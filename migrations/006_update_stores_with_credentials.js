exports.up = function(knex) {
  return knex.schema.alterTable('stores', function(table) {
    // Add encrypted Shopify credentials
    table.text('shopify_app_id_encrypted').nullable();
    table.text('shopify_app_secret_encrypted').nullable();
    table.text('shopify_webhook_secret_encrypted').nullable();
    
    // Add store configuration
    table.string('plan').defaultTo('basic'); // basic, premium, enterprise
    table.integer('monthly_order_limit').defaultTo(1000);
    table.decimal('monthly_rate_rupees', 8, 2).defaultTo(9.00);
    
    // Add billing info
    table.date('billing_cycle_start').nullable();
    table.date('billing_cycle_end').nullable();
    table.integer('current_month_orders').defaultTo(0);
    table.decimal('current_month_charges', 10, 2).defaultTo(0);
    
    // Add store settings
    table.boolean('auto_tag_products').defaultTo(true);
    table.boolean('analytics_enabled').defaultTo(true);
    table.integer('analytics_refresh_minutes').defaultTo(30);
    
    // Indexes
    table.index(['plan']);
    table.index(['billing_cycle_start', 'billing_cycle_end']);
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('stores', function(table) {
    table.dropColumn('shopify_app_id_encrypted');
    table.dropColumn('shopify_app_secret_encrypted');
    table.dropColumn('shopify_webhook_secret_encrypted');
    table.dropColumn('plan');
    table.dropColumn('monthly_order_limit');
    table.dropColumn('monthly_rate_rupees');
    table.dropColumn('billing_cycle_start');
    table.dropColumn('billing_cycle_end');
    table.dropColumn('current_month_orders');
    table.dropColumn('current_month_charges');
    table.dropColumn('auto_tag_products');
    table.dropColumn('analytics_enabled');
    table.dropColumn('analytics_refresh_minutes');
  });
};
