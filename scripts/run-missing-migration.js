#!/usr/bin/env node

/**
 * Manual migration runner for 007_create_admin_tracking.js
 * This script manually runs the missing migration that Render deployment can't find
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const db = require('../db');

async function runMissingMigration() {
  console.log('🔧 Manual Migration Runner - 007_create_admin_tracking.js');
  console.log('');
  
  try {
    console.log('📊 Checking current migration status...');
    
    // Check if migration has already been run
    const migrations = await db('knex_migrations')
      .where('name', '007_create_admin_tracking.js')
      .first();
    
    if (migrations) {
      console.log('✅ Migration 007_create_admin_tracking.js already exists');
      console.log('   No action needed.');
      process.exit(0);
    }
    
    console.log('⚠️  Migration 007_create_admin_tracking.js not found in database');
    console.log('🔨 Running migration manually...');
    
    // Run the migration manually
    const migrationContent = require('../migrations/007_create_admin_tracking.js');
    
    console.log('📝 Executing migration up() function...');
    await migrationContent.up(db);
    
    console.log('📋 Recording migration in knex_migrations table...');
    await db('knex_migrations').insert({
      name: '007_create_admin_tracking.js',
      batch: await getNextBatch(),
      migration_time: new Date()
    });
    
    console.log('✅ Migration 007_create_admin_tracking.js completed successfully!');
    console.log('');
    console.log('📊 Tables created:');
    console.log('   - split_products');
    console.log('   - products'); 
    console.log('   - orders');
    console.log('   - order_line_items');
    console.log('   - admin_sessions');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('');
    console.error('Full error:', error);
    process.exit(1);
  } finally {
    await db.destroy();
  }
}

async function getNextBatch() {
  const result = await db('knex_migrations')
    .max('batch as max_batch')
    .first();
  
  return (result.max_batch || 0) + 1;
}

// Run if called directly
if (require.main === module) {
  runMissingMigration();
}

module.exports = runMissingMigration;
