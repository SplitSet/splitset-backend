const request = require('supertest');
const TestServer = require('../helpers/testServer');

describe('Admin API Integration Tests', () => {
  let testServer;
  let app;
  let adminToken;
  let ownerToken;

  beforeAll(async () => {
    testServer = new TestServer();
    app = await testServer.setup();
    
    // Generate tokens for testing
    adminToken = testServer.generateToken(global.testHelpers.mockAdminUser);
    ownerToken = testServer.generateToken(global.testHelpers.mockStoreOwner);
  });

  afterAll(async () => {
    await testServer.cleanup();
  });

  describe('Admin Authentication & Authorization', () => {
    test('should deny access to admin endpoints without token', async () => {
      const response = await request(app)
        .get('/api/admin/dashboard/metrics')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Authentication required');
    });

    test('should deny access to non-admin users', async () => {
      const response = await request(app)
        .get('/api/admin/dashboard/metrics')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('App owner access required');
    });

    test('should allow access to admin users', async () => {
      const response = await request(app)
        .get('/api/admin/dashboard/metrics')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
    });
  });

  describe('Admin Dashboard Metrics', () => {
    test('should return correct dashboard metrics structure', async () => {
      const response = await request(app)
        .get('/api/admin/dashboard/metrics')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const { data } = response.body;
      
      // Check structure
      expect(data).toHaveProperty('today');
      expect(data).toHaveProperty('allTime');
      expect(data).toHaveProperty('weeklyTrend');

      // Check today metrics
      expect(data.today).toHaveProperty('products_split_today');
      expect(data.today).toHaveProperty('orders_today');
      expect(data.today).toHaveProperty('total_revenue_today');
      expect(data.today).toHaveProperty('splitset_revenue_today');
      expect(data.today).toHaveProperty('active_stores');

      // Check all-time metrics
      expect(data.allTime).toHaveProperty('total_products_split');
      expect(data.allTime).toHaveProperty('total_orders');
      expect(data.allTime).toHaveProperty('total_revenue_all_time');
      expect(data.allTime).toHaveProperty('splitset_revenue_all_time');
    });

    test('should calculate SplitSet revenue correctly (quantity * 9)', async () => {
      const response = await request(app)
        .get('/api/admin/dashboard/metrics')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const { data } = response.body;
      
      // We have 2 products with 1 quantity each = 2 * 9 = 18
      expect(data.today.splitset_revenue_today).toBe(18);
      expect(data.allTime.splitset_revenue_all_time).toBe(18);
    });

    test('should return correct product and order counts', async () => {
      const response = await request(app)
        .get('/api/admin/dashboard/metrics')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const { data } = response.body;
      
      expect(data.allTime.total_products_split).toBe(2);
      expect(data.allTime.total_orders).toBe(1);
      expect(data.today.active_stores).toBe(1);
    });
  });

  describe('Admin Split Products API', () => {
    test('should return list of split products', async () => {
      const response = await request(app)
        .get('/api/admin/products?page=1&limit=10')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.products).toHaveLength(2);
      expect(response.body.data.pagination).toBeDefined();
      
      const product = response.body.data.products[0];
      expect(product).toHaveProperty('id');
      expect(product).toHaveProperty('title');
      expect(product).toHaveProperty('price');
      expect(product).toHaveProperty('split_type');
      expect(product).toHaveProperty('shop_domain');
    });

    test('should support pagination', async () => {
      const response = await request(app)
        .get('/api/admin/products?page=1&limit=1')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.data.products).toHaveLength(1);
      expect(response.body.data.pagination.currentPage).toBe(1);
      expect(response.body.data.pagination.totalPages).toBe(2);
    });

    test('should support search filtering', async () => {
      const response = await request(app)
        .get('/api/admin/products?search=Product 1')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.data.products).toHaveLength(1);
      expect(response.body.data.products[0].title).toContain('Product 1');
    });
  });

  describe('Admin Orders API', () => {
    test('should return list of orders with split products', async () => {
      const response = await request(app)
        .get('/api/admin/orders?page=1&limit=10')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.ordersByStore).toBeDefined();
      
      const storeOrders = response.body.data.ordersByStore['test-store.myshopify.com'];
      expect(storeOrders).toBeDefined();
      expect(storeOrders).toHaveLength(2); // 2 line items
    });

    test('should group orders by store correctly', async () => {
      const response = await request(app)
        .get('/api/admin/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const ordersByStore = response.body.data.ordersByStore;
      expect(Object.keys(ordersByStore)).toHaveLength(1);
      expect(ordersByStore).toHaveProperty('test-store.myshopify.com');
    });
  });
});
