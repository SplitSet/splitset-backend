const express = require('express');
const router = express.Router();
const shopifyService = require('../services/shopifyService');

// Test Shopify connection
router.get('/test-connection', async (req, res) => {
  try {
    const result = await shopifyService.getProducts(1);
    
    if (result.success) {
      res.json({
        success: true,
        message: 'Shopify connection successful',
        store: process.env.SHOPIFY_STORE_DOMAIN,
        productsCount: result.data.length
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'Shopify connection failed',
        error: result.error
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Connection test failed',
      error: error.message
    });
  }
});

// Get shop information
router.get('/shop-info', async (req, res) => {
  try {
    const axios = require('axios');
    const response = await axios.get(`https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2023-10/shop.json`, {
      headers: {
        'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
        'Content-Type': 'application/json'
      }
    });

    if (response.status === 200 && response.data.shop) {
      res.json({
        success: true,
        data: {
          name: response.data.shop.name,
          domain: response.data.shop.domain,
          email: response.data.shop.email,
          currency: response.data.shop.currency,
          timezone: response.data.shop.timezone,
          plan_name: response.data.shop.plan_name
        }
      });
    } else {
      res.status(400).json({
        success: false,
        error: 'Failed to fetch shop information'
      });
    }
  } catch (error) {
    console.error('Shop info error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data?.errors || error.message
    });
  }
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

// Handle product updates webhook
router.post('/webhook/products/update', (req, res) => {
  try {
    const product = req.body;
    console.log('Product updated:', product.id, product.title);
    
    // Handle product update logic here
    // You can sync bundle configurations, update pricing, etc.
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).send('Error');
  }
});

// Handle order creation webhook
router.post('/webhook/orders/create', (req, res) => {
  try {
    const order = req.body;
    console.log('Order created:', order.id);
    
    // Check if order contains bundle products
    const bundleItems = order.line_items.filter(item => 
      item.properties && item.properties.some(prop => prop.name === '_bundle_id')
    );
    
    if (bundleItems.length > 0) {
      console.log('Bundle order detected:', bundleItems.length, 'bundle items');
      // Handle bundle order logic here
    }
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).send('Error');
  }
});

// Get app permissions
router.get('/permissions', (req, res) => {
  const requiredScopes = process.env.SHOPIFY_SCOPES.split(',');
  
  res.json({
    success: true,
    data: {
      required_scopes: requiredScopes,
      configured_store: process.env.SHOPIFY_STORE_DOMAIN,
      has_access_token: !!process.env.SHOPIFY_ACCESS_TOKEN
    }
  });
});

// Validate access token
router.get('/validate-token', async (req, res) => {
  try {
    const axios = require('axios');
    const response = await axios.get(`https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2023-10/shop.json`, {
      headers: {
        'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
        'Content-Type': 'application/json'
      }
    });

    if (response.status === 200 && response.data.shop) {
      res.json({
        success: true,
        message: 'Access token is valid',
        status: 'authorized',
        shop: {
          name: response.data.shop.name,
          domain: response.data.shop.myshopify_domain,
          currency: response.data.shop.currency
        }
      });
    } else {
      res.status(401).json({
        success: false,
        message: 'Access token is invalid or expired',
        status: 'unauthorized'
      });
    }
  } catch (error) {
    console.error('Token validation error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: 'Token validation failed',
      status: 'unauthorized',
      error: error.response?.data?.errors || error.message
    });
  }
});

// Get API usage
router.get('/api-usage', async (req, res) => {
  try {
    const response = await fetch(`https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2023-10/shop.json`, {
      headers: {
        'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
        'Content-Type': 'application/json'
      }
    });

    const rateLimitHeader = response.headers.get('X-Shopify-Shop-Api-Call-Limit');
    
    if (rateLimitHeader) {
      const [used, limit] = rateLimitHeader.split('/').map(Number);
      res.json({
        success: true,
        data: {
          used,
          limit,
          remaining: limit - used,
          percentage: ((used / limit) * 100).toFixed(1)
        }
      });
    } else {
      res.json({
        success: true,
        data: {
          message: 'API usage information not available'
        }
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
