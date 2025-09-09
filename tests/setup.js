// Test setup file
const path = require('path');

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-key-for-testing-only';
process.env.ENCRYPTION_KEY = 'test-encryption-key-32-chars-long!';
process.env.DATABASE_URL = ':memory:'; // In-memory SQLite for tests
process.env.PORT = '0'; // Let the system assign a port
process.env.REDIS_URL = 'redis://localhost:6379';

// Global test timeout
jest.setTimeout(30000);

// Mock console methods for cleaner test output
global.console = {
  ...console,
  // Uncomment to silence logs during tests
  // log: jest.fn(),
  // debug: jest.fn(),
  // info: jest.fn(),
  // warn: jest.fn(),
  // error: jest.fn(),
};

// Global test helpers
global.testHelpers = {
  // Mock admin user for tests
  mockAdminUser: {
    id: 1,
    email: 'admin@test.com',
    role: 'admin',
    firstName: 'Test',
    lastName: 'Admin'
  },
  
  // Mock store owner user for tests
  mockStoreOwner: {
    id: 2,
    email: 'owner@test.com',
    role: 'store_owner',
    firstName: 'Test',
    lastName: 'Owner'
  },
  
  // Mock store data
  mockStore: {
    id: 1,
    shop_domain: 'test-store.myshopify.com',
    access_token: 'test-token',
    status: 'active'
  }
};

// Cleanup after each test
afterEach(() => {
  // Clear all mocks
  jest.clearAllMocks();
});

// Global cleanup after all tests
afterAll(async () => {
  // Close any open connections
  if (global.__DB__) {
    await global.__DB__.destroy();
  }
});
