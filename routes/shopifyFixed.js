const express = require('express');
const router = express.Router();
const shopifyApiFixed = require('../services/shopifyApiFixed');

// Test Shopify connection with detailed diagnostics
router.get('/test-connection', async (req, res) => {
  try {
    // First check configuration
    const configCheck = shopifyApiFixed.checkConfiguration();
    
    if (!configCheck.configured) {
      return res.status(500).json({
        success: false,
        message: 'Shopify configuration incomplete',
        issues: configCheck.issues,
        warnings: configCheck.warnings,
        config: configCheck.config
      });
    }
    
    // Test actual connection
    const result = await shopifyApiFixed.testConnection();
    
    if (result.success) {
      res.json(result);
    } else {
      // Return appropriate status code based on error type
      const statusCode = result.error === 'INVALID_TOKEN' ? 401 : 
                        result.error === 'INSUFFICIENT_PERMISSIONS' ? 403 :
                        result.error === 'STORE_NOT_FOUND' ? 404 : 400;
      
      res.status(statusCode).json(result);
    }
  } catch (error) {
    console.error('Test connection error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// Get shop information
router.get('/shop-info', async (req, res) => {
  try {
    const result = await shopifyApiFixed.getShopInfo();
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Shop info error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Validate access token
router.get('/validate-token', async (req, res) => {
  try {
    const result = await shopifyApiFixed.validateToken();
    
    if (result.valid) {
      res.json(result);
    } else {
      res.status(401).json(result);
    }
  } catch (error) {
    console.error('Validate token error:', error);
    res.status(500).json({
      success: false,
      message: 'Token validation failed',
      status: 'error',
      error: error.message
    });
  }
});

// Get API permissions/configuration
router.get('/permissions', (req, res) => {
  try {
    const configCheck = shopifyApiFixed.checkConfiguration();
    const requiredScopes = process.env.SHOPIFY_SCOPES ? 
      process.env.SHOPIFY_SCOPES.split(',') : 
      ['read_products', 'write_products', 'read_orders', 'write_orders'];
    
    res.json({
      success: true,
      data: {
        required_scopes: requiredScopes,
        configured_store: configCheck.config.storeDomain,
        has_access_token: configCheck.config.hasAccessToken,
        configuration_status: configCheck.configured ? 'complete' : 'incomplete',
        issues: configCheck.issues,
        warnings: configCheck.warnings
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get API usage/rate limits
router.get('/api-usage', async (req, res) => {
  try {
    const result = await shopifyApiFixed.getApiUsage();
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Health check endpoint
router.get('/health', async (req, res) => {
  try {
    const configCheck = shopifyApiFixed.checkConfiguration();
    
    if (!configCheck.configured) {
      return res.json({
        success: false,
        status: 'unhealthy',
        message: 'Shopify not configured',
        issues: configCheck.issues
      });
    }
    
    // Quick connection test
    const connectionTest = await shopifyApiFixed.validateToken();
    
    res.json({
      success: connectionTest.valid,
      status: connectionTest.valid ? 'healthy' : 'unhealthy',
      message: connectionTest.message,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.json({
      success: false,
      status: 'error',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Debug endpoint to check configuration (development only)
router.get('/debug-config', (req, res) => {
  if (process.env.NODE_ENV !== 'development') {
    return res.status(403).json({
      success: false,
      message: 'Debug endpoint only available in development mode'
    });
  }
  
  const configCheck = shopifyApiFixed.checkConfiguration();
  
  res.json({
    success: true,
    environment: {
      NODE_ENV: process.env.NODE_ENV,
      PORT: process.env.PORT
    },
    shopify: {
      store_domain: process.env.SHOPIFY_STORE_DOMAIN || 'NOT_SET',
      has_access_token: !!process.env.SHOPIFY_ACCESS_TOKEN,
      token_prefix: process.env.SHOPIFY_ACCESS_TOKEN ? 
        process.env.SHOPIFY_ACCESS_TOKEN.substring(0, 6) : 'NOT_SET',
      has_api_key: !!process.env.SHOPIFY_API_KEY,
      has_api_secret: !!process.env.SHOPIFY_API_SECRET
    },
    configuration_check: configCheck
  });
});

// Webhook verification
router.get('/webhook/verify', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
  
  if (mode === 'subscribe' && token === process.env.WEBHOOK_SECRET) {
    res.status(200).send(challenge);
  } else {
    res.status(403).send('Forbidden');
  }
});

// Handle webhooks
router.post('/webhook/:topic', (req, res) => {
  try {
    const { topic } = req.params;
    const data = req.body;
    
    console.log(`Webhook received: ${topic}`, data);
    
    // Handle different webhook topics
    switch(topic) {
      case 'products/update':
        console.log('Product updated:', data.id);
        break;
      case 'orders/create':
        console.log('Order created:', data.id);
        break;
      default:
        console.log('Unknown webhook topic:', topic);
    }
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).send('Error');
  }
});

module.exports = router;
