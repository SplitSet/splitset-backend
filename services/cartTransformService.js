/**
 * Cart Transform Service
 * Handles the cart transformation logic for bundles
 * This ensures when a bundle product is added to cart,
 * all component products are automatically added with synchronized variants
 */

class CartTransformService {
  /**
   * Check if a product is a bundle and needs cart transformation
   */
  async isBundle(productId, storeId) {
    const ShopifyServiceV2 = require('./shopifyServiceV2');
    const shopifyService = await ShopifyServiceV2.create(storeId);
    const productResult = await shopifyService.getProduct(productId);
    
    if (!productResult.success) {
      return false;
    }
    
    const product = productResult.data;
    
    // Check if product has bundle metafields
    if (product.metafields) {
      const isBundleField = product.metafields.find(
        m => m.namespace === 'bundle_app' && m.key === 'is_bundle'
      );
      return isBundleField && isBundleField.value === 'true';
    }
    
    return false;
  }

  /**
   * Get bundle configuration for a product
   */
  async getBundleConfig(productId, storeId) {
    const ShopifyServiceV2 = require('./shopifyServiceV2');
    const shopifyService = await ShopifyServiceV2.create(storeId);
    const productResult = await shopifyService.getProduct(productId);
    
    if (!productResult.success) {
      return null;
    }
    
    const product = productResult.data;
    
    // Get bundle config from metafields
    if (product.metafields) {
      const bundleConfigField = product.metafields.find(
        m => m.namespace === 'bundle_app' && m.key === 'bundle_config'
      );
      
      if (bundleConfigField) {
        try {
          return JSON.parse(bundleConfigField.value);
        } catch (error) {
          console.error('Failed to parse bundle config:', error);
          return null;
        }
      }
    }
    
    return null;
  }

  /**
   * Transform cart items based on bundle configuration
   * This is called when a bundle product is added to cart
   */
  async transformCart(cartItems, storeId) {
    const transformedItems = [];
    const ShopifyServiceV2 = require('./shopifyServiceV2');
    const shopifyService = await ShopifyServiceV2.create(storeId);
    
    for (const item of cartItems) {
      // Check if this is a bundle product
      const bundleConfig = await this.getBundleConfig(item.productId, storeId);
      
      if (bundleConfig && bundleConfig.cartTransform?.enabled) {
        console.log(`Transforming bundle product: ${item.productId}`);
        
        // Add the main product (original bundle)
        transformedItems.push({
          ...item,
          isBundleParent: true,
          bundleId: bundleConfig.bundleId || `bundle_${item.productId}`
        });
        
        // Add component products
        for (const bundleProduct of bundleConfig.bundleProducts) {
          // Find matching variant based on selected options
          const selectedVariant = await this.findMatchingVariant(
            item.variantId,
            item.productId,
            bundleProduct.id,
            bundleProduct.variantMapping,
            storeId
          );
          
          transformedItems.push({
            productId: bundleProduct.id,
            variantId: selectedVariant?.id || null,
            quantity: item.quantity * bundleProduct.quantity,
            price: selectedVariant?.price || 0,
            title: bundleProduct.title,
            isBundleComponent: true,
            bundleId: bundleConfig.bundleId || `bundle_${item.productId}`,
            parentProductId: item.productId,
            componentType: bundleProduct.componentType,
            hideVariantSelector: bundleProduct.variantMapping?.hideVariants || false
          });
        }
      } else {
        // Not a bundle, add as-is
        transformedItems.push(item);
      }
    }
    
    return transformedItems;
  }

