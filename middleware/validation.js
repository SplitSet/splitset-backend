const { z } = require('zod');
const { logger } = require('../utils/logger');

// Validation middleware factory
const validate = (schema, source = 'body') => {
  return (req, res, next) => {
    try {
      let data;
      
      switch (source) {
        case 'body':
          data = req.body;
          break;
        case 'params':
          data = req.params;
          break;
        case 'query':
          data = req.query;
          break;
        case 'headers':
          data = req.headers;
          break;
        default:
          // Combine all sources
          data = {
            ...req.params,
            ...req.query,
            ...req.body
          };
      }

      const validated = schema.parse(data);
      
      // Attach validated data to request
      req.validated = {
        ...req.validated,
        [source]: validated
      };
      
      // Also update the original source with validated data
      if (source === 'body') req.body = validated;
      else if (source === 'params') req.params = validated;
      else if (source === 'query') req.query = validated;
      
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        const validationErrors = error.errors.map(err => ({
          field: err.path.join('.'),
          message: err.message,
          code: err.code,
          received: err.received
        }));

        req.logger?.warn('Validation failed', {
          source,
          errors: validationErrors,
          received: data
        });

        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: validationErrors
        });
      }

      // Unexpected validation error
      req.logger?.error('Validation middleware error', {
        error: error.message,
        source
      });

      return res.status(500).json({
        success: false,
        error: 'Internal validation error'
      });
    }
  };
};

// Specific validation middlewares
const validateBody = (schema) => validate(schema, 'body');
const validateParams = (schema) => validate(schema, 'params');
const validateQuery = (schema) => validate(schema, 'query');
const validateAll = (schema) => validate(schema, 'all');

// Store ID parameter validation
const validateStoreId = validateParams(z.object({
  storeId: z.coerce.number().int().positive()
}));

// Run ID parameter validation
const validateRunId = validateParams(z.object({
  runId: z.string().min(1)
}));

// Common pagination validation
const validatePagination = validateQuery(z.object({
  limit: z.coerce.number().int().min(1).max(250).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
  page: z.coerce.number().int().min(1).optional(),
  pageInfo: z.string().optional()
}));

// Date range validation
const validateDateRange = validateQuery(z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  year: z.coerce.number().int().min(2020).max(2030).optional(),
  month: z.coerce.number().int().min(1).max(12).optional()
}).refine(
  (data) => {
    // If startDate is provided, endDate should also be provided
    if (data.startDate && !data.endDate) return false;
    if (data.endDate && !data.startDate) return false;
    
    // If both dates are provided, startDate should be before endDate
    if (data.startDate && data.endDate) {
      return new Date(data.startDate) <= new Date(data.endDate);
    }
    
    return true;
  },
  {
    message: "Invalid date range: both startDate and endDate must be provided, and startDate must be before endDate"
  }
));

// Error handling for async validation
const asyncValidate = (validationFn) => {
  return async (req, res, next) => {
    try {
      await validationFn(req, res, next);
    } catch (error) {
      req.logger?.error('Async validation error', {
        error: error.message
      });
      
      res.status(500).json({
        success: false,
        error: 'Validation error'
      });
    }
  };
};

// Custom validators
const customValidators = {
  // Validate that store exists and user has access
  storeExists: async (req, res, next) => {
    try {
      const Store = require('../models/Store');
      const { storeId } = req.params;
      
      const store = await Store.findById(storeId);
      if (!store) {
        return res.status(404).json({
          success: false,
          error: `Store not found: ${storeId}`
        });
      }
      
      if (store.status !== 'active') {
        return res.status(403).json({
          success: false,
          error: `Store is ${store.status}`
        });
      }
      
      req.store = store;
      next();
    } catch (error) {
      req.logger?.error('Store validation error', {
        storeId: req.params.storeId,
        error: error.message
      });
      
      res.status(500).json({
        success: false,
        error: 'Store validation failed'
      });
    }
  },

  // Validate run exists and belongs to store
  runExists: async (req, res, next) => {
    try {
      const Run = require('../models/Run');
      const { runId } = req.params;
      const storeId = req.params.storeId || req.store?.id;
      
      const run = await Run.findByRunId(runId);
      if (!run) {
        return res.status(404).json({
          success: false,
          error: `Run not found: ${runId}`
        });
      }
      
      if (storeId && run.store_id !== parseInt(storeId)) {
        return res.status(403).json({
          success: false,
          error: 'Run does not belong to this store'
        });
      }
      
      req.run = run;
      next();
    } catch (error) {
      req.logger?.error('Run validation error', {
        runId: req.params.runId,
        error: error.message
      });
      
      res.status(500).json({
        success: false,
        error: 'Run validation failed'
      });
    }
  }
};

module.exports = {
  validate,
  validateBody,
  validateParams,
  validateQuery,
  validateAll,
  validateStoreId,
  validateRunId,
  validatePagination,
  validateDateRange,
  asyncValidate,
  customValidators
};
