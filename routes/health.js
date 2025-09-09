const express = require('express');
const router = express.Router();
const Redis = require('ioredis');
const QueueService = require('../services/queueService');
const logger = require('../utils/logger');

// Basic health check
router.get('/', async (req, res) => {
  try {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '2.0.0',
      environment: process.env.NODE_ENV,
      responseTime: 0
    };
    res.json({ success: true, data: health });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Detailed Redis health check
router.get('/redis', async (req, res) => {
  const startTime = Date.now();
  
  try {
    // Get Redis config from environment
    const redisConfig = process.env.REDIS_URL || {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB) || 0
    };

    // Test Redis connection
    const redis = new Redis(redisConfig);
    
    // Set a test key
    const testKey = 'health-check-' + Date.now();
    await redis.set(testKey, 'ok');
    const testValue = await redis.get(testKey);
    await redis.del(testKey);
    
    // Get queue service status
    const queueStatus = {
      initialized: QueueService.isInitialized,
      redisDisabled: QueueService.redisDisabled || false
    };

    // Check Redis info
    const info = await redis.info();
    
    const status = {
      connected: true,
      ping: 'ok',
      testKey: testValue === 'ok' ? 'passed' : 'failed',
      queueService: queueStatus,
      config: {
        url: process.env.REDIS_URL ? 'set' : 'not set',
        host: process.env.REDIS_HOST || 'default',
        port: process.env.REDIS_PORT || 'default'
      },
      info: info.split('\n').reduce((acc, line) => {
        const [key, value] = line.split(':');
        if (key && value) acc[key.trim()] = value.trim();
        return acc;
      }, {}),
      responseTime: Date.now() - startTime
    };

    // Clean up test connection
    redis.disconnect();

    res.json({ success: true, data: status });
  } catch (error) {
    const errorResponse = {
      success: false,
      error: error.message,
      details: {
        type: error.name,
        allowlistError: error.message.includes('allowlist'),
        config: {
          url: process.env.REDIS_URL ? 'set' : 'not set',
          host: process.env.REDIS_HOST || 'default',
          port: process.env.REDIS_PORT || 'default'
        },
        queueService: {
          initialized: QueueService.isInitialized,
          redisDisabled: QueueService.redisDisabled || false
        },
        responseTime: Date.now() - startTime
      }
    };

    logger.error('Redis health check failed:', error);
    res.status(500).json(errorResponse);
  }
});

module.exports = router;