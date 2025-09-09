const db = require('../db');
const encryptionService = require('../utils/encryption');

class StoreV2 {
  static tableName = 'stores';

  static async findById(id) {
    return await db(this.tableName).where({ id }).first();
  }

  static async findByDomain(shopDomain) {
    return await db(this.tableName).where({ shop_domain: shopDomain }).first();
  }

  static async create(data) {
    const {
      shopDomain,
      accessToken,
      appId,
      appSecret,
      webhookSecret,
      scopes = [],
      plan = 'basic',
      metadata = {}
    } = data;
    
    // Encrypt Shopify credentials
    const encryptedCredentials = encryptionService.encryptShopifyCredentials({
      accessToken,
      appId,
      appSecret,
      webhookSecret
    });
    
    // Set billing cycle (monthly)
    const now = new Date();
    const billingStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const billingEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    
    const [id] = await db(this.tableName).insert({
      shop_domain: shopDomain,
      access_token_encrypted: encryptedCredentials.accessTokenEncrypted,
      shopify_app_id_encrypted: encryptedCredentials.appIdEncrypted,
      shopify_app_secret_encrypted: encryptedCredentials.appSecretEncrypted,
      shopify_webhook_secret_encrypted: encryptedCredentials.webhookSecretEncrypted,
      scopes: JSON.stringify(scopes),
      metadata: JSON.stringify(metadata),
      plan,
      billing_cycle_start: billingStart,
      billing_cycle_end: billingEnd,
      monthly_order_limit: this.getPlanLimit(plan),
      monthly_rate_rupees: this.getPlanRate(plan),
      status: 'active'
    });

    return await this.findById(id);
  }

  static async update(id, data) {
    const updateData = { ...data };
    
    // Handle credential updates
    if (data.accessToken || data.appId || data.appSecret || data.webhookSecret) {
      const store = await this.findById(id);
      if (!store) throw new Error('Store not found');
      
      // Get current credentials
      const currentCredentials = this.getDecryptedCredentials(store);
      
      // Update with new values
      const updatedCredentials = {
        accessToken: data.accessToken || currentCredentials.accessToken,
        appId: data.appId || currentCredentials.appId,
        appSecret: data.appSecret || currentCredentials.appSecret,
        webhookSecret: data.webhookSecret || currentCredentials.webhookSecret
      };
      
      // Re-encrypt
      const encryptedCredentials = encryptionService.encryptShopifyCredentials(updatedCredentials);
      
      updateData.access_token_encrypted = encryptedCredentials.accessTokenEncrypted;
      updateData.shopify_app_id_encrypted = encryptedCredentials.appIdEncrypted;
      updateData.shopify_app_secret_encrypted = encryptedCredentials.appSecretEncrypted;
      updateData.shopify_webhook_secret_encrypted = encryptedCredentials.webhookSecretEncrypted;
      
      // Remove plain text credentials
      delete updateData.accessToken;
      delete updateData.appId;
      delete updateData.appSecret;
      delete updateData.webhookSecret;
    }
    
    // Handle plan updates
    if (updateData.plan) {
      updateData.monthly_order_limit = this.getPlanLimit(updateData.plan);
      updateData.monthly_rate_rupees = this.getPlanRate(updateData.plan);
    }
    
    if (updateData.scopes) {
      updateData.scopes = JSON.stringify(updateData.scopes);
    }
    
    if (updateData.metadata) {
      updateData.metadata = JSON.stringify(updateData.metadata);
    }

    await db(this.tableName).where({ id }).update(updateData);
    return await this.findById(id);
  }

  // Get decrypted credentials for API calls
  static getDecryptedCredentials(store) {
    if (!store) return null;
    
    try {
      return encryptionService.decryptShopifyCredentials(store);
    } catch (error) {
      throw new Error(`Failed to decrypt credentials for store ${store.id}: ${error.message}`);
    }
  }

  // Get store with decrypted credentials (use carefully!)
  static async findByIdWithCredentials(id) {
    const store = await this.findById(id);
    if (!store) return null;
    
    const credentials = this.getDecryptedCredentials(store);
    
    return {
      ...store,
      credentials,
      // Remove encrypted fields from response
      access_token_encrypted: undefined,
      shopify_app_id_encrypted: undefined,
      shopify_app_secret_encrypted: undefined,
      shopify_webhook_secret_encrypted: undefined
    };
  }

