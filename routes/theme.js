const express = require('express');
const router = express.Router();
const themeInstallerService = require('../services/themeInstallerService');
const { authenticate, requireStoreAccess } = require('../middleware/auth');

/**
 * Install bundle display components in the active theme
 */
router.post('/:storeId/install-bundle-display', 
  authenticate,
  requireStoreAccess('manager'),
  async (req, res) => {
  try {
    const { storeId } = req.params;
    console.log(`📦 Installing bundle display in theme for store ${storeId}...`);
    
    const result = await themeInstallerService.installBundleDisplay(storeId);
    
    if (result.success) {
      res.json({
        success: true,
        message: result.message,
        details: {
          theme: result.theme,
          snippetInstalled: result.snippetInstalled,
          templateUpdated: result.templateUpdated
        }
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    console.error('Error installing bundle display:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Uninstall bundle display components from theme
 */
router.post('/:storeId/uninstall-bundle-display',
  authenticate,
  requireStoreAccess('manager'),
  async (req, res) => {
  try {
    const { storeId } = req.params;
    console.log(`🗑️ Uninstalling bundle display from theme for store ${storeId}...`);
    
    const result = await themeInstallerService.uninstallBundleDisplay(storeId);
    
    if (result.success) {
      res.json({
        success: true,
        message: result.message
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    console.error('Error uninstalling bundle display:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Check if bundle display is installed
 */
router.get('/:storeId/check-installation',
  authenticate,
  requireStoreAccess('viewer'),
  async (req, res) => {
  try {
    const { storeId } = req.params;
    const result = await themeInstallerService.checkInstallation(storeId);

    if (result.success) {
      res.json({
        installed: result.installed,
        theme: result.theme,
        message: result.message
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    console.error('Error checking installation:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
