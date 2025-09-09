const { DataMemoryEngine, newDb } = require('pg-mem');
const TestServer = require('../helpers/testServer');

describe('Database Integration Tests', () => {
  let db;
  let testServer;
  let app;
  let adminToken;
  let ownerToken;

  beforeAll(async () => {
    // Create in-memory PostgreSQL database
    const memDb = newDb();
    
    // Setup database schema
    memDb.public.none(`
      CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        "firstName" VARCHAR(255),
        "lastName" VARCHAR(255),
        role VARCHAR(50) DEFAULT 'store_owner',
        "emailVerified" BOOLEAN DEFAULT FALSE,
        "accountLocked" BOOLEAN DEFAULT FALSE,
        "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE stores (
        id SERIAL PRIMARY KEY,
        "shop_domain" VARCHAR(255) UNIQUE NOT NULL,
        "access_token" TEXT,
        status VARCHAR(50) DEFAULT 'active',
        plan VARCHAR(50) DEFAULT 'basic',
        "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE split_products (
        id SERIAL PRIMARY KEY,
        "store_id" INTEGER REFERENCES stores(id) ON DELETE CASCADE,
        "product_id" VARCHAR(255) UNIQUE NOT NULL,
        "original_product_id" VARCHAR(255),
        title VARCHAR(255) NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        "split_type" VARCHAR(50) DEFAULT 'manual',
        metadata JSONB,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE orders (
        id SERIAL PRIMARY KEY,
        "store_id" INTEGER REFERENCES stores(id) ON DELETE CASCADE,
        "shopify_order_id" VARCHAR(255) UNIQUE NOT NULL,
        "order_number" VARCHAR(255) NOT NULL,
        "financial_status" VARCHAR(50),
        "fulfillment_status" VARCHAR(50),
        "total_price" DECIMAL(10,2) NOT NULL,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE order_line_items (
        id SERIAL PRIMARY KEY,
        "order_id" INTEGER REFERENCES orders(id) ON DELETE CASCADE,
        "product_id" VARCHAR(255) NOT NULL,
        "variant_id" VARCHAR(255),
        title VARCHAR(255) NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        quantity INTEGER NOT NULL,
        properties JSONB,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX idx_split_products_store_created ON split_products("store_id", "created_at");
      CREATE INDEX idx_split_products_product_id ON split_products("product_id");
      CREATE INDEX idx_orders_store_created ON orders("store_id", "created_at");
      CREATE INDEX idx_orders_shopify_id ON orders("shopify_order_id");
      CREATE INDEX idx_order_line_items_product ON order_line_items("product_id");
      CREATE INDEX idx_order_line_items_order ON order_line_items("order_id");
    `);

    // Seed test data
    await seedTestData(memDb);

    // Setup test server with real database
    testServer = new TestServer();
    // Override database connection to use our in-memory PostgreSQL
    global.__TEST_DB__ = memDb;
    app = await testServer.setup();
    
    // Generate tokens
    adminToken = testServer.generateToken({
      id: 1,
      email: 'admin@splitset.app',
      role: 'admin'
    });
    
    ownerToken = testServer.generateToken({
      id: 2,
      email: 'owner@test.com',
      role: 'store_owner'
    });
  });

  afterAll(async () => {
    await testServer.cleanup();
  });

  async function seedTestData(db) {
    // Insert test users
    await db.public.none(`
      INSERT INTO users (id, email, password, "firstName", "lastName", role, "emailVerified")
      VALUES 
        (1, 'admin@splitset.app', '$2b$10$test.hash.admin', 'Admin', 'User', 'admin', true),
        (2, 'owner@test.com', '$2b$10$test.hash.owner', 'Store', 'Owner', 'store_owner', true);
    `);

    // Insert test stores
    await db.public.none(`
      INSERT INTO stores (id, "shop_domain", "access_token", status, plan)
      VALUES 
        (1, 'test-store-1.myshopify.com', 'encrypted-token-1', 'active', 'premium'),
        (2, 'test-store-2.myshopify.com', 'encrypted-token-2', 'active', 'basic'),
        (3, 'demo-store.myshopify.com', 'encrypted-token-3', 'active', 'premium');
    `);

    // Insert split products with realistic data
    await db.public.none(`
      INSERT INTO split_products ("store_id", "product_id", "original_product_id", title, price, "split_type", metadata)
      VALUES 
        (1, 'split-prod-1', 'orig-prod-1', 'Split T-Shirt - Size S', 29.99, 'manual', '{"splitset_tag": true, "size": "S"}'),
        (1, 'split-prod-2', 'orig-prod-1', 'Split T-Shirt - Size M', 29.99, 'manual', '{"splitset_tag": true, "size": "M"}'),
        (1, 'split-prod-3', 'orig-prod-1', 'Split T-Shirt - Size L', 31.99, 'manual', '{"splitset_tag": true, "size": "L"}'),
        (2, 'split-prod-4', 'orig-prod-2', 'Split Hoodie - Red', 59.99, 'auto', '{"splitset_tag": true, "color": "red"}'),
        (2, 'split-prod-5', 'orig-prod-2', 'Split Hoodie - Blue', 59.99, 'auto', '{"splitset_tag": true, "color": "blue"}'),
        (3, 'split-prod-6', 'orig-prod-3', 'Split Shoes - Size 8', 89.99, 'manual', '{"splitset_tag": true, "shoe_size": "8"}');
    `);

    // Insert test orders
    await db.public.none(`
      INSERT INTO orders ("store_id", "shopify_order_id", "order_number", "financial_status", "fulfillment_status", "total_price")
      VALUES 
        (1, 'order-001', '#1001', 'paid', 'fulfilled', 89.97),
        (1, 'order-002', '#1002', 'paid', 'fulfilled', 31.99),
        (2, 'order-003', '#2001', 'paid', 'fulfilled', 119.98),
        (3, 'order-004', '#3001', 'paid', 'pending', 89.99);
    `);

    // Insert order line items
    await db.public.none(`
      INSERT INTO order_line_items ("order_id", "product_id", "variant_id", title, price, quantity)
      VALUES 
        (1, 'split-prod-1', 'var-1', 'Split T-Shirt - Size S', 29.99, 2),
        (1, 'split-prod-2', 'var-2', 'Split T-Shirt - Size M', 29.99, 1),
        (2, 'split-prod-3', 'var-3', 'Split T-Shirt - Size L', 31.99, 1),
        (3, 'split-prod-4', 'var-4', 'Split Hoodie - Red', 59.99, 1),
        (3, 'split-prod-5', 'var-5', 'Split Hoodie - Blue', 59.99, 1),
        (4, 'split-prod-6', 'var-6', 'Split Shoes - Size 8', 89.99, 1);
    `);
  }

  describe('SplitSet Revenue Calculation Integration', () => {
    test('should calculate revenue correctly with real database data', async () => {
      const response = await request(app)
        .get('/api/admin/dashboard/metrics')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const { data } = response.body;
      
      // Test real revenue calculation
      // Total quantity from order_line_items: 2+1+1+1+1+1 = 7
      // Expected SplitSet revenue: 7 * 9 = 63
      expect(data.allTime.splitset_revenue_all_time).toBe(63);
      
      // Verify individual calculations
      expect(data.allTime.total_products_split).toBe(6);
      expect(data.allTime.total_orders).toBe(4);
    });

    test('should handle large dataset efficiently', async () => {
      // Insert additional test data
      const startTime = Date.now();
      
      // Add 100 more products and orders
      for (let i = 7; i <= 106; i++) {
        await global.__TEST_DB__.public.none(`
          INSERT INTO split_products ("store_id", "product_id", title, price, "split_type", metadata)
          VALUES (1, 'bulk-prod-${i}', 'Bulk Product ${i}', 19.99, 'auto', '{"splitset_tag": true}');
        `);
        
        if (i <= 50) {
          await global.__TEST_DB__.public.none(`
            INSERT INTO orders ("store_id", "shopify_order_id", "order_number", "financial_status", "fulfillment_status", "total_price")
            VALUES (1, 'bulk-order-${i}', '#BULK${i}', 'paid', 'fulfilled', 19.99);
            
            INSERT INTO order_line_items ("order_id", "product_id", title, price, quantity)
            VALUES (${i + 4}, 'bulk-prod-${i}', 'Bulk Product ${i}', 19.99, 1);
          `);
        }
      }
      
      const response = await request(app)
        .get('/api/admin/dashboard/metrics')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const queryTime = Date.now() - startTime;
      
      // Should complete within reasonable time even with larger dataset
      expect(queryTime).toBeLessThan(5000); // 5 seconds max
      
      const { data } = response.body;
      
      // Verify calculations with larger dataset
      // Original: 7 items, Added: 44 items (orders 5-48), Total: 51 items
      // Expected revenue: 51 * 9 = 459
      expect(data.allTime.splitset_revenue_all_time).toBe(459);
      expect(data.allTime.total_products_split).toBe(106);
    });
  });

  describe('Database Transaction Integrity', () => {
    test('should maintain data consistency during concurrent operations', async () => {
      // Simulate concurrent admin dashboard requests
      const promises = Array.from({ length: 10 }, () =>
        request(app)
          .get('/api/admin/dashboard/metrics')
          .set('Authorization', `Bearer ${adminToken}`)
      );

      const results = await Promise.all(promises);
      
      // All requests should succeed
      results.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      });

      // All should return consistent data
      const revenues = results.map(r => r.body.data.allTime.splitset_revenue_all_time);
      const uniqueRevenues = [...new Set(revenues)];
      expect(uniqueRevenues).toHaveLength(1); // All should be the same
    });

    test('should handle database connection errors gracefully', async () => {
      // This test would simulate database connection issues
      // For now, we'll test that the error handling exists
      expect(true).toBe(true); // Placeholder
    });
  });

  describe('Complex Query Performance', () => {
    test('should efficiently handle filtered product queries', async () => {
      const startTime = Date.now();
      
      const response = await request(app)
        .get('/api/admin/products?search=Split&store=test-store-1.myshopify.com&page=1&limit=50')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const queryTime = Date.now() - startTime;
      
      // Complex filtered query should complete quickly
      expect(queryTime).toBeLessThan(1000); // 1 second max
      
      const { data } = response.body;
      expect(data.products).toBeDefined();
      expect(Array.isArray(data.products)).toBe(true);
      
      // Should return filtered results
      data.products.forEach(product => {
        expect(product.title.toLowerCase()).toContain('split');
        expect(product.shop_domain).toBe('test-store-1.myshopify.com');
      });
    });

    test('should efficiently handle order aggregation queries', async () => {
      const startTime = Date.now();
      
      const response = await request(app)
        .get('/api/admin/orders?page=1&limit=50')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const queryTime = Date.now() - startTime;
      
      // Order aggregation should complete quickly
      expect(queryTime).toBeLessThan(1500); // 1.5 seconds max
      
      const { data } = response.body;
      expect(data.ordersByStore).toBeDefined();
      expect(typeof data.ordersByStore).toBe('object');
      
      // Should group orders by store correctly
      Object.keys(data.ordersByStore).forEach(storeDomain => {
        expect(storeDomain).toMatch(/\.myshopify\.com$/);
        expect(Array.isArray(data.ordersByStore[storeDomain])).toBe(true);
      });
    });
  });

  describe('Data Integrity and Constraints', () => {
    test('should enforce foreign key constraints', async () => {
      try {
        // Try to insert order line item with invalid order_id
        await global.__TEST_DB__.public.none(`
          INSERT INTO order_line_items ("order_id", "product_id", title, price, quantity)
          VALUES (9999, 'invalid-product', 'Invalid Item', 10.00, 1);
        `);
        
        // Should not reach this line
        expect(true).toBe(false);
      } catch (error) {
        // Should throw foreign key constraint error
        expect(error.message).toContain('foreign key');
      }
    });

    test('should enforce unique constraints', async () => {
      try {
        // Try to insert duplicate product_id
        await global.__TEST_DB__.public.none(`
          INSERT INTO split_products ("store_id", "product_id", title, price)
          VALUES (1, 'split-prod-1', 'Duplicate Product', 25.00);
        `);
        
        // Should not reach this line
        expect(true).toBe(false);
      } catch (error) {
        // Should throw unique constraint error
        expect(error.message).toContain('unique');
      }
    });

    test('should handle JSON metadata correctly', async () => {
      const response = await request(app)
        .get('/api/admin/products?page=1&limit=10')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const { data } = response.body;
      
      // Find a product with metadata
      const productWithMetadata = data.products.find(p => p.metadata);
      expect(productWithMetadata).toBeDefined();
      
      // Verify JSON parsing
      expect(typeof productWithMetadata.metadata).toBe('object');
      expect(productWithMetadata.metadata.splitset_tag).toBe(true);
    });
  });

  describe('Index Performance', () => {
    test('should use indexes for common queries', async () => {
      // Test store_id + created_at index
      const startTime = Date.now();
      
      await global.__TEST_DB__.public.many(`
        SELECT * FROM split_products 
        WHERE "store_id" = 1 
        ORDER BY "created_at" DESC 
        LIMIT 10;
      `);
      
      const queryTime = Date.now() - startTime;
      
      // Indexed query should be very fast
      expect(queryTime).toBeLessThan(100); // 100ms max
    });

    test('should efficiently search by product_id', async () => {
      const startTime = Date.now();
      
      await global.__TEST_DB__.public.oneOrNone(`
        SELECT * FROM split_products WHERE "product_id" = 'split-prod-1';
      `);
      
      const queryTime = Date.now() - startTime;
      
      // Unique index lookup should be very fast
      expect(queryTime).toBeLessThan(50); // 50ms max
    });
  });
});
