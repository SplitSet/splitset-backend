const ShopifyServiceV2 = require('./shopifyServiceV2');
const AnalyticsDaily = require('../models/AnalyticsDaily');
const Run = require('../models/Run');
const { logger } = require('../utils/logger');

class AnalyticsServiceV2 {
  constructor() {
    this.processing = new Set(); // Track running refreshes per store
  }

  // Main analytics refresh job
  async refreshStoreAnalytics(storeId, runId, params = {}, jobLogger = logger) {
    if (this.processing.has(storeId)) {
      throw new Error(`Analytics refresh already running for store ${storeId}`);
    }

    this.processing.add(storeId);
    
    try {
      await Run.updateStatus(runId, 'running');
      
      const { year, month } = params;
      const currentDate = new Date();
      const targetYear = year || currentDate.getFullYear();
      const targetMonth = month || currentDate.getMonth() + 1;
      
      jobLogger.info('Starting analytics refresh', {
        storeId,
        targetYear,
        targetMonth
      });

      // Get splitter orders for the month
      const ordersResult = await ShopifyServiceV2.getSplitterOrdersForMonth(
        storeId, 
        targetYear, 
        targetMonth
      );

      if (!ordersResult.success) {
        throw new Error(`Failed to fetch orders: ${ordersResult.error}`);
      }

      const { data: orders, totalOrders, totalItems } = ordersResult;
      
      // Group orders by date
      const dailyStats = {};
      
      for (const order of orders) {
        const date = new Date(order.createdAt).toISOString().split('T')[0];
        
        if (!dailyStats[date]) {
          dailyStats[date] = {
            ordersCount: 0,
            itemsCount: 0,
            revenueRupees: 0
          };
        }
        
        dailyStats[date].ordersCount += 1;
        dailyStats[date].itemsCount += order.itemsCount;
        dailyStats[date].revenueRupees += 9; // Rs 9 per order
      }

      // Persist daily stats
      const persistedDays = [];
      for (const [date, stats] of Object.entries(dailyStats)) {
        await AnalyticsDaily.upsert(storeId, date, stats);
        persistedDays.push(date);
      }

      const result = {
        storeId,
        period: { year: targetYear, month: targetMonth },
        totalOrders,
        totalItems,
        totalRevenueRupees: totalOrders * 9,
        dailyStatsCount: Object.keys(dailyStats).length,
        persistedDays: persistedDays.length,
        processedOrders: orders.length
      };

      await Run.updateStatus(runId, 'completed', { stats: result });
      
      jobLogger.info('Analytics refresh completed', result);
      
      return result;
      
    } catch (error) {
      await Run.updateStatus(runId, 'failed', { error: error.message });
      jobLogger.error('Analytics refresh failed', { error: error.message });
      throw error;
    } finally {
      this.processing.delete(storeId);
    }
  }

  // Get cached analytics summary
  async getStoreSummary(storeId, year = null, month = null) {
    const currentDate = new Date();
    const targetYear = year || currentDate.getFullYear();
    const targetMonth = month || currentDate.getMonth() + 1;

    try {
      // Get monthly totals from persisted data
      const monthlyTotals = await AnalyticsDaily.getMonthlyTotal(storeId, targetYear, targetMonth);
      
      // Get daily series for the month
      const startDate = new Date(targetYear, targetMonth - 1, 1).toISOString().split('T')[0];
      const endDate = new Date(targetYear, targetMonth, 0).toISOString().split('T')[0];
      const dailySeries = await AnalyticsDaily.getDailySeries(storeId, startDate, endDate);

      // Get last refresh info
      const lastRun = await Run.findByStore(storeId, { 
        type: 'analytics_refresh', 
        status: 'completed',
        limit: 1 
      });

      return {
        success: true,
        data: {
          storeId,
          period: {
            year: targetYear,
            month: targetMonth,
            start: startDate,
            end: endDate
          },
          summary: {
            totalOrders: monthlyTotals.totalOrders,
            totalItems: monthlyTotals.totalItems,
            totalRevenueRupees: monthlyTotals.totalRevenue
          },
          dailyItems: dailySeries.map(day => ({
            date: day.date,
            count: day.itemsCount
          })),
          lastRefresh: lastRun[0] ? {
            runId: lastRun[0].run_id,
            completedAt: lastRun[0].finished_at,
            stats: lastRun[0].stats ? JSON.parse(lastRun[0].stats) : null
          } : null
        }
      };
    } catch (error) {
      logger.error('Failed to get store summary', {
        storeId,
        error: error.message
      });
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Check if refresh is needed
  async isRefreshNeeded(storeId, maxAgeMinutes = 30) {
    const lastRun = await Run.findByStore(storeId, { 
      type: 'analytics_refresh', 
      status: 'completed',
      limit: 1 
    });

    if (!lastRun.length) return true;

    const lastRefresh = new Date(lastRun[0].finished_at);
    const ageMinutes = (Date.now() - lastRefresh.getTime()) / (1000 * 60);
    
    return ageMinutes > maxAgeMinutes;
  }

  // Get analytics for multiple stores (admin view)
  async getMultiStoreAnalytics(storeIds, year = null, month = null) {
    const results = await Promise.allSettled(
      storeIds.map(storeId => this.getStoreSummary(storeId, year, month))
    );

    const successful = [];
    const failed = [];

    results.forEach((result, index) => {
      const storeId = storeIds[index];
      
      if (result.status === 'fulfilled' && result.value.success) {
        successful.push(result.value.data);
      } else {
        failed.push({
          storeId,
          error: result.status === 'rejected' ? result.reason.message : result.value.error
        });
      }
    });

    // Calculate aggregate stats
    const aggregate = successful.reduce(
      (acc, store) => ({
        totalStores: acc.totalStores + 1,
        totalOrders: acc.totalOrders + store.summary.totalOrders,
        totalItems: acc.totalItems + store.summary.totalItems,
        totalRevenueRupees: acc.totalRevenueRupees + store.summary.totalRevenueRupees
      }),
      { totalStores: 0, totalOrders: 0, totalItems: 0, totalRevenueRupees: 0 }
    );

    return {
      success: true,
      data: {
        aggregate,
        stores: successful,
        errors: failed,
        period: year && month ? { year, month } : null
      }
    };
  }

  // Cleanup old analytics data
  async cleanup(olderThanDays = 90) {
    const cleanedAnalytics = await AnalyticsDaily.cleanup(olderThanDays);
    const cleanedRuns = await Run.cleanup(olderThanDays);
    
    logger.info('Analytics cleanup completed', {
      cleanedAnalytics,
      cleanedRuns,
      olderThanDays
    });
    
    return { cleanedAnalytics, cleanedRuns };
  }

  // Health check
  async healthCheck() {
    try {
      // Check if we can access the database
      const testQuery = await AnalyticsDaily.findByStoreAndDateRange(1, '2023-01-01', '2023-01-01');
      
      return {
        success: true,
        status: 'healthy',
        processingStores: Array.from(this.processing)
      };
    } catch (error) {
      return {
        success: false,
        status: 'unhealthy',
        error: error.message
      };
    }
  }
}

module.exports = new AnalyticsServiceV2();
