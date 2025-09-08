const express = require('express');
const router = express.Router();
const bundleTemplateService = require('../services/bundleTemplateService');

/**
 * Create bundle product template
 */
router.post('/create-bundle-template', async (req, res) => {
  try {
    console.log('📦 Creating bundle product template...');
    
    const result = await bundleTemplateService.createBundleTemplate();
    
    res.json({
      success: true,
      message: 'Bundle template created successfully',
      data: result
    });
  } catch (error) {
    console.error('Error creating bundle template:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Update product to use bundle template
 */
router.post('/assign-template/:productId', async (req, res) => {
  try {
    const { productId } = req.params;
    const { templateSuffix = 'bundle' } = req.body;
    
    console.log(`Assigning template product.${templateSuffix} to product ${productId}`);
    
    const product = await bundleTemplateService.updateProductTemplate(productId, templateSuffix);
    
    res.json({
      success: true,
      message: `Product now uses template: product.${templateSuffix}`,
      data: {
        productId: product.id,
        title: product.title,
        template: `product.${templateSuffix}`
      }
    });
  } catch (error) {
    console.error('Error assigning template:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
