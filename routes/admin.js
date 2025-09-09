const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate, requireAppOwner } = require('../middleware/auth');

// Apply authentication and admin access to all admin routes
router.use(authenticate);
router.use(requireAppOwner);

// Get daily metrics dashboard
router.get('/dashboard/metrics', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    // Get today's counts
    const todayMetrics = await db.raw(`
      SELECT 
        COUNT(DISTINCT sp.id) as products_split_today,
        COUNT(DISTINCT ol.order_id) as orders_today,
        SUM(CASE WHEN ol.quantity > 0 THEN ol.quantity ELSE 0 END) as total_quantity_today,
        SUM(CASE WHEN ol.price > 0 THEN ol.price * ol.quantity ELSE 0 END) as total_revenue_today,
        COUNT(DISTINCT s.id) as active_stores,
        SUM(CASE WHEN ol.quantity > 0 THEN ol.quantity ELSE 0 END) * 9 as splitset_revenue_today
      FROM stores s
      LEFT JOIN split_products sp ON s.id = sp.store_id AND date(sp.created_at) = ?
      LEFT JOIN order_line_items ol ON sp.product_id = ol.product_id AND date(ol.created_at) = ?
      WHERE s.status = 'active'
    `, [today, today]);

    // Get all-time metrics
    const allTimeMetrics = await db.raw(`
      SELECT 
        COUNT(DISTINCT sp.id) as total_products_split,
        COUNT(DISTINCT ol.order_id) as total_orders,
        SUM(CASE WHEN ol.quantity > 0 THEN ol.quantity ELSE 0 END) as total_quantity_all_time,
        SUM(CASE WHEN ol.price > 0 THEN ol.price * ol.quantity ELSE 0 END) as total_revenue_all_time,
        COUNT(DISTINCT s.id) as total_stores,
        SUM(CASE WHEN ol.quantity > 0 THEN ol.quantity ELSE 0 END) * 9 as splitset_revenue_all_time
      FROM stores s
      LEFT JOIN split_products sp ON s.id = sp.store_id
      LEFT JOIN order_line_items ol ON sp.product_id = ol.product_id
    `);

    // Get weekly trend (last 7 days)
    const weeklyTrend = await db.raw(`
      SELECT 
        date(sp.created_at) as date,
        COUNT(DISTINCT sp.id) as products_split,
        COUNT(DISTINCT ol.order_id) as orders
      FROM split_products sp
      LEFT JOIN order_line_items ol ON sp.product_id = ol.product_id AND date(ol.created_at) = date(sp.created_at)
      WHERE sp.created_at >= date('now', '-7 days')
      GROUP BY date(sp.created_at)
      ORDER BY date DESC
      LIMIT 7
    `);

    req.logger?.audit('Admin dashboard metrics accessed', {
      userId: req.user.id,
      metricsType: 'daily_overview'
    });

    res.json({
      success: true,
      data: {
        today: todayMetrics[0] || {},
        allTime: allTimeMetrics[0] || {},
        weeklyTrend: weeklyTrend || []
      }
    });

  } catch (error) {
    req.logger?.error('Failed to fetch admin dashboard metrics', {
      error: error.message
    });

    res.status(500).json({
      success: false,
      error: 'Failed to fetch dashboard metrics'
    });
  }
});

// Get all split products with store information
router.get('/products', async (req, res) => {
  try {
    const { page = 1, limit = 50, store, search } = req.query;
    const offset = (page - 1) * limit;

    let query = db('split_products as sp')
      .join('stores as s', 'sp.store_id', 's.id')
      .leftJoin('products as p', 'sp.product_id', 'p.shopify_id')
      .select(
        'sp.id',
        'sp.product_id',
        'sp.original_product_id',
        'sp.title',
        'sp.price',
        'sp.created_at',
        'sp.split_type',
        'sp.metadata',
        's.shop_domain',
        's.plan as store_plan',
        'p.handle as product_handle',
        'p.vendor',
        'p.product_type'
      )
      .orderBy('sp.created_at', 'desc');

    // Apply filters
    if (store) {
      query = query.where('s.shop_domain', 'like', `%${store}%`);
    }
    
    if (search) {
      query = query.where(function() {
        this.where('sp.title', 'like', `%${search}%`)
            .orWhere('s.shop_domain', 'like', `%${search}%`)
            .orWhere('p.vendor', 'like', `%${search}%`);
      });
    }

    // Get total count for pagination
    const totalQuery = query.clone().clearSelect().count('* as total');
    const [{ total }] = await totalQuery;

    // Get paginated results
    const products = await query.limit(limit).offset(offset);

    req.logger?.audit('Admin products list accessed', {
      userId: req.user.id,
      page,
      limit,
      filters: { store, search },
      resultCount: products.length
    });

    res.json({
      success: true,
      data: {
        products: products.map(product => ({
          ...product,
          metadata: product.metadata ? JSON.parse(product.metadata) : null,
          price: parseFloat(product.price || 0)
        })),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: parseInt(total),
          pages: Math.ceil(total / limit)
        }
      }
    });

  } catch (error) {
    req.logger?.error('Failed to fetch admin products', {
      error: error.message
    });

    res.status(500).json({
      success: false,
      error: 'Failed to fetch products'
    });
  }
});

