const jwt = require('jsonwebtoken');

// Test admin user credentials
const ADMIN_CREDENTIALS = {
  email: 'admin@splitset.app',
  password: 'AdminPass123!' // This should match your actual admin password
};

// Generate a test JWT token for admin user
function generateAdminToken() {
  const payload = {
    userId: 2,
    email: ADMIN_CREDENTIALS.email,
    role: 'admin',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (60 * 60) // 1 hour expiry
  };
  
  return jwt.sign(payload, process.env.JWT_SECRET || 'test-jwt-secret-for-performance-testing');
}

// Login as admin user and set auth token
function loginAsAdmin(requestParams, context, ee, next) {
  try {
    // For performance testing, we'll use a pre-generated token
    // In production, you might want to actually call the login endpoint
    const authToken = generateAdminToken();
    context.vars.authToken = authToken;
    
    // Set random store for testing
    const stores = ['test-store-1.myshopify.com', 'test-store-2.myshopify.com', 'demo-store.myshopify.com'];
    context.vars.randomStore = stores[Math.floor(Math.random() * stores.length)];
    
    // Track custom metrics
    context.vars.startTime = Date.now();
    
    return next();
  } catch (error) {
    console.error('Failed to generate admin token:', error);
    return next(error);
  }
}

// Track SplitSet revenue calculation performance
function trackRevenueCalculation(requestParams, response, context, ee, next) {
  if (response.body && response.body.data && response.body.data.today) {
    const responseTime = Date.now() - context.vars.startTime;
    ee.emit('counter', 'splitset_revenue_response_time', responseTime);
    
    // Verify revenue calculation (quantity * 9)
    const revenueToday = response.body.data.today.splitset_revenue_today;
    const quantityToday = response.body.data.today.total_quantity_today;
    
    if (revenueToday === quantityToday * 9) {
      ee.emit('counter', 'revenue_calculation_correct', 1);
    } else {
      ee.emit('counter', 'revenue_calculation_incorrect', 1);
      console.warn(`Revenue calculation mismatch: ${revenueToday} !== ${quantityToday * 9}`);
    }
  }
  
  return next();
}

// Track authentication success rate
function trackAuthSuccess(requestParams, response, context, ee, next) {
  if (response.statusCode === 200) {
    ee.emit('counter', 'admin_auth_success_rate', 1);
  } else if (response.statusCode === 401 || response.statusCode === 403) {
    ee.emit('counter', 'admin_auth_failure_rate', 1);
  }
  
  return next();
}

// Track pagination performance
function trackPaginationPerformance(requestParams, response, context, ee, next) {
  if (response.body && response.body.data && response.body.data.pagination) {
    const responseTime = Date.now() - context.vars.startTime;
    ee.emit('counter', 'pagination_performance', responseTime);
    
    const pagination = response.body.data.pagination;
    ee.emit('counter', 'pagination_total_pages', pagination.totalPages || 0);
    ee.emit('counter', 'pagination_total_items', pagination.totalItems || 0);
  }
  
  return next();
}

// Simulate realistic user behavior delays
function simulateUserThinking(requestParams, context, ee, next) {
  // Random delay between 500ms and 3000ms to simulate user reading/thinking
  const thinkTime = Math.floor(Math.random() * 2500) + 500;
  setTimeout(next, thinkTime);
}

// Memory usage tracking
function trackMemoryUsage(requestParams, context, ee, next) {
  const memUsage = process.memoryUsage();
  ee.emit('counter', 'memory_rss_mb', Math.round(memUsage.rss / 1024 / 1024));
  ee.emit('counter', 'memory_heap_used_mb', Math.round(memUsage.heapUsed / 1024 / 1024));
  ee.emit('counter', 'memory_heap_total_mb', Math.round(memUsage.heapTotal / 1024 / 1024));
  
  return next();
}

// Database connection stress test
function stressTestDatabase(requestParams, context, ee, next) {
  // Simulate concurrent database queries
  const startTime = Date.now();
  
  // This would be replaced with actual database operations in a real test
  setTimeout(() => {
    const dbResponseTime = Date.now() - startTime;
    ee.emit('counter', 'database_response_time', dbResponseTime);
    next();
  }, Math.random() * 100); // Simulate 0-100ms database response time
}

module.exports = {
  loginAsAdmin,
  trackRevenueCalculation,
  trackAuthSuccess,
  trackPaginationPerformance,
  simulateUserThinking,
  trackMemoryUsage,
  stressTestDatabase
};
