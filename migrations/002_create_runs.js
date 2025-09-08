exports.up = function(knex) {
  return knex.schema.createTable('runs', function(table) {
    table.increments('id').primary();
    table.string('run_id').notNullable().unique(); // nanoid for external reference
    table.integer('store_id').unsigned().references('id').inTable('stores').onDelete('CASCADE');
    table.enum('type', ['analytics_refresh', 'product_split', 'bulk_operation']).notNullable();
    table.enum('status', ['pending', 'running', 'completed', 'failed', 'cancelled']).defaultTo('pending');
    table.json('input_params').nullable(); // Store request parameters
    table.json('stats').nullable(); // Store results/metrics
    table.text('error_message').nullable();
    table.timestamp('started_at').nullable();
    table.timestamp('finished_at').nullable();
    table.timestamps(true, true);
    
    table.index(['store_id', 'type']);
    table.index(['status']);
    table.index(['run_id']);
    table.index(['created_at']);
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('runs');
};
