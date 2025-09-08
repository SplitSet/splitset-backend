const express = require('express');
const router = express.Router();
const ShopifyServiceV2 = require('../services/shopifyServiceV2');
const QueueService = require('../services/queueService');
const AnalyticsServiceV2 = require('../services/analyticsServiceV2');
const db = require('../db');
const { validateQuery, customValidators } = require('../middleware/validation');
const { healthCheckSchema } = require('../validators/schemas');

// Basic health check - always returns 200 if server is running
router.get('/health', async (req, res) => {
  const startTime = Date.now();
  
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    responseTime: Date.now() - startTime
  };

  res.json({
    success: true,
    data: health
  });
});

// Comprehensive readiness check
router.get('/ready', 
  validateQuery(healthCheckSchema),
  async (req, res) => {
    const startTime = Date.now();
    const { storeId, includeShopify, includeDatabase, includeQueue } = req.query;
    
    const checks = {
      server: { status: 'healthy', responseTime: 0 },
      database: { status: 'unknown', responseTime: 0 },
      queue: { status: 'unknown', responseTime: 0 },
      analytics: { status: 'unknown', responseTime: 0 },
      shopify: { status: 'unknown', responseTime: 0 }
    };

    let overallStatus = 'healthy';
    const errors = [];

    try {
      // Database check
      if (includeDatabase) {
        const dbStart = Date.now();
        try {
          await db.raw('SELECT 1');
          checks.database = {
            status: 'healthy',
            responseTime: Date.now() - dbStart
          };
        } catch (error) {
          checks.database = {
            status: 'unhealthy',
            error: error.message,
            responseTime: Date.now() - dbStart
          };
          overallStatus = 'unhealthy';
          errors.push('Database connection failed');
        }
      }

      // Queue check
      if (includeQueue) {
        const queueStart = Date.now();
        try {
          // Test Redis connection
          if (QueueService.redis) {
            await QueueService.redis.ping();
            checks.queue = {
              status: 'healthy',
              responseTime: Date.now() - queueStart
            };
          } else {
            checks.queue = {
              status: 'degraded',
              message: 'Running in-memory mode',
              responseTime: Date.now() - queueStart
            };
          }
        } catch (error) {
          checks.queue = {
            status: 'unhealthy',
            error: error.message,
            responseTime: Date.now() - queueStart
          };
          // Queue failure is not critical - we can fall back to in-memory
          if (overallStatus === 'healthy') {
            overallStatus = 'degraded';
          }
          errors.push('Queue connection failed (fallback available)');
        }
      }

      // Analytics service check
      const analyticsStart = Date.now();
      try {
        const analyticsHealth = await AnalyticsServiceV2.healthCheck();
        checks.analytics = {
          status: analyticsHealth.success ? 'healthy' : 'unhealthy',
          responseTime: Date.now() - analyticsStart,
          processingStores: analyticsHealth.processingStores || [],
          ...(analyticsHealth.error && { error: analyticsHealth.error })
        };
        
        if (!analyticsHealth.success && overallStatus === 'healthy') {
          overallStatus = 'degraded';
          errors.push('Analytics service degraded');
        }
      } catch (error) {
        checks.analytics = {
          status: 'unhealthy',
          error: error.message,
          responseTime: Date.now() - analyticsStart
        };
        if (overallStatus === 'healthy') {
          overallStatus = 'degraded';
        }
        errors.push('Analytics service check failed');
      }

      // Shopify API check (if store specified)
      if (includeShopify && storeId) {
        const shopifyStart = Date.now();
        try {
          const validation = await ShopifyServiceV2.validateStoreConnection(storeId);
          const apiUsage = await ShopifyServiceV2.getApiUsage(storeId);
          
          checks.shopify = {
            status: validation.success ? 'healthy' : 'unhealthy',
            responseTime: Date.now() - shopifyStart,
            ...(validation.shop && { shop: validation.shop }),
            ...(apiUsage && { apiUsage }),
            ...(validation.error && { error: validation.error })
          };
          
          if (!validation.success) {
            overallStatus = 'unhealthy';
            errors.push(`Shopify connection failed for store ${storeId}`);
          } else if (apiUsage && apiUsage.percentage > 90) {
            if (overallStatus === 'healthy') {
              overallStatus = 'degraded';
            }
            errors.push('Shopify API usage is high');
          }
        } catch (error) {
          checks.shopify = {
            status: 'unhealthy',
            error: error.message,
            responseTime: Date.now() - shopifyStart
          };
          overallStatus = 'unhealthy';
          errors.push('Shopify API check failed');
        }
      }

      const totalResponseTime = Date.now() - startTime;
      
      const readiness = {
        status: overallStatus,
        timestamp: new Date().toISOString(),
        totalResponseTime,
        checks,
        ...(errors.length > 0 && { errors })
      };

      // Return appropriate status code
      const statusCode = overallStatus === 'healthy' ? 200 : 
                        overallStatus === 'degraded' ? 200 : 503;

      res.status(statusCode).json({
        success: overallStatus !== 'unhealthy',
        data: readiness
      });

    } catch (error) {
      req.logger?.error('Readiness check failed', {
        error: error.message
      });

      res.status(503).json({
        success: false,
        data: {
          status: 'unhealthy',
          timestamp: new Date().toISOString(),
          totalResponseTime: Date.now() - startTime,
          error: 'Readiness check failed',
          checks
        }
      });
    }
  }
);

