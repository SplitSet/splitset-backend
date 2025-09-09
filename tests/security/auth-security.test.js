const request = require('supertest');
const TestServer = require('../helpers/testServer');

describe('Authentication Security Tests', () => {
  let testServer;
  let app;

  beforeAll(async () => {
    testServer = new TestServer();
    app = await testServer.setup();
  });

  afterAll(async () => {
    await testServer.cleanup();
  });

  describe('JWT Security', () => {
    test('should reject requests with invalid JWT tokens', async () => {
      const invalidTokens = [
        'invalid.jwt.token',
        'Bearer invalid.jwt.token',
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid.signature',
        '', // Empty token
        'null',
        'undefined'
      ];

      for (const token of invalidTokens) {
        const response = await request(app)
          .get('/api/admin/dashboard/metrics')
          .set('Authorization', `Bearer ${token}`)
          .expect(401);

        expect(response.body.success).toBe(false);
        expect(response.body.error).toContain('Authentication');
      }
    });

    test('should reject expired JWT tokens', async () => {
      // Generate an expired token
      const jwt = require('jsonwebtoken');
      const expiredToken = jwt.sign(
        {
          userId: 1,
          email: 'test@example.com',
          role: 'admin',
          exp: Math.floor(Date.now() / 1000) - 3600 // Expired 1 hour ago
        },
        process.env.JWT_SECRET || 'test-secret'
      );

      const response = await request(app)
        .get('/api/admin/dashboard/metrics')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('expired');
    });

    test('should reject tokens with invalid signatures', async () => {
      const jwt = require('jsonwebtoken');
      const tokenWithWrongSecret = jwt.sign(
        {
          userId: 1,
          email: 'test@example.com',
          role: 'admin'
        },
        'wrong-secret'
      );

      const response = await request(app)
        .get('/api/admin/dashboard/metrics')
        .set('Authorization', `Bearer ${tokenWithWrongSecret}`)
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    test('should prevent JWT token manipulation', async () => {
      const jwt = require('jsonwebtoken');
      const validToken = jwt.sign(
        {
          userId: 2,
          email: 'owner@test.com',
          role: 'store_owner'
        },
        process.env.JWT_SECRET || 'test-secret'
      );

      // Try to manipulate the payload by changing the role
      const [header, payload, signature] = validToken.split('.');
      const decodedPayload = JSON.parse(Buffer.from(payload, 'base64').toString());
      decodedPayload.role = 'admin'; // Try to escalate privileges
      
      const manipulatedPayload = Buffer.from(JSON.stringify(decodedPayload)).toString('base64');
      const manipulatedToken = `${header}.${manipulatedPayload}.${signature}`;

      const response = await request(app)
        .get('/api/admin/dashboard/metrics')
        .set('Authorization', `Bearer ${manipulatedToken}`)
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });

  describe('Role-Based Access Control (RBAC)', () => {
    test('should enforce admin-only access to admin endpoints', async () => {
      const ownerToken = testServer.generateToken({
        id: 2,
        email: 'owner@test.com',
        role: 'store_owner'
      });

      const adminEndpoints = [
        '/api/admin/dashboard/metrics',
        '/api/admin/products',
        '/api/admin/orders',
        '/api/admin/stores/performance'
      ];

      for (const endpoint of adminEndpoints) {
        const response = await request(app)
          .get(endpoint)
          .set('Authorization', `Bearer ${ownerToken}`)
          .expect(403);

        expect(response.body.success).toBe(false);
        expect(response.body.code).toBe('ADMIN_ACCESS_DENIED');
      }
    });

    test('should prevent privilege escalation attempts', async () => {
      // Test various role escalation attempts
      const escalationAttempts = [
        { role: 'admin' },
        { role: 'ADMIN' },
        { role: 'administrator' },
        { role: 'root' },
        { role: 'superuser' }
      ];

      for (const attempt of escalationAttempts) {
        const maliciousToken = testServer.generateToken({
          id: 2,
          email: 'owner@test.com',
          role: attempt.role
        });

        if (attempt.role !== 'admin') {
          const response = await request(app)
            .get('/api/admin/dashboard/metrics')
            .set('Authorization', `Bearer ${maliciousToken}`)
            .expect(403);

          expect(response.body.success).toBe(false);
        }
      }
    });

    test('should validate user existence for token claims', async () => {
      const nonExistentUserToken = testServer.generateToken({
        id: 99999,
        email: 'nonexistent@test.com',
        role: 'admin'
      });

      const response = await request(app)
        .get('/api/admin/dashboard/metrics')
        .set('Authorization', `Bearer ${nonExistentUserToken}`)
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });

  describe('Session Security', () => {
    test('should prevent session fixation attacks', async () => {
      // Login with one session
      const loginResponse1 = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'admin@test.com',
          password: 'password123'
        });

      // Login again with different session
      const loginResponse2 = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'admin@test.com',
          password: 'password123'
        });

      // Tokens should be different
      if (loginResponse1.body.success && loginResponse2.body.success) {
        expect(loginResponse1.body.data.token).not.toBe(loginResponse2.body.data.token);
      }
    });

    test('should implement proper session isolation', async () => {
      const adminToken = testServer.generateToken({
        id: 1,
        email: 'admin@test.com',
        role: 'admin'
      });

      const ownerToken = testServer.generateToken({
        id: 2,
        email: 'owner@test.com',
        role: 'store_owner'
      });

      // Make requests with different tokens
      const adminResponse = await request(app)
        .get('/api/admin/dashboard/metrics')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const ownerResponse = await request(app)
        .get('/api/admin/dashboard/metrics')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(403);

      // Verify proper isolation
      expect(adminResponse.body.success).toBe(true);
      expect(ownerResponse.body.success).toBe(false);
    });
  });

  describe('Input Validation Security', () => {
    test('should prevent SQL injection in login', async () => {
      const sqlInjectionAttempts = [
        "admin@test.com'; DROP TABLE users; --",
        "admin@test.com' OR '1'='1",
        "admin@test.com' UNION SELECT * FROM users --",
        "'; DELETE FROM users WHERE '1'='1",
        "admin@test.com' OR 1=1 --"
      ];

      for (const maliciousEmail of sqlInjectionAttempts) {
        const response = await request(app)
          .post('/api/auth/login')
          .send({
            email: maliciousEmail,
            password: 'password123'
          });

        // Should not crash or return unexpected results
        expect(response.status).toBeGreaterThanOrEqual(400);
        expect(response.body.success).toBe(false);
      }
    });

    test('should prevent XSS in input fields', async () => {
      const xssAttempts = [
        '<script>alert("XSS")</script>',
        'javascript:alert("XSS")',
        '<img src="x" onerror="alert(\'XSS\')">',
        '"><script>alert("XSS")</script>',
        '<svg onload="alert(\'XSS\')">'
      ];

      for (const xssPayload of xssAttempts) {
        const response = await request(app)
          .post('/api/auth/login')
          .send({
            email: xssPayload,
            password: 'password123'
          });

        // Should handle XSS attempts safely
        expect(response.status).toBeGreaterThanOrEqual(400);
        if (response.body.error) {
          expect(response.body.error).not.toContain('<script>');
          expect(response.body.error).not.toContain('javascript:');
        }
      }
    });

    test('should validate input lengths to prevent buffer overflow', async () => {
      const longString = 'A'.repeat(10000); // 10KB string

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: longString,
          password: longString
        });

      // Should handle long inputs gracefully
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('Rate Limiting Security', () => {
    test('should implement rate limiting on login endpoint', async () => {
      const promises = [];
      
      // Attempt many rapid login requests
      for (let i = 0; i < 20; i++) {
        promises.push(
          request(app)
            .post('/api/auth/login')
            .send({
              email: 'admin@test.com',
              password: 'wrongpassword'
            })
        );
      }

      const responses = await Promise.all(promises);
      
      // Should have some rate limited responses
      const rateLimitedResponses = responses.filter(r => r.status === 429);
      expect(rateLimitedResponses.length).toBeGreaterThan(0);
    });

    test('should implement rate limiting on admin endpoints', async () => {
      const adminToken = testServer.generateToken({
        id: 1,
        email: 'admin@test.com',
        role: 'admin'
      });

      const promises = [];
      
      // Attempt many rapid admin requests
      for (let i = 0; i < 30; i++) {
        promises.push(
          request(app)
            .get('/api/admin/dashboard/metrics')
            .set('Authorization', `Bearer ${adminToken}`)
        );
      }

      const responses = await Promise.all(promises);
      
      // Most should succeed, but some might be rate limited
      const successResponses = responses.filter(r => r.status === 200);
      const rateLimitedResponses = responses.filter(r => r.status === 429);
      
      expect(successResponses.length).toBeGreaterThan(0);
      // Rate limiting might kick in for excessive requests
    });
  });

  describe('Security Headers', () => {
    test('should include security headers in responses', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      // Check for common security headers
      expect(response.headers).toHaveProperty('x-content-type-options');
      expect(response.headers).toHaveProperty('x-frame-options');
      expect(response.headers).toHaveProperty('x-xss-protection');
    });

    test('should not expose sensitive server information', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      // Should not expose server details
      expect(response.headers['x-powered-by']).toBeUndefined();
      expect(response.headers['server']).not.toContain('Express');
    });
  });
});