// Get orders containing split products, grouped by store
router.get('/orders', async (req, res) => {
  try {
    const { page = 1, limit = 50, store, dateFrom, dateTo } = req.query;
    const offset = (page - 1) * limit;

    let query = db('order_line_items as oli')
      .join('split_products as sp', 'oli.product_id', 'sp.product_id')
      .join('stores as s', 'sp.store_id', 's.id')
      .join('orders as o', 'oli.order_id', 'o.shopify_id')
      .select(
        'o.id as order_id',
        'o.shopify_id',
        'o.order_number',
        'o.created_at as order_date',
        'o.total_price as order_total',
        'o.financial_status',
        'o.fulfillment_status',
        's.shop_domain',
        'sp.title as product_name',
        'sp.price as product_price',
        'oli.quantity',
        'oli.price as line_item_price',
        db.raw('(oli.price * oli.quantity) as line_total')
      )
      .orderBy('o.created_at', 'desc');

    // Apply filters
    if (store) {
      query = query.where('s.shop_domain', 'like', `%${store}%`);
    }
    
    if (dateFrom) {
      query = query.where('o.created_at', '>=', dateFrom);
    }
    
    if (dateTo) {
      query = query.where('o.created_at', '<=', dateTo);
    }

    // Get total count for pagination
    const totalQuery = query.clone().clearSelect().count('* as total');
    const [{ total }] = await totalQuery;

    // Get paginated results
    const orders = await query.limit(limit).offset(offset);

    // Group by store for better organization
    const ordersByStore = orders.reduce((acc, order) => {
      const store = order.shop_domain;
      if (!acc[store]) {
        acc[store] = {
          store_domain: store,
          orders: [],
          totals: {
            order_count: 0,
            total_quantity: 0,
            total_revenue: 0
          }
        };
      }
      
      acc[store].orders.push({
        ...order,
        product_price: parseFloat(order.product_price || 0),
        line_item_price: parseFloat(order.line_item_price || 0),
        line_total: parseFloat(order.line_total || 0),
        order_total: parseFloat(order.order_total || 0)
      });
      
      acc[store].totals.order_count++;
      acc[store].totals.total_quantity += parseInt(order.quantity || 0);
      acc[store].totals.total_revenue += parseFloat(order.line_total || 0);
      
      return acc;
    }, {});

    req.logger?.audit('Admin orders list accessed', {
      userId: req.user.id,
      page,
      limit,
      filters: { store, dateFrom, dateTo },
      resultCount: orders.length
    });

    res.json({
      success: true,
      data: {
        ordersByStore,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: parseInt(total),
          pages: Math.ceil(total / limit)
        }
      }
    });

  } catch (error) {
    req.logger?.error('Failed to fetch admin orders', {
      error: error.message
    });

    res.status(500).json({
      success: false,
      error: 'Failed to fetch orders'
    });
  }
});

// Get store performance summary
router.get('/stores/performance', async (req, res) => {
  try {
    const { period = '30' } = req.query; // days
    
    const storePerformance = await db.raw(`
      SELECT 
        s.shop_domain,
        s.plan,
        s.status,
        s.created_at as store_joined,
        COUNT(DISTINCT sp.id) as total_products_split,
        COUNT(DISTINCT oli.order_id) as total_orders,
        SUM(CASE WHEN oli.quantity > 0 THEN oli.quantity ELSE 0 END) as total_quantity_sold,
        SUM(CASE WHEN oli.price > 0 THEN oli.price * oli.quantity ELSE 0 END) as total_revenue,
        COUNT(DISTINCT date(sp.created_at)) as active_days,
        AVG(CASE WHEN oli.price > 0 THEN oli.price ELSE NULL END) as avg_product_price
      FROM stores s
      LEFT JOIN split_products sp ON s.id = sp.store_id AND sp.created_at >= date('now', '-' || ? || ' days')
      LEFT JOIN order_line_items oli ON sp.product_id = oli.product_id AND oli.created_at >= date('now', '-' || ? || ' days')
      WHERE s.status = 'active'
      GROUP BY s.id, s.shop_domain, s.plan, s.status, s.created_at
      ORDER BY total_revenue DESC, total_products_split DESC
    `, [period, period]);

    req.logger?.audit('Admin store performance accessed', {
      userId: req.user.id,
      period: `${period} days`,
      storeCount: storePerformance.length
    });

    res.json({
      success: true,
      data: {
        stores: storePerformance.map(store => ({
          ...store,
          total_revenue: parseFloat(store.total_revenue || 0),
          avg_product_price: parseFloat(store.avg_product_price || 0),
          total_products_split: parseInt(store.total_products_split || 0),
          total_orders: parseInt(store.total_orders || 0),
          total_quantity_sold: parseInt(store.total_quantity_sold || 0),
          active_days: parseInt(store.active_days || 0)
        })),
        period: parseInt(period)
      }
    });

  } catch (error) {
    req.logger?.error('Failed to fetch store performance', {
      error: error.message
    });

    res.status(500).json({
      success: false,
      error: 'Failed to fetch store performance'
    });
  }
});

module.exports = router;
