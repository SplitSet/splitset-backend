#!/usr/bin/env node

/**
 * Complete Migration System Rebuild Script
 * This script completely rebuilds the migration system to fix deployment issues
 */

require('dotenv').config();
const db = require('../db');
const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '../migrations');

async function rebuildMigrations() {
  console.log('🔧 MIGRATION SYSTEM REBUILD');
  console.log('===========================\n');

  try {
    // Step 1: Analyze current state
    console.log('📊 Step 1: Analyzing current migration state...');
    
    const migrations = await db('knex_migrations')
      .select('*')
      .orderBy('batch', 'asc');
    
    console.log(`Found ${migrations.length} migration records in database:`);
    migrations.forEach(m => {
      console.log(`  - ${m.name} (batch ${m.batch})`);
    });

    // Step 2: Check physical files
    console.log('\n📁 Step 2: Checking physical migration files...');
    
    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.js') && !f.includes('backup'));
    
    console.log(`Found ${files.length} migration files on disk:`);
    files.forEach(f => {
      console.log(`  - ${f}`);
    });

    // Step 3: Identify mismatches
    console.log('\n🔍 Step 3: Identifying mismatches...');
    
    const dbMigrations = migrations.map(m => m.name);
    const orphanedRecords = dbMigrations.filter(m => !files.includes(m));
    const unrecordedFiles = files.filter(f => !dbMigrations.includes(f));
    
    if (orphanedRecords.length > 0) {
      console.log('❌ Orphaned database records (no file exists):');
      orphanedRecords.forEach(r => console.log(`  - ${r}`));
    }
    
    if (unrecordedFiles.length > 0) {
      console.log('⚠️  Unrecorded files (not in database):');
      unrecordedFiles.forEach(f => console.log(`  - ${f}`));
    }

    // Step 4: Fix the issues
    console.log('\n🛠️  Step 4: Applying fixes...');
    
    if (orphanedRecords.length > 0) {
      console.log('Removing orphaned migration records...');
      
      for (const orphan of orphanedRecords) {
        const deleted = await db('knex_migrations')
          .where('name', orphan)
          .del();
        console.log(`  ✅ Removed ${orphan} (${deleted} record)`);
      }
    }

    // Step 5: Verify all tables exist
    console.log('\n📋 Step 5: Verifying database tables...');
    
    const requiredTables = [
      'stores', 'runs', 'analytics_daily', 'users', 'user_stores',
      'split_products', 'products', 'orders', 'order_line_items', 'admin_sessions'
    ];
    
    for (const table of requiredTables) {
      const exists = await db.schema.hasTable(table);
      console.log(`  ${table}: ${exists ? '✅ EXISTS' : '❌ MISSING'}`);
    }

    // Step 6: Final state
    console.log('\n✨ Step 6: Final migration state...');
    
    const finalMigrations = await db('knex_migrations')
      .select('*')
      .orderBy('batch', 'asc');
    
    console.log('Clean migration records:');
    finalMigrations.forEach(m => {
      console.log(`  ✅ ${m.name}`);
    });

    console.log('\n🎉 MIGRATION REBUILD COMPLETE!');
    console.log('The migration system is now clean and ready for deployment.\n');

  } catch (error) {
    console.error('\n❌ Error during rebuild:', error.message);
    process.exit(1);
  } finally {
    await db.destroy();
  }
}

// Run if called directly
if (require.main === module) {
  rebuildMigrations();
}

module.exports = { rebuildMigrations };
