const { z } = require('zod');

// Common schemas
const storeIdSchema = z.coerce.number().int().positive();
const runIdSchema = z.string().min(1);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const yearSchema = z.coerce.number().int().min(2020).max(2030);
const monthSchema = z.coerce.number().int().min(1).max(12);
const shopDomainSchema = z.string().regex(/^[a-zA-Z0-9-]+\.myshopify\.com$/);

// Store schemas
const createStoreSchema = z.object({
  shopDomain: shopDomainSchema,
  accessToken: z.string().min(1),
  scopes: z.array(z.string()).min(1),
  metadata: z.object({}).optional()
});

const updateStoreSchema = z.object({
  accessToken: z.string().min(1).optional(),
  scopes: z.array(z.string()).min(1).optional(),
  status: z.enum(['active', 'inactive', 'suspended']).optional(),
  metadata: z.object({}).optional()
});

// Analytics schemas
const analyticsRefreshSchema = z.object({
  storeId: storeIdSchema,
  year: yearSchema.optional(),
  month: monthSchema.optional(),
  force: z.boolean().optional().default(false)
});

const analyticsQuerySchema = z.object({
  storeId: storeIdSchema,
  year: yearSchema.optional(),
  month: monthSchema.optional(),
  startDate: dateSchema.optional(),
  endDate: dateSchema.optional()
});

const multiStoreAnalyticsSchema = z.object({
  storeIds: z.array(storeIdSchema).min(1).max(50),
  year: yearSchema.optional(),
  month: monthSchema.optional()
});

// Product schemas
const productQuerySchema = z.object({
  storeId: storeIdSchema,
  limit: z.coerce.number().int().min(1).max(250).optional().default(50),
  pageInfo: z.string().optional(),
  fields: z.string().optional(),
  createdAtMin: z.string().datetime().optional(),
  createdAtMax: z.string().datetime().optional()
});

const productSplitSchema = z.object({
  storeId: storeIdSchema,
  productId: z.coerce.number().int().positive(),
  splitConfig: z.object({
    titleSuffix: z.string().optional().default('- Bundle'),
    bundleProducts: z.array(z.object({
      id: z.number().int().positive(),
      title: z.string(),
      price: z.number().positive(),
      quantity: z.number().int().positive().optional().default(1)
    })).min(1),
    discount: z.number().min(0).max(100).optional().default(15),
    tags: z.array(z.string()).optional().default(['splitter'])
  })
});

// Order schemas
const orderQuerySchema = z.object({
  storeId: storeIdSchema,
  limit: z.coerce.number().int().min(1).max(250).optional().default(50),
  status: z.enum(['open', 'closed', 'cancelled', 'any']).optional().default('any'),
  createdAtMin: z.string().datetime().optional(),
  createdAtMax: z.string().datetime().optional(),
  fulfillmentStatus: z.enum(['shipped', 'partial', 'unshipped', 'any', 'unfulfilled']).optional()
});

// Job schemas
const jobCreateSchema = z.object({
  storeId: storeIdSchema,
  type: z.enum(['analytics_refresh', 'product_split', 'bulk_operation']),
  params: z.object({}).optional().default({}),
  priority: z.number().int().min(0).max(10).optional().default(5),
  delay: z.number().int().min(0).optional().default(0),
  attempts: z.number().int().min(1).max(5).optional().default(3)
});

const jobQuerySchema = z.object({
  storeId: storeIdSchema,
  type: z.enum(['analytics_refresh', 'product_split', 'bulk_operation']).optional(),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20)
});

// Health check schemas
const healthCheckSchema = z.object({
  storeId: storeIdSchema.optional(),
  includeShopify: z.boolean().optional().default(false),
  includeDatabase: z.boolean().optional().default(true),
  includeQueue: z.boolean().optional().default(true)
});

// Pagination schemas
const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(250).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
  page: z.coerce.number().int().min(1).optional(),
  pageInfo: z.string().optional()
});

// Export all schemas
module.exports = {
  // Store schemas
  createStoreSchema,
  updateStoreSchema,
  
  // Analytics schemas
  analyticsRefreshSchema,
  analyticsQuerySchema,
  multiStoreAnalyticsSchema,
  
  // Product schemas
  productQuerySchema,
  productSplitSchema,
  
  // Order schemas
  orderQuerySchema,
  
  // Job schemas
  jobCreateSchema,
  jobQuerySchema,
  
  // Health schemas
  healthCheckSchema,
  
  // Common schemas
  storeIdSchema,
  runIdSchema,
  dateSchema,
  yearSchema,
  monthSchema,
  shopDomainSchema,
  paginationSchema,
  
  // Validation helpers
  validateStoreId: (value) => storeIdSchema.parse(value),
  validateRunId: (value) => runIdSchema.parse(value),
  validateShopDomain: (value) => shopDomainSchema.parse(value)
};
