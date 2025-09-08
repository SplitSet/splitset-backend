/**
 * Bundle Display Service
 * Generates the HTML/JSON structure for displaying bundle components on product pages
 * Similar to FastBundle's display format
 */

class BundleDisplayService {
  /**
   * Generate bundle display configuration for product page
   */
  generateBundleDisplay(originalProduct, componentProducts, bundleConfig) {
    const displayConfig = {
      enabled: true,
      displayType: 'multi-line', // multi-line display like FastBundle
      containerClass: 'bundle-products-container',
      showVariantSelectors: true,
      showPrices: true,
      showImages: true,
      components: componentProducts.map((product, index) => ({
        id: product.id,
        handle: product.handle,
        title: product.title,
        price: product.variants[0].price,
        compareAtPrice: product.variants[0].compare_at_price,
        image: product.images[0] || null,
        variants: product.variants.map(v => ({
          id: v.id,
          title: v.title,
          price: v.price,
          available: v.available !== false,
          options: {
            option1: v.option1,
            option2: v.option2,
            option3: v.option3
          }
        })),
        options: product.options,
        componentType: bundleConfig.bundleProducts[index].componentType,
        displayOrder: index,
        variantSync: {
          enabled: true,
          hideSelector: index > 0, // Only show selector for first product
          syncWith: index > 0 ? componentProducts[0].id : null
        }
      })),
      bundleSummary: {
        totalPrice: componentProducts.reduce((sum, p) => sum + parseFloat(p.variants[0].price), 0),
        originalPrice: originalProduct.variants[0].price,
        componentCount: componentProducts.length,
        showSavings: false
      }
    };

    return displayConfig;
  }

  /**
   * Generate HTML for bundle display (for theme integration)
   */
  generateBundleHTML(displayConfig) {
    return `
      <div class="bundle-products-display" data-bundle-config='${JSON.stringify(displayConfig)}'>
        ${displayConfig.components.map((component, index) => `
          <div class="bundle-product-item" data-product-id="${component.id}" data-component-index="${index}">
            <div class="bundle-product-info">
              ${component.image ? `
                <div class="bundle-product-thumbnail" style="width: 80px; height: 80px;">
                  <img src="${component.image.src}" alt="${component.title}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 6px;">
                </div>
              ` : ''}
              <div class="bundle-product-details">
                <div class="bundle-product-title">
                  <a href="/products/${component.handle}" target="_blank">${component.title}</a>
                </div>
                <div class="bundle-product-price">
                  <span class="money">₹${parseFloat(component.price).toFixed(2)}</span>
                </div>
              </div>
            </div>
            ${component.variants.length > 1 && !component.variantSync.hideSelector ? `
              <div class="bundle-product-variants">
                <select class="bundle-variant-selector" data-product-id="${component.id}">
                  ${component.variants.map(v => `
                    <option value="${v.id}" data-price="${v.price}">
                      ${v.title}
                    </option>
                  `).join('')}
                </select>
              </div>
            ` : ''}
            ${index < displayConfig.components.length - 1 ? '<div class="bundle-divider"></div>' : ''}
          </div>
        `).join('')}
        <div class="bundle-total-summary">
          <div class="bundle-total-label">Total Bundle Price:</div>
          <div class="bundle-total-price">₹${displayConfig.bundleSummary.totalPrice.toFixed(2)}</div>
        </div>
      </div>
    `;
  }

  /**
   * Generate script for variant synchronization
   */
  generateSyncScript() {
    return `
      <script>
        (function() {
          // Bundle Variant Synchronization
          const bundleContainer = document.querySelector('.bundle-products-display');
          if (!bundleContainer) return;
          
          const config = JSON.parse(bundleContainer.dataset.bundleConfig);
          const variantSelectors = bundleContainer.querySelectorAll('.bundle-variant-selector');
          
          // Sync variants when main selector changes
          if (variantSelectors.length > 0) {
            variantSelectors[0].addEventListener('change', function(e) {
              const selectedIndex = e.target.selectedIndex;
              
              // Update all other selectors to match
              variantSelectors.forEach((selector, index) => {
                if (index > 0 && selector.options[selectedIndex]) {
                  selector.selectedIndex = selectedIndex;
                }
              });
              
              // Update total price if needed
              updateBundlePrice();
            });
          }
          
          function updateBundlePrice() {
            let total = 0;
            variantSelectors.forEach(selector => {
              const selectedOption = selector.options[selector.selectedIndex];
              if (selectedOption) {
                total += parseFloat(selectedOption.dataset.price);
              }
            });
            
            const priceElement = bundleContainer.querySelector('.bundle-total-price');
            if (priceElement) {
              priceElement.textContent = '₹' + total.toFixed(2);
            }
          }
          
          // Cart transform integration
          const addToCartButton = document.querySelector('[name="add"]');
          if (addToCartButton) {
            addToCartButton.addEventListener('click', function(e) {
              e.preventDefault();
              
              // Collect all component variants
              const items = [];
              config.components.forEach((component, index) => {
                const selector = variantSelectors[index];
                const variantId = selector ? selector.value : component.variants[0].id;
                
                items.push({
                  id: variantId,
                  quantity: 1,
                  properties: {
                    _bundle_id: config.bundleId,
                    _component_type: component.componentType,
                    _bundle_product: true
                  }
                });
              });
              
              // Add all items to cart
              addBundleToCart(items);
            });
          }
          
          async function addBundleToCart(items) {
            try {
              const response = await fetch('/cart/add.js', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ items })
              });
              
              if (response.ok) {
                // Redirect to cart or show success message
                window.location.href = '/cart';
              } else {
                console.error('Failed to add bundle to cart');
              }
            } catch (error) {
              console.error('Error adding bundle to cart:', error);
            }
          }
        })();
      </script>
    `;
  }
}

module.exports = new BundleDisplayService();
