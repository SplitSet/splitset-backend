/**
 * Consolidated Schema Migration
 * This migration ensures ALL required tables exist with correct schema
 * It's idempotent - safe to run multiple times
 */

exports.up = async function(knex) {
  console.log('🔧 Running consolidated schema migration...');
  
  // Helper function to safely create table if not exists
  async function createTableIfNotExists(tableName, schemaBuilder) {
    const exists = await knex.schema.hasTable(tableName);
    if (!exists) {
      console.log(`  Creating table: ${tableName}`);
      await knex.schema.createTable(tableName, schemaBuilder);
    } else {
      console.log(`  Table already exists: ${tableName} ✓`);
    }
  }

  // 1. Stores table
  await createTableIfNotExists('stores', (table) => {
    table.increments('id').primary();
    table.string('shop_domain').notNullable().unique();
    table.string('shop_name').nullable();
    table.string('email').nullable();
    table.string('owner_name').nullable();
    table.string('access_token', 512).nullable();
    table.string('shopify_api_key').nullable();
    table.string('shopify_api_secret').nullable();
    table.boolean('is_active').defaultTo(true);
    table.timestamp('installed_at').defaultTo(knex.fn.now());
    table.timestamp('uninstalled_at').nullable();
    table.timestamps(true, true);
  });

  // 2. Runs table
  await createTableIfNotExists('runs', (table) => {
    table.increments('id').primary();
    table.integer('store_id').unsigned().references('id').inTable('stores').onDelete('CASCADE');
    table.string('run_type').notNullable();
    table.string('status').notNullable();
    table.json('details').nullable();
    table.integer('products_processed').defaultTo(0);
    table.integer('sets_created').defaultTo(0);
    table.integer('errors_count').defaultTo(0);
    table.timestamp('started_at').defaultTo(knex.fn.now());
    table.timestamp('completed_at').nullable();
    table.timestamps(true, true);
    table.index(['store_id', 'status']);
    table.index(['run_type']);
  });

  // 3. Analytics Daily table
  await createTableIfNotExists('analytics_daily', (table) => {
    table.increments('id').primary();
    table.integer('store_id').unsigned().references('id').inTable('stores').onDelete('CASCADE');
    table.date('date').notNullable();
    table.integer('orders_count').defaultTo(0);
    table.decimal('revenue', 10, 2).defaultTo(0);
    table.integer('sets_sold').defaultTo(0);
    table.integer('individual_products_sold').defaultTo(0);
    table.decimal('average_order_value', 10, 2).defaultTo(0);
    table.json('top_products').nullable();
    table.json('hourly_distribution').nullable();
    table.timestamps(true, true);
    table.unique(['store_id', 'date']);
    table.index(['date']);
  });

  // 4. Users table
  await createTableIfNotExists('users', (table) => {
    table.increments('id').primary();
    table.string('email').notNullable().unique();
    table.string('password_hash').notNullable();
    table.string('first_name').nullable();
    table.string('last_name').nullable();
    table.string('role').defaultTo('store_owner');
    table.boolean('is_active').defaultTo(true);
    table.boolean('email_verified').defaultTo(false);
    table.string('verification_token').nullable();
    table.string('reset_token').nullable();
    table.timestamp('reset_token_expires').nullable();
    table.integer('login_attempts').defaultTo(0);
    table.timestamp('locked_until').nullable();
    table.timestamp('last_login').nullable();
    table.json('preferences').nullable();
    table.timestamps(true, true);
    table.index(['email']);
    table.index(['role']);
  });

  // 5. User Stores table
  await createTableIfNotExists('user_stores', (table) => {
    table.increments('id').primary();
    table.integer('user_id').unsigned().references('id').inTable('users').onDelete('CASCADE');
    table.integer('store_id').unsigned().references('id').inTable('stores').onDelete('CASCADE');
    table.string('role').defaultTo('owner');
    table.json('permissions').nullable();
    table.timestamp('granted_at').defaultTo(knex.fn.now());
    table.timestamps(true, true);
    table.unique(['user_id', 'store_id']);
    table.index(['user_id']);
    table.index(['store_id']);
  });

  // 6. Split Products table
  await createTableIfNotExists('split_products', (table) => {
    table.increments('id').primary();
    table.integer('store_id').unsigned().references('id').inTable('stores').onDelete('CASCADE');
    table.string('product_id').notNullable();
    table.string('original_product_id').nullable();
    table.string('title').notNullable();
    table.decimal('price', 10, 2).notNullable();
    table.string('split_type').defaultTo('manual');
    table.json('metadata').nullable();
    table.timestamps(true, true);
    table.index(['store_id', 'created_at']);
    table.index(['product_id']);
    table.index(['original_product_id']);
  });

  // 7. Products table
  await createTableIfNotExists('products', (table) => {
    table.increments('id').primary();
    table.integer('store_id').unsigned().references('id').inTable('stores').onDelete('CASCADE');
    table.string('shopify_id').notNullable();
    table.string('title').notNullable();
    table.string('handle').notNullable();
    table.string('vendor').nullable();
    table.string('product_type').nullable();
    table.decimal('price', 10, 2).nullable();
    table.text('description').nullable();
    table.json('images').nullable();
    table.json('variants').nullable();
    table.string('status').defaultTo('active');
    table.timestamps(true, true);
    table.unique(['store_id', 'shopify_id']);
    table.index(['store_id', 'status']);
    table.index(['handle']);
  });

  // 8. Orders table
  await createTableIfNotExists('orders', (table) => {
    table.increments('id').primary();
    table.integer('store_id').unsigned().references('id').inTable('stores').onDelete('CASCADE');
    table.string('shopify_id').notNullable();
    table.string('order_number').notNullable();
    table.decimal('total_price', 10, 2).notNullable();
    table.string('currency', 3).defaultTo('USD');
    table.string('financial_status').nullable();
    table.string('fulfillment_status').nullable();
    table.json('customer_info').nullable();
    table.timestamp('order_date').notNullable();
    table.timestamps(true, true);
    table.unique(['store_id', 'shopify_id']);
    table.index(['store_id', 'order_date']);
    table.index(['financial_status']);
  });

  // 9. Order Line Items table
  await createTableIfNotExists('order_line_items', (table) => {
    table.increments('id').primary();
    table.integer('order_id').unsigned().references('id').inTable('orders').onDelete('CASCADE');
    table.string('product_id').notNullable();
    table.string('variant_id').nullable();
    table.string('title').notNullable();
    table.integer('quantity').notNullable();
    table.decimal('price', 10, 2).notNullable();
    table.json('properties').nullable();
    table.timestamps(true, true);
    table.index(['order_id']);
    table.index(['product_id']);
    table.index(['created_at']);
  });

  // 10. Admin Sessions table
  await createTableIfNotExists('admin_sessions', (table) => {
    table.increments('id').primary();
    table.integer('user_id').unsigned().references('id').inTable('users').onDelete('CASCADE');
    table.string('session_id').notNullable();
    table.string('ip_address').nullable();
    table.string('user_agent').nullable();
    table.json('accessed_resources').nullable();
    table.timestamp('last_activity').defaultTo(knex.fn.now());
    table.timestamps(true, true);
    table.index(['user_id', 'session_id']);
    table.index(['last_activity']);
  });

  console.log('✅ Consolidated schema migration complete!');
};

exports.down = async function(knex) {
  console.log('⚠️  Rolling back consolidated schema...');
  
  // Drop tables in reverse order to respect foreign keys
  const tablesToDrop = [
    'admin_sessions',
    'order_line_items',
    'orders',
    'products',
    'split_products',
    'user_stores',
    'users',
    'analytics_daily',
    'runs',
    'stores'
  ];

  for (const table of tablesToDrop) {
    const exists = await knex.schema.hasTable(table);
    if (exists) {
      console.log(`  Dropping table: ${table}`);
      await knex.schema.dropTable(table);
    }
  }

  console.log('✅ Rollback complete');
};
