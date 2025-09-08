const axios = require('axios');
const pino = require('pino');

const logger = pino({ name: 'shopify-api-client' });

class ShopifyApiClient {
  constructor(shopDomain, accessToken) {
    this.shopDomain = shopDomain;
    this.accessToken = accessToken;
    this.baseURL = `https://${shopDomain}/admin/api/2023-10`;
    
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 30000,
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
        'User-Agent': 'ShopifyBundleApp/1.0'
      }
    });

    this.setupInterceptors();
  }

  setupInterceptors() {
    // Request interceptor
    this.client.interceptors.request.use(
      (config) => {
        logger.info({
          method: config.method?.toUpperCase(),
          url: config.url,
          shop: this.shopDomain
        }, 'Shopify API request');
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor with retry logic
    this.client.interceptors.response.use(
      (response) => {
        logger.info({
          status: response.status,
          url: response.config.url,
          shop: this.shopDomain,
          callLimit: response.headers['x-shopify-shop-api-call-limit']
        }, 'Shopify API response');
        return response;
      },
      async (error) => {
        const config = error.config;
        
        if (!config || config.__retryCount >= 3) {
          return Promise.reject(error);
        }

        config.__retryCount = config.__retryCount || 0;
        config.__retryCount++;

        // Handle rate limiting (429) and server errors (5xx)
        if (error.response?.status === 429 || error.response?.status >= 500) {
          const retryAfter = error.response?.headers['retry-after'];
          const delay = retryAfter ? parseInt(retryAfter) * 1000 : Math.pow(2, config.__retryCount) * 1000;
          
          logger.warn({
            status: error.response?.status,
            retryCount: config.__retryCount,
            delay,
            shop: this.shopDomain
          }, 'Retrying Shopify API request');
          
          await this.delay(delay);
          return this.client(config);
        }

        return Promise.reject(error);
      }
    );
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async request(method, endpoint, data = null, params = {}) {
    try {
      const config = {
        method,
        url: endpoint,
        params,
        ...(data && { data })
      };

      const response = await this.client.request(config);
      return {
        success: true,
        data: response.data,
        headers: response.headers
      };
    } catch (error) {
      logger.error({
        error: error.message,
        status: error.response?.status,
        shop: this.shopDomain,
        endpoint
      }, 'Shopify API error');

      return {
        success: false,
        error: error.response?.data?.errors || error.message,
        status: error.response?.status
      };
    }
  }

  async get(endpoint, params = {}) {
    return this.request('GET', endpoint, null, params);
  }

  async post(endpoint, data, params = {}) {
    return this.request('POST', endpoint, data, params);
  }

  async put(endpoint, data, params = {}) {
    return this.request('PUT', endpoint, data, params);
  }

  async delete(endpoint, params = {}) {
    return this.request('DELETE', endpoint, null, params);
  }

  // Paginated requests with automatic link header parsing
  async getAllPages(endpoint, params = {}, limit = 250) {
    const allData = [];
    let nextPageInfo = null;
    let pageCount = 0;
    const maxPages = 20; // Safety limit

    do {
      pageCount++;
      if (pageCount > maxPages) {
        logger.warn({ shop: this.shopDomain, endpoint }, 'Max pages reached, stopping pagination');
        break;
      }

      const requestParams = { 
        ...params, 
        limit: Math.min(limit, 250)
      };
      
      if (nextPageInfo) {
        requestParams.page_info = nextPageInfo;
      }

      const result = await this.get(endpoint, requestParams);
      
      if (!result.success) {
        throw new Error(result.error);
      }

      // Extract data based on endpoint type
      let pageData = result.data;
      if (result.data.products) pageData = result.data.products;
      else if (result.data.orders) pageData = result.data.orders;
      else if (result.data.customers) pageData = result.data.customers;

      allData.push(...(Array.isArray(pageData) ? pageData : [pageData]));

      // Parse Link header for next page
      nextPageInfo = this.extractPageInfo(result.headers.link, 'next');
      
      logger.info({
        shop: this.shopDomain,
        endpoint,
        pageCount,
        pageSize: Array.isArray(pageData) ? pageData.length : 1,
        totalSoFar: allData.length,
        hasNext: !!nextPageInfo
      }, 'Paginated request page completed');

      // Rate limiting courtesy delay
      if (nextPageInfo) {
        await this.delay(200);
      }

    } while (nextPageInfo);

    return {
      success: true,
      data: allData,
      totalCount: allData.length,
      pageCount
    };
  }

  // Extract page_info from Link header
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

  // Date-range filtered requests
  async getOrdersByDateRange(startDate, endDate, params = {}) {
    const requestParams = {
      ...params,
      created_at_min: startDate.toISOString(),
      created_at_max: endDate.toISOString(),
      status: 'any',
      fields: 'id,name,created_at,updated_at,fulfillment_status,line_items,tags'
    };

    return this.getAllPages('/orders.json', requestParams);
  }

  async getProductsByDateRange(startDate, endDate, params = {}) {
    const requestParams = {
      ...params,
      created_at_min: startDate.toISOString(),
      created_at_max: endDate.toISOString(),
      fields: 'id,title,tags,created_at,updated_at'
    };

    return this.getAllPages('/products.json', requestParams);
  }

  // Validation methods
  async validateConnection() {
    try {
      const result = await this.get('/shop.json');
      return {
        success: result.success,
        shop: result.data?.shop,
        error: result.error
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async getApiCallLimit() {
    try {
      const result = await this.get('/shop.json');
      const callLimit = result.headers?.['x-shopify-shop-api-call-limit'];
      
      if (callLimit) {
        const [used, total] = callLimit.split('/').map(Number);
        return {
          used,
          total,
          remaining: total - used,
          percentage: (used / total) * 100
        };
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }
}

module.exports = ShopifyApiClient;
