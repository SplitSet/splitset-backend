const express = require('express');
const router = express.Router();
const { authenticate, requireStoreAccess } = require('../middleware/auth');
const StoreV2 = require('../models/StoreV2');
const ShopifyServiceV2 = require('../services/shopifyServiceV2');

// Create theme backup
router.post('/:storeId/theme/backup',
  authenticate,
  requireStoreAccess('owner'),
  async (req, res) => {
    try {
      const { storeId } = req.params;
      
      const shopifyService = await ShopifyServiceV2.create(storeId);
      
      // Get current theme
      const themesResponse = await shopifyService.getThemes();
      if (!themesResponse.success) {
        return res.status(400).json({
          success: false,
          error: 'Failed to fetch themes'
        });
      }

      const publishedTheme = themesResponse.data.find(theme => theme.role === 'main');
      if (!publishedTheme) {
        return res.status(400).json({
          success: false,
          error: 'No published theme found'
        });
      }

      // Create backup by duplicating theme
      const backupName = `${publishedTheme.name} - Before SplitSet Creation`;
      const backupResponse = await shopifyService.duplicateTheme(publishedTheme.id, backupName);
      
      if (!backupResponse.success) {
        return res.status(400).json({
          success: false,
          error: 'Failed to create theme backup'
        });
      }

      // Update store metadata to track backup
      const store = await StoreV2.findById(storeId);
      const metadata = JSON.parse(store.metadata || '{}');
      metadata.themeBackup = {
        originalThemeId: publishedTheme.id,
        backupThemeId: backupResponse.data.id,
        backupName: backupName,
        createdAt: new Date().toISOString()
      };

      await StoreV2.update(storeId, { metadata });

      req.logger?.audit('Theme backup created', {
        storeId,
        userId: req.user.id,
        originalThemeId: publishedTheme.id,
        backupThemeId: backupResponse.data.id
      });

      res.json({
        success: true,
        message: 'Theme backup created successfully',
        data: {
          backupId: backupResponse.data.id,
          backupName: backupName,
          originalTheme: publishedTheme.name
        }
      });

    } catch (error) {
      req.logger?.error('Theme backup failed', {
        error: error.message,
        storeId: req.params.storeId,
        userId: req.user?.id
      });

      res.status(500).json({
        success: false,
        error: 'Theme backup failed',
        details: error.message
      });
    }
  }
);

// Enable SplitSet functionality
router.post('/:storeId/splitset/enable',
  authenticate,
  requireStoreAccess('owner'),
  async (req, res) => {
    try {
      const { storeId } = req.params;
      
      // Update store settings
      const store = await StoreV2.findById(storeId);
      const metadata = JSON.parse(store.metadata || '{}');
      metadata.splitsetEnabled = true;
      metadata.enabledAt = new Date().toISOString();

      await StoreV2.update(storeId, { metadata });

      // Initialize Shopify service and process products
      const shopifyService = await ShopifyServiceV2.create(storeId);
      
      // Get all products that could be sets (contain " - " in title)
      const allProducts = await shopifyService.getAllProducts();
      const setProducts = allProducts.filter(product => 
        product.title && product.title.includes(' - ')
      );

      let productsProcessed = 0;
      const errors = [];

      // Process each set product
      for (const product of setProducts.slice(0, 10)) { // Limit to first 10 for demo
        try {
          // Add SplitSet metafields to mark as processed
          await shopifyService.setProductMetafield(product.id, {
            namespace: 'splitset',
            key: 'processed',
            value: 'true',
            type: 'boolean'
          });

          await shopifyService.setProductMetafield(product.id, {
            namespace: 'splitset',
            key: 'original_product',
            value: 'true',
            type: 'boolean'
          });

          productsProcessed++;
        } catch (error) {
          errors.push(`Failed to process ${product.title}: ${error.message}`);
        }
      }

      // Update metadata with processing results
      metadata.productsProcessed = productsProcessed;
      metadata.lastProcessedAt = new Date().toISOString();
      await StoreV2.update(storeId, { metadata });

      req.logger?.audit('SplitSet enabled', {
        storeId,
        userId: req.user.id,
        productsProcessed,
        errors: errors.length
      });

      res.json({
        success: true,
        message: 'SplitSet enabled successfully',
        data: {
          productsProcessed,
          errors: errors.length > 0 ? errors : undefined
        }
      });

    } catch (error) {
      req.logger?.error('SplitSet enable failed', {
        error: error.message,
        storeId: req.params.storeId,
        userId: req.user?.id
      });

      res.status(500).json({
        success: false,
        error: 'Failed to enable SplitSet',
        details: error.message
      });
    }
  }
);

