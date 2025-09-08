const express = require('express');
const router = express.Router();
const ShopifyServiceV2 = require('../services/shopifyServiceV2');
const ProductTaggingService = require('../utils/productTagging');
const Run = require('../models/Run');
const QueueService = require('../services/queueService');
const { authenticate, requireRole } = require('../middleware/auth');
const { validateBody, validateParams } = require('../middleware/validation');
const { z } = require('zod');

// Add tracking tags to existing products (admin only)
router.post('/fix-product-tags',
  authenticate,
  requireRole('admin'),
  validateBody(z.object({
    storeId: z.number().int().positive(),
    dryRun: z.boolean().optional().default(true),
    batchSize: z.number().int().min(1).max(50).optional().default(10)
  })),
  async (req, res) => {
    try {
      const { storeId, dryRun, batchSize } = req.body;

      // Create run record
      const run = await Run.create({
        storeId,
        type: 'bulk_operation',
        inputParams: { operation: 'fix-product-tags', dryRun, batchSize }
      });

      // Queue the job
      await QueueService.addJob(storeId, 'bulk_operation', {
        runId: run.run_id,
        operation: 'fix-product-tags',
        dryRun,
        batchSize
      });

      req.logger?.audit('Product tag fix initiated', {
        storeId,
        runId: run.run_id,
        dryRun,
        batchSize
      });

      res.status(202).json({
        success: true,
        message: dryRun ? 'Tag analysis started' : 'Tag fix operation started',
        runId: run.run_id,
        dryRun
      });

    } catch (error) {
      req.logger?.error('Failed to start tag fix operation', {
        error: error.message,
        storeId: req.body.storeId
      });

      res.status(500).json({
        success: false,
        error: 'Failed to start tag fix operation'
      });
    }
  }
);

// Get product tagging report
router.get('/:storeId/product-tagging-report',
  authenticate,
  requireRole('admin'),
  validateParams(z.object({ storeId: z.coerce.number().int().positive() })),
  async (req, res) => {
    try {
      const { storeId } = req.params;
      const { limit = 250 } = req.query;

      // Get all products for the store
      const productsResult = await ShopifyServiceV2.getAllProducts(storeId, { limit });
      
      if (!productsResult.success) {
        return res.status(400).json({
          success: false,
          error: productsResult.error
        });
      }

      // Generate tagging report
      const report = ProductTaggingService.getTaggingReport(productsResult.data);

      req.logger?.info('Product tagging report generated', {
        storeId,
        total: report.total,
        properlyTagged: report.properlyTagged,
        missingTags: report.missingTags
      });

      res.json({
        success: true,
        data: {
          storeId,
          summary: {
            totalProductsInStore: report.totalProducts,
            splitsetProducts: report.splitsetProducts,
            nonSplitsetProducts: report.nonSplitsetProducts,
            properlyTagged: report.properlyTagged,
            missingTags: report.missingTags,
            percentage: report.splitsetProducts > 0 ? Math.round((report.properlyTagged / report.splitsetProducts) * 100) : 0
          },
          note: 'Only products created by SplitSet are included in this analysis. Regular store products are not affected.',
          details: report.details.filter(detail => !detail.validation.isValid), // Only show SplitSet products needing fixes
          recommendations: report.missingTags > 0 ? [
            'Run the fix-product-tags operation to add missing tracking tags to SplitSet-created products',
            'Consider running in dry-run mode first to preview changes',
            'Only products created by SplitSet will be modified',
            'Products without tracking tags will not be counted in billing analytics'
          ] : [
            'All SplitSet-created products have proper tracking tags',
            'Analytics and billing will work correctly',
            `${report.nonSplitsetProducts} regular store products are unaffected`
          ]
        }
      });

    } catch (error) {
      req.logger?.error('Failed to generate tagging report', {
        error: error.message,
        storeId: req.params.storeId
      });

      res.status(500).json({
        success: false,
        error: 'Failed to generate tagging report'
      });
    }
  }
);

// Validate specific product tagging
router.get('/:storeId/products/:productId/validate-tags',
  authenticate,
  requireRole('admin'),
  validateParams(z.object({ 
    storeId: z.coerce.number().int().positive(),
    productId: z.coerce.number().int().positive()
  })),
  async (req, res) => {
    try {
      const { storeId, productId } = req.params;

      // Get product from Shopify
      const productResult = await ShopifyServiceV2.getProduct(storeId, productId);
      
      if (!productResult.success) {
        return res.status(404).json({
          success: false,
          error: 'Product not found'
        });
      }

      const product = productResult.data.product || productResult.data;
      const validation = ProductTaggingService.validateProductTagging(product);

      res.json({
        success: true,
        data: {
          productId: product.id,
          title: product.title,
          currentTags: product.tags,
          validation,
          recommendations: validation.isValid ? 
            ['Product has proper tracking tags'] : 
            ['Add missing tracking tags: ' + validation.missingTags.join(', ')]
        }
      });

    } catch (error) {
      req.logger?.error('Failed to validate product tags', {
        error: error.message,
        storeId: req.params.storeId,
        productId: req.params.productId
      });

      res.status(500).json({
        success: false,
        error: 'Failed to validate product tags'
      });
    }
  }
);

// Fix tags for a specific product
router.post('/:storeId/products/:productId/fix-tags',
  authenticate,
  requireRole('admin'),
  validateParams(z.object({ 
    storeId: z.coerce.number().int().positive(),
    productId: z.coerce.number().int().positive()
  })),
  validateBody(z.object({
    productType: z.enum(['original', 'component', 'bundle', 'variant']).optional().default('original'),
    dryRun: z.boolean().optional().default(false)
  })),
  async (req, res) => {
    try {
      const { storeId, productId } = req.params;
      const { productType, dryRun } = req.body;

      // Get current product
      const productResult = await ShopifyServiceV2.getProduct(storeId, productId);
      
      if (!productResult.success) {
        return res.status(404).json({
          success: false,
          error: 'Product not found'
        });
      }

      const product = productResult.data.product || productResult.data;
      const currentTags = product.tags || '';
      
      // Generate new tags
      const newTags = ProductTaggingService.ensureTrackingTags(currentTags, productType);
      
      if (dryRun) {
        const validation = ProductTaggingService.validateProductTagging(product);
        
        res.json({
          success: true,
          dryRun: true,
          data: {
            productId: product.id,
            title: product.title,
            currentTags,
            proposedTags: newTags,
            validation,
            wouldChange: currentTags !== newTags
          }
        });
      } else {
        // Update product with new tags
        const updateResult = await ShopifyServiceV2.updateProduct(storeId, productId, {
          tags: newTags
        });
        
        if (!updateResult.success) {
          return res.status(400).json({
            success: false,
            error: updateResult.error
          });
        }

        req.logger?.audit('Product tags fixed', {
          storeId,
          productId,
          oldTags: currentTags,
          newTags,
          productType
        });

        res.json({
          success: true,
          message: 'Product tags updated successfully',
          data: {
            productId: product.id,
            title: product.title,
            oldTags: currentTags,
            newTags,
            productType
          }
        });
      }

    } catch (error) {
      req.logger?.error('Failed to fix product tags', {
        error: error.message,
        storeId: req.params.storeId,
        productId: req.params.productId
      });

      res.status(500).json({
        success: false,
        error: 'Failed to fix product tags'
      });
    }
  }
);

module.exports = router;
