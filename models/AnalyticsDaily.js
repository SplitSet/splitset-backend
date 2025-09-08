const db = require('../db');

class AnalyticsDaily {
  static tableName = 'analytics_daily';

  static async upsert(storeId, date, data) {
    const { ordersCount = 0, itemsCount = 0, revenueRupees = 0, metadata = {} } = data;
    
    const existing = await db(this.tableName)
      .where({ store_id: storeId, date })
      .first();

    const record = {
      store_id: storeId,
      date,
      splitter_orders_count: ordersCount,
      splitter_items_count: itemsCount,
      splitter_revenue_rupees: revenueRupees,
      metadata: JSON.stringify(metadata)
    };

    if (existing) {
      await db(this.tableName)
        .where({ store_id: storeId, date })
        .update(record);
      return { ...existing, ...record };
    } else {
      const [id] = await db(this.tableName).insert(record);
      return await db(this.tableName).where({ id }).first();
    }
  }

  static async findByStoreAndDateRange(storeId, startDate, endDate) {
    return await db(this.tableName)
      .where({ store_id: storeId })
      .whereBetween('date', [startDate, endDate])
      .orderBy('date', 'asc');
  }

  static async getMonthlyTotal(storeId, year, month) {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);
    
    const result = await db(this.tableName)
      .where({ store_id: storeId })
      .whereBetween('date', [startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]])
      .sum('splitter_orders_count as totalOrders')
      .sum('splitter_items_count as totalItems')
      .sum('splitter_revenue_rupees as totalRevenue')
      .first();

    return {
      totalOrders: parseInt(result.totalOrders) || 0,
      totalItems: parseInt(result.totalItems) || 0,
      totalRevenue: parseFloat(result.totalRevenue) || 0
    };
  }

  static async getDailySeries(storeId, startDate, endDate) {
    const records = await this.findByStoreAndDateRange(storeId, startDate, endDate);
    
    // Create continuous series with zero-fill
    const series = [];
    const current = new Date(startDate);
    const end = new Date(endDate);
    
    while (current <= end) {
      const dateStr = current.toISOString().split('T')[0];
      const record = records.find(r => r.date === dateStr);
      
      series.push({
        date: dateStr,
        ordersCount: record ? record.splitter_orders_count : 0,
        itemsCount: record ? record.splitter_items_count : 0,
        revenueRupees: record ? parseFloat(record.splitter_revenue_rupees) : 0
      });
      
      current.setDate(current.getDate() + 1);
    }
    
    return series;
  }

  static async cleanup(olderThanDays = 90) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - olderThanDays);
    
    return await db(this.tableName)
      .where('date', '<', cutoff.toISOString().split('T')[0])
      .del();
  }
}

module.exports = AnalyticsDaily;
