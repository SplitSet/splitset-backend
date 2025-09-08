/**
 * Bundle Template Service
 * Creates and manages a dedicated product template for bundle products
 */

const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

class BundleTemplateService {
  constructor() {
    this.baseURL = `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2023-10`;
    this.accessToken = process.env.SHOPIFY_ACCESS_TOKEN;
    this.headers = {
      'X-Shopify-Access-Token': this.accessToken,
      'Content-Type': 'application/json'
    };
  }

  /**
   * Create a dedicated bundle product template
   */
  async createBundleTemplate() {
    try {
      console.log('🚀 Creating dedicated bundle product template...');
      
      // Get active theme
      const themes = await axios.get(
        `${this.baseURL}/themes.json`,
        { headers: this.headers }
      );
      
      const activeTheme = themes.data.themes.find(t => t.role === 'main');
      if (!activeTheme) {
        throw new Error('No active theme found');
      }
      
      console.log(`📦 Working with theme: ${activeTheme.name}`);
      
      // Step 1: Get the existing product template
      let existingTemplate;
      try {
        const response = await axios.get(
          `${this.baseURL}/themes/${activeTheme.id}/assets.json?asset[key]=templates/product.json`,
          { headers: this.headers }
        );
        existingTemplate = JSON.parse(response.data.asset.value);
        console.log('✅ Found existing product.json template');
      } catch (error) {
        console.log('⚠️ No product.json found, checking for product.liquid');
        
        // Try liquid template
        try {
          const liquidResponse = await axios.get(
            `${this.baseURL}/themes/${activeTheme.id}/assets.json?asset[key]=templates/product.liquid`,
            { headers: this.headers }
          );
          // Create a basic JSON template structure
          existingTemplate = {
            sections: {
              main: {
                type: "main-product",
                settings: {}
              }
            },
            order: ["main"]
          };
          console.log('📝 Created basic template structure from liquid');
        } catch (liquidError) {
          throw new Error('Could not find product template');
        }
      }
      
      // Step 2: Create the bundle template based on existing
      const bundleTemplate = JSON.parse(JSON.stringify(existingTemplate));
      
      // Add bundle display section only if it doesn't exist
      if (!bundleTemplate.sections['bundle-display']) {
        bundleTemplate.sections['bundle-display'] = {
          type: 'bundle-components',
          settings: {}
        };
        
        // Insert bundle display after main product section only if not already in order
        if (!bundleTemplate.order.includes('bundle-display')) {
          const mainIndex = bundleTemplate.order.indexOf('main');
          if (mainIndex >= 0) {
            bundleTemplate.order.splice(mainIndex + 1, 0, 'bundle-display');
          } else {
            bundleTemplate.order.unshift('bundle-display');
          }
        }
      }
      
      // Step 3: Create the bundle template file
      const bundleTemplateResponse = await axios.put(
        `${this.baseURL}/themes/${activeTheme.id}/assets.json`,
        {
          asset: {
            key: 'templates/product.bundle.json',
            value: JSON.stringify(bundleTemplate, null, 2)
          }
        },
        { headers: this.headers }
      );
      
      console.log('✅ Created product.bundle.json template');
      
      // Step 4: Create the bundle components section
      const bundleComponentsSection = await this.createBundleComponentsSection();
      
      await axios.put(
        `${this.baseURL}/themes/${activeTheme.id}/assets.json`,
        {
          asset: {
            key: 'sections/bundle-components.liquid',
            value: bundleComponentsSection
          }
        },
        { headers: this.headers }
      );
      
      console.log('✅ Created bundle-components section');
      
      // Step 5: Create bundle cart override script
      const cartOverrideScript = await this.createCartOverrideScript();
      
      await axios.put(
        `${this.baseURL}/themes/${activeTheme.id}/assets.json`,
        {
          asset: {
            key: 'assets/bundle-cart-override.js',
            value: cartOverrideScript
          }
        },
        { headers: this.headers }
      );
      
      console.log('✅ Created bundle cart override script');
      
      return {
        success: true,
        templateName: 'product.bundle',
        themeId: activeTheme.id,
        themeName: activeTheme.name
      };
      
    } catch (error) {
      console.error('❌ Error creating bundle template:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Create the bundle components section
   */
  createBundleComponentsSection() {
    return `{% comment %}
  Bundle Components Display Section
  Shows component products inline like FastBundle
{% endcomment %}

{% if product.metafields.bundle_app.is_bundle %}
  {% assign component_products_json = product.metafields.bundle_app.component_products.value %}
  {% if component_products_json == blank %}
    {% assign component_products_json = product.metafields.bundle_app.component_products %}
  {% endif %}
  
  <style>
    .bundle-components-section {
      margin: 20px 0;
      padding: 0;
    }
    
    .bundle-component-item {
      display: flex;
      align-items: center;
      padding: 12px 0;
      border-bottom: 1px solid #e5e7eb;
      gap: 12px;
    }
    
    .bundle-component-item:first-child {
      border-top: 1px solid #e5e7eb;
      padding-top: 12px;
    }
    
    .bundle-component-item:last-child {
      border-bottom: none;
    }
    
    .bundle-component-image {
      width: 60px;
      height: 60px;
      border-radius: 6px;
      overflow: hidden;
      flex-shrink: 0;
      border: 1px solid #e5e7eb;
    }
    
    .bundle-component-image img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    
    .bundle-component-details {
      flex-grow: 1;
      min-width: 0;
    }
    
    .bundle-component-title {
      font-size: 14px;
      line-height: 1.4;
      color: #111827;
      margin-bottom: 4px;
      font-weight: 500;
    }
    
    .bundle-component-price {
      font-size: 14px;
      color: #6b7280;
    }
    
    .bundle-component-variant {
      margin-left: auto;
      min-width: 120px;
    }
    
    .bundle-variant-select {
      width: 100%;
      padding: 6px 10px;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      font-size: 14px;
      background: white;
      cursor: pointer;
    }
    
    .bundle-component-variant.hidden {
      visibility: hidden;
    }
  </style>
  
  <div class="bundle-components-section" id="bundle-components-display" data-product-id="{{ product.id }}">
    <!-- Components will be loaded here -->
  </div>
  
  <script src="{{ 'bundle-cart-override.js' | asset_url }}" defer></script>
  <script>
    window.bundleProductData = {
      productId: {{ product.id | json }},
      componentProducts: {{ component_products_json | json }},
      productHandle: {{ product.handle | json }}
    };
  </script>
{% endif %}

{% schema %}
{
  "name": "Bundle Components",
  "settings": [],
  "presets": [
    {
      "name": "Bundle Components"
    }
  ]
}
{% endschema %}`;
  }

  /**
   * Create cart override script
   */
  createCartOverrideScript() {
    return `// Bundle Cart Override Script
(function() {
  'use strict';
  
  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBundleSystem);
  } else {
    initBundleSystem();
  }
  
  function initBundleSystem() {
    console.log('🎯 Initializing bundle system...');
    
    // Check if this is a bundle product page
    const bundleData = window.bundleProductData;
    if (!bundleData || !bundleData.componentProducts) {
      console.log('Not a bundle product page');
      return;
    }
    
    console.log('Bundle product detected:', bundleData);
    
    // Parse component products
    let componentProducts = [];
    try {
      componentProducts = typeof bundleData.componentProducts === 'string' 
        ? JSON.parse(bundleData.componentProducts) 
        : bundleData.componentProducts;
    } catch (e) {
      console.error('Failed to parse component products:', e);
      return;
    }
    
    if (!componentProducts || componentProducts.length === 0) {
      console.warn('No component products found');
      return;
    }
    
    console.log('Found', componentProducts.length, 'component products');
    
    // Store for variant tracking
    const componentVariants = {};
    
    // Render components
    renderBundleComponents();
    
    // Override add to cart
    overrideAddToCart();
    
    function renderBundleComponents() {
      const container = document.getElementById('bundle-components-display');
      if (!container) {
        console.error('Bundle container not found');
        return;
      }
      
      let html = '';
      componentProducts.forEach((component, index) => {
        const imageUrl = component.image || 'https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-image_small.png';
        const firstVariant = component.variants && component.variants[0];
        const price = firstVariant ? (parseFloat(firstVariant.price) / 100).toFixed(2) : '0.00';
        
            html += '<div class="bundle-component-item" data-component-id="' + component.id + '">' +
              '<div class="bundle-component-image">' +
                '<img src="' + imageUrl + '" alt="' + component.title + '" loading="lazy">' +
              '</div>' +
              '<div class="bundle-component-details">' +
                '<div class="bundle-component-title">' + component.title + '</div>' +
                '<div class="bundle-component-price">₹' + price + '</div>' +
              '</div>' +
              '<div class="bundle-component-variant ' + (index > 0 ? 'hidden' : '') + '">' +
                (component.variants && component.variants.length > 1 ? 
                  '<select class="bundle-variant-select" data-component-id="' + component.id + '" data-index="' + index + '">' +
                    component.variants.map(function(v) {
                      return '<option value="' + v.id + '" data-price="' + v.price + '">' + (v.title || 'Default') + '</option>';
                    }).join('') +
                  '</select>'
                : '') +
              '</div>' +
            '</div>';
        
        // Store default variant
        if (firstVariant) {
          componentVariants[component.id] = firstVariant.id;
        }
      });
      
      container.innerHTML = html;
      
      // Setup variant sync
      setupVariantSync();
    }
    
    function setupVariantSync() {
      const selectors = document.querySelectorAll('.bundle-variant-select');
      const firstSelector = selectors[0];
      
      if (firstSelector) {
        firstSelector.addEventListener('change', function(e) {
          const selectedIndex = e.target.selectedIndex;
          const componentId = e.target.dataset.componentId;
          componentVariants[componentId] = e.target.value;
          
          // Sync other selectors
          selectors.forEach((selector, index) => {
            if (index > 0 && selector.options[selectedIndex]) {
              selector.selectedIndex = selectedIndex;
              const syncComponentId = selector.dataset.componentId;
              componentVariants[syncComponentId] = selector.options[selectedIndex].value;
            }
          });
        });
      }
    }
    
    function overrideAddToCart() {
      console.log('Setting up cart override...');
      
      // Find all add to cart forms
      const forms = document.querySelectorAll('form[action*="/cart/add"]');
      console.log('Found', forms.length, 'cart forms');
      
      forms.forEach(form => {
        // Remove existing listeners
        const newForm = form.cloneNode(true);
        form.parentNode.replaceChild(newForm, form);
        
        // Add new handler
        newForm.addEventListener('submit', handleBundleAddToCart);
      });
      
      // Also handle any standalone add buttons
      const addButtons = document.querySelectorAll('button[name="add"], button[type="submit"][data-add-to-cart]');
      addButtons.forEach(btn => {
        if (!btn.closest('form')) {
          btn.addEventListener('click', function(e) {
            e.preventDefault();
            handleBundleAddToCart(e);
          });
        }
      });
    }
    
    async function handleBundleAddToCart(e) {
      e.preventDefault();
      e.stopPropagation();
      
      console.log('Bundle add to cart triggered');
      
      // Get quantity
      const form = e.target.closest('form') || e.target;
      const qtyInput = form.querySelector('[name="quantity"]') || document.querySelector('[name="quantity"]');
      const quantity = qtyInput ? parseInt(qtyInput.value) : 1;
      
      // Prepare items
      const items = [];
      componentProducts.forEach(component => {
        const variantId = componentVariants[component.id];
        if (variantId) {
          items.push({
            id: variantId,
            quantity: quantity,
            properties: {
              '_bundle_product': 'true',
              '_bundle_id': bundleData.productId.toString(),
              '_component_type': component.componentType || component.title
            }
          });
        }
      });
      
      if (items.length === 0) {
        console.error('No items to add');
        return;
      }
      
      console.log('Adding items to cart:', items);
      
      // Find submit button
      const submitBtn = form.querySelector('[type="submit"], [name="add"]') || e.target;
      const originalText = submitBtn.textContent;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Adding...';
      
      try {
        const response = await fetch('/cart/add.js', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
          },
          body: JSON.stringify({ items })
        });
        
        if (response.ok) {
          const result = await response.json();
          console.log('Successfully added to cart:', result);
          
          // Trigger cart update
          document.dispatchEvent(new CustomEvent('cart:added', {
            detail: { items: result.items }
          }));
          
          // Redirect to cart
          window.location.href = '/cart';
        } else {
          throw new Error('Failed to add to cart');
        }
      } catch (error) {
        console.error('Error adding to cart:', error);
        alert('Failed to add bundle to cart. Please try again.');
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
      }
    }
    
    // Also load full component data for better display
    async function loadComponentDetails() {
      for (const component of componentProducts) {
        if (!component.handle) continue;
        
        try {
          const response = await fetch(\`/products/\${component.handle}.js\`);
          if (response.ok) {
            const data = await response.json();
            
            // Update component with full data
            const index = componentProducts.findIndex(c => c.id === component.id);
            if (index !== -1) {
              componentProducts[index] = {
                ...component,
                ...data,
                componentType: component.componentType
              };
              
              // Update default variant
              if (data.variants && data.variants[0]) {
                componentVariants[component.id] = data.variants[0].id;
              }
            }
          }
        } catch (error) {
          console.error('Failed to load component details:', error);
        }
      }
      
      // Re-render with full data
      renderBundleComponents();
    }
    
    // Load full details
    setTimeout(loadComponentDetails, 100);
  }
})();`;
  }

  /**
   * Update product to use bundle template
   */
  async updateProductTemplate(productId, templateSuffix = 'bundle') {
    try {
      const updateData = {
        product: {
          template_suffix: templateSuffix
        }
      };
      
      const response = await axios.put(
        `${this.baseURL}/products/${productId}.json`,
        updateData,
        { headers: this.headers }
      );
      
      console.log(`✅ Product ${productId} now uses template: product.${templateSuffix}`);
      return response.data.product;
    } catch (error) {
      console.error('Error updating product template:', error.response?.data || error.message);
      throw error;
    }
  }
}

module.exports = new BundleTemplateService();
