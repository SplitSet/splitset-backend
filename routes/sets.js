const express = require('express');
const router = express.Router();
const setProcessorService = require('../services/setProcessorService');

// Process a single set product (for testing)
router.post('/process/:productId', async (req, res) => {
  try {
    const { productId } = req.params;
    
    if (!productId) {
      return res.status(400).json({
        success: false,
        error: 'Product ID is required'
      });
    }

    console.log(`Processing set product with ID: ${productId}`);
    
    const result = await setProcessorService.processSetProduct(productId);
    
    if (result.success) {
      res.json({
        success: true,
        message: `Successfully processed set product: ${result.data.originalProduct.title}`,
        data: {
          originalProduct: {
            id: result.data.originalProduct.id,
            title: result.data.originalProduct.title
          },
          componentProducts: result.data.componentProducts.map(comp => ({
            id: comp.id,
            title: comp.title,
            price: comp.variants[0].price
          })),
          pieceCount: result.data.pieceCount,
          priceSplit: result.data.priceSplit,
          totalOriginalPrice: result.data.totalOriginalPrice,
          bundleConfig: result.data.bundleConfig
        }
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error
      });
    }

  } catch (error) {
    console.error('Error in set processing route:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Find all set products in the store
router.get('/find-all', async (req, res) => {
  try {
    console.log('Finding all set products...');
    
    const result = await setProcessorService.findAllSetProducts();
    
    if (result.success) {
      res.json({
        success: true,
        data: {
          setProducts: result.data.map((product) => ({
            id: product.id,
            title: product.title,
            price: product.variants[0]?.price,
            isProcessed: false, // findAllSetProducts already filters out processed products
            estimatedPieces: setProcessorService.parsePieceCount(product)
          })),
          count: result.data.length
        }
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }

  } catch (error) {
    console.error('Error finding set products:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Process all set products (use with caution)
router.post('/process-all', async (req, res) => {
  try {
    const { confirmProcessAll } = req.body;
    
    if (!confirmProcessAll) {
      return res.status(400).json({
        success: false,
        error: 'Please confirm by setting confirmProcessAll to true. This will process ALL set products.'
      });
    }

    console.log('Processing ALL set products...');
    
    const result = await setProcessorService.processAllSetProducts();
    
    if (result.success) {
      res.json({
        success: true,
        message: `Successfully processed ${result.data.processedCount} set products (${result.data.failedCount} failed)`,
        data: result.data
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }

  } catch (error) {
    console.error('Error processing all set products:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Check if a product is a set product
router.get('/check/:productId', async (req, res) => {
  try {
    const { productId } = req.params;
    
    // Get product details
    const shopifyService = require('../services/shopifyService');
    const productResult = await shopifyService.getProduct(productId);
    
    if (!productResult.success) {
      return res.status(404).json({
        success: false,
        error: 'Product not found'
      });
    }

    const product = productResult.data;
    const isSet = setProcessorService.isSetProduct(product);
    const isProcessed = await setProcessorService.isAlreadyProcessed(product);
    const pieceCount = setProcessorService.parsePieceCount(product);
    
    if (isSet) {
      const priceSplit = setProcessorService.calculatePriceSplit(product.variants[0].price, pieceCount);
      const componentNames = setProcessorService.parseComponentNames(product);
      
      res.json({
        success: true,
        data: {
          productId: product.id,
          title: product.title,
          isSetProduct: isSet,
          isAlreadyProcessed: isProcessed,
          pieceCount,
          originalPrice: product.variants[0].price,
          proposedPriceSplit: priceSplit,
          componentNames: componentNames,
          detectedFromDescription: componentNames.length > 0 ? true : false
        }
      });
    } else {
      res.json({
        success: true,
        data: {
          productId: product.id,
          title: product.title,
          isSetProduct: false,
          message: 'Product does not contain "set" in the title'
        }
      });
    }

  } catch (error) {
    console.error('Error checking set product:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get bundle configuration for a processed set product
router.get('/bundle-config/:productId', async (req, res) => {
  try {
    const { productId } = req.params;
    
    const shopifyService = require('../services/shopifyService');
    const productResult = await shopifyService.getProduct(productId);
    
    if (!productResult.success) {
      return res.status(404).json({
        success: false,
        error: 'Product not found'
      });
    }

    const product = productResult.data;
    const bundleMetafield = product.metafields?.find(meta => 
      meta.namespace === 'bundle_app' && meta.key === 'bundle_config'
    );

    if (!bundleMetafield) {
      return res.status(404).json({
        success: false,
        error: 'Bundle configuration not found. Product may not be processed as a set.'
      });
    }

    const bundleConfig = JSON.parse(bundleMetafield.value);

    res.json({
      success: true,
      data: {
        originalProduct: {
          id: product.id,
          title: product.title
        },
        bundleConfig
      }
    });

  } catch (error) {
    console.error('Error getting bundle config:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Test endpoint to check service functionality
router.get('/test', async (req, res) => {
  try {
    res.json({
      success: true,
      message: 'Set Processor Service is running',
      data: {
        maxComponentPrice: setProcessorService.maxComponentPrice,
        defaultComponentNames: setProcessorService.defaultComponentNames,
        endpoints: [
          'GET /api/sets/find-all - Find all set products',
          'GET /api/sets/check/:productId - Check if product is a set',
          'POST /api/sets/process/:productId - Process single set product',
          'POST /api/sets/process-all - Process all set products',
          'GET /api/sets/bundle-config/:productId - Get bundle config'
        ]
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
