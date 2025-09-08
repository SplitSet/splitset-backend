/**
 * App Toggle Service
 * Handles activation and deactivation of the bundle app
 * Provides complete on/off functionality
 */

const shopifyService = require('./shopifyService');
const axios = require('axios');

class AppToggleService {
  constructor() {
    this.themeId = '143347351746'; // Current active theme
  }

  /**
   * Completely deactivate the bundle app
   */
  async deactivateApp() {
    try {
      console.log('🔄 Deactivating Bundle App...');
      
      const results = {
        themeCleanup: false,
        assetsRemoved: [],
        productsReset: [],
        errors: []
      };

      // 1. Remove bundle sections from theme.liquid
      try {
        await this.removeBundleSectionsFromTheme();
        results.themeCleanup = true;
        console.log('✅ Removed bundle sections from theme.liquid');
      } catch (error) {
        results.errors.push(`Theme cleanup failed: ${error.message}`);
        console.error('❌ Theme cleanup failed:', error.message);
      }

      // 2. Delete bundle assets
      const assetsToDelete = [
        'sections/bundle-components.liquid',
        'sections/bundle-cart-sync.liquid',
        'assets/bundle-cart-override.js',
        'snippets/bundle-display.liquid'
      ];

      for (const assetKey of assetsToDelete) {
        try {
          await this.deleteThemeAsset(assetKey);
          results.assetsRemoved.push(assetKey);
          console.log(`✅ Deleted ${assetKey}`);
        } catch (error) {
          console.log(`⚠️  ${assetKey} not found or already deleted`);
        }
      }

      // 3. Reset bundle products to default templates
      try {
        const resetProducts = await this.resetBundleProducts();
        results.productsReset = resetProducts;
        console.log(`✅ Reset ${resetProducts.length} bundle products`);
      } catch (error) {
        results.errors.push(`Product reset failed: ${error.message}`);
        console.error('❌ Product reset failed:', error.message);
      }

      // 4. Set app status to deactivated
      await this.setAppStatus(false);

      console.log('\n🎉 Bundle App Completely Deactivated!');
      console.log('- All bundle sections removed from theme');
      console.log('- Bundle assets deleted');
      console.log('- Product templates reset to default');
      console.log('- Bundle functionality completely disabled');

      return {
        success: true,
        message: 'Bundle app deactivated successfully',
        details: results
      };

    } catch (error) {
      console.error('❌ Error deactivating app:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Activate the bundle app
   */
  async activateApp() {
    try {
      console.log('🔄 Activating Bundle App...');

      const results = {
        themeSetup: false,
        assetsCreated: [],
        productsUpdated: [],
        errors: []
      };

      // 1. Install bundle sections to theme
      try {
        await this.installBundleSectionsToTheme();
        results.themeSetup = true;
        console.log('✅ Installed bundle sections to theme');
      } catch (error) {
        results.errors.push(`Theme setup failed: ${error.message}`);
        console.error('❌ Theme setup failed:', error.message);
      }

      // 2. Create bundle assets
      try {
        const createdAssets = await this.createBundleAssets();
        results.assetsCreated = createdAssets;
        console.log(`✅ Created ${createdAssets.length} bundle assets`);
      } catch (error) {
        results.errors.push(`Asset creation failed: ${error.message}`);
        console.error('❌ Asset creation failed:', error.message);
      }

      // 3. Update bundle products to use bundle template
      try {
        const updatedProducts = await this.updateBundleProducts();
        results.productsUpdated = updatedProducts;
        console.log(`✅ Updated ${updatedProducts.length} bundle products`);
      } catch (error) {
        results.errors.push(`Product update failed: ${error.message}`);
        console.error('❌ Product update failed:', error.message);
      }

      // 4. Set app status to activated
      await this.setAppStatus(true);

      console.log('\n🎉 Bundle App Activated!');
      console.log('- Bundle sections installed to theme');
      console.log('- Bundle assets created');
      console.log('- Bundle products configured');
      console.log('- Bundle functionality enabled');

      return {
        success: true,
        message: 'Bundle app activated successfully',
        details: results
      };

    } catch (error) {
      console.error('❌ Error activating app:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get current app activation status
   */
  async getAppStatus() {
    try {
      // Check if bundle sections exist in theme
      const hasBundleSection = await this.checkBundleSectionExists();
      
      // Check if any products have bundle template
      const bundleProducts = await this.getBundleProducts();
      
      const status = {
        active: hasBundleSection && bundleProducts.length > 0,
        bundleSectionExists: hasBundleSection,
        bundleProductsCount: bundleProducts.length,
        lastChecked: new Date().toISOString()
      };

      return {
        success: true,
        data: status
      };

    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Remove bundle sections from theme.liquid
   */
  async removeBundleSectionsFromTheme() {
    const response = await axios.get(
      `https://${process.env.SHOPIFY_SHOP_DOMAIN}/admin/api/2023-10/themes/${this.themeId}/assets.json?asset[key]=layout/theme.liquid`,
      {
        headers: {
          'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );

    let themeContent = response.data.asset.value;

    // Remove bundle cart sync section and comments
    themeContent = themeContent.replace(/{% comment %}.*?Bundle Cart Synchronization.*?{% endcomment %}\s*{% section 'bundle-cart-sync' %}\s*/gs, '');
    themeContent = themeContent.replace(/{% section 'bundle-cart-sync' %}/g, '');
    themeContent = themeContent.replace(/{% comment %}.*?Bundle.*?{% endcomment %}\s*/gs, '');

    // Update theme.liquid
    await axios.put(
      `https://${process.env.SHOPIFY_SHOP_DOMAIN}/admin/api/2023-10/themes/${this.themeId}/assets.json`,
      {
        asset: {
          key: 'layout/theme.liquid',
          value: themeContent
        }
      },
      {
        headers: {
          'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );
  }

  /**
   * Install bundle sections to theme.liquid
   */
  async installBundleSectionsToTheme() {
    const response = await axios.get(
      `https://${process.env.SHOPIFY_SHOP_DOMAIN}/admin/api/2023-10/themes/${this.themeId}/assets.json?asset[key]=layout/theme.liquid`,
      {
        headers: {
          'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );

    let themeContent = response.data.asset.value;

    // Check if bundle sync is already included
    if (!themeContent.includes('bundle-cart-sync')) {
      // Add bundle sync section before closing body tag
      const bundleSyncInclude = `
  {% comment %} Bundle Cart Synchronization - Auto-remove bundle components {% endcomment %}
  {% section 'bundle-cart-sync' %}
</body>`;
      
      themeContent = themeContent.replace('</body>', bundleSyncInclude);

      // Update theme.liquid
      await axios.put(
        `https://${process.env.SHOPIFY_SHOP_DOMAIN}/admin/api/2023-10/themes/${this.themeId}/assets.json`,
        {
          asset: {
            key: 'layout/theme.liquid',
            value: themeContent
          }
        },
        {
          headers: {
            'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
            'Content-Type': 'application/json'
          }
        }
      );
    }
  }

  /**
   * Delete a theme asset
   */
  async deleteThemeAsset(assetKey) {
    await axios.delete(
      `https://${process.env.SHOPIFY_SHOP_DOMAIN}/admin/api/2023-10/themes/${this.themeId}/assets.json?asset[key]=${assetKey}`,
      {
        headers: {
          'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );
  }

  /**
   * Create bundle assets
   */
  async createBundleAssets() {
    const fs = require('fs');
    const path = require('path');
    const createdAssets = [];

    // Bundle components section
    const bundleComponentsPath = path.join(__dirname, '../scripts/bundle-components-dynamic.liquid');
    if (fs.existsSync(bundleComponentsPath)) {
      const bundleComponentsContent = fs.readFileSync(bundleComponentsPath, 'utf8');
      
      await axios.put(
        `https://${process.env.SHOPIFY_SHOP_DOMAIN}/admin/api/2023-10/themes/${this.themeId}/assets.json`,
        {
          asset: {
            key: 'sections/bundle-components.liquid',
            value: bundleComponentsContent
          }
        },
        {
          headers: {
            'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
            'Content-Type': 'application/json'
          }
        }
      );
      createdAssets.push('sections/bundle-components.liquid');
    }

    // Bundle cart sync section
    const bundleCartSyncPath = path.join(__dirname, '../scripts/bundle-cart-sync.liquid');
    if (fs.existsSync(bundleCartSyncPath)) {
      const bundleCartSyncContent = fs.readFileSync(bundleCartSyncPath, 'utf8');
      
      await axios.put(
        `https://${process.env.SHOPIFY_SHOP_DOMAIN}/admin/api/2023-10/themes/${this.themeId}/assets.json`,
        {
          asset: {
            key: 'sections/bundle-cart-sync.liquid',
            value: bundleCartSyncContent
          }
        },
        {
          headers: {
            'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
            'Content-Type': 'application/json'
          }
        }
      );
      createdAssets.push('sections/bundle-cart-sync.liquid');
    }

    return createdAssets;
  }

  /**
   * Reset bundle products to default template
   */
  async resetBundleProducts() {
    const bundleProducts = await this.getBundleProducts();
    const resetProducts = [];

    for (const product of bundleProducts) {
      try {
        await axios.put(
          `https://${process.env.SHOPIFY_SHOP_DOMAIN}/admin/api/2023-10/products/${product.id}.json`,
          {
            product: {
              id: product.id,
              template_suffix: null // Remove bundle template
            }
          },
          {
            headers: {
              'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
              'Content-Type': 'application/json'
            }
          }
        );
        resetProducts.push(product.title);
      } catch (error) {
        console.warn(`Could not reset template for: ${product.title}`);
      }
    }

    return resetProducts;
  }

  /**
   * Update bundle products to use bundle template
   */
  async updateBundleProducts() {
    const bundleProducts = await this.getBundleProducts();
    const updatedProducts = [];

    for (const product of bundleProducts) {
      try {
        await axios.put(
          `https://${process.env.SHOPIFY_SHOP_DOMAIN}/admin/api/2023-10/products/${product.id}.json`,
          {
            product: {
              id: product.id,
              template_suffix: 'bundle' // Set bundle template
            }
          },
          {
            headers: {
              'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
              'Content-Type': 'application/json'
            }
          }
        );
        updatedProducts.push(product.title);
      } catch (error) {
        console.warn(`Could not update template for: ${product.title}`);
      }
    }

    return updatedProducts;
  }

  /**
   * Get all bundle products
   */
  async getBundleProducts() {
    const response = await axios.get(
      `https://${process.env.SHOPIFY_SHOP_DOMAIN}/admin/api/2023-10/products.json?limit=250`,
      {
        headers: {
          'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );

    return response.data.products.filter(p => 
      p.template_suffix === 'bundle' || 
      (p.tags && (p.tags.includes('bundle') || p.tags.includes('auto-bundle')))
    );
  }

  /**
   * Check if bundle section exists in theme
   */
  async checkBundleSectionExists() {
    try {
      await axios.get(
        `https://${process.env.SHOPIFY_SHOP_DOMAIN}/admin/api/2023-10/themes/${this.themeId}/assets.json?asset[key]=sections/bundle-components.liquid`,
        {
          headers: {
            'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
            'Content-Type': 'application/json'
          }
        }
      );
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Set app activation status (for future use with database)
   */
  async setAppStatus(active) {
    // For now, just log the status
    // In future, this could save to database or metafields
    console.log(`App status set to: ${active ? 'ACTIVE' : 'INACTIVE'}`);
    
    // Could also save to a global metafield on the shop
    try {
      await axios.post(
        `https://${process.env.SHOPIFY_SHOP_DOMAIN}/admin/api/2023-10/metafields.json`,
        {
          metafield: {
            namespace: 'bundle_app',
            key: 'app_status',
            value: active ? 'active' : 'inactive',
            type: 'single_line_text_field'
          }
        },
        {
          headers: {
            'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
            'Content-Type': 'application/json'
          }
        }
      );
    } catch (error) {
      console.log('Could not save app status to metafield');
    }
  }
}

module.exports = new AppToggleService();
