const express = require('express');
const router = express.Router();
const metafieldDefinitionService = require('../services/metafieldDefinitionService');
const metafieldUpdateService = require('../services/metafieldUpdateService');

/**
 * Create metafield definitions for storefront access
 */
router.post('/create-definitions', async (req, res) => {
  try {
    console.log('📦 Creating metafield definitions...');
    
    const result = await metafieldDefinitionService.createBundleMetafieldDefinitions();
    
    res.json({
      success: true,
      message: 'Metafield definitions created successfully',
      data: result
    });
  } catch (error) {
    console.error('Error creating definitions:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Make existing metafields storefront visible
 */
router.post('/make-visible', async (req, res) => {
  try {
    console.log('👁️ Making metafields storefront visible...');
    
    const result = await metafieldDefinitionService.makeMetafieldsStorefrontVisible();
    
    res.json({
      success: true,
      message: 'Metafields are now storefront visible',
      data: result
    });
  } catch (error) {
    console.error('Error updating visibility:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Force update metafields on a product
 */
router.post('/force-update/:productId', async (req, res) => {
  try {
    const { productId } = req.params;
    console.log(`🔄 Force updating metafields for product ${productId}...`);
    
    const result = await metafieldUpdateService.forceUpdateBundleMetafields(productId);
    
    res.json({
      success: true,
      message: 'Metafields force updated successfully',
      data: result
    });
  } catch (error) {
    console.error('Error force updating metafields:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
