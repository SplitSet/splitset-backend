const express = require('express');
const router = express.Router();
const shopifyService = require('../services/shopifyService');

// Get all orders
router.get('/', async (req, res) => {
  try {
    const { limit = 50, status = 'any' } = req.query;
    const result = await shopifyService.getOrders(limit, status);
    
    if (result.success) {
      res.json({
        success: true,
        data: result.data
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get orders with bundle products
router.get('/bundles', async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const result = await shopifyService.getOrders(limit);
    
    if (result.success) {
      // Filter orders that contain bundle products
      const bundleOrders = result.data.filter(order => {
        return order.line_items.some(item => 
          item.properties && item.properties.some(prop => 
            prop.name === '_bundle_id' || prop.name === '_bundle_main' || prop.name === '_bundle_item'
          )
        );
      });

      // Process bundle orders to group bundle items
      const processedOrders = bundleOrders.map(order => {
        const bundles = {};
        const regularItems = [];

        order.line_items.forEach(item => {
          const bundleIdProp = item.properties?.find(p => p.name === '_bundle_id');
          const isBundleMain = item.properties?.some(p => p.name === '_bundle_main');
          const isBundleItem = item.properties?.some(p => p.name === '_bundle_item');

          if (bundleIdProp) {
            const bundleId = bundleIdProp.value;
            
            if (!bundles[bundleId]) {
              bundles[bundleId] = {
                bundleId,
                mainProduct: null,
                bundleItems: [],
                totalPrice: 0,
                totalQuantity: 0
              };
            }

            if (isBundleMain) {
              bundles[bundleId].mainProduct = item;
            } else if (isBundleItem) {
              bundles[bundleId].bundleItems.push(item);
            }

            bundles[bundleId].totalPrice += parseFloat(item.price) * item.quantity;
            bundles[bundleId].totalQuantity += item.quantity;
          } else {
            regularItems.push(item);
          }
        });

        return {
          ...order,
          bundles: Object.values(bundles),
          regularItems,
          hasBundles: Object.keys(bundles).length > 0
        };
      });

      res.json({
        success: true,
        data: processedOrders,
        totalBundleOrders: processedOrders.length
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get bundle analytics
router.get('/bundle-analytics', async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const result = await shopifyService.getOrders(250); // Get more orders for analytics
    
    if (result.success) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      // Filter orders within date range
      const recentOrders = result.data.filter(order => 
        new Date(order.created_at) >= cutoffDate
      );

      // Analyze bundle performance
      let totalOrders = recentOrders.length;
      let bundleOrders = 0;
      let totalBundleRevenue = 0;
      let totalRegularRevenue = 0;
      let bundleProductsSold = {};
      let upsellRevenue = 0;

      recentOrders.forEach(order => {
        let orderHasBundles = false;
        let orderBundleRevenue = 0;
        let orderRegularRevenue = 0;

        order.line_items.forEach(item => {
          const bundleIdProp = item.properties?.find(p => p.name === '_bundle_id');
          const isUpsell = item.properties?.some(p => p.name === '_is_upsell' && p.value === 'true');
          
          const itemRevenue = parseFloat(item.price) * item.quantity;

          if (bundleIdProp) {
            orderHasBundles = true;
            orderBundleRevenue += itemRevenue;
            
            // Track bundle products
            const productKey = `${item.product_id}-${item.variant_id}`;
            if (!bundleProductsSold[productKey]) {
              bundleProductsSold[productKey] = {
                productId: item.product_id,
                variantId: item.variant_id,
                title: item.title,
                quantity: 0,
                revenue: 0
              };
            }
            bundleProductsSold[productKey].quantity += item.quantity;
            bundleProductsSold[productKey].revenue += itemRevenue;

            if (isUpsell) {
              upsellRevenue += itemRevenue;
            }
          } else {
            orderRegularRevenue += itemRevenue;
          }
        });

        if (orderHasBundles) {
          bundleOrders++;
          totalBundleRevenue += orderBundleRevenue;
        }
        totalRegularRevenue += orderRegularRevenue;
      });

      // Calculate metrics
      const bundleConversionRate = totalOrders > 0 ? (bundleOrders / totalOrders * 100).toFixed(2) : 0;
      const averageBundleOrderValue = bundleOrders > 0 ? (totalBundleRevenue / bundleOrders).toFixed(2) : 0;
      const averageRegularOrderValue = (totalOrders - bundleOrders) > 0 ? 
        (totalRegularRevenue / (totalOrders - bundleOrders)).toFixed(2) : 0;

      res.json({
        success: true,
        data: {
          dateRange: {
            days,
            from: cutoffDate.toISOString(),
            to: new Date().toISOString()
          },
          overview: {
            totalOrders,
            bundleOrders,
            regularOrders: totalOrders - bundleOrders,
            bundleConversionRate: parseFloat(bundleConversionRate)
          },
          revenue: {
            totalBundleRevenue: parseFloat(totalBundleRevenue.toFixed(2)),
            totalRegularRevenue: parseFloat(totalRegularRevenue.toFixed(2)),
            upsellRevenue: parseFloat(upsellRevenue.toFixed(2)),
            totalRevenue: parseFloat((totalBundleRevenue + totalRegularRevenue).toFixed(2))
          },
          averageOrderValue: {
            bundle: parseFloat(averageBundleOrderValue),
            regular: parseFloat(averageRegularOrderValue),
            overall: totalOrders > 0 ? 
              parseFloat(((totalBundleRevenue + totalRegularRevenue) / totalOrders).toFixed(2)) : 0
          },
          topBundleProducts: Object.values(bundleProductsSold)
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 10)
        }
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
