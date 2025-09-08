const express = require('express');
const router = express.Router();
const Store = require('../models/Store');
const { validateBody, validateParams, validateQuery, customValidators } = require('../middleware/validation');
const { createStoreSchema, updateStoreSchema } = require('../validators/schemas');
const { z } = require('zod');

// List all stores
router.get('/', 
  validateQuery(z.object({
    status: z.enum(['active', 'inactive', 'suspended']).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(50),
    offset: z.coerce.number().int().min(0).optional().default(0)
  })),
  async (req, res) => {
    try {
      const { status, limit, offset } = req.query;
      
      const stores = await Store.list({ status });
      const paginatedStores = stores.slice(offset, offset + limit);
      
      req.logger.info('Stores listed', {
        count: paginatedStores.length,
        total: stores.length,
        filters: { status }
      });

      res.json({
        success: true,
        data: paginatedStores.map(store => ({
          id: store.id,
          shopDomain: store.shop_domain,
          status: store.status,
          scopes: JSON.parse(store.scopes || '[]'),
          metadata: JSON.parse(store.metadata || '{}'),
          createdAt: store.created_at,
          updatedAt: store.updated_at
        })),
        pagination: {
          limit,
          offset,
          total: stores.length,
          hasMore: offset + limit < stores.length
        }
      });
    } catch (error) {
      req.logger.error('Failed to list stores', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Failed to list stores'
      });
    }
  }
);

// Get store by ID
router.get('/:storeId',
  validateParams(z.object({ storeId: z.coerce.number().int().positive() })),
  customValidators.storeExists,
  async (req, res) => {
    try {
      const store = req.store;
      
      res.json({
        success: true,
        data: {
          id: store.id,
          shopDomain: store.shop_domain,
          status: store.status,
          scopes: JSON.parse(store.scopes || '[]'),
          metadata: JSON.parse(store.metadata || '{}'),
          createdAt: store.created_at,
          updatedAt: store.updated_at
        }
      });
    } catch (error) {
      req.logger.error('Failed to get store', { 
        storeId: req.params.storeId,
        error: error.message 
      });
      res.status(500).json({
        success: false,
        error: 'Failed to get store'
      });
    }
  }
);

// Create new store
router.post('/',
  validateBody(createStoreSchema),
  async (req, res) => {
    try {
      const { shopDomain, accessToken, scopes, metadata } = req.body;
      
      // Check if store already exists
      const existingStore = await Store.findByDomain(shopDomain);
      if (existingStore) {
        return res.status(409).json({
          success: false,
          error: 'Store already exists'
        });
      }

      const store = await Store.create({
        shopDomain,
        accessToken,
        scopes,
        metadata
      });

      req.logger.audit('Store created', {
        storeId: store.id,
        shopDomain
      });

      res.status(201).json({
        success: true,
        data: {
          id: store.id,
          shopDomain: store.shop_domain,
          status: store.status,
          scopes: JSON.parse(store.scopes || '[]'),
          metadata: JSON.parse(store.metadata || '{}'),
          createdAt: store.created_at
        }
      });
    } catch (error) {
      req.logger.error('Failed to create store', { 
        shopDomain: req.body.shopDomain,
        error: error.message 
      });
      res.status(500).json({
        success: false,
        error: 'Failed to create store'
      });
    }
  }
);

// Update store
router.put('/:storeId',
  validateParams(z.object({ storeId: z.coerce.number().int().positive() })),
  validateBody(updateStoreSchema),
  customValidators.storeExists,
  async (req, res) => {
    try {
      const { storeId } = req.params;
      const updates = req.body;

      const updatedStore = await Store.update(storeId, updates);

      req.logger.audit('Store updated', {
        storeId,
        updates: Object.keys(updates)
      });

      res.json({
        success: true,
        data: {
          id: updatedStore.id,
          shopDomain: updatedStore.shop_domain,
          status: updatedStore.status,
          scopes: JSON.parse(updatedStore.scopes || '[]'),
          metadata: JSON.parse(updatedStore.metadata || '{}'),
          updatedAt: updatedStore.updated_at
        }
      });
    } catch (error) {
      req.logger.error('Failed to update store', { 
        storeId: req.params.storeId,
        error: error.message 
      });
      res.status(500).json({
        success: false,
        error: 'Failed to update store'
      });
    }
  }
);

// Delete store
router.delete('/:storeId',
  validateParams(z.object({ storeId: z.coerce.number().int().positive() })),
  customValidators.storeExists,
  async (req, res) => {
    try {
      const { storeId } = req.params;
      
      await Store.delete(storeId);

      req.logger.audit('Store deleted', {
        storeId,
        shopDomain: req.store.shop_domain
      });

      res.json({
        success: true,
        message: 'Store deleted successfully'
      });
    } catch (error) {
      req.logger.error('Failed to delete store', { 
        storeId: req.params.storeId,
        error: error.message 
      });
      res.status(500).json({
        success: false,
        error: 'Failed to delete store'
      });
    }
  }
);

module.exports = router;
