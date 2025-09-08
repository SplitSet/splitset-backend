exports.up = function(knex) {
  return knex.schema.createTable('stores', function(table) {
    table.increments('id').primary();
    table.string('shop_domain').notNullable().unique();
    table.text('access_token_encrypted').notNullable();
    table.json('scopes').notNullable();
    table.enum('status', ['active', 'inactive', 'suspended']).defaultTo('active');
    table.json('metadata').nullable(); // Store additional config
    table.timestamps(true, true);
    
    table.index(['shop_domain']);
    table.index(['status']);
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('stores');
};
