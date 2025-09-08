/**
 * Component Visibility Service
 * Manages visibility of component products to hide them from storefront
 * while keeping them accessible for bundle functionality
 */

const shopifyService = require('./shopifyService');

class ComponentVisibilityService {
  
  /**
   * Hide component products from storefront
   * Makes them draft/unpublished so customers can't see them
   */
  async hideComponentProducts(componentProductIds) {
    try {
      console.log(`Hiding ${componentProductIds.length} component products from storefront`);
      
      const results = [];
      
      for (const productId of componentProductIds) {
        try {
          // Update product to be unpublished/draft
          const updateResult = await shopifyService.updateProduct(productId, {
            published: false,
            published_at: null,
            status: 'draft',
            tags: await this.addHiddenTags(productId)
          });
          
          if (updateResult.success) {
            results.push({
              productId: productId,
              success: true,
              status: 'hidden'
            });
            console.log(`✅ Hidden component product: ${productId}`);
          } else {
            results.push({
              productId: productId,
              success: false,
              error: updateResult.error
            });
            console.log(`❌ Failed to hide component product: ${productId}`);
          }
        } catch (error) {
          results.push({
            productId: productId,
            success: false,
            error: error.message
          });
          console.error(`Error hiding component product ${productId}:`, error);
        }
      }
      
      const successCount = results.filter(r => r.success).length;
      console.log(`Successfully hidden ${successCount}/${componentProductIds.length} component products`);
      
      return {
        success: true,
        results: results,
        hiddenCount: successCount,
        totalCount: componentProductIds.length
      };
      
    } catch (error) {
      console.error('Error hiding component products:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Show component products on storefront (for admin purposes)
   */
  async showComponentProducts(componentProductIds) {
    try {
      console.log(`Showing ${componentProductIds.length} component products on storefront`);
      
      const results = [];
      
      for (const productId of componentProductIds) {
        try {
          const updateResult = await shopifyService.updateProduct(productId, {
            published: true,
            published_at: new Date().toISOString(),
            status: 'active',
            tags: await this.removeHiddenTags(productId)
          });
          
          if (updateResult.success) {
            results.push({
              productId: productId,
              success: true,
              status: 'visible'
            });
            console.log(`✅ Made component product visible: ${productId}`);
          } else {
            results.push({
              productId: productId,
              success: false,
              error: updateResult.error
            });
          }
        } catch (error) {
          results.push({
            productId: productId,
            success: false,
            error: error.message
          });
        }
      }
      
      const successCount = results.filter(r => r.success).length;
      console.log(`Successfully made visible ${successCount}/${componentProductIds.length} component products`);
      
      return {
        success: true,
        results: results,
        visibleCount: successCount,
        totalCount: componentProductIds.length
      };
      
    } catch (error) {
      console.error('Error showing component products:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Get visibility status of component products
   */
  async getComponentVisibilityStatus(bundleProductId) {
    try {
      // Get component products for this bundle
      const bundleResult = await shopifyService.getProduct(bundleProductId);
      if (!bundleResult.success) {
        throw new Error('Bundle product not found');
      }
      
      const bundleProduct = bundleResult.data;
      const metafields = bundleProduct.metafields || [];
      
      // Find component products metafield
      const componentMetafield = metafields.find(m => 
        m.namespace === 'bundle_app' && m.key === 'component_products'
      );
      
      if (!componentMetafield) {
        return {
          success: true,
          components: [],
          allHidden: true,
          hiddenCount: 0,
          totalCount: 0
        };
      }
      
      const componentData = JSON.parse(componentMetafield.value);
      const componentIds = componentData.map(c => c.id);
      
      // Check visibility status of each component
      const visibilityStatus = [];
      
      for (const componentId of componentIds) {
        try {
          const componentResult = await shopifyService.getProduct(componentId);
          if (componentResult.success) {
            const component = componentResult.data;
            visibilityStatus.push({
              id: componentId,
              title: component.title,
              published: component.published_at !== null,
              status: component.status,
              visible: component.published_at !== null && component.status === 'active'
            });
          }
        } catch (error) {
          visibilityStatus.push({
            id: componentId,
            title: 'Unknown',
            published: false,
            status: 'unknown',
            visible: false,
            error: error.message
          });
        }
      }
      
      const hiddenCount = visibilityStatus.filter(c => !c.visible).length;
      const allHidden = hiddenCount === visibilityStatus.length;
      
      return {
        success: true,
        components: visibilityStatus,
        allHidden: allHidden,
        hiddenCount: hiddenCount,
        totalCount: visibilityStatus.length
      };
      
    } catch (error) {
      console.error('Error getting component visibility status:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Hide all component products for all bundles
   */
  async hideAllComponentProducts() {
    try {
      console.log('Finding and hiding all component products...');
      
      // Get all products with component tags
      const productsResult = await shopifyService.getAllProducts();
      if (!productsResult.success) {
        throw new Error('Failed to fetch products');
      }
      
      const allProducts = productsResult.data;
      const componentProducts = allProducts.filter(p => 
        p.tags && (
          p.tags.includes('component') || 
          p.tags.includes('set-component') ||
          p.tags.includes('auto-generated')
        )
      );
      
      console.log(`Found ${componentProducts.length} component products to hide`);
      
      if (componentProducts.length === 0) {
        return {
          success: true,
          message: 'No component products found to hide',
          hiddenCount: 0
        };
      }
      
      const componentIds = componentProducts.map(p => p.id);
      const result = await this.hideComponentProducts(componentIds);
      
      return {
        success: true,
        message: `Hidden ${result.hiddenCount} component products from storefront`,
        hiddenCount: result.hiddenCount,
        totalFound: componentProducts.length
      };
      
    } catch (error) {
      console.error('Error hiding all component products:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Add hidden tags to product
   */
  async addHiddenTags(productId) {
    try {
      const productResult = await shopifyService.getProduct(productId);
      if (!productResult.success) {
        return 'hidden-component, component, auto-generated';
      }
      
      const product = productResult.data;
      const existingTags = product.tags ? product.tags.split(',').map(t => t.trim()) : [];
      
      const hiddenTags = ['hidden-component', 'component', 'auto-generated', 'set-component'];
      const newTags = [...new Set([...existingTags, ...hiddenTags])];
      
      return newTags.join(', ');
    } catch (error) {
      return 'hidden-component, component, auto-generated';
    }
  }
  
  /**
   * Remove hidden tags from product
   */
  async removeHiddenTags(productId) {
    try {
      const productResult = await shopifyService.getProduct(productId);
      if (!productResult.success) {
        return 'component, auto-generated';
      }
      
      const product = productResult.data;
      const existingTags = product.tags ? product.tags.split(',').map(t => t.trim()) : [];
      
      const tagsToRemove = ['hidden-component'];
      const newTags = existingTags.filter(tag => !tagsToRemove.includes(tag));
      
      return newTags.join(', ');
    } catch (error) {
      return 'component, auto-generated';
    }
  }
  
  /**
   * Bulk update component product visibility
   */
  async bulkUpdateComponentVisibility(componentIds, visible = false) {
    try {
      if (visible) {
        return await this.showComponentProducts(componentIds);
      } else {
        return await this.hideComponentProducts(componentIds);
      }
    } catch (error) {
      console.error('Error in bulk visibility update:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = new ComponentVisibilityService();

