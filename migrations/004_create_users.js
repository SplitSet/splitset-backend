exports.up = function(knex) {
  return knex.schema.createTable('users', function(table) {
    table.increments('id').primary();
    table.string('email').notNullable().unique();
    table.string('password_hash').notNullable();
    table.string('first_name').notNullable();
    table.string('last_name').notNullable();
    table.enum('role', ['store_owner', 'admin', 'manager']).defaultTo('store_owner');
    table.enum('status', ['active', 'inactive', 'suspended']).defaultTo('active');
    table.timestamp('last_login_at').nullable();
    table.string('last_login_ip').nullable();
    table.integer('login_attempts').defaultTo(0);
    table.timestamp('locked_until').nullable();
    table.string('password_reset_token').nullable();
    table.timestamp('password_reset_expires').nullable();
    table.string('email_verification_token').nullable();
    table.boolean('email_verified').defaultTo(false);
    table.json('preferences').nullable(); // UI preferences, timezone, etc.
    table.timestamps(true, true);
    
    table.index(['email']);
    table.index(['status']);
    table.index(['role']);
    table.index(['password_reset_token']);
    table.index(['email_verification_token']);
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('users');
};
