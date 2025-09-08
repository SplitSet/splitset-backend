/**
 * Shopify Cart Transform Function
 * This function runs on Shopify's infrastructure during checkout
 * It automatically adds bundle components as separate line items
 */

// @ts-check
import { CartTransform } from '@shopify/function-extensions';

/**
 * @param {CartTransform.Input} input
 * @returns {CartTransform.Output}
 */
export default function transform(input) {
  const transformOperations = [];
  
  // Process each cart line
  for (const cartLine of input.cart.lines) {
    // Check if this product has bundle metafields
    const bundleConfig = cartLine.merchandise.product.metafield({
      namespace: 'bundle_app',
      key: 'cart_transform_config'
    });
    
    const isBundle = cartLine.merchandise.product.metafield({
      namespace: 'bundle_app',
      key: 'is_bundle'
    });
    
    const componentProducts = cartLine.merchandise.product.metafield({
      namespace: 'bundle_app',
      key: 'component_products'
    });
    
    // If this is a bundle product
    if (isBundle && isBundle.value === 'true' && bundleConfig && componentProducts) {
      try {
        const config = JSON.parse(bundleConfig.value);
        const components = JSON.parse(componentProducts.value);
        
        if (config.enabled) {
          // Remove the original bundle product line
          transformOperations.push({
            remove: {
              cartLineId: cartLine.id
            }
          });
          
          // Add each component as a separate line item
          for (const component of components) {
            // Find the matching variant based on the selected options
            const selectedVariantOptions = cartLine.merchandise.selectedOptions;
            let variantToAdd = component.variants[0]; // Default to first variant
            
            // Try to match variants based on options
            if (selectedVariantOptions && component.variants.length > 1) {
              for (const variant of component.variants) {
                const matchesAllOptions = variant.options.every((option, index) => {
                  return !selectedVariantOptions[index] || 
                         option === selectedVariantOptions[index].value;
                });
                
                if (matchesAllOptions) {
                  variantToAdd = variant;
                  break;
                }
              }
            }
            
            // Add component to cart
            transformOperations.push({
              add: {
                merchandiseId: `gid://shopify/ProductVariant/${variantToAdd.id}`,
                quantity: cartLine.quantity,
                // Add line item properties to identify bundle components
                attributes: [
                  {
                    key: '_bundle_id',
                    value: `bundle_${cartLine.merchandise.product.id}`
                  },
                  {
                    key: '_component_type',
                    value: component.componentType
                  },
                  {
                    key: '_bundle_component',
                    value: 'true'
                  }
                ]
              }
            });
          }
        }
      } catch (error) {
        // If there's an error parsing, just keep the original line
        console.error('Error processing bundle:', error);
      }
    }
  }
  
  return {
    operations: transformOperations
  };
}
