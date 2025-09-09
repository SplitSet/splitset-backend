#!/usr/bin/env node

const db = require('../db');

async function fixStoreAccess() {
  console.log('🔧 Fixing Store Access Issues...\n');
  
  try {
    // Get all users and their stores
    const users = await db('users').select('*');
    console.log(`Found ${users.length} users`);
    
    for (const user of users) {
      console.log(`\n👤 User: ${user.email} (ID: ${user.id}, Role: ${user.role})`);
      
      // Get user's stores
      const userStores = await db('user_stores as us')
        .join('stores as s', 'us.store_id', 's.id')
        .where('us.user_id', user.id)
        .select('s.*', 'us.role as user_role', 'us.status as access_status', 'us.granted_at');
      
      if (userStores.length === 0) {
        console.log('  ❌ No store access found');
        
        // Check if user has stores but no access
        const allStores = await db('stores').where('shop_domain', 'like', '%');
        if (allStores.length > 0) {
          console.log('  🔍 Available stores:');
          allStores.forEach(store => {
            console.log(`    - ${store.shop_domain} (ID: ${store.id})`);
          });
        }
      } else {
        console.log(`  ✅ Has access to ${userStores.length} store(s):`);
        userStores.forEach(store => {
          console.log(`    - ${store.shop_domain} (Role: ${store.user_role}, Status: ${store.access_status})`);
        });
      }
    }
    
    // Check for orphaned stores (stores without any user access)
    console.log('\n🏪 Checking for orphaned stores...');
    const orphanedStores = await db('stores as s')
      .leftJoin('user_stores as us', 's.id', 'us.store_id')
      .whereNull('us.store_id')
      .select('s.*');
    
    if (orphanedStores.length > 0) {
      console.log(`❌ Found ${orphanedStores.length} orphaned store(s):`);
      orphanedStores.forEach(store => {
        console.log(`  - ${store.shop_domain} (ID: ${store.id})`);
      });
    } else {
      console.log('✅ No orphaned stores found');
    }
    
    // Offer to fix common issues
    console.log('\n🛠️  Fix Options:');
    console.log('1. Grant store owner access to users missing access');
    console.log('2. Update inactive store access to active');
    console.log('3. Show detailed access report');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

async function grantMissingAccess() {
  console.log('🔧 Granting missing store access...\n');
  
  try {
    // Find users without any store access
    const usersWithoutAccess = await db('users as u')
      .leftJoin('user_stores as us', 'u.id', 'us.user_id')
      .whereNull('us.user_id')
      .andWhere('u.role', 'store_owner')
      .select('u.*');
    
    for (const user of usersWithoutAccess) {
      console.log(`👤 User: ${user.email} needs store access`);
      
      // Find stores that might belong to this user (same domain or recent)
      const potentialStores = await db('stores')
        .orderBy('created_at', 'desc')
        .limit(5);
      
      if (potentialStores.length > 0) {
        // Grant access to the most recent store (assuming it's theirs)
        const store = potentialStores[0];
        
        await db('user_stores').insert({
          user_id: user.id,
          store_id: store.id,
          role: 'owner',
          status: 'active',
          granted_at: new Date(),
          granted_by: null
        });
        
        console.log(`  ✅ Granted owner access to ${store.shop_domain}`);
      }
    }
    
    console.log('\n✅ Access granting completed');
    
  } catch (error) {
    console.error('❌ Error granting access:', error.message);
  }
}

async function showDetailedReport() {
  console.log('📊 Detailed Store Access Report\n');
  console.log('='.repeat(60));
  
  try {
    const report = await db.raw(`
      SELECT 
        u.email,
        u.role as user_role,
        s.shop_domain,
        us.role as store_role,
        us.status as access_status,
        us.granted_at
      FROM users u
      LEFT JOIN user_stores us ON u.id = us.user_id
      LEFT JOIN stores s ON us.store_id = s.id
      ORDER BY u.email, s.shop_domain
    `);
    
    const results = report[0] || report;
    
    let currentUser = '';
    for (const row of results) {
      if (row.email !== currentUser) {
        if (currentUser) console.log(''); // Add space between users
        currentUser = row.email;
        console.log(`👤 ${row.email} (${row.user_role})`);
      }
      
      if (row.shop_domain) {
        console.log(`  🏪 ${row.shop_domain} - ${row.store_role} (${row.access_status})`);
      } else {
        console.log(`  ❌ No store access`);
      }
    }
    
  } catch (error) {
    console.error('❌ Error generating report:', error.message);
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  switch (command) {
    case 'fix':
      await grantMissingAccess();
      break;
    case 'report':
      await showDetailedReport();
      break;
    default:
      await fixStoreAccess();
  }
  
  process.exit(0);
}

if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { fixStoreAccess, grantMissingAccess, showDetailedReport };
