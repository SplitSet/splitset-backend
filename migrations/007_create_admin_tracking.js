exports.up = function(knex) {
  return Promise.all([
    // Create split_products table to track all products created via the app
    knex.schema.createTable('split_products', function(table) {
      table.increments('id').primary();
      table.integer('store_id').unsigned().references('id').inTable('stores').onDelete('CASCADE');
      table.string('product_id').notNullable(); // Shopify product ID
      table.string('original_product_id').nullable(); // Original product this was split from
      table.string('title').notNullable();
      table.decimal('price', 10, 2).notNullable();
      table.string('split_type').defaultTo('manual'); // manual, auto, bulk
      table.json('metadata').nullable(); // Store additional split information
      table.timestamps(true, true);
      
      table.index(['store_id', 'created_at']);
      table.index(['product_id']);
      table.index(['original_product_id']);
    }),

    // Create products table to store Shopify product details
    knex.schema.createTable('products', function(table) {
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
    }),

    // Create orders table to track orders
    knex.schema.createTable('orders', function(table) {
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
    }),

    // Create order_line_items table to track individual line items
    knex.schema.createTable('order_line_items', function(table) {
      table.increments('id').primary();
      table.integer('order_id').unsigned().references('id').inTable('orders').onDelete('CASCADE');
      table.string('product_id').notNullable(); // Shopify product ID
      table.string('variant_id').nullable(); // Shopify variant ID
      table.string('title').notNullable();
      table.integer('quantity').notNullable();
      table.decimal('price', 10, 2).notNullable();
      table.json('properties').nullable(); // Line item properties
      table.timestamps(true, true);
      
      table.index(['order_id']);
      table.index(['product_id']);
      table.index(['created_at']);
    }),

    // Create admin_sessions table for enhanced session tracking
    knex.schema.createTable('admin_sessions', function(table) {
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
    })
  ]);
};

exports.down = function(knex) {
  return Promise.all([
    knex.schema.dropTableIfExists('admin_sessions'),
    knex.schema.dropTableIfExists('order_line_items'),
    knex.schema.dropTableIfExists('orders'),
    knex.schema.dropTableIfExists('products'),
    knex.schema.dropTableIfExists('split_products')
  ]);
};
