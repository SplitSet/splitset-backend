#!/usr/bin/env node

/**
 * Debug Deployment Script
 * This script helps diagnose file deployment issues on Render
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 DEPLOYMENT DIAGNOSTIC');
console.log('========================\n');

// 1. Check current working directory
console.log('📁 Current Working Directory:');
console.log(`   ${process.cwd()}\n`);

// 2. Check if migrations directory exists
const migrationsDir = path.join(process.cwd(), 'migrations');
console.log('📂 Migrations Directory:');
if (fs.existsSync(migrationsDir)) {
  console.log('   ✅ EXISTS');
  
  // List all files in migrations
  const files = fs.readdirSync(migrationsDir);
  console.log(`   📄 Found ${files.length} files:`);
  files.forEach(file => {
    const filePath = path.join(migrationsDir, file);
    const stats = fs.statSync(filePath);
    console.log(`      - ${file} (${stats.size} bytes)`);
  });
  
  // Check specifically for the missing files
  const requiredFiles = [
    '007_create_admin_tracking.js',
    '008_consolidated_schema.js'
  ];
  
  console.log('\n   🎯 Required Files Check:');
  requiredFiles.forEach(file => {
    const exists = files.includes(file);
    console.log(`      ${exists ? '✅' : '❌'} ${file}`);
  });
  
} else {
  console.log('   ❌ MISSING');
}

// 3. Check package.json
console.log('\n📦 Package.json:');
const packagePath = path.join(process.cwd(), 'package.json');
if (fs.existsSync(packagePath)) {
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  console.log(`   ✅ EXISTS`);
  console.log(`   📝 Name: ${pkg.name}`);
  console.log(`   📝 Version: ${pkg.version}`);
  console.log(`   📝 Start Script: ${pkg.scripts.start}`);
} else {
  console.log('   ❌ MISSING');
}

// 4. Check server files
console.log('\n🖥️  Server Files:');
const serverFiles = ['server.js', 'serverV2.js', 'server-production.js'];
serverFiles.forEach(file => {
  const exists = fs.existsSync(path.join(process.cwd(), file));
  console.log(`   ${exists ? '✅' : '❌'} ${file}`);
});

// 5. Check key directories
console.log('\n📁 Key Directories:');
const keyDirs = ['routes', 'services', 'middleware', 'utils'];
keyDirs.forEach(dir => {
  const exists = fs.existsSync(path.join(process.cwd(), dir));
  console.log(`   ${exists ? '✅' : '❌'} ${dir}/`);
});

// 6. Environment info
console.log('\n🌍 Environment:');
console.log(`   📝 NODE_ENV: ${process.env.NODE_ENV || 'undefined'}`);
console.log(`   📝 PORT: ${process.env.PORT || 'undefined'}`);
console.log(`   📝 PWD: ${process.env.PWD || 'undefined'}`);

console.log('\n✅ Diagnostic complete!');
console.log('If migration files are missing, this is a deployment sync issue.');
