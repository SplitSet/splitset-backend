#!/usr/bin/env node

const db = require('../db');
const User = require('../models/User');

async function resetUserAccess() {
  console.log('🔧 Resetting User Access for dcgallerymumbai@gmail.com\n');
  
  try {
    const email = 'dcgallerymumbai@gmail.com';
    const newPassword = 'TempPass123!';
    
    // Find the user
    const user = await User.findByEmail(email);
    if (!user) {
      console.log('❌ User not found');
      return;
    }
    
    console.log(`👤 Found user: ${user.email} (ID: ${user.id})`);
    
    // Reset password
    await User.update(user.id, {
      password: newPassword
    });
    console.log('✅ Password reset to: TempPass123!');
    
    // Check store access
    const userStores = await User.getUserStores(user.id);
    console.log(`📊 User has access to ${userStores.length} store(s):`);
    
    userStores.forEach(store => {
      console.log(`  🏪 ${store.shop_domain} (Role: ${store.user_role}, Status: ${store.status})`);
    });
    
    // If no access, grant access to labeldc-estore.myshopify.com
    if (userStores.length === 0) {
      const store = await db('stores').where('shop_domain', 'labeldc-estore.myshopify.com').first();
      if (store) {
        await User.grantStoreAccess(user.id, store.id, 'owner');
        console.log('✅ Granted owner access to labeldc-estore.myshopify.com');
      }
    }
    
    // Clear any account locks
    await db('users').where('id', user.id).update({
      account_locked: false,
      locked_until: null,
      login_attempts: 0
    });
    console.log('✅ Cleared any account locks');
    
    console.log('\n🎉 User access reset complete!');
    console.log('📝 Login credentials:');
    console.log(`   Email: ${email}`);
    console.log(`   Password: ${newPassword}`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
  
  process.exit(0);
}

if (require.main === module) {
  resetUserAccess().catch(console.error);
}

module.exports = { resetUserAccess };
