const shopifyService = require('./shopifyService');
const axios = require('axios');

// Simple in-memory cache with TTL for product tags to avoid repeated lookups
class ProductTagCache {
  constructor(ttlMs = 1000 * 60 * 60) {
    this.ttlMs = ttlMs;
    this.map = new Map();
  }

  get(productId) {
    const entry = this.map.get(productId);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(productId);
      return null;
    }
    return entry.tags;
  }

  set(productId, tags) {
    this.map.set(productId, { tags, expiresAt: Date.now() + this.ttlMs });
  }
}

class AnalyticsService {
  constructor() {
    this.cache = {
      summary: null,
      lastRefreshed: 0
    };
    this.productTagCache = new ProductTagCache();
    this.refreshInProgress = false;
  }

  getMonthRange() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = now;
    return { start, end };
  }

  async productHasSplitterTag(productId) {
    const cached = this.productTagCache.get(productId);
    if (cached) {
      return cached.includes('splitter') || 
             cached.includes('splitset') || 
             cached.includes('splitset-created') || 
             cached.includes('billing-tracked');
    }
    
    const productResp = await shopifyService.getProduct(productId);
    if (!productResp.success || !productResp.data) return false;
    
    const product = productResp.data;
    const tagsStr = product.tags || '';
    const tags = tagsStr.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
    this.productTagCache.set(productId, tags);
    
    // Only count products that have SplitSet tracking tags
    // This ensures we don't accidentally count unrelated products
    const hasTrackingTags = tags.includes('splitter') || 
                           tags.includes('splitset') || 
                           tags.includes('splitset-created') || 
                           tags.includes('billing-tracked');
    
    return hasTrackingTags;
  }

  async fetchOrdersThisMonth(limit = 250) {
    // For simplicity, fetch up to 250 recent orders and filter by month
    const { start, end } = this.getMonthRange();
    const result = await shopifyService.getOrders(limit, 'any');
    if (!result.success) {
      throw new Error(result.error || 'Failed to fetch orders');
    }
    const orders = result.data || [];
    return orders.filter(o => {
      const created = new Date(o.created_at);
      return created >= start && created <= end;
    });
  }

  async computeSplitterSummary() {
    const orders = await this.fetchOrdersThisMonth(250);

    let totalOrdersViaSplitter = 0;
    let totalItemsViaSplitter = 0;
    const dailyItems = {};

    for (const order of orders) {
      if (order.fulfillment_status !== 'fulfilled') continue;
      const createdDate = new Date(order.created_at);
      const dayKey = createdDate.toISOString().slice(0, 10);

      let orderHasSplitter = false;
      let itemsInOrder = 0;

      for (const li of order.line_items || []) {
        if (!li.product_id) continue;
        // Check splitter tag on product
        // If any line item belongs to a product tagged 'splitter', count its quantity as items
        try {
          const isSplitter = await this.productHasSplitterTag(li.product_id);
          if (isSplitter) {
            orderHasSplitter = true;
            itemsInOrder += (li.quantity || 0);
          }
        } catch (_) {
          // ignore tag lookup errors for robustness
        }
      }

      if (orderHasSplitter) {
        totalOrdersViaSplitter += 1;
        totalItemsViaSplitter += itemsInOrder;
        dailyItems[dayKey] = (dailyItems[dayKey] || 0) + itemsInOrder;
      }
    }

    // Build continuous series for current month
    const { start, end } = this.getMonthRange();
    const series = [];
    const cursor = new Date(start);
    while (cursor <= end) {
      const key = cursor.toISOString().slice(0, 10);
      series.push({ date: key, count: dailyItems[key] || 0 });
      cursor.setDate(cursor.getDate() + 1);
    }

    return {
      period: {
        start: start.toISOString(),
        end: end.toISOString()
      },
      totalOrders: totalOrdersViaSplitter,
      totalItems: totalItemsViaSplitter,
      totalRevenueRupees: totalOrdersViaSplitter * 9,
      dailyItems: series
    };
  }

  async refreshCache() {
    if (this.refreshInProgress) return;
    this.refreshInProgress = true;
    try {
      const summary = await this.computeSplitterSummary();
      this.cache.summary = summary;
      this.cache.lastRefreshed = Date.now();
    } catch (e) {
      // keep old cache on failure
    } finally {
      this.refreshInProgress = false;
    }
  }

  getCachedSummary() {
    return {
      summary: this.cache.summary,
      lastRefreshed: this.cache.lastRefreshed
    };
  }
}

module.exports = new AnalyticsService();


