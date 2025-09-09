const express = require('express');
const router = express.Router();
const { authenticate, requireStoreAccess } = require('../middleware/auth');
const { validateBody } = require('../middleware/validation');
const { z } = require('zod');
const StoreV2 = require('../models/StoreV2');

// Validation schema for store settings update
const updateStoreSettingsSchema = z.object({
  shopifyAccessToken: z.string().min(1).optional(),
  shopifyApiKey: z.string().min(1).optional(),
  shopifyApiSecretKey: z.string().min(1).optional(),
  splitsetEnabled: z.boolean().optional()
});

// Get store settings
router.get('/:storeId/settings', 
  authenticate,
  requireStoreAccess('viewer'),
  async (req, res) => {
    try {
      const { storeId } = req.params;
      
      const store = await StoreV2.findById(storeId);
      if (!store) {
        return res.status(404).json({
          success: false,
          error: 'Store not found'
        });
      }

      // Parse metadata
      const metadata = store.metadata ? JSON.parse(store.metadata) : {};
      
      // Return settings without sensitive data
      res.json({
        success: true,
        data: {
          storeId: store.id,
          shopDomain: store.shop_domain,
          hasAccessToken: !!store.access_token_encrypted,
          hasApiKey: !!store.shopify_app_id_encrypted,
          hasApiSecretKey: !!store.shopify_app_secret_encrypted,
          splitsetEnabled: metadata.splitsetEnabled || false,
          hasThemeBackup: !!metadata.themeBackup,
          installedAt: metadata.enabledAt,
          splitProductsCount: metadata.productsProcessed || 0,
          scopes: JSON.parse(store.scopes || '[]'),
          plan: store.plan,
          status: store.status
        }
      });

    } catch (error) {
      req.logger?.error('Failed to get store settings', {
        error: error.message,
        storeId: req.params.storeId,
        userId: req.user?.id
      });

      res.status(500).json({
        success: false,
        error: 'Failed to get store settings'
      });
    }
  }
);

// Update store settings
router.put('/:storeId/settings',
  authenticate,
  requireStoreAccess('owner'),
  validateBody(updateStoreSettingsSchema),
  async (req, res) => {
    try {
      const { storeId } = req.params;
      const { shopifyAccessToken, shopifyApiKey, shopifyApiSecretKey, splitsetEnabled } = req.body;

      const store = await StoreV2.findById(storeId);
      if (!store) {
        return res.status(404).json({
          success: false,
          error: 'Store not found'
        });
      }

      // Prepare update data
      const updateData = {};
      
      if (shopifyAccessToken) {
        updateData.accessToken = shopifyAccessToken;
      }
      
      if (shopifyApiKey) {
        updateData.appId = shopifyApiKey;
      }
      
      if (shopifyApiSecretKey) {
        updateData.appSecret = shopifyApiSecretKey;
      }

      // Update metadata for SplitSet settings
      const currentMetadata = store.metadata ? JSON.parse(store.metadata) : {};
      if (splitsetEnabled !== undefined) {
        currentMetadata.splitsetEnabled = splitsetEnabled;
        updateData.metadata = currentMetadata;
      }

      // Update the store
      const updatedStore = await StoreV2.update(storeId, updateData);

      req.logger?.audit('Store settings updated', {
        storeId,
        userId: req.user.id,
        updatedFields: Object.keys(updateData),
        splitsetEnabled
      });

      res.json({
        success: true,
        message: 'Store settings updated successfully',
        data: {
          storeId: updatedStore.id,
          shopDomain: updatedStore.shop_domain,
          hasAccessToken: !!updatedStore.access_token_encrypted,
          hasApiKey: !!updatedStore.shopify_app_id_encrypted,
          hasApiSecretKey: !!updatedStore.shopify_app_secret_encrypted,
          splitsetEnabled: updatedStore.metadata ? JSON.parse(updatedStore.metadata).splitsetEnabled !== false : true,
          updatedAt: updatedStore.updated_at
        }
      });

    } catch (error) {
      req.logger?.error('Failed to update store settings', {
        error: error.message,
        storeId: req.params.storeId,
        userId: req.user?.id
      });

      res.status(500).json({
        success: false,
        error: 'Failed to update store settings'
      });
    }
  }
);

// Test Shopify connection with current settings
router.post('/:storeId/test-connection',
  authenticate,
  requireStoreAccess('manager'),
  async (req, res) => {
    try {
      const { storeId } = req.params;
      
      const store = await StoreV2.findById(storeId);
      if (!store) {
        return res.status(404).json({
          success: false,
          error: 'Store not found'
        });
      }

      // Get decrypted credentials
      const credentials = await StoreV2.getDecryptedCredentials(storeId);
      
      if (!credentials.accessToken) {
        return res.status(400).json({
          success: false,
          error: 'No access token configured'
        });
      }

      // Test connection by making a simple API call
      const shopifyUrl = `https://${store.shop_domain}/admin/api/2023-10/shop.json`;
      const response = await fetch(shopifyUrl, {
        headers: {
          'X-Shopify-Access-Token': credentials.accessToken,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const shopData = await response.json();
        
        req.logger?.info('Shopify connection test successful', {
          storeId,
          userId: req.user.id,
          shopName: shopData.shop?.name
        });

        res.json({
          success: true,
          message: 'Connection successful',
          data: {
            shopName: shopData.shop?.name,
            shopDomain: shopData.shop?.domain,
            planName: shopData.shop?.plan_name,
            currency: shopData.shop?.currency
          }
        });
      } else {
        const errorText = await response.text();
        
        req.logger?.warn('Shopify connection test failed', {
          storeId,
          userId: req.user.id,
          status: response.status,
          error: errorText
        });

        res.status(400).json({
          success: false,
          error: 'Connection failed',
          details: `HTTP ${response.status}: ${errorText}`
        });
      }

    } catch (error) {
      req.logger?.error('Shopify connection test error', {
        error: error.message,
        storeId: req.params.storeId,
        userId: req.user?.id
      });

      res.status(500).json({
        success: false,
        error: 'Connection test failed',
        details: error.message
      });
    }
  }
);

module.exports = router;
