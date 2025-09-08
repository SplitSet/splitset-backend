const express = require('express');
const router = express.Router();
const AnalyticsServiceV2 = require('../services/analyticsServiceV2');
const QueueService = require('../services/queueService');
const Run = require('../models/Run');
const { authenticate, requireStoreAccess, requireRole } = require('../middleware/auth');
const { validateParams, validateQuery, validateBody, customValidators } = require('../middleware/validation');
const { analyticsRefreshSchema, analyticsQuerySchema, multiStoreAnalyticsSchema } = require('../validators/schemas');
const { z } = require('zod');

// Get analytics summary for a store
router.get('/:storeId/summary',
  authenticate,
  validateParams(z.object({ storeId: z.coerce.number().int().positive() })),
  validateQuery(analyticsQuerySchema.omit({ storeId: true })),
  requireStoreAccess('viewer'),
  customValidators.storeExists,
  async (req, res) => {
    try {
      const { storeId } = req.params;
      const { year, month } = req.query;

      const result = await AnalyticsServiceV2.getStoreSummary(storeId, year, month);

      if (!result.success) {
        return res.status(400).json(result);
      }

      req.logger.info('Analytics summary retrieved', {
        storeId,
        year,
        month,
        totalOrders: result.data.summary.totalOrders
      });

      res.json(result);
    } catch (error) {
      req.logger.error('Failed to get analytics summary', {
        storeId: req.params.storeId,
        error: error.message
      });
      res.status(500).json({
        success: false,
        error: 'Failed to get analytics summary'
      });
    }
  }
);

// Trigger analytics refresh for a store
router.post('/:storeId/refresh',
  authenticate,
  validateParams(z.object({ storeId: z.coerce.number().int().positive() })),
  validateBody(analyticsRefreshSchema.omit({ storeId: true })),
  requireStoreAccess('manager'),
  customValidators.storeExists,
  async (req, res) => {
    try {
      const { storeId } = req.params;
      const { year, month, force } = req.body;

      // Check if refresh is needed (unless forced)
      if (!force) {
        const isNeeded = await AnalyticsServiceV2.isRefreshNeeded(storeId);
        if (!isNeeded) {
          return res.json({
            success: true,
            message: 'Analytics data is up to date',
            data: await AnalyticsServiceV2.getStoreSummary(storeId, year, month)
          });
        }
      }

      // Check if there's already a running refresh
      const runningRefresh = await Run.findRunningByType(storeId, 'analytics_refresh');
      if (runningRefresh) {
        return res.status(409).json({
          success: false,
          error: 'Analytics refresh already in progress',
          runId: runningRefresh.run_id
        });
      }

      // Create run record
      const run = await Run.create({
        storeId,
        type: 'analytics_refresh',
        inputParams: { year, month, force }
      });

      // Queue the job
      await QueueService.addJob(storeId, 'analytics_refresh', {
        runId: run.run_id,
        year,
        month
      });

      req.logger.audit('Analytics refresh triggered', {
        storeId,
        runId: run.run_id,
        year,
        month,
        force
      });

      res.status(202).json({
        success: true,
        message: 'Analytics refresh started',
        runId: run.run_id,
        status: 'pending'
      });
    } catch (error) {
      req.logger.error('Failed to trigger analytics refresh', {
        storeId: req.params.storeId,
        error: error.message
      });
      res.status(500).json({
        success: false,
        error: 'Failed to trigger analytics refresh'
      });
    }
  }
);

// Get refresh status
router.get('/:storeId/refresh/:runId',
  validateParams(z.object({ 
    storeId: z.coerce.number().int().positive(),
    runId: z.string().min(1)
  })),
  customValidators.storeExists,
  customValidators.runExists,
  async (req, res) => {
    try {
      const run = req.run;

      res.json({
        success: true,
        data: {
          runId: run.run_id,
          status: run.status,
          startedAt: run.started_at,
          finishedAt: run.finished_at,
          stats: run.stats ? JSON.parse(run.stats) : null,
          error: run.error_message,
          inputParams: run.input_params ? JSON.parse(run.input_params) : null
        }
      });
    } catch (error) {
      req.logger.error('Failed to get refresh status', {
        runId: req.params.runId,
        error: error.message
      });
      res.status(500).json({
        success: false,
        error: 'Failed to get refresh status'
      });
    }
  }
);

// Get recent runs for a store
router.get('/:storeId/runs',
  validateParams(z.object({ storeId: z.coerce.number().int().positive() })),
  validateQuery(z.object({
    type: z.enum(['analytics_refresh', 'product_split', 'bulk_operation']).optional(),
    status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20)
  })),
  customValidators.storeExists,
  async (req, res) => {
    try {
      const { storeId } = req.params;
      const { type, status, limit } = req.query;

      const runs = await Run.findByStore(storeId, { type, status, limit });

      res.json({
        success: true,
        data: runs.map(run => ({
          runId: run.run_id,
          type: run.type,
          status: run.status,
          startedAt: run.started_at,
          finishedAt: run.finished_at,
          createdAt: run.created_at,
          stats: run.stats ? JSON.parse(run.stats) : null,
          error: run.error_message
        }))
      });
    } catch (error) {
      req.logger.error('Failed to get runs', {
        storeId: req.params.storeId,
        error: error.message
      });
      res.status(500).json({
        success: false,
        error: 'Failed to get runs'
      });
    }
  }
);

// Multi-store analytics (admin endpoint)
router.post('/multi-store',
  authenticate,
  requireRole('admin'),
  validateBody(multiStoreAnalyticsSchema),
  async (req, res) => {
    try {
      const { storeIds, year, month } = req.body;

      const result = await AnalyticsServiceV2.getMultiStoreAnalytics(storeIds, year, month);

      req.logger.info('Multi-store analytics retrieved', {
        storeCount: storeIds.length,
        successCount: result.data.stores.length,
        errorCount: result.data.errors.length
      });

      res.json(result);
    } catch (error) {
      req.logger.error('Failed to get multi-store analytics', {
        error: error.message
      });
      res.status(500).json({
        success: false,
        error: 'Failed to get multi-store analytics'
      });
    }
  }
);

// Queue statistics for a store
router.get('/:storeId/queue/stats',
  validateParams(z.object({ storeId: z.coerce.number().int().positive() })),
  customValidators.storeExists,
  async (req, res) => {
    try {
      const { storeId } = req.params;

      const stats = await QueueService.getQueueStats(storeId);

      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      req.logger.error('Failed to get queue stats', {
        storeId: req.params.storeId,
        error: error.message
      });
      res.status(500).json({
        success: false,
        error: 'Failed to get queue stats'
      });
    }
  }
);

// Clean old analytics data
router.post('/cleanup',
  validateBody(z.object({
    olderThanDays: z.number().int().min(1).max(365).optional().default(90)
  })),
  async (req, res) => {
    try {
      const { olderThanDays } = req.body;

      const result = await AnalyticsServiceV2.cleanup(olderThanDays);

      req.logger.audit('Analytics cleanup performed', {
        olderThanDays,
        ...result
      });

      res.json({
        success: true,
        message: 'Cleanup completed',
        data: result
      });
    } catch (error) {
      req.logger.error('Failed to cleanup analytics', {
        error: error.message
      });
      res.status(500).json({
        success: false,
        error: 'Failed to cleanup analytics'
      });
    }
  }
);

module.exports = router;
