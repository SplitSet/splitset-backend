const express = require('express');
const router = express.Router();
const setProcessorService = require('../services/setProcessorService');
const { authenticate, requireStoreAccess } = require('../middleware/auth');
const ShopifyServiceV2 = require('../services/shopifyServiceV2');

// Process a single set product (store-specific)
router.post('/:storeId/process/:productId',
  authenticate,
  requireStoreAccess('manager'),
  async (req, res) => {
    try {
      const { storeId, productId } = req.params;
      
      if (!productId) {
        return res.status(400).json({
          success: false,
          error: 'Product ID is required'
        });
      }

      console.log(`Processing set product with ID: ${productId} for store: ${storeId}`);
      
      const result = await setProcessorService.processSetProduct(productId, storeId);
    
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
router.get('/:storeId/find-all', 
  authenticate,
  requireStoreAccess('viewer'),
  async (req, res) => {
    try {
      console.log('Finding all set products...');
      
      // Get the store ID from the URL parameter
      const { storeId } = req.params;
      if (!storeId) {
        return res.status(400).json({
          success: false,
          error: 'Store ID is required'
        });
      }
      
      // Create Shopify service for this store
      console.log(`Creating Shopify service for store ${storeId}...`);
      const shopifyService = await ShopifyServiceV2.create(storeId);
      console.log(`Service created, shop domain: ${shopifyService.shopDomain}`);
      
      // Get pagination parameters from query
      const page = parseInt(req.query.page) || 1;
      const limit = 250; // Shopify's max limit
      
      console.log(`Fetching products page ${page} to find sets...`);
      const result = await shopifyService.getProducts(limit, req.query.pageInfo);
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch products');
      }
      
      // Enhanced filter for set products with multiple search terms
      const setKeywords = ['set', 'bundle', 'group', 'piece', 'coord'];
      const setProducts = result.data.filter(product => {
        if (!product.title) return false;
        
        const title = product.title.toLowerCase();
        
        // Check for " - " (dash separator)
        const hasDash = title.includes(' - ');
        
        // Check for set-related keywords
        const hasSetKeyword = setKeywords.some(keyword => 
          title.includes(keyword)
        );
        
        // Check for number + "piece" pattern (e.g., "3 piece", "two piece")
        const hasPiecePattern = /(\d+|two|three|four|five|six|seven|eight|nine|ten)\s+piece/i.test(title);
        
        return hasDash || hasSetKeyword || hasPiecePattern;
      });
      
      console.log(`Found ${setProducts.length} set products out of ${result.data.length} total products on page ${page}`);
      
      res.json({
        success: true,
        data: {
          setProducts: setProducts.map((product) => ({
            id: product.id,
            title: product.title,
            handle: product.handle,
            status: product.status,
            price: product.variants[0]?.price,
            variants: product.variants?.length || 0,
            tags: product.tags,
            createdAt: product.created_at,
            updatedAt: product.updated_at,
            isProcessed: false,
            estimatedPieces: setProcessorService.parsePieceCount(product)
          })),
          count: setProducts.length,
          pagination: {
            currentPage: page,
            hasNext: result.pagination?.hasNext || false,
            nextPageInfo: result.pagination?.nextPageInfo || null,
            totalFetched: result.data.length
          },
          summary: {
            totalProducts: setProducts.length,
            totalVariants: setProducts.reduce((sum, product) => sum + (product.variants?.length || 0), 0),
            searchTerms: setKeywords,
            filterCriteria: ['Products with " - " in title', 'Products containing: ' + setKeywords.join(', '), 'Products with number + "piece" pattern']
          }
        }
      });

  } catch (error) {
    console.error('Error finding set products:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Process all set products (use with caution)
router.post('/:storeId/process-all',
  authenticate,
  requireStoreAccess('manager'),
  async (req, res) => {
    try {
      const { storeId } = req.params;
      const { confirmProcessAll } = req.body;
    
    if (!confirmProcessAll) {
      return res.status(400).json({
        success: false,
        error: 'Please confirm by setting confirmProcessAll to true. This will process ALL set products.'
      });
    }

    console.log('Processing ALL set products...');
    
    const result = await setProcessorService.processAllSetProducts(storeId);
    
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
router.get('/:storeId/check/:productId',
  authenticate,
  requireStoreAccess('viewer'),
  async (req, res) => {
    try {
      const { storeId, productId } = req.params;
      
      console.log(`Checking product ${productId} for store ${storeId}...`);
      
      // Create Shopify service for this store
      const shopifyService = await ShopifyServiceV2.create(storeId);
      const productResult = await shopifyService.getProduct(productId);
      
      if (!productResult.success) {
        return res.status(404).json({
          success: false,
          error: 'Product not found'
        });
      }

      const product = productResult.data;
      const isSet = setProcessorService.isSetProduct(product);
      const isProcessed = await setProcessorService.isAlreadyProcessed(product, null, storeId);
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
            message: 'Product does not appear to be a set product based on our analysis'
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
  }
);

// Get bundle configuration for a processed set product
router.get('/:storeId/bundle-config/:productId',
  authenticate,
  requireStoreAccess('viewer'),
  async (req, res) => {
    try {
      const { storeId, productId } = req.params;
      
      const shopifyService = await ShopifyServiceV2.create(storeId);
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
          'GET /api/sets/:storeId/find-all - Find all set products',
          'GET /api/sets/:storeId/check/:productId - Check if product is a set',
          'POST /api/sets/:storeId/process/:productId - Process single set product',
          'POST /api/sets/:storeId/process-all - Process all set products',
          'GET /api/sets/:storeId/bundle-config/:productId - Get bundle config'
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
