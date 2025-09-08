const axios = require('axios');
const ProductTaggingService = require('../utils/productTagging');

class ShopifyService {
  constructor() {
    this.baseURL = `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2023-10`;
    this.accessToken = process.env.SHOPIFY_ACCESS_TOKEN;
    this.headers = {
      'X-Shopify-Access-Token': this.accessToken,
      'Content-Type': 'application/json'
    };
  }

  // Get all products
  async getProducts(limit = 50, page_info = null) {
    try {
      let url = `${this.baseURL}/products.json?limit=${parseInt(limit)}`; // Ensure limit is an integer
      if (page_info) {
        url += `&page_info=${page_info}`;
      }

      const response = await axios.get(url, { headers: this.headers });
      return {
        success: true,
        data: response.data.products,
        pagination: {
          hasNext: response.headers.link && response.headers.link.includes('rel="next"'),
          hasPrevious: response.headers.link && response.headers.link.includes('rel="previous"'),
          nextPageInfo: this.extractPageInfo(response.headers.link, 'next'),
          previousPageInfo: this.extractPageInfo(response.headers.link, 'previous')
        }
      };
    } catch (error) {
      console.error('Error fetching products:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.errors || error.message
      };
    }
  }

  // Get single product
  async getProduct(productId) {
    try {
      const response = await axios.get(`${this.baseURL}/products/${productId}.json`, {
        headers: this.headers
      });
      return {
        success: true,
        data: response.data.product
      };
    } catch (error) {
      console.error('Error fetching product:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.errors || error.message
      };
    }
  }

  // Create product (for duplicating)
  async createProduct(productData) {
    try {
      const response = await axios.post(`${this.baseURL}/products.json`, {
        product: productData
      }, { headers: this.headers });
      
      return {
        success: true,
        data: response.data.product
      };
    } catch (error) {
      console.error('Error creating product:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.errors || error.message
      };
    }
  }

  // Update product
  async updateProduct(productId, productData) {
    try {
      const response = await axios.put(`${this.baseURL}/products/${productId}.json`, {
        product: productData
      }, { headers: this.headers });
      
      return {
        success: true,
        data: response.data.product
      };
    } catch (error) {
      console.error('Error updating product:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.errors || error.message
      };
    }
  }

  // Get orders
  async getOrders(limit = 50, status = 'any') {
    try {
      const response = await axios.get(`${this.baseURL}/orders.json?limit=${limit}&status=${status}`, {
        headers: this.headers
      });
      return {
        success: true,
        data: response.data.orders
      };
    } catch (error) {
      console.error('Error fetching orders:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.errors || error.message
      };
    }
  }

