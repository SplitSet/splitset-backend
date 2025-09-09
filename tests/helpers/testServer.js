const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

// Import your app components
const db = require('../../db');

class TestServer {
  constructor() {
    this.app = null;
    this.server = null;
  }

  async setup() {
    // Create test app
    this.app = express();
    
    // Setup middleware
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    
    // Import routes
    const adminRoutes = require('../../routes/admin');
    const authRoutes = require('../../routes/auth');
    const healthRoutes = require('../../routes/health');
    
    // Setup routes
    this.app.use('/health', healthRoutes);
    this.app.use('/api/auth', authRoutes);
    this.app.use('/api/admin', adminRoutes);
    
    // Setup test database
    await this.setupTestDatabase();
    
    return this.app;
  }

  async setupTestDatabase() {
    try {
      // Run migrations
      await db.migrate.latest();
      
      // Seed test data
      await this.seedTestData();
      
      // Store db reference for cleanup
      global.__DB__ = db;
    } catch (error) {
      console.error('Failed to setup test database:', error);
      throw error;
    }
  }

  async seedTestData() {
    // Insert test users
    await db('users').insert([
      {
        id: 1,
        email: 'admin@test.com',
        password: '$2b$10$test.hash.for.admin.user',
        firstName: 'Test',
        lastName: 'Admin',
        role: 'admin',
        emailVerified: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 2,
        email: 'owner@test.com',
        password: '$2b$10$test.hash.for.store.owner',
        firstName: 'Test',
        lastName: 'Owner',
        role: 'store_owner',
        emailVerified: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ]);

    // Insert test store
    await db('stores').insert({
      id: 1,
      shop_domain: 'test-store.myshopify.com',
      access_token: 'encrypted-test-token',
      status: 'active',
      plan: 'basic',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    // Insert test split products
    await db('split_products').insert([
      {
        id: 1,
        store_id: 1,
        product_id: 'test-product-1',
        original_product_id: 'original-1',
        title: 'Test Split Product 1',
        price: 34.99,
        split_type: 'manual',
        metadata: JSON.stringify({ splitset_tag: true }),
        created_at: new Date().toISOString()
      },
      {
        id: 2,
        store_id: 1,
        product_id: 'test-product-2',
        original_product_id: 'original-2',
        title: 'Test Split Product 2',
        price: 35.00,
        split_type: 'auto',
        metadata: JSON.stringify({ splitset_tag: true }),
        created_at: new Date().toISOString()
      }
    ]);

    // Insert test orders
    await db('orders').insert({
      id: 1,
      store_id: 1,
      shopify_order_id: 'test-order-1',
      order_number: '#1001',
      financial_status: 'paid',
      fulfillment_status: 'fulfilled',
      total_price: 69.99,
      created_at: new Date().toISOString()
    });

    // Insert test order line items
    await db('order_line_items').insert([
      {
        id: 1,
        order_id: 1,
        product_id: 'test-product-1',
        variant_id: 'variant-1',
        title: 'Test Split Product 1',
        price: 34.99,
        quantity: 1,
        created_at: new Date().toISOString()
      },
      {
        id: 2,
        order_id: 1,
        product_id: 'test-product-2',
        variant_id: 'variant-2',
        title: 'Test Split Product 2',
        price: 35.00,
        quantity: 1,
        created_at: new Date().toISOString()
      }
    ]);
  }

  generateToken(user) {
    return jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role
      },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
  }

  async cleanup() {
    if (global.__DB__) {
      await global.__DB__.destroy();
    }
    if (this.server) {
      await new Promise((resolve) => {
        this.server.close(resolve);
      });
    }
  }
}

module.exports = TestServer;
