const axios = require('axios');
const StoreV2 = require('../models/StoreV2');

class ShopifyServiceV2 {
  constructor(storeId, credentials = null) {
    this.storeId = storeId;
    this.credentials = credentials;
    this.store = null;
  }

  // Initialize service with store credentials
  async initialize() {
    if (!this.credentials) {
      this.store = await StoreV2.findById(this.storeId);
      if (!this.store) {
        throw new Error(`Store not found: ${this.storeId}`);
      }
      this.credentials = await StoreV2.getDecryptedCredentials(this.storeId);
    }

    if (!this.credentials.accessToken) {
      throw new Error('No access token configured for store');
    }

    this.shopDomain = this.store?.shop_domain || this.credentials.shopDomain;
    this.baseURL = `https://${this.shopDomain}/admin/api/2023-10`;
    this.headers = {
      'X-Shopify-Access-Token': this.credentials.accessToken,
      'Content-Type': 'application/json'
    };

    return this;
  }

  // Static method to create and initialize service
  static async create(storeId, credentials = null) {
    const service = new ShopifyServiceV2(storeId, credentials);
    await service.initialize();
    return service;
  }

  // Test connection to Shopify
  async testConnection() {
    try {
      const response = await axios.get(`${this.baseURL}/shop.json`, { headers: this.headers });
      return {
        success: true,
        shop: response.data.shop
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data || error.message
      };
    }
  }

