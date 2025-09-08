const express = require('express');
const router = express.Router();
const analyticsService = require('../services/analyticsService');

// Get cached splitter summary
router.get('/splitter/summary', async (req, res) => {
  try {
    const cache = analyticsService.getCachedSummary();
    if (!cache.summary) {
      await analyticsService.refreshCache();
    }
    const current = analyticsService.getCachedSummary();
    res.json({ success: true, data: current });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Force refresh
router.post('/splitter/refresh', async (req, res) => {
  try {
    await analyticsService.refreshCache();
    const current = analyticsService.getCachedSummary();
    res.json({ success: true, data: current });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;


