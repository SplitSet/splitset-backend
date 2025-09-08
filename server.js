const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 5000;

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/products', require('./routes/products'));
app.use('/api/shopify', require('./routes/shopifyFixed')); // Using fixed Shopify routes
app.use('/api/orders', require('./routes/orders'));
app.use('/api/sets', require('./routes/sets')); // Automatic set processing
app.use('/api/theme', require('./routes/theme')); // Theme installation
app.use('/api/bundle-template', require('./routes/bundleTemplate')); // Bundle template management
app.use('/api/metafields', require('./routes/metafields')); // Metafield definitions
app.use('/api/app-toggle', require('./routes/appToggle')); // App activation/deactivation
app.use('/api/component-visibility', require('./routes/componentVisibility')); // Component product visibility
app.use('/api/analytics', require('./routes/analytics')); // Analytics routes

// Health check
app.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    message: 'SplitSet API is running'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: 'Internal Server Error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

app.listen(PORT, () => {
  console.log(`🚀 SplitSet server running on port ${PORT}`);
  console.log(`📱 Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:3000'}`);
  console.log(`🏪 Shopify Store: ${process.env.SHOPIFY_STORE_DOMAIN || 'Not configured'}`);

  // Schedule analytics cache refresh every 30 minutes
  const analyticsService = require('./services/analyticsService');
  const intervalMs = (parseInt(process.env.ANALYTICS_REFRESH_MINUTES || '30', 10)) * 60 * 1000;
  const tick = async () => {
    try { await analyticsService.refreshCache(); } catch (_) {}
  };
  tick();
  setInterval(tick, intervalMs);
});
