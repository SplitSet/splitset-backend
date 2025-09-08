const express = require('express');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 5000;

console.log('🔍 DEBUGGING SPLITSET DEPLOYMENT');
console.log('================================');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('PORT:', process.env.PORT);
console.log('DATABASE_URL exists:', !!process.env.DATABASE_URL);
console.log('DATABASE_URL preview:', process.env.DATABASE_URL ? process.env.DATABASE_URL.substring(0, 30) + '...' : 'NOT SET');

// Test database connection
async function testDatabase() {
  try {
    console.log('📊 Testing database connection...');
    const db = require('./db');
    
    // Test basic connection
    await db.raw('SELECT 1+1 as result');
    console.log('✅ Database connection successful!');
    
    // Test migration
    console.log('📋 Testing migration...');
    await db.migrate.latest();
    console.log('✅ Migration successful!');
    
    return true;
  } catch (error) {
    console.error('❌ Database error:', error.message);
    console.error('Full error:', error);
    return false;
  }
}

// Simple health endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'SplitSet Debug Server Running',
    timestamp: new Date().toISOString()
  });
});

app.get('/debug', async (req, res) => {
  const dbStatus = await testDatabase();
  res.json({
    status: 'debug',
    environment: {
      NODE_ENV: process.env.NODE_ENV,
      PORT: process.env.PORT,
      DATABASE_URL_SET: !!process.env.DATABASE_URL
    },
    database: {
      connected: dbStatus
    },
    timestamp: new Date().toISOString()
  });
});

// Start server
const startServer = async () => {
  try {
    console.log('🚀 Starting debug server...');
    
    // Test database first
    const dbOk = await testDatabase();
    if (!dbOk) {
      console.log('⚠️  Database issues detected, but continuing...');
    }
    
    const server = app.listen(PORT, () => {
      console.log('✅ SplitSet Debug Server running on port', PORT);
      console.log('🔗 Health check: /health');
      console.log('🔍 Debug info: /debug');
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('Shutting down gracefully...');
      server.close(() => {
        process.exit(0);
      });
    });

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
