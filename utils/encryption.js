const crypto = require('crypto');

class EncryptionService {
  constructor() {
    this.algorithm = 'aes-256-gcm';
    this.secretKey = this.getSecretKey();
  }

  getSecretKey() {
    const key = process.env.ENCRYPTION_KEY;
    if (!key) {
      throw new Error('ENCRYPTION_KEY environment variable is required');
    }
    
    // Ensure key is 32 bytes for AES-256
    return crypto.scryptSync(key, 'salt', 32);
  }

  encrypt(text) {
    if (!text) return null;
    
    try {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv(this.algorithm, this.secretKey, iv);
      cipher.setAAD(Buffer.from('shopify-credentials'));
      
      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      const authTag = cipher.getAuthTag();
      
      // Combine iv, authTag, and encrypted data
      return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
    } catch (error) {
      throw new Error('Encryption failed: ' + error.message);
    }
  }

  decrypt(encryptedData) {
    if (!encryptedData) return null;
    
    try {
      const parts = encryptedData.split(':');
      if (parts.length !== 3) {
        throw new Error('Invalid encrypted data format');
      }
      
      const iv = Buffer.from(parts[0], 'hex');
      const authTag = Buffer.from(parts[1], 'hex');
      const encrypted = parts[2];
      
      const decipher = crypto.createDecipheriv(this.algorithm, this.secretKey, iv);
      decipher.setAuthTag(authTag);
      decipher.setAAD(Buffer.from('shopify-credentials'));
      
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      throw new Error('Decryption failed: ' + error.message);
    }
  }

  // Encrypt Shopify credentials
  encryptShopifyCredentials(credentials) {
    const { accessToken, appId, appSecret, webhookSecret } = credentials;
    
    return {
      accessTokenEncrypted: this.encrypt(accessToken),
      appIdEncrypted: this.encrypt(appId),
      appSecretEncrypted: this.encrypt(appSecret),
      webhookSecretEncrypted: this.encrypt(webhookSecret)
    };
  }

  // Decrypt Shopify credentials
  decryptShopifyCredentials(encryptedCredentials) {
    const {
      access_token_encrypted,
      shopify_app_id_encrypted,
      shopify_app_secret_encrypted,
      shopify_webhook_secret_encrypted
    } = encryptedCredentials;
    
    return {
      accessToken: this.decrypt(access_token_encrypted),
      appId: this.decrypt(shopify_app_id_encrypted),
      appSecret: this.decrypt(shopify_app_secret_encrypted),
      webhookSecret: this.decrypt(shopify_webhook_secret_encrypted)
    };
  }

  // Generate encryption key (for initial setup)
  static generateEncryptionKey() {
    return crypto.randomBytes(32).toString('hex');
  }

  // Rotate encryption key (advanced feature)
  async rotateKey(newKey, stores) {
    const oldService = new EncryptionService();
    const newService = new EncryptionService();
    newService.secretKey = crypto.scryptSync(newKey, 'salt', 32);

    const rotatedStores = [];

    for (const store of stores) {
      try {
        // Decrypt with old key
        const credentials = oldService.decryptShopifyCredentials(store);
        
        // Re-encrypt with new key
        const reencrypted = newService.encryptShopifyCredentials(credentials);
        
        rotatedStores.push({
          storeId: store.id,
          ...reencrypted
        });
      } catch (error) {
        console.error(`Failed to rotate key for store ${store.id}:`, error.message);
      }
    }

    return rotatedStores;
  }
}

module.exports = new EncryptionService();
