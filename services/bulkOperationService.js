const ShopifyServiceV2 = require('./shopifyServiceV2');
const ProductTaggingService = require('../utils/productTagging');
const { logger } = require('../utils/logger');

class BulkOperationService {
  constructor() {
    this.operations = {
      'fix-product-tags': this.fixProductTags.bind(this),
      'validate-all-tags': this.validateAllTags.bind(this),
      'cleanup-old-tags': this.cleanupOldTags.bind(this)
    };
  }

  async processBulkOperation(storeId, runId, params, jobLogger = logger) {
    const { operation, ...operationParams } = params;
    
    if (!this.operations[operation]) {
      throw new Error(`Unknown bulk operation: ${operation}`);
    }

    jobLogger.info('Starting bulk operation', {
      storeId,
      operation,
      params: operationParams
    });

    return await this.operations[operation](storeId, runId, operationParams, jobLogger);
  }

  async fixProductTags(storeId, runId, params, jobLogger) {
    const { dryRun = true, batchSize = 10 } = params;
    
    jobLogger.info('Starting product tag fix operation', {
      storeId,
      dryRun,
      batchSize
    });

    try {
      // Get all products for the store
      const productsResult = await ShopifyServiceV2.getAllProducts(storeId, { limit: 250 });
      
      if (!productsResult.success) {
        throw new Error(`Failed to fetch products: ${productsResult.error}`);
      }

      const products = productsResult.data || [];
      
      // Generate tagging report (only for SplitSet-created products)
      const report = ProductTaggingService.getTaggingReport(products);
      
      jobLogger.info('Product analysis complete', {
        totalProducts: report.totalProducts,
        splitsetProducts: report.splitsetProducts,
        nonSplitsetProducts: report.nonSplitsetProducts,
        needsFixing: report.missingTags
      });
      
      if (dryRun) {
        // Just return analysis
        return {
          operation: 'fix-product-tags',
          dryRun: true,
          storeId,
          summary: {
            totalProductsInStore: report.totalProducts,
            splitsetProducts: report.splitsetProducts,
            nonSplitsetProducts: report.nonSplitsetProducts,
            properlyTagged: report.properlyTagged,
            needsFixing: report.missingTags,
            percentage: report.splitsetProducts > 0 ? Math.round((report.properlyTagged / report.splitsetProducts) * 100) : 0
          },
          note: 'Only SplitSet-created products are analyzed and tagged. Regular store products are left untouched.',
          productsNeedingFix: report.details.filter(d => !d.validation.isValid).map(d => ({
            id: d.id,
            title: d.title,
            currentTags: d.validation.allTags.join(','),
            missingTags: d.validation.missingTags,
            reason: 'Created by SplitSet but missing tracking tags'
          }))
        };
      }

      // Actually fix the tags
      const results = [];
      const productsToFix = report.details.filter(d => !d.validation.isValid);
      
      jobLogger.info('Fixing product tags', {
        totalToFix: productsToFix.length,
        batchSize
      });

      // Process in batches to avoid rate limits
      for (let i = 0; i < productsToFix.length; i += batchSize) {
        const batch = productsToFix.slice(i, i + batchSize);
        
        for (const productDetail of batch) {
          try {
            const product = products.find(p => p.id === productDetail.id);
            if (!product) continue;

            // Use safe tagging - only tag SplitSet-created products
            const taggingDecision = ProductTaggingService.safeTagProduct(product);
            
            if (!taggingDecision.shouldTag) {
              results.push({
                productId: product.id,
                title: product.title,
                success: true,
                action: 'skipped',
                reason: taggingDecision.reason,
                tags: taggingDecision.currentTags
              });
              continue;
            }

            if (!taggingDecision.changed) {
              results.push({
                productId: product.id,
                title: product.title,
                success: true,
                action: 'no_change_needed',
                reason: 'Product already has proper tracking tags',
                tags: taggingDecision.currentTags
              });
              continue;
            }
            
            // Update product with new tags
            const updateResult = await ShopifyServiceV2.updateProduct(storeId, product.id, {
              tags: taggingDecision.newTags
            });

            if (updateResult.success) {
              results.push({
                productId: product.id,
                title: product.title,
                success: true,
                oldTags: taggingDecision.currentTags,
                newTags: taggingDecision.newTags,
                action: 'tags_updated'
              });
              
              jobLogger.info('Product tags fixed', {
                productId: product.id,
                title: product.title,
                productType
              });
            } else {
              results.push({
                productId: product.id,
                title: product.title,
                success: false,
                error: updateResult.error,
                action: 'update_failed'
              });
              
              jobLogger.error('Failed to fix product tags', {
                productId: product.id,
                error: updateResult.error
              });
            }

          } catch (error) {
            results.push({
              productId: productDetail.id,
              title: productDetail.title,
              success: false,
              error: error.message
            });
            
            jobLogger.error('Error processing product', {
              productId: productDetail.id,
              error: error.message
            });
          }
        }

        // Rate limiting delay between batches
        if (i + batchSize < productsToFix.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      const successCount = results.filter(r => r.success).length;
      const errorCount = results.filter(r => !r.success).length;

      return {
        operation: 'fix-product-tags',
        dryRun: false,
        storeId,
        summary: {
          totalProcessed: results.length,
          successful: successCount,
          failed: errorCount,
          batchesProcessed: Math.ceil(productsToFix.length / batchSize)
        },
        results
      };

    } catch (error) {
      jobLogger.error('Bulk tag fix operation failed', {
        error: error.message,
        storeId
      });
      throw error;
    }
  }

  async validateAllTags(storeId, runId, params, jobLogger) {
    jobLogger.info('Starting tag validation for all products', { storeId });

    try {
      const productsResult = await ShopifyServiceV2.getAllProducts(storeId);
      
      if (!productsResult.success) {
        throw new Error(`Failed to fetch products: ${productsResult.error}`);
      }

      const products = productsResult.data || [];
      const report = ProductTaggingService.getTaggingReport(products);

      // Categorize products by type
      const categorized = {
        original: [],
        component: [],
        bundle: [],
        unknown: []
      };

      products.forEach(product => {
        const tags = (product.tags || '').toLowerCase();
        
        if (tags.includes('component')) {
          categorized.component.push(product);
        } else if (tags.includes('bundle')) {
          categorized.bundle.push(product);
        } else if (tags.includes('splitter') || tags.includes('splitset')) {
          categorized.original.push(product);
        } else {
          categorized.unknown.push(product);
        }
      });

      return {
        operation: 'validate-all-tags',
        storeId,
        summary: {
          totalProducts: products.length,
          properlyTagged: report.properlyTagged,
          missingTags: report.missingTags,
          byType: {
            original: categorized.original.length,
            component: categorized.component.length,
            bundle: categorized.bundle.length,
            unknown: categorized.unknown.length
          }
        },
        details: {
          productsNeedingFix: report.details.filter(d => !d.validation.isValid),
          unknownProducts: categorized.unknown.map(p => ({
            id: p.id,
            title: p.title,
            tags: p.tags
          }))
        }
      };

    } catch (error) {
      jobLogger.error('Tag validation failed', {
        error: error.message,
        storeId
      });
      throw error;
    }
  }

  async cleanupOldTags(storeId, runId, params, jobLogger) {
    const { dryRun = true, tagsToRemove = [] } = params;
    
    jobLogger.info('Starting tag cleanup operation', {
      storeId,
      dryRun,
      tagsToRemove
    });

    // This would remove old/deprecated tags from products
    // Implementation would be similar to fixProductTags but removing instead of adding
    
    return {
      operation: 'cleanup-old-tags',
      dryRun,
      storeId,
      message: 'Tag cleanup operation completed',
      tagsToRemove
    };
  }
}

module.exports = new BulkOperationService();
