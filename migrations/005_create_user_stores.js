exports.up = function(knex) {
  return knex.schema.createTable('user_stores', function(table) {
    table.increments('id').primary();
    table.integer('user_id').unsigned().references('id').inTable('users').onDelete('CASCADE');
    table.integer('store_id').unsigned().references('id').inTable('stores').onDelete('CASCADE');
    table.enum('role', ['owner', 'admin', 'manager', 'viewer']).defaultTo('owner');
    table.enum('status', ['active', 'inactive']).defaultTo('active');
    table.json('permissions').nullable(); // Specific permissions override
    table.timestamp('granted_at').defaultTo(knex.fn.now());
    table.integer('granted_by').unsigned().references('id').inTable('users').nullable();
    table.timestamps(true, true);
    
    table.unique(['user_id', 'store_id']);
    table.index(['user_id']);
    table.index(['store_id']);
    table.index(['role']);
    table.index(['status']);
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('user_stores');
};
