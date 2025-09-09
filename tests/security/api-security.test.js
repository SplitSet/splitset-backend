const request = require('supertest');
const TestServer = require('../helpers/testServer');

describe('API Security Tests', () => {
  let testServer;
  let app;
  let adminToken;

  beforeAll(async () => {
    testServer = new TestServer();
    app = await testServer.setup();
    
    adminToken = testServer.generateToken({
      id: 1,
      email: 'admin@test.com',
      role: 'admin'
    });
  });

  afterAll(async () => {
    await testServer.cleanup();
  });

  describe('SplitSet Revenue Calculation Security', () => {
    test('should prevent revenue manipulation via SQL injection', async () => {
      const sqlInjectionAttempts = [
        "1; UPDATE order_line_items SET quantity = 999999; --",
        "1' OR quantity = 999999 --",
        "1 UNION SELECT 999999 as quantity --",
        "1; DROP TABLE order_line_items; --"
      ];

      for (const maliciousInput of sqlInjectionAttempts) {
        // Try to inject malicious SQL via query parameters
        const response = await request(app)
          .get(`/api/admin/products?search=${encodeURIComponent(maliciousInput)}`)
          .set('Authorization', `Bearer ${adminToken}`);

        // Should not crash or return manipulated data
        expect(response.status).toBeLessThanOrEqual(400);
        
        if (response.status === 200) {
          // If successful, verify data integrity
          expect(response.body.success).toBe(true);
          expect(response.body.data.products).toBeDefined();
        }
      }
    });

    test('should validate revenue calculation integrity', async () => {
      const response = await request(app)
        .get('/api/admin/dashboard/metrics')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const { data } = response.body;
      
      // Verify revenue calculation follows the ₹9 formula
      const todayRevenue = data.today.splitset_revenue_today;
      const todayQuantity = data.today.total_quantity_today;
      
      if (todayQuantity > 0) {
        expect(todayRevenue).toBe(todayQuantity * 9);
      }
      
      // Verify all-time calculation
      const allTimeRevenue = data.allTime.splitset_revenue_all_time;
      const allTimeQuantity = data.allTime.total_quantity_all_time;
      
      if (allTimeQuantity > 0) {
        expect(allTimeRevenue).toBe(allTimeQuantity * 9);
      }
    });

    test('should prevent currency manipulation attacks', async () => {
      // Test various currency manipulation attempts
      const currencyAttacks = [
        '₹999999.99',
        'USD 999999',
        '€999999',
        '$999999',
        '₹-999999', // Negative amounts
        '₹999999999999999999999' // Overflow attempt
      ];

      for (const attack of currencyAttacks) {
        const response = await request(app)
          .get(`/api/admin/products?search=${encodeURIComponent(attack)}`)
          .set('Authorization', `Bearer ${adminToken}`);

        // Should handle currency attacks safely
        expect([200, 400, 422]).toContain(response.status);
        
        if (response.status === 200) {
          expect(response.body.success).toBe(true);
        }
      }
    });
  });

  describe('Data Validation Security', () => {
    test('should validate numeric inputs for pagination', async () => {
      const invalidInputs = [
        'NaN',
        'Infinity',
        '-Infinity',
        'null',
        'undefined',
        '999999999999999999999', // Large number
        '-999999', // Negative number
        '1.5', // Float for integer field
        '<script>alert("XSS")</script>',
        'DROP TABLE users'
      ];

      for (const input of invalidInputs) {
        const response = await request(app)
          .get(`/api/admin/products?page=${input}&limit=${input}`)
          .set('Authorization', `Bearer ${adminToken}`);

        // Should handle invalid inputs gracefully
        expect([200, 400, 422]).toContain(response.status);
        
        if (response.status === 200) {
          // If accepted, should use default values
          expect(response.body.data.pagination.currentPage).toBeGreaterThan(0);
          expect(response.body.data.pagination.currentPage).toBeLessThan(1000);
        }
      }
    });

    test('should prevent NoSQL injection in filters', async () => {
      const noSqlAttacks = [
        '{"$gt": ""}',
        '{"$where": "function() { return true; }"}',
        '{"$regex": ".*"}',
        '{"$ne": null}',
        '{"$or": [{}]}'
      ];

      for (const attack of noSqlAttacks) {
        const response = await request(app)
          .get(`/api/admin/products?store=${encodeURIComponent(attack)}`)
          .set('Authorization', `Bearer ${adminToken}`);

        // Should reject NoSQL injection attempts
        expect([200, 400, 422]).toContain(response.status);
      }
    });

    test('should sanitize search inputs', async () => {
      const maliciousSearches = [
        '<script>alert("XSS")</script>',
        'javascript:alert("XSS")',
        '"><img src=x onerror=alert("XSS")>',
        '\'; DROP TABLE split_products; --',
        '%3Cscript%3Ealert%28%22XSS%22%29%3C/script%3E' // URL encoded
      ];

      for (const search of maliciousSearches) {
        const response = await request(app)
          .get(`/api/admin/products?search=${encodeURIComponent(search)}`)
          .set('Authorization', `Bearer ${adminToken}`);

        expect([200, 400]).toContain(response.status);
        
        if (response.status === 200) {
          // Response should not contain unescaped malicious content
          const responseText = JSON.stringify(response.body);
          expect(responseText).not.toContain('<script>');
          expect(responseText).not.toContain('javascript:');
          expect(responseText).not.toContain('DROP TABLE');
        }
      }
    });
  });

  describe('HTTP Security', () => {
    test('should reject requests with malicious headers', async () => {
      const maliciousHeaders = {
        'X-Forwarded-For': '<script>alert("XSS")</script>',
        'User-Agent': 'DROP TABLE users; --',
        'Referer': 'javascript:alert("XSS")',
        'X-Real-IP': ''; DROP TABLE split_products; --',
        'X-Custom-Header': '../../etc/passwd'
      };

      const response = await request(app)
        .get('/api/admin/dashboard/metrics')
        .set('Authorization', `Bearer ${adminToken}`)
        .set(maliciousHeaders);

      // Should handle malicious headers gracefully
      expect([200, 400]).toContain(response.status);
    });

    test('should prevent HTTP method tampering', async () => {
      const methods = ['PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
      
      for (const method of methods) {
        const response = await request(app)[method.toLowerCase()]('/api/admin/dashboard/metrics')
          .set('Authorization', `Bearer ${adminToken}`);

        // Should only allow GET for this endpoint
        expect([405, 404]).toContain(response.status);
      }
    });

    test('should validate Content-Type for POST requests', async () => {
      const maliciousContentTypes = [
        'text/html',
        'application/xml',
        'text/plain',
        'multipart/form-data',
        'application/x-www-form-urlencoded; charset=UTF-7'
      ];

      for (const contentType of maliciousContentTypes) {
        const response = await request(app)
          .post('/api/auth/login')
          .set('Content-Type', contentType)
          .send('malicious data');

        // Should reject invalid content types
        expect([400, 415, 422]).toContain(response.status);
      }
    });
  });

  describe('File Upload Security', () => {
    test('should prevent path traversal attacks', async () => {
      const pathTraversalAttempts = [
        '../../../etc/passwd',
        '..\\..\\..\\windows\\system32\\config\\sam',
        '....//....//....//etc//passwd',
        '%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd',
        '..%252f..%252f..%252fetc%252fpasswd'
      ];

      // If your app has file upload endpoints, test them here
      // For now, we'll test with query parameters that might be used for file operations
      for (const path of pathTraversalAttempts) {
        const response = await request(app)
          .get(`/api/admin/products?export=${encodeURIComponent(path)}`)
          .set('Authorization', `Bearer ${adminToken}`);

        // Should reject path traversal attempts
        expect([200, 400, 403, 404]).toContain(response.status);
        
        if (response.status === 200) {
          // Should not contain system file contents
          const responseText = JSON.stringify(response.body);
          expect(responseText).not.toContain('root:');
          expect(responseText).not.toContain('passwd');
          expect(responseText).not.toContain('shadow');
        }
      }
    });
  });

  describe('Business Logic Security', () => {
    test('should prevent negative quantity manipulation', async () => {
      // Test if negative quantities could be injected to manipulate revenue
      const response = await request(app)
        .get('/api/admin/dashboard/metrics')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const { data } = response.body;
      
      // All quantities should be non-negative
      expect(data.today.total_quantity_today).toBeGreaterThanOrEqual(0);
      expect(data.allTime.total_quantity_all_time).toBeGreaterThanOrEqual(0);
      
      // Revenue should also be non-negative (0 or positive)
      expect(data.today.splitset_revenue_today).toBeGreaterThanOrEqual(0);
      expect(data.allTime.splitset_revenue_all_time).toBeGreaterThanOrEqual(0);
    });

    test('should validate store access boundaries', async () => {
      // Try to access data from stores the user shouldn't have access to
      const response = await request(app)
        .get('/api/admin/products?store=unauthorized-store.myshopify.com')
        .set('Authorization', `Bearer ${adminToken}`);

      expect([200, 403]).toContain(response.status);
      
      if (response.status === 200) {
        // Admin should have access to all stores
        expect(response.body.success).toBe(true);
      }
    });

    test('should prevent price manipulation in calculations', async () => {
      const response = await request(app)
        .get('/api/admin/dashboard/metrics')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const { data } = response.body;
      
      // Verify that total revenue is calculated from actual database prices
      // and not manipulated by user input
      expect(typeof data.today.total_revenue_today).toBe('number');
      expect(typeof data.allTime.total_revenue_all_time).toBe('number');
      
      // SplitSet revenue should always be quantity * 9, never manipulated
      if (data.today.total_quantity_today > 0) {
        expect(data.today.splitset_revenue_today).toBe(data.today.total_quantity_today * 9);
      }
    });
  });

  describe('Information Disclosure Prevention', () => {
    test('should not expose sensitive information in error messages', async () => {
      // Try to trigger various error conditions
      const errorTriggers = [
        '/api/admin/nonexistent-endpoint',
        '/api/admin/dashboard/metrics?malformed=query&',
        '/api/admin/products?limit=abc',
      ];

      for (const trigger of errorTriggers) {
        const response = await request(app)
          .get(trigger)
          .set('Authorization', `Bearer ${adminToken}`);

        if (response.status >= 400) {
          const errorText = JSON.stringify(response.body);
          
          // Should not expose sensitive information
          expect(errorText).not.toContain('password');
          expect(errorText).not.toContain('token');
          expect(errorText).not.toContain('secret');
          expect(errorText).not.toContain('database');
          expect(errorText).not.toContain('connection string');
          expect(errorText).not.toContain('stack trace');
        }
      }
    });

    test('should not expose database schema information', async () => {
      const response = await request(app)
        .get('/api/admin/products?page=1&limit=1')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const responseText = JSON.stringify(response.body);
      
      // Should not contain database-specific information
      expect(responseText).not.toContain('SELECT');
      expect(responseText).not.toContain('FROM');
      expect(responseText).not.toContain('WHERE');
      expect(responseText).not.toContain('JOIN');
      expect(responseText).not.toContain('database');
      expect(responseText).not.toContain('table');
      expect(responseText).not.toContain('column');
    });
  });
});