  // Create a bundle product (duplicate with modifications)
  async createBundleProduct(originalProduct, bundleConfig) {
    try {
      // Create a new product based on the original
      const bundleProduct = {
        title: `${originalProduct.title} ${bundleConfig.titleSuffix || '- Bundle'}`,
        body_html: this.generateBundleDescription(originalProduct, bundleConfig),
        vendor: originalProduct.vendor,
        product_type: originalProduct.product_type + ' Bundle',
        tags: ProductTaggingService.getBundleProductTags(originalProduct.tags || '', bundleConfig),
        images: originalProduct.images,
        variants: this.createBundleVariants(originalProduct, bundleConfig),
        metafields: [
          {
            namespace: 'bundle',
            key: 'is_bundle',
            value: 'true',
            type: 'boolean'
          },
          {
            namespace: 'bundle',
            key: 'original_product_id',
            value: originalProduct.id.toString(),
            type: 'single_line_text_field'
          },
          {
            namespace: 'bundle',
            key: 'bundle_products',
            value: JSON.stringify(bundleConfig.bundleProducts),
            type: 'json'
          }
        ]
      };

      return await this.createProduct(bundleProduct);
    } catch (error) {
      console.error('Error creating bundle product:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Generate bundle description HTML
  generateBundleDescription(originalProduct, bundleConfig) {
    let html = originalProduct.body_html || '';
    
    html += `
      <div class="bundle-info" style="margin-top: 20px; padding: 15px; border: 1px solid #ddd; border-radius: 8px;">
        <h3>🎁 Bundle Includes:</h3>
        <ul style="margin: 10px 0; padding-left: 20px;">
          <li><strong>${originalProduct.title}</strong> (Main Product)</li>
    `;
    
    bundleConfig.bundleProducts.forEach(product => {
      html += `<li>${product.title} ${product.isUpsell ? '(Add-on)' : ''}</li>`;
    });
    
    html += `
        </ul>
        <p style="color: #28a745; font-weight: bold;">
          💰 Save ${bundleConfig.discount || '15'}% when you buy this bundle!
        </p>
      </div>
    `;
    
    return html;
  }

  // Create bundle variants with pricing
  createBundleVariants(originalProduct, bundleConfig) {
    const bundlePrice = this.calculateBundlePrice(originalProduct, bundleConfig);
    
    return originalProduct.variants.map(variant => ({
      title: variant.title,
      price: bundlePrice.toString(),
      compare_at_price: this.calculateOriginalPrice(originalProduct, bundleConfig).toString(),
      sku: `BUNDLE-${variant.sku || ''}`,
      inventory_management: 'shopify',
      inventory_policy: 'deny',
      fulfillment_service: 'manual',
      inventory_quantity: Math.min(
        variant.inventory_quantity || 0,
        ...bundleConfig.bundleProducts.map(p => p.inventory_quantity || 0)
      ),
      weight: (variant.weight || 0) + bundleConfig.bundleProducts.reduce((sum, p) => sum + (p.weight || 0), 0),
      requires_shipping: true,
      taxable: true,
      metafields: [
        {
          namespace: 'bundle',
          key: 'original_variant_id',
          value: variant.id.toString(),
          type: 'single_line_text_field'
        }
      ]
    }));
  }

  // Calculate bundle price with discount
  calculateBundlePrice(originalProduct, bundleConfig) {
    const mainPrice = parseFloat(originalProduct.variants[0].price);
    const bundleProductsPrice = bundleConfig.bundleProducts.reduce(
      (sum, product) => sum + parseFloat(product.price || 0), 0
    );
    const totalPrice = mainPrice + bundleProductsPrice;
    const discount = bundleConfig.discount || 15;
    return (totalPrice * (100 - discount) / 100).toFixed(2);
  }

  // Calculate original total price
  calculateOriginalPrice(originalProduct, bundleConfig) {
    const mainPrice = parseFloat(originalProduct.variants[0].price);
    const bundleProductsPrice = bundleConfig.bundleProducts.reduce(
      (sum, product) => sum + parseFloat(product.price || 0), 0
    );
    return (mainPrice + bundleProductsPrice).toFixed(2);
  }

  // Create a new product in Shopify
  async createProduct(productData) {
    try {
      const response = await fetch(`https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2023-10/products.json`, {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ product: productData })
      });

      const data = await response.json();

      if (response.ok && data.product) {
        return {
          success: true,
          data: data.product
        };
      } else {
        return {
          success: false,
          error: data.errors || 'Failed to create product'
        };
      }
    } catch (error) {
      console.error('Error creating product:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Update product metafields
  async updateProductMetafields(productId, metafields) {
    try {
      const results = [];

      for (const metafield of metafields) {
        const response = await fetch(`https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2023-10/products/${productId}/metafields.json`, {
          method: 'POST',
          headers: {
            'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ metafield })
        });

        const data = await response.json();

        if (response.ok && data.metafield) {
          results.push({
            success: true,
            data: data.metafield
          });
        } else {
          results.push({
            success: false,
            error: data.errors || 'Failed to create metafield'
          });
        }
      }

      return {
        success: true,
        data: results
      };
    } catch (error) {
      console.error('Error updating metafields:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Get all products from Shopify
  async getAllProducts(limit = 250) {
    try {
      console.log('Fetching ALL products with pagination...');
      let allProducts = [];
      let hasNextPage = true;
      let pageInfo = null;
      let pageCount = 0;
      
      while (hasNextPage) {
        pageCount++;
        console.log(`Fetching page ${pageCount}...`);
        
        // Add retry logic for rate limiting
        let retries = 3;
        let delay = 500; // Start with 500ms delay
        
        while (retries > 0) {
          let url = `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2023-10/products.json?limit=${limit}`;
          if (pageInfo) {
            url += `&page_info=${pageInfo}`;
          }
          
          const response = await fetch(url, {
            method: 'GET',
            headers: {
              'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
              'Content-Type': 'application/json',
            }
          });

          const data = await response.json();

          // Check for rate limiting
          if (response.status === 429 || (data.errors && data.errors.includes('Exceeded'))) {
            console.log(`Rate limit hit, retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            delay *= 2; // Exponential backoff
            retries--;
            continue;
          }

          if (response.ok && data.products) {
            allProducts = allProducts.concat(data.products);
            console.log(`Page ${pageCount}: Found ${data.products.length} products (Total: ${allProducts.length})`);
            
            // Check for next page using Link header
            const linkHeader = response.headers.get('link');
            if (linkHeader && linkHeader.includes('rel="next"')) {
              // Extract page_info from Link header
              const nextMatch = linkHeader.match(/<[^>]*[?&]page_info=([^&>]+)[^>]*>;\s*rel="next"/);
              if (nextMatch) {
                pageInfo = nextMatch[1];
                hasNextPage = true;
              } else {
                hasNextPage = false;
              }
            } else {
              hasNextPage = false;
            }
            
            break; // Success, exit retry loop
          } else {
            return {
              success: false,
              error: data.errors || 'Failed to fetch products'
            };
          }
        }
        
        if (retries === 0) {
          return {
            success: false,
            error: 'Rate limit exceeded. Please try again later.'
          };
        }
        
        // Small delay between pages to be respectful to API
        if (hasNextPage) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }
      
      console.log(`✅ Successfully fetched ${allProducts.length} total products from ${pageCount} pages`);
      
      return {
        success: true,
        data: allProducts,
        totalCount: allProducts.length,
        pageCount: pageCount
      };
      
    } catch (error) {
      console.error('Error fetching all products:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Find matching variant based on variant mapping
  findMatchingVariant(mainVariant, targetVariants, variantMapping) {
    if (!variantMapping || !variantMapping.syncOptions) {
      return null;
    }

    // Try to find exact match based on mapped options
    for (const targetVariant of targetVariants) {
      let isMatch = true;
      
      for (const syncOption of variantMapping.syncOptions) {
        const mainOptionValue = this.getVariantOptionValue(mainVariant, syncOption.mainOption);
        const targetOptionValue = this.getVariantOptionValue(targetVariant, syncOption.targetOption);
        
        if (mainOptionValue !== targetOptionValue) {
          isMatch = false;
          break;
        }
      }
      
      if (isMatch) {
        return targetVariant;
      }
    }

    return null;
  }

  // Get option value from variant
  getVariantOptionValue(variant, optionName) {
    if (!variant.option1 && !variant.option2 && !variant.option3) {
      return null;
    }

    // Match option by name (case insensitive)
    const lowerOptionName = optionName.toLowerCase();
    
    if (lowerOptionName.includes('size')) {
      return variant.option1 || variant.option2 || variant.option3;
    } else if (lowerOptionName.includes('color') || lowerOptionName.includes('colour')) {
      return variant.option2 || variant.option1 || variant.option3;
    } else if (lowerOptionName.includes('material') || lowerOptionName.includes('type')) {
      return variant.option3 || variant.option2 || variant.option1;
    }

    // Default: try to match by position
    return variant.option1;
  }

  // Generate smart variant mapping suggestions
  generateVariantMapping(mainProduct, targetProduct) {
    const mapping = {
      syncOptions: [],
      suggestions: []
    };

    if (!mainProduct.variants || !targetProduct.variants) {
      return mapping;
    }

    // Analyze option patterns
    const mainOptions = this.extractProductOptions(mainProduct);
    const targetOptions = this.extractProductOptions(targetProduct);

    // Auto-match similar option names
    for (const mainOption of mainOptions) {
      for (const targetOption of targetOptions) {
        if (this.areOptionsCompatible(mainOption, targetOption)) {
          mapping.syncOptions.push({
            mainOption: mainOption.name,
            targetOption: targetOption.name,
            confidence: this.calculateOptionCompatibility(mainOption, targetOption)
          });
          break; // One-to-one mapping
        }
      }
    }

    return mapping;
  }

  // Extract product options with their values
  extractProductOptions(product) {
    const options = [];
    
    if (product.options) {
      for (const option of product.options) {
        options.push({
          name: option.name,
          values: option.values,
          position: option.position
        });
      }
    }

    return options;
  }

  // Check if two options are compatible for syncing
  areOptionsCompatible(mainOption, targetOption) {
    const main = mainOption.name.toLowerCase();
    const target = targetOption.name.toLowerCase();

    // Direct name matches
    if (main === target) return true;

    // Similar option types
    const sizeTypes = ['size', 'sizes'];
    const colorTypes = ['color', 'colour', 'colors', 'colours'];
    const materialTypes = ['material', 'type', 'style'];

    if (sizeTypes.some(t => main.includes(t)) && sizeTypes.some(t => target.includes(t))) {
      return true;
    }
    if (colorTypes.some(t => main.includes(t)) && colorTypes.some(t => target.includes(t))) {
      return true;
    }
    if (materialTypes.some(t => main.includes(t)) && materialTypes.some(t => target.includes(t))) {
      return true;
    }

    return false;
  }

  // Calculate compatibility score between options
  calculateOptionCompatibility(mainOption, targetOption) {
    let score = 0;
    
    // Name similarity
    if (mainOption.name.toLowerCase() === targetOption.name.toLowerCase()) {
      score += 50;
    }
    
    // Common values
    const commonValues = mainOption.values.filter(v => 
      targetOption.values.some(tv => tv.toLowerCase() === v.toLowerCase())
    );
    score += Math.min(30, commonValues.length * 10);
    
    // Value count similarity
    const valueDiff = Math.abs(mainOption.values.length - targetOption.values.length);
    score += Math.max(0, 20 - valueDiff * 5);
    
    return Math.min(100, score);
  }

  // Extract page info from Link header
  extractPageInfo(linkHeader, rel) {
    if (!linkHeader) return null;
    
    const links = linkHeader.split(',');
    for (const link of links) {
      if (link.includes(`rel="${rel}"`)) {
        const match = link.match(/page_info=([^&>]+)/);
        return match ? match[1] : null;
      }
    }
    return null;
  }

  // Search products
  async searchProducts(query) {
    try {
      const response = await axios.get(`${this.baseURL}/products.json?title=${encodeURIComponent(query)}`, {
        headers: this.headers
      });
      return {
        success: true,
        data: response.data.products
      };
    } catch (error) {
      console.error('Error searching products:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.errors || error.message
      };
    }
  }

  // Get product metafields
  async getProductMetafields(productId) {
    try {
      const response = await axios.get(`${this.baseURL}/products/${productId}/metafields.json`, {
        headers: this.headers
      });
      return {
        success: true,
        data: response.data.metafields
      };
    } catch (error) {
      console.error('Error fetching metafields:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.errors || error.message
      };
    }
  }

  // Create metafield
  async createProductMetafield(productId, metafield) {
    try {
      const response = await axios.post(`${this.baseURL}/products/${productId}/metafields.json`, {
        metafield
      }, { headers: this.headers });
      
      return {
        success: true,
        data: response.data.metafield
      };
    } catch (error) {
      console.error('Error creating metafield:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.errors || error.message
      };
    }
  }
}

module.exports = new ShopifyService();
