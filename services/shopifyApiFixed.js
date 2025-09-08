const axios = require('axios');

class ShopifyApiFixed {
  constructor() {
    // Initialize with environment variables
    this.storeDomain = process.env.SHOPIFY_STORE_DOMAIN;
    this.accessToken = process.env.SHOPIFY_ACCESS_TOKEN;
    this.apiKey = process.env.SHOPIFY_API_KEY;
    this.apiSecret = process.env.SHOPIFY_API_SECRET;
    
    // Set up base configuration
    this.baseURL = `https://${this.storeDomain}/admin/api/2024-01`;
    this.headers = {
      'X-Shopify-Access-Token': this.accessToken,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
    
    // Configure axios defaults
    this.client = axios.create({
      baseURL: this.baseURL,
      headers: this.headers,
      timeout: 30000,
      validateStatus: function (status) {
        return status >= 200 && status < 500; // Don't throw on 4xx errors
      }
    });
  }

  // Test connection with detailed error handling
  async testConnection() {
    try {
      console.log('Testing Shopify connection...');
      console.log('Store:', this.storeDomain);
      console.log('Token:', this.accessToken ? `${this.accessToken.substring(0, 10)}...` : 'NOT SET');
      
      // First, try to get shop info
      const response = await this.client.get('/shop.json');
      
      if (response.status === 200 && response.data.shop) {
        return {
          success: true,
          message: 'Shopify connection successful',
          store: this.storeDomain,
          shop: {
            name: response.data.shop.name,
            email: response.data.shop.email,
            currency: response.data.shop.currency,
            plan: response.data.shop.plan_name,
            domain: response.data.shop.domain
          }
        };
      } else if (response.status === 401) {
        return {
          success: false,
          message: 'Authentication failed - Invalid or expired access token',
          error: 'INVALID_TOKEN',
          details: response.data.errors || 'Please check your access token'
        };
      } else if (response.status === 403) {
        return {
          success: false,
          message: 'Permission denied - Token lacks required permissions',
          error: 'INSUFFICIENT_PERMISSIONS',
          details: 'Ensure your app has read_products and write_products permissions'
        };
      } else {
        return {
          success: false,
          message: 'Unexpected response from Shopify',
          error: 'UNEXPECTED_RESPONSE',
          status: response.status,
          details: response.data
        };
      }
    } catch (error) {
      console.error('Connection test error:', error.message);
      
      // Handle network errors
      if (error.code === 'ENOTFOUND') {
        return {
          success: false,
          message: 'Store domain not found',
          error: 'STORE_NOT_FOUND',
          details: `Cannot reach ${this.storeDomain}. Please check the domain.`
        };
      } else if (error.code === 'ETIMEDOUT') {
        return {
          success: false,
          message: 'Connection timeout',
          error: 'TIMEOUT',
          details: 'The request to Shopify timed out. Please try again.'
        };
      } else {
        return {
          success: false,
          message: 'Connection test failed',
          error: error.code || 'UNKNOWN_ERROR',
          details: error.message
        };
      }
    }
  }

  // Validate token with proper error handling
  async validateToken() {
    try {
      const response = await this.client.get('/shop.json');
      
      if (response.status === 200) {
        return {
          success: true,
          valid: true,
          message: 'Token is valid',
          status: 'authorized',
          shop: response.data.shop ? {
            name: response.data.shop.name,
            domain: response.data.shop.myshopify_domain,
            currency: response.data.shop.currency
          } : null
        };
      } else if (response.status === 401) {
        return {
          success: false,
          valid: false,
          message: 'Invalid or expired token',
          status: 'unauthorized',
          error: response.data.errors || 'Authentication failed'
        };
      } else {
        return {
          success: false,
          valid: false,
          message: 'Token validation failed',
          status: 'error',
          error: `Unexpected status: ${response.status}`
        };
      }
    } catch (error) {
      console.error('Token validation error:', error.message);
      return {
        success: false,
        valid: false,
        message: 'Token validation failed',
        status: 'error',
        error: error.message
      };
    }
  }

  // Get shop info with error handling
  async getShopInfo() {
    try {
      const response = await this.client.get('/shop.json');
      
      if (response.status === 200 && response.data.shop) {
        return {
          success: true,
          data: {
            name: response.data.shop.name,
            domain: response.data.shop.domain,
            email: response.data.shop.email,
            currency: response.data.shop.currency,
            timezone: response.data.shop.timezone,
            plan_name: response.data.shop.plan_name,
            myshopify_domain: response.data.shop.myshopify_domain
          }
        };
      } else {
        return {
          success: false,
          error: response.data.errors || 'Failed to fetch shop information'
        };
      }
    } catch (error) {
      console.error('Shop info error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Get products with pagination
  async getProducts(limit = 50, pageInfo = null) {
    try {
      let url = '/products.json';
      const params = { limit: parseInt(limit) }; // Ensure limit is an integer
      if (pageInfo) {
        params.page_info = pageInfo;
      }
      
      const response = await this.client.get(url, { params });
      
      if (response.status === 200) {
        return {
          success: true,
          data: response.data.products || [],
          pagination: {
            hasNext: response.headers.link && response.headers.link.includes('rel="next"'),
            hasPrevious: response.headers.link && response.headers.link.includes('rel="previous"')
          }
        };
      } else {
        return {
          success: false,
          data: [],
          error: response.data.errors || 'Failed to fetch products'
        };
      }
    } catch (error) {
      console.error('Get products error:', error.message);
      return {
        success: false,
        data: [],
        error: error.message
      };
    }
  }

  // Get API usage/rate limit info
  async getApiUsage() {
    try {
      const response = await this.client.get('/shop.json');
      const rateLimitHeader = response.headers['x-shopify-shop-api-call-limit'];
      
      if (rateLimitHeader) {
        const [used, limit] = rateLimitHeader.split('/').map(Number);
        return {
          success: true,
          data: {
            used,
            limit,
            remaining: limit - used,
            percentage: ((used / limit) * 100).toFixed(1)
          }
        };
      } else {
        return {
          success: true,
          data: {
            message: 'API usage information not available'
          }
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Check configuration status
  checkConfiguration() {
    const issues = [];
    const warnings = [];
    
    if (!this.storeDomain) {
      issues.push('SHOPIFY_STORE_DOMAIN is not configured');
    } else if (!this.storeDomain.includes('.myshopify.com')) {
      warnings.push('Store domain should include .myshopify.com');
    }
    
    if (!this.accessToken) {
      issues.push('SHOPIFY_ACCESS_TOKEN is not configured');
    } else if (!this.accessToken.startsWith('shpat_') && !this.accessToken.startsWith('shppa_')) {
      warnings.push('Access token format may be incorrect (should start with shpat_ or shppa_)');
    }
    
    return {
      configured: issues.length === 0,
      issues,
      warnings,
      config: {
        storeDomain: this.storeDomain || 'NOT_SET',
        hasAccessToken: !!this.accessToken,
        hasApiKey: !!this.apiKey,
        hasApiSecret: !!this.apiSecret
      }
    };
  }
}

module.exports = new ShopifyApiFixed();
