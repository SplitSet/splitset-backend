const express = require('express');
const router = express.Router();
const themeInstallerService = require('../services/themeInstallerService');

/**
 * Install bundle display components in the active theme
 */
router.post('/install-bundle-display', async (req, res) => {
  try {
    console.log('📦 Installing bundle display in theme...');
    
    const result = await themeInstallerService.installBundleDisplay();
    
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
router.post('/uninstall-bundle-display', async (req, res) => {
  try {
    console.log('🗑️ Uninstalling bundle display from theme...');
    
    const result = await themeInstallerService.uninstallBundleDisplay();
    
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
router.get('/check-installation', async (req, res) => {
  try {
    const activeTheme = await themeInstallerService.getActiveTheme();
    
    if (!activeTheme) {
      return res.json({
        installed: false,
        message: 'No active theme found'
      });
    }

    // Check if snippet exists
    let snippetExists = false;
    try {
      const axios = require('axios');
      const response = await axios.get(
        `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2023-10/themes/${activeTheme.id}/assets.json?asset[key]=snippets/bundle-display.liquid`,
        {
          headers: {
            'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
            'Content-Type': 'application/json'
          }
        }
      );
      snippetExists = !!response.data.asset;
    } catch (error) {
      snippetExists = false;
    }

    res.json({
      installed: snippetExists,
      theme: activeTheme.name,
      message: snippetExists ? 'Bundle display is installed' : 'Bundle display is not installed'
    });
  } catch (error) {
    console.error('Error checking installation:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
