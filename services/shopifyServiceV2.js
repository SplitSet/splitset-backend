const ShopifyApiClient = require('./shopifyApiClient');
const Store = require('../models/Store');
const pino = require('pino');

const logger = pino({ name: 'shopify-service' });

class ShopifyServiceV2 {
  constructor() {
    this.clients = new Map(); // Cache API clients per store
  }

  // Get or create API client for a store
  async getClient(storeId) {
    if (this.clients.has(storeId)) {
      return this.clients.get(storeId);
    }

    const store = await Store.findById(storeId);
    if (!store) {
      throw new Error(`Store not found: ${storeId}`);
    }

    // Note: In production, you'd decrypt the token here
    // For now, we'll assume the token is stored in env for the single store
    const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;
    if (!accessToken) {
      throw new Error(`No access token configured for store: ${store.shop_domain}`);
    }

    const client = new ShopifyApiClient(store.shop_domain, accessToken);
    this.clients.set(storeId, client);
    
    return client;
  }

  // Clear client cache (useful for token rotation)
  clearClientCache(storeId) {
    this.clients.delete(storeId);
  }

  // Products API
  async getProducts(storeId, options = {}) {
    const client = await this.getClient(storeId);
    const { limit = 50, pageInfo = null, fields } = options;
    
    const params = { limit };
    if (pageInfo) params.page_info = pageInfo;
    if (fields) params.fields = fields;
    
    return client.get('/products.json', params);
  }

  async getAllProducts(storeId, options = {}) {
    const client = await this.getClient(storeId);
    return client.getAllPages('/products.json', options);
  }

  async getProduct(storeId, productId) {
    const client = await this.getClient(storeId);
    return client.get(`/products/${productId}.json`);
  }

  async createProduct(storeId, productData) {
    const client = await this.getClient(storeId);
    return client.post('/products.json', { product: productData });
  }

  async updateProduct(storeId, productId, productData) {
    const client = await this.getClient(storeId);
    return client.put(`/products/${productId}.json`, { product: productData });
  }

  // Orders API with date range support
  async getOrders(storeId, options = {}) {
    const client = await this.getClient(storeId);
    const { limit = 50, status = 'any', fields } = options;
    
    const params = { limit, status };
    if (fields) params.fields = fields;
    
    return client.get('/orders.json', params);
  }

  async getOrdersByDateRange(storeId, startDate, endDate, options = {}) {
    const client = await this.getClient(storeId);
    return client.getOrdersByDateRange(startDate, endDate, options);
  }

  async getAllOrders(storeId, options = {}) {
    const client = await this.getClient(storeId);
    return client.getAllPages('/orders.json', options);
  }

  // Analytics-specific methods
  async getSplitterOrdersForMonth(storeId, year, month) {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);
    
    logger.info({
      storeId,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString()
    }, 'Fetching splitter orders for month');

    const result = await this.getOrdersByDateRange(storeId, startDate, endDate, {
      status: 'any',
      fields: 'id,name,created_at,fulfillment_status,line_items,tags'
    });

    if (!result.success) {
      throw new Error(result.error);
    }

    const orders = result.data || [];
    const splitterOrders = [];

    for (const order of orders) {
      // Skip non-fulfilled orders
      if (order.fulfillment_status !== 'fulfilled') continue;

      // Check if order has tracking tags or line items with splitter properties
      const orderTags = (order.tags || '').toLowerCase();
      const hasSplitterTag = orderTags.includes('splitter') || 
                            orderTags.includes('splitset') || 
                            orderTags.includes('splitset-created') || 
                            orderTags.includes('billing-tracked');
      
      const hasSplitterItems = order.line_items?.some(item => 
        item.properties?.some(prop => 
          prop.name === 'splitter' || 
          prop.name === '_splitter' || 
          prop.name === 'splitset' ||
          prop.name === '_splitset' ||
          prop.value === 'true' ||
          prop.value === 'splitset' ||
          prop.value === 'billing-tracked'
        )
      );

      if (hasSplitterTag || hasSplitterItems) {
        // Count items from splitter-related line items
        let itemsCount = 0;
        for (const item of order.line_items || []) {
          // If order is tagged as splitter, count all items
          // Otherwise, only count items with splitter properties
          if (hasSplitterTag || item.properties?.some(p => 
            p.name === 'splitter' || 
            p.name === '_splitter' || 
            p.name === 'splitset' || 
            p.name === '_splitset' ||
            p.value === 'splitset' ||
            p.value === 'billing-tracked'
          )) {
            itemsCount += item.quantity || 0;
          }
        }

        splitterOrders.push({
          id: order.id,
          name: order.name,
          createdAt: order.created_at,
          itemsCount,
          lineItems: order.line_items?.length || 0
        });
      }
    }

    return {
      success: true,
      data: splitterOrders,
      totalOrders: splitterOrders.length,
      totalItems: splitterOrders.reduce((sum, order) => sum + order.itemsCount, 0),
      dateRange: { startDate, endDate }
    };
  }

  // Connection validation
  async validateStoreConnection(storeId) {
    try {
      const client = await this.getClient(storeId);
      return await client.validateConnection();
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async getStoreInfo(storeId) {
    const client = await this.getClient(storeId);
    const result = await client.get('/shop.json');
    
    if (result.success) {
      return {
        success: true,
        data: result.data.shop
      };
    }
    
    return result;
  }

  async getApiUsage(storeId) {
    const client = await this.getClient(storeId);
    return await client.getApiCallLimit();
  }

  // Bulk operations with proper error handling
  async batchCreateProducts(storeId, productsData, batchSize = 10) {
    const results = [];
    const client = await this.getClient(storeId);
    
    for (let i = 0; i < productsData.length; i += batchSize) {
      const batch = productsData.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(
        batch.map(productData => client.post('/products.json', { product: productData }))
      );
      
      results.push(...batchResults.map((result, index) => ({
        index: i + index,
        success: result.status === 'fulfilled' && result.value.success,
        data: result.status === 'fulfilled' ? result.value.data : null,
        error: result.status === 'rejected' ? result.reason.message : 
               (result.value.success ? null : result.value.error)
      })));
      
      // Rate limiting delay between batches
      if (i + batchSize < productsData.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    return {
      success: true,
      results,
      successCount: results.filter(r => r.success).length,
      errorCount: results.filter(r => !r.success).length
    };
  }
}

module.exports = new ShopifyServiceV2();
