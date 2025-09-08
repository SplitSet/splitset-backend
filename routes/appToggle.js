const express = require('express');
const router = express.Router();
const appToggleService = require('../services/appToggleService');

/**
 * Get app activation status
 */
router.get('/status', async (req, res) => {
  try {
    const result = await appToggleService.getAppStatus();
    
    if (result.success) {
      res.json({
        success: true,
        data: result.data
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    console.error('Error getting app status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get app status'
    });
  }
});

/**
 * Activate the bundle app
 */
router.post('/activate', async (req, res) => {
  try {
    console.log('Activating bundle app...');
    
    const result = await appToggleService.activateApp();
    
    if (result.success) {
      res.json({
        success: true,
        message: result.message,
        details: result.details
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    console.error('Error activating app:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to activate app'
    });
  }
});

/**
 * Deactivate the bundle app
 */
router.post('/deactivate', async (req, res) => {
  try {
    console.log('Deactivating bundle app...');
    
    const result = await appToggleService.deactivateApp();
    
    if (result.success) {
      res.json({
        success: true,
        message: result.message,
        details: result.details
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    console.error('Error deactivating app:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to deactivate app'
    });
  }
});

/**
 * Toggle app status (activate if inactive, deactivate if active)
 */
router.post('/toggle', async (req, res) => {
  try {
    console.log('Toggling app status...');
    
    // Get current status
    const statusResult = await appToggleService.getAppStatus();
    if (!statusResult.success) {
      return res.status(500).json({
        success: false,
        error: 'Failed to get current app status'
      });
    }
    
    const isCurrentlyActive = statusResult.data.active;
    
    // Toggle the status
    const result = isCurrentlyActive 
      ? await appToggleService.deactivateApp()
      : await appToggleService.activateApp();
    
    if (result.success) {
      res.json({
        success: true,
        message: result.message,
        previousStatus: isCurrentlyActive ? 'active' : 'inactive',
        newStatus: isCurrentlyActive ? 'inactive' : 'active',
        details: result.details
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    console.error('Error toggling app:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to toggle app status'
    });
  }
});

module.exports = router;