// Disable SplitSet functionality
router.post('/:storeId/splitset/disable',
  authenticate,
  requireStoreAccess('owner'),
  async (req, res) => {
    try {
      const { storeId } = req.params;
      
      // Update store settings
      const store = await StoreV2.findById(storeId);
      const metadata = JSON.parse(store.metadata || '{}');
      metadata.splitsetEnabled = false;
      metadata.disabledAt = new Date().toISOString();

      // Initialize Shopify service
      const shopifyService = await ShopifyServiceV2.create(storeId);
      
      // Find all products with SplitSet metafields
      const allProducts = await shopifyService.getAllProducts();
      let productsProcessed = 0;
      const errors = [];

      for (const product of allProducts) {
        try {
          const metafields = await shopifyService.getProductMetafields(product.id);
          
          if (metafields.success) {
            const splitsetMetafields = metafields.data.filter(mf => 
              mf.namespace === 'splitset'
            );

            // Remove SplitSet metafields
            for (const metafield of splitsetMetafields) {
              try {
                await shopifyService.deleteMetafield(metafield.id);
              } catch (error) {
                errors.push(`Failed to remove metafield from ${product.title}`);
              }
            }

            // If this was a split product (not original), delete it
            const isOriginal = splitsetMetafields.some(mf => 
              mf.key === 'original_product' && mf.value === 'true'
            );
            
            if (!isOriginal && splitsetMetafields.length > 0) {
              await shopifyService.deleteProduct(product.id);
            }

            productsProcessed++;
          }
        } catch (error) {
          errors.push(`Failed to process ${product.title}: ${error.message}`);
        }
      }

      // Clear processing metadata
      delete metadata.productsProcessed;
      delete metadata.lastProcessedAt;
      await StoreV2.update(storeId, { metadata });

      req.logger?.audit('SplitSet disabled', {
        storeId,
        userId: req.user.id,
        productsProcessed,
        errors: errors.length
      });

      res.json({
        success: true,
        message: 'SplitSet disabled successfully',
        data: {
          productsProcessed,
          errors: errors.length > 0 ? errors : undefined
        }
      });

    } catch (error) {
      req.logger?.error('SplitSet disable failed', {
        error: error.message,
        storeId: req.params.storeId,
        userId: req.user?.id
      });

      res.status(500).json({
        success: false,
        error: 'Failed to disable SplitSet',
        details: error.message
      });
    }
  }
);

// Clean up all SplitSet data
router.delete('/:storeId/splitset/cleanup',
  authenticate,
  requireStoreAccess('owner'),
  async (req, res) => {
    try {
      const { storeId } = req.params;
      
      const shopifyService = await ShopifyServiceV2.create(storeId);
      
      // Get all products and clean up SplitSet data
      const allProducts = await shopifyService.getAllProducts();
      let productsDeleted = 0;
      let metafieldsDeleted = 0;
      const errors = [];

      for (const product of allProducts) {
        try {
          const metafields = await shopifyService.getProductMetafields(product.id);
          
          if (metafields.success) {
            const splitsetMetafields = metafields.data.filter(mf => 
              mf.namespace === 'splitset'
            );

            // Remove all SplitSet metafields
            for (const metafield of splitsetMetafields) {
              try {
                await shopifyService.deleteMetafield(metafield.id);
                metafieldsDeleted++;
              } catch (error) {
                errors.push(`Failed to remove metafield from ${product.title}`);
              }
            }

            // Check if this is an original product
            const isOriginal = splitsetMetafields.some(mf => 
              mf.key === 'original_product' && mf.value === 'true'
            );
            
            // If not original and has SplitSet metafields, delete the product
            if (!isOriginal && splitsetMetafields.length > 0) {
              await shopifyService.deleteProduct(product.id);
              productsDeleted++;
            }
          }
        } catch (error) {
          errors.push(`Failed to process ${product.title}: ${error.message}`);
        }
      }

      // Clear all SplitSet metadata from store
      const store = await StoreV2.findById(storeId);
      const metadata = JSON.parse(store.metadata || '{}');
      
      // Remove all SplitSet-related metadata
      delete metadata.splitsetEnabled;
      delete metadata.enabledAt;
      delete metadata.disabledAt;
      delete metadata.productsProcessed;
      delete metadata.lastProcessedAt;
      delete metadata.themeBackup;

      await StoreV2.update(storeId, { metadata });

      req.logger?.audit('SplitSet cleanup completed', {
        storeId,
        userId: req.user.id,
        productsDeleted,
        metafieldsDeleted,
        errors: errors.length
      });

      res.json({
        success: true,
        message: 'SplitSet cleanup completed',
        data: {
          productsDeleted,
          metafieldsDeleted,
          errors: errors.length > 0 ? errors : undefined
        }
      });

    } catch (error) {
      req.logger?.error('SplitSet cleanup failed', {
        error: error.message,
        storeId: req.params.storeId,
        userId: req.user?.id
      });

      res.status(500).json({
        success: false,
        error: 'SplitSet cleanup failed',
        details: error.message
      });
    }
  }
);

module.exports = router;
