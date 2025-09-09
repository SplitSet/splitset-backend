/**
 * Production-Safe Server with Intelligent Migration Handling
 * This server can start even with migration file deployment issues
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const db = require('./db');
const logger = require('./utils/logger');

// Import services
const QueueService = require('./services/queueService');
const AnalyticsService = require('./services/analyticsService');
const MaintenanceService = require('./services/maintenanceService');

// Import middleware
const { authenticate, authorizeAdmin } = require('./middleware/auth');
const { validateRequest } = require('./middleware/validation');

// Import routes
const authRoutes = require('./routes/auth');
const shopifyRoutes = require('./routes/shopifyFixed');
const productsRoutes = require('./routes/products');
const ordersRoutes = require('./routes/orders');
const analyticsRoutes = require('./routes/analyticsV2');
const storesRoutes = require('./routes/storesV2');
const setsRoutes = require('./routes/sets');
const themeRoutes = require('./routes/theme');
const healthRoutes = require('./routes/health');
const adminRoutes = require('./routes/admin');
const splitsetControlRoutes = require('./routes/splitsetControl');
const storeSettingsRoutes = require('./routes/storeSettings');

const app = express();

// Trust proxy for accurate IP addresses
app.set('trust proxy', true);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.shopify.com"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://*.myshopify.com"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// Compression
app.use(compression());

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = process.env.FRONTEND_URL 
      ? process.env.FRONTEND_URL.split(',')
      : ['http://localhost:3000'];
    
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

// Body parsing
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000,
  max: process.env.RATE_LIMIT_MAX_REQUESTS || 100,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', limiter);

// Request logging
if (process.env.ENABLE_REQUEST_LOGGING === 'true') {
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      logger.info('Request processed', {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration: `${duration}ms`,
        ip: req.ip
      });
    });
    next();
  });
}

// API Routes
app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/shopify', authenticate, shopifyRoutes);
app.use('/api/products', authenticate, productsRoutes);
app.use('/api/orders', authenticate, ordersRoutes);
app.use('/api/analytics', authenticate, analyticsRoutes);
app.use('/api/stores', authenticate, storesRoutes);
app.use('/api/sets', authenticate, setsRoutes);
app.use('/api/theme', authenticate, themeRoutes);
app.use('/api/admin', authenticate, authorizeAdmin, adminRoutes);
app.use('/api/splitset', authenticate, splitsetControlRoutes);
app.use('/api/store-settings', authenticate, storeSettingsRoutes);

// Shopify webhook endpoints
app.post('/webhooks/shopify/:topic', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const { topic } = req.params;
    const shop = req.get('X-Shopify-Shop-Domain');
    
    logger.info(`Webhook received: ${topic} from ${shop}`);
    
    // Process webhook based on topic
    switch(topic) {
      case 'app/uninstalled':
        await handleAppUninstalled(shop);
        break;
      case 'orders/create':
      case 'orders/updated':
        await QueueService.addJob('processOrder', { 
          shop, 
          order: JSON.parse(req.body) 
        });
        break;
      default:
        logger.warn(`Unhandled webhook topic: ${topic}`);
    }
    
    res.status(200).send('OK');
  } catch (error) {
    logger.error('Webhook processing error:', error);
    res.status(500).send('Error processing webhook');
  }
});

// Error handling
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation Error',
      details: err.details
    });
  }
  
  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({
      error: 'Unauthorized'
    });
  }
  
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// Helper function for app uninstall
async function handleAppUninstalled(shop) {
  try {
    await db('stores')
      .where('shop_domain', shop)
      .update({
        is_active: false,
        uninstalled_at: new Date()
      });
    
    logger.info(`App uninstalled for shop: ${shop}`);
  } catch (error) {
    logger.error(`Error handling app uninstall for ${shop}:`, error);
  }
}

/**
 * Intelligent Migration Handler
 * Handles migration issues gracefully without preventing server startup
 */
async function handleMigrations() {
  logger.info('🔧 Checking database migrations...');
  
  try {
    // First, check database connectivity
    await db.raw('SELECT 1');
    logger.info('✅ Database connection successful');
    
    // Check if essential tables exist
    const essentialTables = ['stores', 'users', 'products', 'orders'];
    const tables = await db.raw("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
    const existingTables = tables.rows.map(row => row.tablename);
    
    const missingTables = essentialTables.filter(table => !existingTables.includes(table));
    
    if (missingTables.length > 0) {
      logger.warn(`⚠️  Missing essential tables: ${missingTables.join(', ')}`);
      logger.info('Running consolidated schema migration...');
      
      // Try to run the consolidated migration
      try {
        const consolidatedMigration = require('./migrations/008_consolidated_schema');
        await consolidatedMigration.up(db);
        logger.info('✅ Consolidated migration completed successfully');
      } catch (migErr) {
        logger.error('Failed to run consolidated migration:', migErr.message);
        throw new Error('Database not properly initialized');
      }
    } else {
      logger.info('✅ All essential tables exist');
    }
    
    // Now try to run normal migrations
    try {
      const pendingMigrations = await db.migrate.list();
      const [completed, pending] = pendingMigrations;
      
      logger.info(`Migrations: ${completed.length} completed, ${pending.length} pending`);
      
      if (pending.length > 0) {
        await db.migrate.latest();
        logger.info('✅ Migrations completed successfully');
      }
    } catch (migrationError) {
      if (migrationError.message.includes('missing:')) {
        logger.warn('⚠️  Migration file missing - but database is ready');
        logger.warn('This is a deployment issue, not a database issue');
        
        // Clean up orphaned migration records
        const match = migrationError.message.match(/missing: (.+)/);
        if (match && match[1]) {
          const missingFiles = match[1].split(', ');
          for (const file of missingFiles) {
            logger.info(`Cleaning orphaned record: ${file}`);
            await db('knex_migrations').where('name', file).del();
          }
          logger.info('✅ Cleaned orphaned migration records');
        }
      } else {
        throw migrationError;
      }
    }
    
  } catch (error) {
    logger.error('Migration handling error:', error.message);
    
    // If it's just a migration file issue but DB is ready, continue
    if (error.message.includes('missing:') || error.message.includes('corrupt')) {
      logger.warn('Continuing despite migration file issues...');
      return true;
    }
    
    throw error;
  }
  
  return true;
}

// Initialize and start server
async function startServer() {
  try {
    // Handle migrations intelligently
    await handleMigrations();
    
    // Initialize services
    logger.info('Initializing services...');
    await QueueService.initialize();
    logger.info('✅ Queue service initialized');
    
    // Start analytics service
    if (process.env.ENABLE_ANALYTICS !== 'false') {
      AnalyticsService.startPeriodicRefresh();
      logger.info('✅ Analytics service started');
    }
    
    // Start maintenance service
    if (process.env.ENABLE_CLEANUP === 'true') {
      MaintenanceService.startPeriodicCleanup();
      logger.info('✅ Maintenance service started');
    }
    
    // Start server
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
      logger.info(`🚀 SplitSet Production Server running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV}`);
      logger.info(`Frontend URL: ${process.env.FRONTEND_URL}`);
    });
    
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  
  try {
    await QueueService.shutdown();
    await db.destroy();
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
});

// Start the server
startServer();
