exports.up = function(knex) {
  return knex.schema.createTable('analytics_daily', function(table) {
    table.increments('id').primary();
    table.integer('store_id').unsigned().references('id').inTable('stores').onDelete('CASCADE');
    table.date('date').notNullable();
    table.integer('splitter_orders_count').defaultTo(0);
    table.integer('splitter_items_count').defaultTo(0);
    table.decimal('splitter_revenue_rupees', 10, 2).defaultTo(0);
    table.json('metadata').nullable(); // Additional metrics
    table.timestamps(true, true);
    
    table.unique(['store_id', 'date']);
    table.index(['store_id', 'date']);
    table.index(['date']);
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('analytics_daily');
};
