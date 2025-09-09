/**
 * Maintenance Service
 * Handles periodic cleanup tasks and maintenance operations
 */

const logger = require('../utils/logger');
const db = require('../db');

class MaintenanceService {
  constructor() {
    this.cleanupInterval = null;
    this.isRunning = false;
  }

  /**
   * Start periodic cleanup tasks
   */
  startPeriodicCleanup() {
    if (this.isRunning) {
      logger.warn('Maintenance service already running');
      return;
    }

    const intervalHours = parseInt(process.env.CLEANUP_INTERVAL_HOURS) || 24;
    const intervalMs = intervalHours * 60 * 60 * 1000;

    logger.info(`Starting maintenance service with ${intervalHours}h interval`);

    this.cleanupInterval = setInterval(async () => {
      await this.runCleanupTasks();
    }, intervalMs);

    this.isRunning = true;

    // Run initial cleanup after startup delay
    setTimeout(async () => {
      await this.runCleanupTasks();
    }, 30000); // 30 seconds delay
  }

  /**
   * Stop periodic cleanup
   */
  stopPeriodicCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      this.isRunning = false;
      logger.info('Maintenance service stopped');
    }
  }

  /**
   * Run all cleanup tasks
   */
  async runCleanupTasks() {
    logger.info('🧹 Starting maintenance cleanup tasks');

    try {
      await Promise.all([
        this.cleanupOldSessions(),
        this.cleanupOldRuns(),
        this.cleanupOrphanedData(),
        this.updateAnalytics()
      ]);

      logger.info('✅ Maintenance cleanup completed successfully');
    } catch (error) {
      logger.error('❌ Maintenance cleanup failed:', error);
    }
  }

  /**
   * Clean up old expired sessions
   */
  async cleanupOldSessions() {
    try {
      const cutoffDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
      
      const deleted = await db('admin_sessions')
        .where('last_activity', '<', cutoffDate)
        .del();

      if (deleted > 0) {
        logger.info(`🗑️  Cleaned up ${deleted} old admin sessions`);
      }
    } catch (error) {
      logger.error('Failed to cleanup old sessions:', error);
    }
  }

  /**
   * Clean up old completed runs
   */
  async cleanupOldRuns() {
    try {
      const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
      
      const deleted = await db('runs')
        .where('completed_at', '<', cutoffDate)
        .whereIn('status', ['completed', 'failed'])
        .del();

      if (deleted > 0) {
        logger.info(`🗑️  Cleaned up ${deleted} old completed runs`);
      }
    } catch (error) {
      logger.error('Failed to cleanup old runs:', error);
    }
  }

  /**
   * Clean up orphaned data
   */
  async cleanupOrphanedData() {
    try {
      // Clean up orphaned split_products
      const orphanedProducts = await db('split_products')
        .leftJoin('stores', 'split_products.store_id', 'stores.id')
        .whereNull('stores.id')
        .del();

      if (orphanedProducts > 0) {
        logger.info(`🗑️  Cleaned up ${orphanedProducts} orphaned split products`);
      }

      // Clean up orphaned user_stores
      const orphanedUserStores = await db('user_stores')
        .leftJoin('users', 'user_stores.user_id', 'users.id')
        .leftJoin('stores', 'user_stores.store_id', 'stores.id')
        .where(function() {
          this.whereNull('users.id').orWhereNull('stores.id');
        })
        .del();

      if (orphanedUserStores > 0) {
        logger.info(`🗑️  Cleaned up ${orphanedUserStores} orphaned user-store relationships`);
      }
    } catch (error) {
      logger.error('Failed to cleanup orphaned data:', error);
    }
  }

  /**
   * Update analytics data
   */
  async updateAnalytics() {
    try {
      // Update daily analytics for yesterday if not exists
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);

      const stores = await db('stores').where('is_active', true);
      
      for (const store of stores) {
        const exists = await db('analytics_daily')
          .where('store_id', store.id)
          .where('date', yesterday.toISOString().split('T')[0])
          .first();

        if (!exists) {
          // Calculate analytics for yesterday
          const orders = await db('orders')
            .where('store_id', store.id)
            .where('order_date', '>=', yesterday)
            .where('order_date', '<', new Date(yesterday.getTime() + 24 * 60 * 60 * 1000));

          const ordersCount = orders.length;
          const revenue = orders.reduce((sum, order) => sum + parseFloat(order.total_price || 0), 0);

          if (ordersCount > 0) {
            await db('analytics_daily').insert({
              store_id: store.id,
              date: yesterday.toISOString().split('T')[0],
              orders_count: ordersCount,
              revenue: revenue,
              average_order_value: revenue / ordersCount,
              created_at: new Date(),
              updated_at: new Date()
            });

            logger.info(`📊 Updated analytics for store ${store.shop_domain}: ${ordersCount} orders, $${revenue.toFixed(2)} revenue`);
          }
        }
      }
    } catch (error) {
      logger.error('Failed to update analytics:', error);
    }
  }

  /**
   * Get maintenance status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      intervalHours: parseInt(process.env.CLEANUP_INTERVAL_HOURS) || 24,
      enabled: process.env.ENABLE_CLEANUP === 'true'
    };
  }

  /**
   * Force run cleanup tasks manually
   */
  async forceCleanup() {
    logger.info('🔧 Manual maintenance cleanup triggered');
    await this.runCleanupTasks();
  }
}

module.exports = new MaintenanceService();