  /**
   * Find matching variant in target product based on main product variant
   */
  async findMatchingVariant(mainVariantId, mainProductId, targetProductId, variantMapping, storeId) {
    const ShopifyServiceV2 = require('./shopifyServiceV2');
    const shopifyService = await ShopifyServiceV2.create(storeId);
    
    // Get main product variant details
    const mainProductResult = await shopifyService.getProduct(mainProductId);
    if (!mainProductResult.success) return null;
    
    const mainVariant = mainProductResult.data.variants.find(v => v.id === mainVariantId);
    if (!mainVariant) return null;
    
    // Get target product details
    const targetProductResult = await shopifyService.getProduct(targetProductId);
    if (!targetProductResult.success) return null;
    
    const targetVariants = targetProductResult.data.variants;
    
    // If auto-select is enabled, try to find matching variant
    if (variantMapping?.autoSelect) {
      // Try exact match first
      for (const targetVariant of targetVariants) {
        let allOptionsMatch = true;
        
        // Check each sync option
        if (variantMapping.syncOptions) {
          for (const syncOption of variantMapping.syncOptions) {
            const mainValue = mainVariant[`option${this.getOptionIndex(mainProductResult.data, syncOption.mainOption)}`];
            const targetValue = targetVariant[`option${this.getOptionIndex(targetProductResult.data, syncOption.targetOption)}`];
            
            if (mainValue !== targetValue) {
              allOptionsMatch = false;
              break;
            }
          }
        }
        
        if (allOptionsMatch) {
          return targetVariant;
        }
      }
      
      // Fallback: Try fuzzy matching (e.g., "Small" matches "S")
      for (const targetVariant of targetVariants) {
        let fuzzyMatch = true;
        
        if (variantMapping.syncOptions) {
          for (const syncOption of variantMapping.syncOptions) {
            const mainValue = mainVariant[`option${this.getOptionIndex(mainProductResult.data, syncOption.mainOption)}`];
            const targetValue = targetVariant[`option${this.getOptionIndex(targetProductResult.data, syncOption.targetOption)}`];
            
            if (!this.fuzzyMatchVariantOption(mainValue, targetValue)) {
              fuzzyMatch = false;
              break;
            }
          }
        }
        
        if (fuzzyMatch) {
          return targetVariant;
        }
      }
    }
    
    // Final fallback: Return first variant
    return targetVariants[0] || null;
  }

  /**
   * Get option index by name
   */
  getOptionIndex(product, optionName) {
    const index = product.options.findIndex(opt => 
      opt.name.toLowerCase() === optionName.toLowerCase()
    );
    return index >= 0 ? index + 1 : 1;
  }

  /**
   * Fuzzy match variant options (e.g., "Small" matches "S")
   */
  fuzzyMatchVariantOption(value1, value2) {
    if (!value1 || !value2) return false;
    
    const v1 = value1.toString().toLowerCase();
    const v2 = value2.toString().toLowerCase();
    
    // Exact match
    if (v1 === v2) return true;
    
    // Size abbreviations
    const sizeMap = {
      'small': ['s', 'sm'],
      'medium': ['m', 'md'],
      'large': ['l', 'lg'],
      'extra large': ['xl', 'x-large'],
      'extra small': ['xs', 'x-small'],
      'double extra large': ['xxl', '2xl'],
      'triple extra large': ['xxxl', '3xl']
    };
    
    for (const [full, abbreviations] of Object.entries(sizeMap)) {
      if ((v1.includes(full) || abbreviations.includes(v1)) &&
          (v2.includes(full) || abbreviations.includes(v2))) {
        return true;
      }
    }
    
    // Check if one contains the other
    return v1.includes(v2) || v2.includes(v1);
  }

  /**
   * Get cart transform script for Shopify
   * This script runs on Shopify's servers during checkout
   */
  getCartTransformScript() {
    return `
      // Shopify Cart Transform Script
      // Automatically adds bundle components when main product is added
      
      export default function transform(input) {
        const cartLines = input.cartLines;
        const transformedLines = [];
        
        for (const line of cartLines) {
          // Check if this is a bundle product
          const bundleMetafield = line.merchandise.product.metafield({
            namespace: 'bundle_app',
            key: 'cart_transform_config'
          });
          
          if (bundleMetafield) {
            const config = JSON.parse(bundleMetafield.value);
            
            if (config.enabled) {
              // Keep the main product
              transformedLines.push(line);
              
              // Add bundle items
              for (const bundleItem of config.bundleItems) {
                transformedLines.push({
                  merchandiseId: bundleItem.productId,
                  quantity: line.quantity * bundleItem.quantity
                });
              }
            } else {
              transformedLines.push(line);
            }
          } else {
            transformedLines.push(line);
          }
        }
        
        return {
          cartLines: transformedLines
        };
      }
    `;
  }
}

module.exports = new CartTransformService();