  // Update billing for current month
  static async updateMonthlyBilling(storeId, orderCount, charges) {
    const store = await this.findById(storeId);
    if (!store) throw new Error('Store not found');
    
    // Check if we need to roll over to new billing cycle
    const now = new Date();
    const billingEnd = new Date(store.billing_cycle_end);
    
    let updateData = {
      current_month_orders: orderCount,
      current_month_charges: charges
    };
    
    if (now > billingEnd) {
      // Start new billing cycle
      const newStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const newEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      
      updateData = {
        ...updateData,
        billing_cycle_start: newStart,
        billing_cycle_end: newEnd,
        current_month_orders: orderCount,
        current_month_charges: charges
      };
    }
    
    await db(this.tableName).where({ id: storeId }).update(updateData);
    return await this.findById(storeId);
  }

  // Check if store is within usage limits
  static async checkUsageLimits(storeId) {
    const store = await this.findById(storeId);
    if (!store) return { withinLimits: false, error: 'Store not found' };
    
    const currentOrders = store.current_month_orders || 0;
    const monthlyLimit = store.monthly_order_limit || 1000;
    
    return {
      withinLimits: currentOrders < monthlyLimit,
      currentUsage: currentOrders,
      monthlyLimit,
      percentageUsed: (currentOrders / monthlyLimit) * 100,
      ordersRemaining: monthlyLimit - currentOrders
    };
  }

  static getPlanLimit(plan) {
    const limits = {
      basic: 1000,
      premium: 5000,
      enterprise: 25000
    };
    return limits[plan] || limits.basic;
  }

  static getPlanRate(plan) {
    const rates = {
      basic: 9.00,
      premium: 7.00,
      enterprise: 5.00
    };
    return rates[plan] || rates.basic;
  }

  static async list(filters = {}) {
    let query = db(this.tableName);
    
    if (filters.status) {
      query = query.where({ status: filters.status });
    }
    
    if (filters.plan) {
      query = query.where({ plan: filters.plan });
    }
    
    if (filters.userId) {
      // Join with user_stores to filter by user access
      query = query
        .join('user_stores as us', 'stores.id', 'us.store_id')
        .where('us.user_id', filters.userId)
        .where('us.status', 'active');
    }

    const stores = await query
      .select(
        'stores.*',
        ...(filters.userId ? ['us.role as user_role', 'us.permissions as user_permissions'] : [])
      )
      .orderBy('stores.created_at', 'desc');

    // Remove encrypted fields from response
    return stores.map(store => ({
      ...store,
      scopes: JSON.parse(store.scopes || '[]'),
      metadata: JSON.parse(store.metadata || '{}'),
      access_token_encrypted: undefined,
      shopify_app_id_encrypted: undefined,
      shopify_app_secret_encrypted: undefined,
      shopify_webhook_secret_encrypted: undefined
    }));
  }

  static async delete(id) {
    // This will cascade delete user_stores and related data
    return await db(this.tableName).where({ id }).del();
  }

  // Get decrypted credentials for API usage
  static async getDecryptedCredentials(id) {
    const store = await this.findById(id);
    if (!store) return null;

    const credentials = {};

    try {
      // Decrypt access token
      if (store.access_token_encrypted) {
        credentials.accessToken = encryptionService.decrypt(store.access_token_encrypted);
      }

      // Decrypt app credentials
      if (store.shopify_app_id_encrypted) {
        credentials.appId = encryptionService.decrypt(store.shopify_app_id_encrypted);
      }

      if (store.shopify_app_secret_encrypted) {
        credentials.appSecret = encryptionService.decrypt(store.shopify_app_secret_encrypted);
      }

      if (store.shopify_webhook_secret_encrypted) {
        credentials.webhookSecret = encryptionService.decrypt(store.shopify_webhook_secret_encrypted);
      }
    } catch (error) {
      console.warn('Failed to decrypt credentials, using fallback values:', error.message);
      // Return empty credentials if decryption fails
      return {};
    }

    // Add shop domain to credentials
    credentials.shopDomain = store.shop_domain;

    return credentials;
  }

  // Rotate credentials (security feature)
  static async rotateCredentials(storeId, newCredentials) {
    const store = await this.findById(storeId);
    if (!store) throw new Error('Store not found');
    
    return await this.update(storeId, newCredentials);
  }

  // Get billing summary
  static async getBillingSummary(storeId) {
    const store = await this.findById(storeId);
    if (!store) throw new Error('Store not found');
    
    const usageLimits = await this.checkUsageLimits(storeId);
    
    return {
      storeId: store.id,
      shopDomain: store.shop_domain,
      plan: store.plan,
      billingCycle: {
        start: store.billing_cycle_start,
        end: store.billing_cycle_end
      },
      currentMonth: {
        orders: store.current_month_orders || 0,
        charges: parseFloat(store.current_month_charges || 0),
        rate: parseFloat(store.monthly_rate_rupees || 9.00)
      },
      limits: usageLimits,
      status: store.status
    };
  }
}

module.exports = StoreV2;
