const Bull = require('bull');
const Redis = require('ioredis');
const { logger, createJobLogger } = require('../utils/logger');

class QueueService {
  constructor() {
    this.redis = null;
    this.queues = new Map();
    this.isInitialized = false;
  }

  async initialize() {
    if (this.isInitialized) return;

    // Use REDIS_URL if available (Render format), otherwise individual config
    let redisConfig;
    if (process.env.REDIS_URL) {
      redisConfig = process.env.REDIS_URL;
      logger.info('Using REDIS_URL for connection');
    } else {
      redisConfig = {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT) || 6379,
        password: process.env.REDIS_PASSWORD || undefined,
        db: parseInt(process.env.REDIS_DB) || 0,
        retryDelayOnFailover: 100,
        enableReadyCheck: false,
        maxRetriesPerRequest: null,
      };
      logger.info('Using individual Redis config vars');
    }

    try {
      // Test Redis connection
      this.redis = new Redis(redisConfig);
      await this.redis.ping();
      
      logger.info('Redis connection established', { 
        host: redisConfig.host, 
        port: redisConfig.port 
      });

      this.isInitialized = true;
    } catch (error) {
      logger.error('Failed to connect to Redis', { error: error.message });
      
      // Fall back to in-memory processing if Redis is not available
      logger.warn('Falling back to in-memory job processing (not recommended for production)');
      this.isInitialized = false;
    }
  }

  // Get or create queue for a store
  getQueue(storeId, queueType = 'default') {
    const queueName = `store-${storeId}-${queueType}`;
    
    if (this.queues.has(queueName)) {
      return this.queues.get(queueName);
    }

    if (!this.isInitialized) {
      // Return a mock queue for in-memory processing
      return this.createMockQueue(queueName);
    }

    const queue = new Bull(queueName, {
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT) || 6379,
        password: process.env.REDIS_PASSWORD || undefined,
        db: parseInt(process.env.REDIS_DB) || 0,
      },
      defaultJobOptions: {
        removeOnComplete: 10, // Keep last 10 completed jobs
        removeOnFail: 50,     // Keep last 50 failed jobs
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      },
    });

    // Set concurrency to 1 per store to prevent conflicts
    queue.process(1, async (job) => {
      return this.processJob(job);
    });

    // Event handlers
    queue.on('completed', (job, result) => {
      logger.info('Job completed', {
        jobId: job.id,
        storeId,
        queueType,
        duration: Date.now() - job.timestamp,
        result: typeof result === 'object' ? result : { success: true }
      });
    });

    queue.on('failed', (job, error) => {
      logger.error('Job failed', {
        jobId: job.id,
        storeId,
        queueType,
        error: error.message,
        attempts: job.attemptsMade,
        maxAttempts: job.opts.attempts
      });
    });

    queue.on('stalled', (job) => {
      logger.warn('Job stalled', {
        jobId: job.id,
        storeId,
        queueType
      });
    });

    this.queues.set(queueName, queue);
    return queue;
  }

  // Create mock queue for in-memory processing
  createMockQueue(queueName) {
    return {
      add: async (jobType, data, options = {}) => {
        logger.info('Processing job in-memory', { queueName, jobType });
        
        try {
          const mockJob = {
            id: Date.now(),
            data,
            opts: options,
            timestamp: Date.now(),
          };
          
          const result = await this.processJob(mockJob);
          logger.info('In-memory job completed', { queueName, jobType });
          return result;
        } catch (error) {
          logger.error('In-memory job failed', { 
            queueName, 
            jobType, 
            error: error.message 
          });
          throw error;
        }
      },
      getWaiting: async () => [],
      getActive: async () => [],
      getCompleted: async () => [],
      getFailed: async () => [],
      clean: async () => {},
      close: async () => {},
    };
  }

  // Central job processor
  async processJob(job) {
    const { type, storeId, runId, ...params } = job.data;
    const jobLogger = createJobLogger(runId, storeId);

    jobLogger.jobStart(type, { jobId: job.id });
    const startTime = Date.now();

    try {
      let result;

      switch (type) {
        case 'analytics_refresh':
          result = await this.processAnalyticsRefresh(storeId, runId, params, jobLogger);
          break;
        case 'product_split':
          result = await this.processProductSplit(storeId, runId, params, jobLogger);
          break;
        case 'bulk_operation':
          result = await this.processBulkOperation(storeId, runId, params, jobLogger);
          break;
        default:
          throw new Error(`Unknown job type: ${type}`);
      }

      const duration = Date.now() - startTime;
      jobLogger.jobComplete(type, duration, result);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      jobLogger.jobError(type, error, { duration });
      throw error;
    }
  }

  // Job processors
  async processAnalyticsRefresh(storeId, runId, params, logger) {
    const AnalyticsServiceV2 = require('./analyticsServiceV2');
    return await AnalyticsServiceV2.refreshStoreAnalytics(storeId, runId, params, logger);
  }

  async processProductSplit(storeId, runId, params, logger) {
    const ProductSplitService = require('./productSplitService');
    return await ProductSplitService.splitProducts(storeId, runId, params, logger);
  }

  async processBulkOperation(storeId, runId, params, logger) {
    const BulkOperationService = require('./bulkOperationService');
    return await BulkOperationService.processBulkOperation(storeId, runId, params, logger);
  }

  // Queue management methods
  async addJob(storeId, jobType, data, options = {}) {
    const queue = this.getQueue(storeId, 'default');
    
    const jobData = {
      type: jobType,
      storeId,
      runId: data.runId,
      ...data
    };

    const jobOptions = {
      delay: options.delay || 0,
      priority: options.priority || 0,
      attempts: options.attempts || 3,
      ...options
    };

    return await queue.add(jobType, jobData, jobOptions);
  }

  async getQueueStats(storeId, queueType = 'default') {
    const queue = this.getQueue(storeId, queueType);
    
    const [waiting, active, completed, failed] = await Promise.all([
      queue.getWaiting(),
      queue.getActive(),
      queue.getCompleted(),
      queue.getFailed()
    ]);

    return {
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
      total: waiting.length + active.length + completed.length + failed.length
    };
  }

  async cleanQueue(storeId, queueType = 'default', grace = 24 * 60 * 60 * 1000) {
    const queue = this.getQueue(storeId, queueType);
    
    // Clean completed jobs older than grace period
    await queue.clean(grace, 'completed');
    await queue.clean(grace, 'failed');
    
    logger.info('Queue cleaned', { storeId, queueType, grace });
  }

  async pauseQueue(storeId, queueType = 'default') {
    const queue = this.getQueue(storeId, queueType);
    await queue.pause();
    logger.info('Queue paused', { storeId, queueType });
  }

  async resumeQueue(storeId, queueType = 'default') {
    const queue = this.getQueue(storeId, queueType);
    await queue.resume();
    logger.info('Queue resumed', { storeId, queueType });
  }

  // Shutdown gracefully
  async shutdown() {
    logger.info('Shutting down queue service');
    
    const closePromises = Array.from(this.queues.values()).map(queue => 
      queue.close ? queue.close() : Promise.resolve()
    );
    
    await Promise.all(closePromises);
    
    if (this.redis) {
      await this.redis.disconnect();
    }
    
    logger.info('Queue service shut down complete');
  }
}

module.exports = new QueueService();
