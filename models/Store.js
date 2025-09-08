const db = require('../db');
const bcrypt = require('bcrypt');

class Store {
  static tableName = 'stores';

  static async findById(id) {
    return await db(this.tableName).where({ id }).first();
  }

  static async findByDomain(shopDomain) {
    return await db(this.tableName).where({ shop_domain: shopDomain }).first();
  }

  static async create(data) {
    const { shopDomain, accessToken, scopes, metadata = {} } = data;
    
    // Encrypt the access token
    const encryptedToken = await bcrypt.hash(accessToken, 10);
    
    const [id] = await db(this.tableName).insert({
      shop_domain: shopDomain,
      access_token_encrypted: encryptedToken,
      scopes: JSON.stringify(scopes),
      metadata: JSON.stringify(metadata),
      status: 'active'
    });

    return await this.findById(id);
  }

  static async update(id, data) {
    const updateData = { ...data };
    
    if (updateData.accessToken) {
      updateData.access_token_encrypted = await bcrypt.hash(updateData.accessToken, 10);
      delete updateData.accessToken;
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

  static async list(filters = {}) {
    let query = db(this.tableName);
    
    if (filters.status) {
      query = query.where({ status: filters.status });
    }
    
    return await query.orderBy('created_at', 'desc');
  }

  static async delete(id) {
    return await db(this.tableName).where({ id }).del();
  }

  // Helper method to verify access token (for validation)
  static async verifyToken(storeId, providedToken) {
    const store = await this.findById(storeId);
    if (!store) return false;
    
    return await bcrypt.compare(providedToken, store.access_token_encrypted);
  }
}

module.exports = Store;
