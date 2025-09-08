const express = require('express');
const router = express.Router();
const componentVisibilityService = require('../services/componentVisibilityService');

/**
 * Get visibility status for bundle components
 */
router.get('/status/:bundleId', async (req, res) => {
  try {
    const { bundleId } = req.params;
    
    const result = await componentVisibilityService.getComponentVisibilityStatus(bundleId);
    
    if (result.success) {
      res.json({
        success: true,
        data: result
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    console.error('Error getting component visibility status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get component visibility status'
    });
  }
});

/**
 * Hide component products from storefront
 */
router.post('/hide', async (req, res) => {
  try {
    const { componentIds } = req.body;
    
    if (!componentIds || !Array.isArray(componentIds)) {
      return res.status(400).json({
        success: false,
        error: 'componentIds array is required'
      });
    }
    
    const result = await componentVisibilityService.hideComponentProducts(componentIds);
    
    if (result.success) {
      res.json({
        success: true,
        message: `Hidden ${result.hiddenCount} component products`,
        data: result
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    console.error('Error hiding component products:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to hide component products'
    });
  }
});

/**
 * Show component products on storefront
 */
router.post('/show', async (req, res) => {
  try {
    const { componentIds } = req.body;
    
    if (!componentIds || !Array.isArray(componentIds)) {
      return res.status(400).json({
        success: false,
        error: 'componentIds array is required'
      });
    }
    
    const result = await componentVisibilityService.showComponentProducts(componentIds);
    
    if (result.success) {
      res.json({
        success: true,
        message: `Made visible ${result.visibleCount} component products`,
        data: result
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    console.error('Error showing component products:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to show component products'
    });
  }
});

/**
 * Hide all component products across the store
 */
router.post('/hide-all', async (req, res) => {
  try {
    const result = await componentVisibilityService.hideAllComponentProducts();
    
    if (result.success) {
      res.json({
        success: true,
        message: result.message,
        hiddenCount: result.hiddenCount,
        totalFound: result.totalFound
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    console.error('Error hiding all component products:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to hide all component products'
    });
  }
});

/**
 * Bulk update component visibility
 */
router.post('/bulk-update', async (req, res) => {
  try {
    const { componentIds, visible } = req.body;
    
    if (!componentIds || !Array.isArray(componentIds)) {
      return res.status(400).json({
        success: false,
        error: 'componentIds array is required'
      });
    }
    
    if (typeof visible !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'visible boolean is required'
      });
    }
    
    const result = await componentVisibilityService.bulkUpdateComponentVisibility(componentIds, visible);
    
    if (result.success) {
      const action = visible ? 'made visible' : 'hidden';
      const count = visible ? result.visibleCount : result.hiddenCount;
      
      res.json({
        success: true,
        message: `Successfully ${action} ${count} component products`,
        data: result
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    console.error('Error in bulk visibility update:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update component visibility'
    });
  }
});

module.exports = router;

