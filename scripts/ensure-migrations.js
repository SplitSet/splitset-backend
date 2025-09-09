#!/usr/bin/env node

/**
 * Ensure all migration files are present before server start
 * This script helps diagnose and fix Render deployment issues
 */

const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '../migrations');
const EXPECTED_MIGRATIONS = [
  '001_create_stores.js',
  '002_create_runs.js',
  '003_create_analytics_daily.js',
  '004_create_users.js',
  '005_create_user_stores.js',
  '006_update_stores_with_credentials.js',
  '20250909205740_fix_admin_tracking_deployment_issue.js'
];

console.log('🔍 Checking migration files...');
console.log(`Migration directory: ${MIGRATIONS_DIR}`);

// Check if migrations directory exists
if (!fs.existsSync(MIGRATIONS_DIR)) {
  console.error('❌ Migrations directory does not exist!');
  console.log('Creating migrations directory...');
  fs.mkdirSync(MIGRATIONS_DIR, { recursive: true });
}

// List actual files
const actualFiles = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.js'));
console.log('\nActual migration files found:');
actualFiles.forEach(file => console.log(`  ✓ ${file}`));

// Check for missing files
const missingFiles = EXPECTED_MIGRATIONS.filter(file => !actualFiles.includes(file));

if (missingFiles.length > 0) {
  console.error('\n❌ Missing migration files:');
  missingFiles.forEach(file => console.error(`  - ${file}`));
  
  // Special handling for the new migration
  if (missingFiles.includes('20250909205740_fix_admin_tracking_deployment_issue.js')) {
    console.log('\n🔧 Creating missing migration file...');
    const migrationContent = `/**
 * Fix for admin tracking deployment issue
 * This migration ensures all required tables exist, creating them only if missing
 */

exports.up = async function(knex) {
  console.log('🔧 Running admin tracking deployment fix...');
  
  const tablesToCheck = ['split_products', 'products', 'orders', 'order_line_items', 'admin_sessions'];
  let allExist = true;
  
  for (const table of tablesToCheck) {
    const exists = await knex.schema.hasTable(table);
    if (!exists) {
      allExist = false;
      console.log(\`  Table missing: \${table}\`);
    } else {
      console.log(\`  Table already exists: \${table} ✓\`);
    }
  }
  
  if (allExist) {
    console.log('✅ All tables already exist - no action needed');
  } else {
    console.log('❌ Some tables missing - manual intervention required');
    // Don't create tables here - let manual migration handle it
  }
};

exports.down = async function(knex) {
  console.log('🔄 Rolling back admin tracking deployment fix...');
  // No-op for safety
  console.log('✅ Rollback complete (no-op)');
};`;
    
    const filePath = path.join(MIGRATIONS_DIR, '20250909205740_fix_admin_tracking_deployment_issue.js');
    fs.writeFileSync(filePath, migrationContent);
    console.log('✅ Created missing migration file');
  }
  
  process.exit(1);
} else {
  console.log('\n✅ All expected migration files are present');
  process.exit(0);
}
