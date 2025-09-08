const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

// Import utilities and middleware
const { logger, requestContextMiddleware } = require('./utils/logger');
const db = require('./db');
const QueueService = require('./services/queueService');

// Import routes
const authRoutes = require('./routes/auth');
const healthRoutes = require('./routes/health');
const storesRoutes = require('./routes/storesV2');
const analyticsRoutes = require('./routes/analyticsV2');
const productsRoutes = require('./routes/products');
const ordersRoutes = require('./routes/orders');
const maintenanceRoutes = require('./routes/maintenance');

const app = express();
const PORT = process.env.PORT || 5000;

// Trust proxy for accurate IP addresses
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

// CORS configuration
app.use(cors({
  origin: function(origin, callback) {
    const allowedOrigins = [
      process.env.FRONTEND_URL || 'http://localhost:3000',
      'http://localhost:3000',
      'http://localhost:3001'
    ];
    
    // Allow requests with no origin (mobile apps, etc.)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-run-id', 'x-store-id']
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 1000, // Increased for multi-store
  message: {
    success: false,
    error: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Skip rate limiting for health checks
  skip: (req) => req.path.startsWith('/health') || req.path.startsWith('/ready')
});

app.use(limiter);

// Body parsing middleware
app.use(express.json({ 
  limit: '10mb',
  verify: (req, res, buf) => {
    // Store raw body for webhook verification if needed
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Request context and logging middleware
app.use(requestContextMiddleware);

// Health checks (before authentication)
app.use('/', healthRoutes);

// Authentication routes (public)
app.use('/api/auth', authRoutes);

// Protected API routes (require authentication)
const { authenticate } = require('./middleware/auth');
app.use('/api/stores', authenticate, storesRoutes);
app.use('/api/analytics', analyticsRoutes); // Has its own auth middleware
app.use('/api/products', authenticate, productsRoutes);
app.use('/api/orders', authenticate, ordersRoutes);
app.use('/api/maintenance', maintenanceRoutes); // Has its own auth middleware

// Legacy routes (for backward compatibility)
app.use('/api/shopify', require('./routes/shopifyFixed'));
app.use('/api/sets', require('./routes/sets'));
app.use('/api/theme', require('./routes/theme'));
app.use('/api/bundle-template', require('./routes/bundleTemplate'));
app.use('/api/metafields', require('./routes/metafields'));
app.use('/api/app-toggle', require('./routes/appToggle'));
app.use('/api/component-visibility', require('./routes/componentVisibility'));

// 404 handler
app.use('*', (req, res) => {
  req.logger?.warn('Route not found', {
    method: req.method,
    path: req.originalUrl
  });
  
  res.status(404).json({
    success: false,
    error: 'Route not found',
    path: req.originalUrl
  });
});

// Global error handler
app.use((err, req, res, next) => {
  req.logger?.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method
  });

  // Don't expose internal errors in production
  const message = process.env.NODE_ENV === 'production' 
    ? 'Internal server error' 
    : err.message;

  res.status(err.status || 500).json({
    success: false,
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Graceful shutdown handler
const gracefulShutdown = async (signal) => {
  logger.info(`${signal} received, starting graceful shutdown`);
  
  const server = app.get('server');
  
  // Stop accepting new connections
  server.close(async () => {
    logger.info('HTTP server closed');
    
    try {
      // Close database connections
      await db.destroy();
      logger.info('Database connections closed');
      
      // Shutdown queue service
      await QueueService.shutdown();
      logger.info('Queue service shutdown complete');
      
      logger.info('Graceful shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown', { error: error.message });
      process.exit(1);
    }
  });
  
  // Force shutdown after 30 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
};

// Initialize services and start server
const startServer = async () => {
  try {
    // Run database migrations
    logger.info('Running database migrations...');
    await db.migrate.latest();
    logger.info('Database migrations completed');
    
    // Initialize queue service (optional - Redis required)
    logger.info('Initializing queue service...');
    try {
      await QueueService.initialize();
      logger.info('Queue service initialized');
    } catch (error) {
      logger.warn('Queue service initialization failed - continuing without Redis', { 
        error: error.message 
      });
      logger.info('App will work without background jobs - Redis can be added later');
    }
    
    // Start HTTP server
    const server = app.listen(PORT, () => {
      logger.info('Server started', {
        port: PORT,
        environment: process.env.NODE_ENV || 'development',
        frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
        shopifyStore: process.env.SHOPIFY_STORE_DOMAIN || 'Not configured'
      });
    });
    
    // Store server reference for graceful shutdown
    app.set('server', server);
    
    // Setup graceful shutdown handlers
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    
    // Handle uncaught exceptions and rejections
    process.on('uncaughtException', (err) => {
      logger.error('Uncaught Exception', { error: err.message, stack: err.stack });
      gracefulShutdown('UNCAUGHT_EXCEPTION');
    });
    
    process.on('unhandledRejection', (err) => {
      logger.error('Unhandled Rejection', { error: err.message, stack: err.stack });
      gracefulShutdown('UNHANDLED_REJECTION');
    });
    
    // Schedule periodic cleanup
    if (process.env.ENABLE_CLEANUP !== 'false') {
      const cleanupInterval = parseInt(process.env.CLEANUP_INTERVAL_HOURS) || 24;
      setInterval(async () => {
        try {
          const AnalyticsServiceV2 = require('./services/analyticsServiceV2');
          await AnalyticsServiceV2.cleanup();
          logger.info('Periodic cleanup completed');
        } catch (error) {
          logger.error('Periodic cleanup failed', { error: error.message });
        }
      }, cleanupInterval * 60 * 60 * 1000);
    }
    
  } catch (error) {
    logger.error('Failed to start server', { error: error.message });
    process.exit(1);
  }
};

// Start the server
if (require.main === module) {
  startServer();
}

module.exports = app;