// Liveness probe - simple endpoint that returns 200 if process is alive
router.get('/live', (req, res) => {
  res.json({
    success: true,
    data: {
      status: 'alive',
      timestamp: new Date().toISOString(),
      pid: process.pid,
      uptime: process.uptime()
    }
  });
});

// Store-specific health check
router.get('/stores/:storeId/health',
  customValidators.storeExists,
  async (req, res) => {
    const startTime = Date.now();
    const { storeId } = req.params;
    
    try {
      // Check Shopify connection
      const shopifyHealth = await ShopifyServiceV2.validateStoreConnection(storeId);
      const apiUsage = await ShopifyServiceV2.getApiUsage(storeId);
      
      // Check recent runs
      const Run = require('../models/Run');
      const recentRuns = await Run.findByStore(storeId, { limit: 5 });
      const failedRuns = recentRuns.filter(run => run.status === 'failed').length;
      
      // Check queue status
      const queueStats = await QueueService.getQueueStats(storeId);
      
      const storeHealth = {
        storeId,
        shopDomain: req.store.shop_domain,
        status: req.store.status,
        shopify: {
          connected: shopifyHealth.success,
          ...(shopifyHealth.shop && { shop: shopifyHealth.shop }),
          ...(apiUsage && { apiUsage }),
          ...(shopifyHealth.error && { error: shopifyHealth.error })
        },
        queue: queueStats,
        recentActivity: {
          totalRuns: recentRuns.length,
          failedRuns,
          lastRun: recentRuns[0] ? {
            type: recentRuns[0].type,
            status: recentRuns[0].status,
            finishedAt: recentRuns[0].finished_at
          } : null
        },
        responseTime: Date.now() - startTime
      };

      const isHealthy = shopifyHealth.success && 
                       req.store.status === 'active' && 
                       failedRuns < 3;

      res.status(isHealthy ? 200 : 503).json({
        success: isHealthy,
        data: storeHealth
      });

    } catch (error) {
      req.logger?.error('Store health check failed', {
        storeId,
        error: error.message
      });

      res.status(503).json({
        success: false,
        error: 'Store health check failed',
        storeId
      });
    }
  }
);

// System metrics
router.get('/metrics', (req, res) => {
  const memUsage = process.memoryUsage();
  
  res.json({
    success: true,
    data: {
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: {
        rss: Math.round(memUsage.rss / 1024 / 1024) + ' MB',
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + ' MB',
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + ' MB',
        external: Math.round(memUsage.external / 1024 / 1024) + ' MB'
      },
      cpu: {
        loadAverage: os.loadavg(),
        platform: os.platform(),
        arch: os.arch()
      },
      node: {
        version: process.version,
        pid: process.pid
      },
      environment: process.env.NODE_ENV || 'development'
    }
  });
});

module.exports = router;
