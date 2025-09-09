/**
 * Theme Installer Service
 * Automatically installs bundle display components into the active Shopify theme
 */

const ShopifyServiceV2 = require('./shopifyServiceV2');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

class ThemeInstallerService {
  constructor() {
    // Store-specific credentials will be initialized per method call
    this.shopifyService = null;
    this.baseURL = null;
    this.headers = null;
  }

  /**
   * Initialize service with store-specific credentials
   */
  async initialize(storeId) {
    try {
      this.shopifyService = await ShopifyServiceV2.create(storeId);
      this.baseURL = `https://${this.shopifyService.shopDomain}/admin/api/2023-10`;
      this.headers = {
        'X-Shopify-Access-Token': this.shopifyService.credentials.accessToken,
        'Content-Type': 'application/json'
      };
      return true;
    } catch (error) {
      console.error('Failed to initialize ThemeInstallerService:', error);
      throw new Error(`Failed to initialize theme service: ${error.message}`);
    }
  }

  /**
   * Install bundle display components into the active theme
   */
  async installBundleDisplay(storeId) {
    try {
      await this.initialize(storeId);
      console.log(`🚀 Starting automatic theme installation for store ${storeId}...`);
      
      // Step 1: Get the active theme
      const activeTheme = await this.getActiveTheme();
      if (!activeTheme) {
        throw new Error('No active theme found');
      }
      console.log(`✅ Found active theme: ${activeTheme.name} (ID: ${activeTheme.id})`);

      // Step 2: Create/update the bundle-display snippet
      const snippetInstalled = await this.installBundleSnippet(activeTheme.id);
      if (snippetInstalled) {
        console.log('✅ Bundle display snippet installed successfully');
      }

      // Step 3: Update the product template
      const templateUpdated = await this.updateProductTemplate(activeTheme.id);
      if (templateUpdated) {
        console.log('✅ Product template updated successfully');
      }

      // Step 4: Create a backup of modifications
      await this.createBackup(activeTheme.id);
      
      console.log('🎉 Theme installation completed successfully!');
      
      return {
        success: true,
        theme: activeTheme.name,
        snippetInstalled,
        templateUpdated,
        message: 'Bundle display has been automatically installed in your theme'
      };
    } catch (error) {
      console.error('❌ Theme installation failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get the currently active theme
   */
  async getActiveTheme() {
    try {
      const response = await axios.get(
        `${this.baseURL}/themes.json`,
        { headers: this.headers }
      );
      
      return response.data.themes.find(theme => theme.role === 'main');
    } catch (error) {
      console.error('Error fetching themes:', error);
      throw error;
    }
  }

  /**
   * Install the bundle-display snippet
   */
  async installBundleSnippet(themeId) {
    try {
      // Read the local snippet file - use inline version for FastBundle style
      const snippetPath = path.join(__dirname, '../scripts/bundle-display-inline.liquid');
      let snippetContent = await fs.readFile(snippetPath, 'utf8');
      
      // Check if snippet already exists
      try {
        const existingSnippet = await axios.get(
          `${this.baseURL}/themes/${themeId}/assets.json?asset[key]=snippets/bundle-display.liquid`,
          { headers: this.headers }
        );
        
        if (existingSnippet.data.asset) {
          console.log('⚠️  Bundle snippet already exists, updating...');
        }
      } catch (error) {
        console.log('📝 Creating new bundle snippet...');
      }

      // Create or update the snippet
      const response = await axios.put(
        `${this.baseURL}/themes/${themeId}/assets.json`,
        {
          asset: {
            key: 'snippets/bundle-display.liquid',
            value: snippetContent
          }
        },
        { headers: this.headers }
      );

      return response.data.asset ? true : false;
    } catch (error) {
      console.error('Error installing snippet:', error);
      throw error;
    }
  }

  /**
   * Update the product template to include bundle display
   */
  async updateProductTemplate(themeId) {
    try {
      // First, try to find the main product template
      const templateKeys = [
        'templates/product.liquid',
        'templates/product.json',
        'sections/product-template.liquid',
        'sections/main-product.liquid'
      ];

      let templateKey = null;
      let templateContent = null;

      for (const key of templateKeys) {
        try {
          const response = await axios.get(
            `${this.baseURL}/themes/${themeId}/assets.json?asset[key]=${encodeURIComponent(key)}`,
            { headers: this.headers }
          );
          
          if (response.data.asset) {
            templateKey = key;
            templateContent = response.data.asset.value;
            console.log(`📄 Found product template: ${key}`);
            break;
          }
        } catch (error) {
          // Template not found, try next
          continue;
        }
      }

      if (!templateKey || !templateContent) {
        console.log('⚠️  Could not find product template, manual installation required');
        return false;
      }

      // Check if bundle display is already included
      if (templateContent.includes('bundle-display') || templateContent.includes('bundle_app.is_bundle')) {
        console.log('✅ Bundle display already integrated in template');
        return true;
      }

      // Determine where to insert the bundle display
      let updatedContent = '';
      
      if (templateKey.endsWith('.json')) {
        // For JSON templates, we need to add a new section
        updatedContent = await this.updateJSONTemplate(templateContent, themeId);
      } else {
        // For Liquid templates, insert after the product form
        updatedContent = this.updateLiquidTemplate(templateContent);
      }

      if (!updatedContent) {
        console.log('⚠️  Could not automatically update template, manual installation required');
        return false;
      }

      // Save the updated template
      const response = await axios.put(
        `${this.baseURL}/themes/${themeId}/assets.json`,
        {
          asset: {
            key: templateKey,
            value: updatedContent
          }
        },
        { headers: this.headers }
      );

      return response.data.asset ? true : false;
    } catch (error) {
      console.error('Error updating template:', error);
      throw error;
    }
  }

  /**
   * Update a liquid template
   */
  updateLiquidTemplate(content) {
    const bundleCode = `
{% comment %} FastBundle Inline Display - Auto-installed {% endcomment %}
{% include 'bundle-display' %}
`;

    // Check if already included
    if (content.includes('bundle-display')) {
      console.log('Bundle display already included');
      return content;
    }

    // Priority insertion points for inline display (right after price or title)
    const insertionPatterns = [
      // After price display
      { pattern: /<div[^>]*class="[^"]*price[^"]*"[^>]*>[\s\S]*?<\/div>/gi, position: 'after' },
      { pattern: /\{\%\s*render\s+['"]price['"][^%]*%\}/gi, position: 'after' },
      { pattern: /<span[^>]*class="[^"]*price[^"]*"[^>]*>[\s\S]*?<\/span>/gi, position: 'after' },
      
      // After product title
      { pattern: /<h1[^>]*>.*?<\/h1>/gi, position: 'after' },
      { pattern: /\{\{\s*product\.title\s*\}\}/gi, position: 'after' },
      
      // Before variant selector
      { pattern: /<div[^>]*class="[^"]*variant[^"]*"[^>]*>/gi, position: 'before' },
      { pattern: /\{\%\s*render\s+['"]product-variant-picker['"][^%]*%\}/gi, position: 'before' },
      
      // Before add to cart button
      { pattern: /<button[^>]*name="add"[^>]*>/gi, position: 'before' },
      { pattern: /\{\%\s*render\s+['"]buy-buttons['"][^%]*%\}/gi, position: 'before' },
      
      // After product form opening
      { pattern: /<form[^>]*action="\/cart\/add"[^>]*>/gi, position: 'after' },
      { pattern: /\{\%\s*form\s+['"]product['"][^%]*%\}/gi, position: 'after' }
    ];

    // Try each pattern
    for (const { pattern, position } of insertionPatterns) {
      const matches = content.match(pattern);
      if (matches && matches.length > 0) {
        const match = matches[0];
        const index = content.indexOf(match);
        
        if (position === 'after') {
          const insertPoint = index + match.length;
          return content.slice(0, insertPoint) + '\n' + bundleCode + content.slice(insertPoint);
        } else {
          return content.slice(0, index) + bundleCode + '\n' + content.slice(index);
        }
      }
    }

    // Fallback: insert before form close
    const formClose = content.indexOf('{% endform %}');
    if (formClose > -1) {
      return content.slice(0, formClose) + bundleCode + '\n' + content.slice(formClose);
    }

    // Last resort: insert before </form>
    const formCloseTag = content.lastIndexOf('</form>');
    if (formCloseTag > -1) {
      return content.slice(0, formCloseTag) + bundleCode + content.slice(formCloseTag);
    }

    return null;
  }

  /**
   * Update a JSON template
   */
  async updateJSONTemplate(content, themeId) {
    try {
      const template = JSON.parse(content);
      
      // Create a new bundle display section
      const bundleSectionContent = `
{% if product.metafields.bundle_app.is_bundle == 'true' %}
  {% include 'bundle-display' %}
{% endif %}
`;

      // First create a custom liquid section for the bundle
      await axios.put(
        `${this.baseURL}/themes/${themeId}/assets.json`,
        {
          asset: {
            key: 'sections/bundle-display-section.liquid',
            value: `
<div class="bundle-display-section">
  ${bundleSectionContent}
</div>

{% schema %}
{
  "name": "Bundle Display",
  "settings": []
}
{% endschema %}
`
          }
        },
        { headers: this.headers }
      );

      // Find the main product section and add our bundle section after it
      const sections = template.sections;
      const mainSection = Object.keys(sections).find(key => 
        sections[key].type === 'main-product' || 
        sections[key].type === 'product-template' ||
        key === 'main'
      );

      if (mainSection) {
        // Add bundle section after the main product section
        const sectionOrder = template.order;
        const mainIndex = sectionOrder.indexOf(mainSection);
        
        // Insert bundle section after main
        sectionOrder.splice(mainIndex + 1, 0, 'bundle-display');
        
        // Add the section configuration
        sections['bundle-display'] = {
          type: 'bundle-display-section',
          settings: {}
        };

        return JSON.stringify(template, null, 2);
      }
    } catch (error) {
      console.error('Error updating JSON template:', error);
    }
    
    return null;
  }

  /**
   * Create a backup of theme modifications
   */
  async createBackup(themeId) {
    try {
      const backup = {
        themeId,
        timestamp: new Date().toISOString(),
        modifications: [
          'snippets/bundle-display.liquid',
          'product template updated'
        ]
      };

      const backupPath = path.join(__dirname, '../backups/theme-backup.json');
      await fs.mkdir(path.dirname(backupPath), { recursive: true });
      await fs.writeFile(backupPath, JSON.stringify(backup, null, 2));
      
      console.log('💾 Backup created successfully');
      return true;
    } catch (error) {
      console.error('Error creating backup:', error);
      return false;
    }
  }

  /**
   * Uninstall bundle display from theme
   */
  async uninstallBundleDisplay(storeId) {
    try {
      await this.initialize(storeId);
      console.log(`🔄 Starting theme uninstallation for store ${storeId}...`);
      
      const activeTheme = await this.getActiveTheme();
      if (!activeTheme) {
        throw new Error('No active theme found');
      }

      // Remove the snippet
      try {
        await axios.delete(
          `${this.baseURL}/themes/${activeTheme.id}/assets.json?asset[key]=snippets/bundle-display.liquid`,
          { headers: this.headers }
        );
        console.log('✅ Bundle snippet removed');
      } catch (error) {
        console.log('⚠️  Bundle snippet not found or already removed');
      }

      // Note: Removing from product template would require parsing and careful removal
      // For safety, we'll just notify the user to manually remove the inclusion
      console.log('ℹ️  Please manually remove the bundle display code from your product template');

      return {
        success: true,
        message: 'Bundle display components removed. Please manually remove the inclusion from your product template.'
      };
    } catch (error) {
      console.error('❌ Uninstallation failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Check if bundle display is installed
   */
  async checkInstallation(storeId) {
    try {
      await this.initialize(storeId);
      
      const activeTheme = await this.getActiveTheme();
      if (!activeTheme) {
        return {
          success: false,
          error: 'No active theme found'
        };
      }

      // Check if snippet exists
      let snippetExists = false;
      try {
        const response = await axios.get(
          `${this.baseURL}/themes/${activeTheme.id}/assets.json?asset[key]=snippets/bundle-display.liquid`,
          { headers: this.headers }
        );
        snippetExists = !!response.data.asset;
      } catch (error) {
        snippetExists = false;
      }

      return {
        success: true,
        installed: snippetExists,
        theme: activeTheme.name,
        message: snippetExists ? 'Bundle display is installed' : 'Bundle display is not installed'
      };
    } catch (error) {
      console.error('Error checking installation:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = new ThemeInstallerService();