  // Get all products with pagination (only active/published products)
  async getProducts(limit = 50, pageInfo = null) {
    try {
      let url = `${this.baseURL}/products.json?limit=${parseInt(limit)}`;
      
      // Only fetch published/active products (like in Shopify Admin Products tab)
      url += '&status=active';
      url += '&published_status=published';
      
      // Add useful fields to reduce payload size
      url += '&fields=id,title,handle,status,variants,tags,created_at,updated_at';
      
      if (pageInfo) {
        url += `&page_info=${pageInfo}`;
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
      throw new Error(`Failed to fetch products: ${error.message}`);
    }
  }

  // Search for products with a query (more efficient than getting all)
  async searchProducts(query, limit = 250) {
    try {
      console.log(`Searching products with query: ${query}`);
      
      const url = `https://${this.shopDomain}/admin/api/2023-10/products.json`;
      const params = new URLSearchParams({
        limit: Math.min(limit, 250).toString(),
        fields: 'id,title,handle,status,variants,tags,created_at,updated_at'
      });
      
      // Add search query if provided
      if (query) {
        // For title searches, we'll get recent products and filter client-side
        params.append('created_at_min', '2020-01-01T00:00:00Z');
      }

      const response = await axios.get(`${url}?${params}`, {
        headers: {
          'X-Shopify-Access-Token': this.credentials.accessToken,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });

      if (response.data && response.data.products) {
        let products = response.data.products;
        
        // Filter for products with " - " in title (set products)
        if (query === 'title:*-*') {
          products = products.filter(product => 
            product.title && product.title.includes(' - ')
          );
        }
        
        console.log(`Found ${products.length} matching products`);
        return products;
      }

      return [];
    } catch (error) {
      console.error('Error searching products:', error.response?.data || error.message);
      throw error;
    }
  }

  // Get all products (fetch all pages) - Only active/published products
  async getAllProducts() {
    const allProducts = [];
    let pageInfo = null;
    let hasNext = true;
    let pageCount = 0;

    console.log('Fetching active/published products with pagination...');

    while (hasNext && pageCount < 20) { // Safety limit: max 20 pages (5000 products)
      try {
        pageCount++;
        const page = pageInfo ? pageInfo.split('page_info=')[1] : null;
        console.log(`Fetching page ${pageCount}...`);
        
        const result = await this.getProducts(250, page); // Use max limit
        
        if (result.success) {
          allProducts.push(...result.data);
          hasNext = result.pagination.hasNext;
          pageInfo = result.pagination.nextPageInfo;
          
          console.log(`Fetched ${result.data.length} active products (total: ${allProducts.length})`);
          
          // Add small delay to avoid rate limits
          if (hasNext) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        } else {
          hasNext = false;
        }
      } catch (error) {
        console.error('Error fetching products page:', error);
        hasNext = false;
      }
    }

    if (pageCount >= 20) {
      console.log('Reached safety limit of 20 pages. If you have more products, consider using search instead.');
    }

    console.log(`Total active products fetched: ${allProducts.length}`);
    return allProducts;
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
      return {
        success: false,
        error: error.response?.data || error.message
      };
    }
  }

  // Create product
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
      throw new Error(`Failed to create product: ${error.message}`);
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
      throw new Error(`Failed to update product: ${error.message}`);
    }
  }

  // Get orders
  async getOrders(limit = 50, status = 'any') {
    try {
      const response = await axios.get(`${this.baseURL}/orders.json`, {
        headers: this.headers,
        params: {
          limit: parseInt(limit),
          status: status,
          financial_status: 'paid'
        }
      });

      return {
        success: true,
        data: response.data.orders
      };
    } catch (error) {
      throw new Error(`Failed to fetch orders: ${error.message}`);
    }
  }

  // Get metafields for a product
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
      return {
        success: false,
        error: error.response?.data || error.message
      };
    }
  }

  // Create or update metafield
  async setProductMetafield(productId, metafieldData) {
    try {
      const response = await axios.post(`${this.baseURL}/products/${productId}/metafields.json`, {
        metafield: metafieldData
      }, { headers: this.headers });

      return {
        success: true,
        data: response.data.metafield
      };
    } catch (error) {
      throw new Error(`Failed to set metafield: ${error.message}`);
    }
  }

  // Create or update multiple metafields for a product
  async updateProductMetafields(productId, metafieldsArray) {
    try {
      const results = [];
      
      for (const metafieldData of metafieldsArray) {
        const result = await this.setProductMetafield(productId, metafieldData);
        results.push(result);
        
        // Small delay between requests to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      return {
        success: true,
        data: results
      };
    } catch (error) {
      throw new Error(`Failed to update product metafields: ${error.message}`);
    }
  }

  // Get themes
  async getThemes() {
    try {
      const response = await axios.get(`${this.baseURL}/themes.json`, { headers: this.headers });
      return {
        success: true,
        data: response.data.themes
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data || error.message
      };
    }
  }

  // Duplicate theme
  async duplicateTheme(themeId, name) {
    try {
      const response = await axios.post(`${this.baseURL}/themes.json`, {
        theme: {
          name: name,
          src: themeId,
          role: 'unpublished'
        }
      }, { headers: this.headers });

      return {
        success: true,
        data: response.data.theme
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data || error.message
      };
    }
  }

  // Delete product
  async deleteProduct(productId) {
    try {
      await axios.delete(`${this.baseURL}/products/${productId}.json`, { 
        headers: this.headers 
      });
      return {
        success: true
      };
    } catch (error) {
      throw new Error(`Failed to delete product: ${error.message}`);
    }
  }

  // Delete metafield
  async deleteMetafield(metafieldId) {
    try {
      await axios.delete(`${this.baseURL}/metafields/${metafieldId}.json`, {
        headers: this.headers
      });
      return {
        success: true
      };
    } catch (error) {
      throw new Error(`Failed to delete metafield: ${error.message}`);
    }
  }

  // Helper method to extract page info from Link header
  extractPageInfo(linkHeader, rel) {
    if (!linkHeader) return null;
    
    const links = linkHeader.split(',');
    const targetLink = links.find(link => link.includes(`rel="${rel}"`));
    
    if (!targetLink) return null;
    
    const match = targetLink.match(/page_info=([^&>]+)/);
    return match ? match[1] : null;
  }

  // Get shop information
  async getShopInfo() {
    try {
      const response = await axios.get(`${this.baseURL}/shop.json`, { headers: this.headers });
      return {
        success: true,
        data: response.data.shop
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data || error.message
      };
    }
  }

  // Validate webhook
  static validateWebhook(data, hmacHeader, webhookSecret) {
    const crypto = require('crypto');
    const calculated_hmac = crypto
      .createHmac('sha256', webhookSecret)
      .update(data, 'utf8')
      .digest('base64');

    return calculated_hmac === hmacHeader;
  }
}

module.exports = ShopifyServiceV2;