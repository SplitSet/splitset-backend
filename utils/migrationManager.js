/**
 * Robust Migration Manager
 * Handles migration issues gracefully while maintaining data integrity
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('./logger');

class MigrationManager {
  constructor(db) {
    this.db = db;
    this.migrationDir = path.join(__dirname, '..', 'migrations');
  }

  /**
   * Run migrations with comprehensive error handling
   */
  async runMigrations() {
    try {
      logger.info('Starting migration process...');
      
      // Check if migration directory exists
      if (!fs.existsSync(this.migrationDir)) {
        logger.error('Migration directory not found:', this.migrationDir);
        throw new Error('Migration directory missing from deployment');
      }

      // List available migration files
      const migrationFiles = this.getMigrationFiles();
      logger.info(`Found ${migrationFiles.length} migration files`);

      // Check database migration status
      const appliedMigrations = await this.getAppliedMigrations();
      logger.info(`Database has ${appliedMigrations.length} applied migrations`);

      // Run Knex migrations with detailed error handling
      await this.runKnexMigrations();
      
      logger.info('Migration process completed successfully');
      return true;

    } catch (error) {
      return this.handleMigrationError(error);
    }
  }

  /**
   * Get list of migration files from filesystem
   */
  getMigrationFiles() {
    try {
      return fs.readdirSync(this.migrationDir)
        .filter(file => file.endsWith('.js'))
        .sort();
    } catch (error) {
      logger.error('Cannot read migration directory:', error.message);
      return [];
    }
  }

  /**
   * Get applied migrations from database
   */
  async getAppliedMigrations() {
    try {
      const migrations = await this.db('knex_migrations')
        .select('name')
        .orderBy('id');
      return migrations.map(m => m.name);
    } catch (error) {
      logger.warn('Cannot check applied migrations:', error.message);
      return [];
    }
  }

  /**
   * Run Knex migrations with enhanced error reporting
   */
  async runKnexMigrations() {
    try {
      const [batchNo, migrations] = await this.db.migrate.latest();
      
      if (migrations.length === 0) {
        logger.info('No new migrations to run');
      } else {
        logger.info(`Applied ${migrations.length} migrations in batch ${batchNo}:`);
        migrations.forEach(migration => {
          logger.info(`  ✅ ${migration}`);
        });
      }
      
      return { batchNo, migrations };
    } catch (error) {
      // Enhanced error reporting
      this.logMigrationError(error);
      throw error;
    }
  }

  /**
   * Handle migration errors with detailed analysis
   */
  handleMigrationError(error) {
    logger.error('Migration failed:', error.message);

    // Analyze the error type
    if (error.message.includes('migration directory is corrupt')) {
      return this.handleCorruptMigrationDirectory(error);
    } else if (error.message.includes('ENOENT')) {
      return this.handleMissingFiles(error);
    } else if (error.message.includes('connect ECONNREFUSED')) {
      return this.handleDatabaseConnection(error);
    } else {
      return this.handleGenericError(error);
    }
  }

  /**
   * Handle corrupt migration directory error
   */
  handleCorruptMigrationDirectory(error) {
    logger.error('Migration directory corruption detected');
    
    // Extract missing files from error message
    const missingFiles = this.extractMissingFiles(error.message);
    logger.error('Missing migration files:', missingFiles);

    // Check if files exist on filesystem
    missingFiles.forEach(file => {
      const filePath = path.join(this.migrationDir, file);
      const exists = fs.existsSync(filePath);
      logger.error(`  ${file}: ${exists ? 'EXISTS on filesystem' : 'MISSING from filesystem'}`);
    });

    // Provide recovery suggestions
    logger.warn('Migration directory corruption recovery options:');
    logger.warn('1. Check deployment process - ensure all files are copied');
    logger.warn('2. Verify git repository includes all migration files');
    logger.warn('3. Run migrations manually after deployment');
    logger.warn('4. Use SKIP_AUTO_MIGRATIONS=true to bypass and run manually');

    // Don't crash the server - let it start without migrations
    logger.warn('Server will continue without running migrations');
    logger.warn('Run migrations manually when deployment issue is resolved');
    
    return false; // Indicate migration failed but don't crash
  }

  /**
   * Extract missing file names from error message
   */
  extractMissingFiles(errorMessage) {
    const matches = errorMessage.match(/following files are missing: (.+)/);
    if (matches && matches[1]) {
      return matches[1].split(', ').map(f => f.trim());
    }
    return [];
  }

  /**
   * Handle missing files error
   */
  handleMissingFiles(error) {
    logger.error('Migration files missing from deployment');
    logger.warn('This usually indicates a deployment configuration issue');
    logger.warn('Server will start without migrations - run them manually');
    return false;
  }

  /**
   * Handle database connection error
   */
  handleDatabaseConnection(error) {
    logger.error('Cannot connect to database for migrations');
    logger.error('Check DATABASE_URL configuration');
    throw error; // This should crash the server as DB is critical
  }

  /**
   * Handle generic migration error
   */
  handleGenericError(error) {
    logger.error('Unexpected migration error:', error.message);
    logger.error('Stack trace:', error.stack);
    logger.warn('Server will continue without migrations');
    return false;
  }

  /**
   * Log detailed migration error information
   */
  logMigrationError(error) {
    logger.error('=== MIGRATION ERROR DETAILS ===');
    logger.error('Error message:', error.message);
    logger.error('Error type:', error.constructor.name);
    
    // Log environment info
    logger.error('Environment:', process.env.NODE_ENV);
    logger.error('Migration directory:', this.migrationDir);
    logger.error('Database URL configured:', !!process.env.DATABASE_URL);
    
    // Log file system state
    const files = this.getMigrationFiles();
    logger.error('Available migration files:', files.length);
    files.forEach(file => logger.error(`  - ${file}`));
    
    logger.error('=== END MIGRATION ERROR DETAILS ===');
  }

  /**
   * Manually run a specific migration (for recovery)
   */
  async runSpecificMigration(migrationName) {
    try {
      logger.info(`Manually running migration: ${migrationName}`);
      
      const migrationPath = path.join(this.migrationDir, migrationName);
      if (!fs.existsSync(migrationPath)) {
        throw new Error(`Migration file not found: ${migrationName}`);
      }

      const migration = require(migrationPath);
      
      // Run the up function
      await migration.up(this.db);
      
      // Record in migrations table
      await this.db('knex_migrations').insert({
        name: migrationName,
        batch: await this.getNextBatch(),
        migration_time: new Date()
      });

      logger.info(`Successfully applied migration: ${migrationName}`);
      return true;

    } catch (error) {
      logger.error(`Failed to run migration ${migrationName}:`, error.message);
      throw error;
    }
  }

  /**
   * Get next migration batch number
   */
  async getNextBatch() {
    try {
      const result = await this.db('knex_migrations')
        .max('batch as max_batch')
        .first();
      return (result.max_batch || 0) + 1;
    } catch (error) {
      logger.warn('Could not determine next batch number:', error.message);
      return 1;
    }
  }
}

module.exports = MigrationManager;
