const shopifyService = require('./shopifyService');
const dynamicVariantService = require('./dynamicVariantService');
const componentVisibilityService = require('./componentVisibilityService');
const ProductTaggingService = require('../utils/productTagging');

class SetProcessorService {
  constructor() {
    this.maxComponentPrice = 2499; // Rs. 2499 constraint
    this.defaultComponentNames = {
      2: ['Top', 'Bottom'],
      3: ['Top', 'Bottom', 'Dupatta'],
      4: ['Top', 'Bottom', 'Dupatta', 'Accessory']
    };
    
    // Keywords to identify components in descriptions
    this.componentKeywords = {
      'top': ['top', 'blouse', 'shirt', 'kurta', 'kurti', 'tunic', 'crop top'],
      'bottom': ['bottom', 'pant', 'pants', 'trouser', 'palazzo', 'dhoti', 'sharara', 'churidar', 'legging', 'skirt'],
      'jacket': ['jacket', 'blazer', 'coat', 'shrug', 'cardigan', 'waistcoat', 'vest'],
      'dupatta': ['dupatta', 'scarf', 'stole', 'veil', 'chunni'],
      'accessory': ['accessory', 'bag', 'purse', 'necklace', 'jewelry', 'belt', 'handbag', 'clutch', 'potli'],
      'lehenga': ['lehenga', 'lengha', 'ghagra'],
      'dress': ['dress', 'gown', 'frock'],
      'jumpsuit': ['jumpsuit', 'romper', 'playsuit'],
      'kaftan': ['kaftan', 'maxi'],
      'saree': ['saree', 'sari'],
      'cape': ['cape', 'poncho'],
      'wrap': ['wrap', 'shawl']
    };
  }

  /**
   * Detect if product is a "set" product
   */
  isSetProduct(product) {
    const title = product.title?.toLowerCase() || '';
    return title.includes('set');
  }

  /**
   * Parse product title and description to determine piece count
   */
  parsePieceCount(product) {
    const text = `${product.title} ${product.body_html || ''}`.toLowerCase();
    
    // Look for explicit piece counts
    if (text.includes('four piece') || text.includes('4 piece') || text.includes('four-piece')) {
      return 4;
    }
    if (text.includes('three piece') || text.includes('3 piece') || text.includes('three-piece')) {
      return 3;
    }
    if (text.includes('two piece') || text.includes('2 piece') || text.includes('two-piece')) {
      return 2;
    }
    
    // Default to 2-piece set
    return 2;
  }

  /**
   * Intelligently parse product description to identify component names
   */
  parseComponentNames(product) {
    const pieceCount = this.parsePieceCount(product);
    const text = `${product.title} ${product.body_html || ''}`.toLowerCase().replace(/<[^>]*>/g, ' ');
    
    const foundComponents = [];
    
    // Search for components mentioned in the text
    for (const [componentType, keywords] of Object.entries(this.componentKeywords)) {
      for (const keyword of keywords) {
        if (text.includes(keyword.toLowerCase())) {
          if (!foundComponents.includes(componentType)) {
            foundComponents.push(componentType);
          }
        }
      }
    }
    
    console.log(`Found components for "${product.title}":`, foundComponents);
    
    // If we found specific components, use them
    if (foundComponents.length >= pieceCount) {
      return foundComponents.slice(0, pieceCount).map(comp => this.capitalizeFirst(comp));
    }
    
    // If we found some but not enough, combine with defaults
    if (foundComponents.length > 0 && foundComponents.length < pieceCount) {
      const components = [...foundComponents];
      const defaults = this.defaultComponentNames[pieceCount];
      
      for (const defaultComp of defaults) {
        if (components.length >= pieceCount) break;
        const defaultLower = defaultComp.toLowerCase();
        if (!components.some(c => c.toLowerCase() === defaultLower)) {
          components.push(defaultLower);
        }
      }
      
      return components.slice(0, pieceCount).map(comp => this.capitalizeFirst(comp));
    }
    
    // Fall back to defaults
    return this.defaultComponentNames[pieceCount] || this.defaultComponentNames[2];
  }

  /**
   * Capitalize first letter
   */
  capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  /**
   * Calculate price split with constraints
   */
  calculatePriceSplit(originalPrice, pieceCount) {
    const originalPriceNum = parseFloat(originalPrice);
    const evenSplit = originalPriceNum / pieceCount;
    
    if (evenSplit <= this.maxComponentPrice) {
      // Simple even split
      return Array(pieceCount).fill(evenSplit.toFixed(2));
    } else {
      // Complex split to stay under constraint
      const prices = [];
      let remainingPrice = originalPriceNum;
      
      for (let i = 0; i < pieceCount - 1; i++) {
        const maxForThisPiece = Math.min(this.maxComponentPrice, remainingPrice - (pieceCount - i - 1));
        prices.push(maxForThisPiece.toFixed(2));
        remainingPrice -= maxForThisPiece;
      }
      
      // Last piece gets remaining amount
      prices.push(Math.max(0, remainingPrice).toFixed(2));
      return prices;
    }
  }

  /**
   * Generate component product data
   */
  generateComponentProducts(originalProduct, pieceCount, priceSplit) {
    const componentNames = this.parseComponentNames(originalProduct);
    const baseTitle = originalProduct.title.replace(/\bset\b/gi, '').trim();
    
    console.log(`Generating components for "${originalProduct.title}":`, componentNames);
    
    return componentNames.map((componentName, index) => {
      const componentTitle = `${baseTitle} ${componentName}`;
      
      // Create component product data
      const componentProduct = {
        title: componentTitle,
        body_html: this.generateComponentDescription(originalProduct, componentName, pieceCount),
        vendor: originalProduct.vendor,
        product_type: originalProduct.product_type,
        tags: ProductTaggingService.getComponentProductTags(originalProduct.tags || '', componentName, index),
        images: originalProduct.images, // Use same images as original
        options: originalProduct.options, // Same variant options
        variants: this.generateComponentVariants(originalProduct.variants, priceSplit[index]),
        // Hide from storefront - component products should not be visible to customers
        published: false,
        published_at: null,
        status: 'draft',
        metafields: [
          {
            namespace: 'bundle_app',
            key: 'component_of',
            value: originalProduct.id.toString(),
            type: 'single_line_text_field'
          },
          {
            namespace: 'bundle_app',
            key: 'component_type',
            value: componentName.toLowerCase(),
            type: 'single_line_text_field'
          },
          {
            namespace: 'bundle_app',
            key: 'component_index',
            value: index.toString(),
            type: 'single_line_text_field'
          }
        ]
      };

      return componentProduct;
    });
  }

  /**
   * Generate description for component product
   */
  generateComponentDescription(originalProduct, componentName, pieceCount) {
    const originalDesc = originalProduct.body_html || '';
    
    return `
      <div class="auto-generated-component">
        <h4>This ${componentName} is part of a ${pieceCount}-piece set</h4>
        <p><strong>Complete Set:</strong> ${originalProduct.title}</p>
        <p><strong>Component:</strong> ${componentName}</p>
        <div class="original-description">
          ${originalDesc}
        </div>
        <p><em>Note: This is an automatically generated component product. For the complete set experience, visit the main product page.</em></p>
      </div>
    `;
  }

  /**
   * Generate variants for component product with adjusted pricing
   */
  generateComponentVariants(originalVariants, componentPrice) {
    return originalVariants.map(variant => ({
      option1: variant.option1,
      option2: variant.option2,
      option3: variant.option3,
      price: componentPrice,
      compare_at_price: variant.compare_at_price ? (parseFloat(variant.compare_at_price) * (parseFloat(componentPrice) / parseFloat(variant.price))).toFixed(2) : null,
      sku: `${variant.sku || ''}-component`.substring(0, 30),
      barcode: variant.barcode,
      grams: Math.floor((variant.grams || 0) / 2), // Approximate weight split
      inventory_policy: variant.inventory_policy,
      inventory_management: variant.inventory_management,
      inventory_quantity: variant.inventory_quantity,
      requires_shipping: variant.requires_shipping,
      taxable: variant.taxable
    }));
  }

  /**
   * Create bundle configuration for the set
   */
  async createSetBundleConfiguration(originalProduct, componentProducts) {
    const componentNames = this.parseComponentNames(originalProduct);
    
    // Calculate prices
    const totalBundlePrice = componentProducts.reduce((sum, p) => sum + parseFloat(p.variants[0].price), 0);
    
    const bundleConfig = {
      originalProductId: originalProduct.id,
      originalProductTitle: originalProduct.title,
      isAutoGeneratedSet: true,
      displayAsBundle: true,
      cartTransform: {
        enabled: true,
        hideComponentVariants: true,
        showOnlyMainVariant: true,
        autoAddToCart: true,
        synchronizeVariants: true
      },
      bundleProducts: componentProducts.map((component, index) => ({
        id: component.id,
        title: component.title,
        quantity: 1,
        isUpsell: false,
        discount: 0,
        componentType: componentNames[index] || `Component ${index + 1}`,
        price: component.variants[0].price,
        variantMapping: {
          enabled: true,
          autoSelect: true,
          hideVariants: index > 0, // Hide variants for all except first product
          syncOptions: originalProduct.options.map(option => ({
            mainOption: option.name,
            targetOption: option.name,
            confidence: 100,
            autoSync: true
          }))
        }
      })),
      bundleMetadata: {
        totalOriginalPrice: originalProduct.variants[0].price,
        totalBundlePrice: totalBundlePrice,
        pieceCount: componentProducts.length,
        componentNames: componentNames,
        autoGenerated: true,
        createdAt: new Date().toISOString()
      },
      displaySettings: {
        showBundlePrice: true,
        showComponentPrices: true,
        showSavings: false,
        bundlePriceText: `Total: ₹${totalBundlePrice.toFixed(2)}`,
        hideComponentVariantSelectors: true
      }
    };

    // Store bundle configuration in the original product's metafields
    await shopifyService.updateProductMetafields(originalProduct.id, [
      {
        namespace: 'bundle_app',
        key: 'bundle_config',
        value: JSON.stringify(bundleConfig),
        type: 'json_string'
      },
      {
        namespace: 'bundle_app',
        key: 'is_bundle',
        value: 'true',
        type: 'boolean'
      },
      {
        namespace: 'bundle_app',
        key: 'auto_generated_bundle',
        value: 'true',
        type: 'boolean'
      },
      {
        namespace: 'bundle_app',
        key: 'cart_transform_config',
        value: JSON.stringify({
          enabled: true,
          bundleItems: componentProducts.map(p => ({ 
            productId: p.id, 
            quantity: 1,
            autoSelect: true 
          })),
          variantSync: true,
          hideSubVariants: true
        }),
        type: 'json_string'
      },
      {
        namespace: 'bundle_app',
        key: 'component_products',
        value: JSON.stringify(componentProducts.map((p, index) => ({
          id: p.id,
          handle: p.handle,
          title: p.title,
          price: p.variants[0].price,
          image: p.images[0]?.src || null,
          componentType: componentNames[index] || `Component ${index + 1}`,
          variants: p.variants.map(v => ({
            id: v.id,
            title: v.title,
            price: v.price,
            options: [v.option1, v.option2, v.option3].filter(Boolean),
            option1: v.option1,
            option2: v.option2,
            option3: v.option3,
            available: v.available !== false,
            inventory_quantity: v.inventory_quantity || 0
          })),
          options: p.options,
          // Create size-to-variant-id mapping for easy lookup
          variantMapping: p.variants.reduce((mapping, variant) => {
            const size = variant.option1 || variant.title;
            if (size) {
              mapping[size.toUpperCase()] = variant.id;
            }
            return mapping;
          }, {})
        }))),
        type: 'json_string'
      },
      {
        namespace: 'bundle_app',
        key: 'variant_sync_mapping',
        value: JSON.stringify({
          // Map main product variants to component variants by size
          mainProductVariants: originalProduct.variants.reduce((mapping, variant) => {
            const size = variant.option1 || variant.title;
            if (size) {
              mapping[size.toUpperCase()] = {
                id: variant.id,
                title: variant.title,
                price: variant.price,
                size: size.toUpperCase()
              };
            }
            return mapping;
          }, {}),
          // Component variant mappings by size
          componentVariantsBySize: componentProducts.reduce((sizeMapping, component, componentIndex) => {
            component.variants.forEach(variant => {
              const size = variant.option1 || variant.title;
              if (size) {
                const sizeKey = size.toUpperCase();
                if (!sizeMapping[sizeKey]) {
                  sizeMapping[sizeKey] = {};
                }
                sizeMapping[sizeKey][componentNames[componentIndex] || `Component ${componentIndex + 1}`] = {
                  variantId: variant.id,
                  productId: component.id,
                  title: variant.title,
                  price: variant.price,
                  available: variant.available !== false
                };
              }
            });
            return sizeMapping;
          }, {}),
          lastUpdated: new Date().toISOString(),
          bundleProductId: originalProduct.id
        }),
        type: 'json_string'
      }
    ]);

    return bundleConfig;
  }

  /**
   * Process a single set product (for testing)
   */
  async processSetProduct(productId) {
    try {
      console.log(`Starting to process set product with ID: ${productId}`);
      
      // Get the original product
      const productResult = await shopifyService.getProduct(productId);
      if (!productResult.success) {
        console.error(`Failed to fetch product ${productId}:`, productResult.error);
        throw new Error(`Failed to fetch product: ${productResult.error}`);
      }

      const originalProduct = productResult.data;
      console.log(`Fetched product: ${originalProduct.title}`);

      // Check if it's a set product
      if (!this.isSetProduct(originalProduct)) {
        console.log(`Product ${originalProduct.title} is not a set product`);
        return {
          success: false,
          error: 'Product is not a set product (no "set" in title)'
        };
      }

      // Check if already processed
      const alreadyProcessed = await this.isAlreadyProcessed(originalProduct);
      if (alreadyProcessed) {
        console.log(`Product ${originalProduct.title} has already been processed`);
        return {
          success: false,
          error: 'Product has already been processed'
        };
      }

      // Parse piece count and component names
      const pieceCount = this.parsePieceCount(originalProduct);
      const componentNames = this.parseComponentNames(originalProduct);
      console.log(`Detected ${pieceCount} piece set with components:`, componentNames);
      
      // Calculate price split
      const originalPrice = originalProduct.variants[0].price;
      const priceSplit = this.calculatePriceSplit(originalPrice, pieceCount);
      console.log(`Price split: ${originalPrice} -> ${priceSplit.join(', ')}`);

      // Generate component products data
      const componentProductsData = this.generateComponentProducts(originalProduct, pieceCount, priceSplit);
      console.log(`Generated ${componentProductsData.length} component products`);

      // Create component products in Shopify
      const createdComponents = [];
      for (let i = 0; i < componentProductsData.length; i++) {
        const componentData = componentProductsData[i];
        console.log(`Creating component ${i + 1}/${componentProductsData.length}: ${componentData.title}`);
        
        const createResult = await shopifyService.createProduct(componentData);
        if (createResult.success) {
          console.log(`Successfully created component: ${createResult.data.title} (ID: ${createResult.data.id})`);
          createdComponents.push(createResult.data);
        } else {
          console.error(`Failed to create component ${componentData.title}:`, createResult.error);
          throw new Error(`Failed to create component product "${componentData.title}": ${createResult.error}`);
        }
        
        // Add small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      console.log(`Successfully created all ${createdComponents.length} component products`);

      // Create bundle configuration
      console.log('Creating bundle configuration...');
      const bundleConfig = await this.createSetBundleConfiguration(originalProduct, createdComponents);
      console.log('Bundle configuration created successfully');
      
      // Update with dynamic variant mapping
      console.log('Setting up dynamic variant mapping...');
      const variantMappingResult = await dynamicVariantService.updateBundleVariantMapping(originalProduct.id, createdComponents);
      if (variantMappingResult.success) {
        console.log('✅ Dynamic variant mapping configured successfully');
      } else {
        console.warn('⚠️ Dynamic variant mapping failed:', variantMappingResult.error);
      }
      
      // Hide component products from storefront
      console.log('Hiding component products from storefront...');
      const componentIds = createdComponents.map(c => c.id);
      const visibilityResult = await componentVisibilityService.hideComponentProducts(componentIds);
      if (visibilityResult.success) {
        console.log(`✅ Hidden ${visibilityResult.hiddenCount} component products from storefront`);
      } else {
        console.warn('⚠️ Failed to hide component products:', visibilityResult.error);
      }

      // Update the original product to show as bundle with proper pricing
      try {
        console.log('Updating original product to display as bundle...');
        
        // Calculate total bundle price
        const totalBundlePrice = createdComponents.reduce((sum, p) => sum + parseFloat(p.variants[0].price), 0);
        
        // Keep original description without adding bundle info in HTML
        // The bundle display will be handled by the theme/app
        const bundleDescription = originalProduct.body_html || '';
        
        // Prepare variant updates with new bundle pricing
        const variantUpdates = originalProduct.variants.map(variant => ({
          id: variant.id,
          price: totalBundlePrice.toFixed(2),
          compare_at_price: (totalBundlePrice * 1.2).toFixed(2) // Show 20% higher as compare price
        }));
        
        // Update product with bundle info and new pricing
        const updateData = {
          body_html: bundleDescription, // Keep original description
          tags: ProductTaggingService.getOriginalProductTags(originalProduct.tags || '', pieceCount),
          variants: variantUpdates,
          template_suffix: 'bundle' // Use the dedicated bundle template
        };
        
        const updateResult = await shopifyService.updateProduct(originalProduct.id, updateData);
        
        if (updateResult.success) {
          console.log('Original product updated as bundle with new pricing');
          console.log(`Bundle price updated to: ₹${totalBundlePrice}`);
        } else {
          console.error('Failed to update product display:', updateResult.error);
        }
        
        // Create a bundle link for easy access
        bundleConfig.bundleId = `bundle_${originalProduct.id}_${Date.now()}`;
        bundleConfig.bundleUrl = `https://${process.env.SHOPIFY_STORE_DOMAIN}/products/${originalProduct.handle}`;
        console.log(`Bundle configuration complete with ID: ${bundleConfig.bundleId}`);
        console.log(`Bundle URL: ${bundleConfig.bundleUrl}`);
        
      } catch (updateError) {
        console.error('Failed to update bundle display:', updateError);
        // Continue even if update fails
      }

      return {
        success: true,
        data: {
          originalProduct,
          componentProducts: createdComponents,
          bundleConfig,
          pieceCount,
          priceSplit,
          totalOriginalPrice: originalPrice,
          componentNames
        }
      };

    } catch (error) {
      console.error('Error processing set product:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Find all set products in the store
   */
  async findAllSetProducts() {
    try {
      console.log('Fetching all products from Shopify...');
      
      // Get all products ONCE
      const productsResult = await shopifyService.getAllProducts();
      if (!productsResult.success) {
        throw new Error(`Failed to fetch products: ${productsResult.error}`);
      }

      const allProducts = productsResult.data;
      console.log(`Found ${allProducts.length} total products, filtering for sets...`);

      // Filter for set products first
      const setProducts = allProducts.filter(product => {
        return this.isSetProduct(product);
      });

      console.log(`Found ${setProducts.length} set products, checking processed status...`);

      // Check which ones haven't been processed yet
      // Pass the product list to avoid re-fetching
      const unprocessedSetProducts = [];
      for (const product of setProducts) {
        const isProcessed = await this.isAlreadyProcessed(product, allProducts);
        if (!isProcessed) {
          unprocessedSetProducts.push(product);
        }
      }

      console.log(`${unprocessedSetProducts.length} set products are unprocessed`);

      return {
        success: true,
        data: unprocessedSetProducts
      };

    } catch (error) {
      console.error('Error finding set products:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Check if product has already been processed
   */
  async isAlreadyProcessed(product, existingProductsList = null) {
    try {
      // Check if product has bundle metafields indicating it's already processed
      const metafields = product.metafields || [];
      const hasAutoGenBundleMeta = metafields.some(meta => 
        meta.namespace === 'bundle_app' && 
        meta.key === 'auto_generated_bundle' && 
        meta.value === 'true'
      );
      
      if (hasAutoGenBundleMeta) {
        console.log(`Product ${product.title} already processed (has auto_generated_bundle metafield)`);
        return true;
      }

      // Also check if component products already exist
      const baseTitle = product.title.replace(/\bset\b/gi, '').trim();
      const componentNames = this.parseComponentNames(product);
      
      // Use provided product list or fetch once if not provided
      let existingProducts = existingProductsList;
      if (!existingProducts) {
        const allProductsResult = await shopifyService.getAllProducts();
        if (!allProductsResult.success) {
          console.warn('Could not fetch products to check for duplicates');
          return false;
        }
        existingProducts = allProductsResult.data;
      }
      
      for (const componentName of componentNames) {
        const expectedTitle = `${baseTitle} ${componentName}`;
        const componentExists = existingProducts.some(p => 
          p.title.toLowerCase().includes(componentName.toLowerCase()) && 
          p.title.toLowerCase().includes(baseTitle.toLowerCase().substring(0, 10))
        );
        
        if (componentExists) {
          console.log(`Product ${product.title} already processed (component ${componentName} exists)`);
          return true;
        }
      }
      
      return false;
    } catch (error) {
      console.error('Error checking if product already processed:', error);
      return false; // If we can't check, assume it's not processed
    }
  }

  /**
   * Process all set products (use with caution)
   */
  async processAllSetProducts() {
    try {
      const setProductsResult = await this.findAllSetProducts();
      if (!setProductsResult.success) {
        return setProductsResult;
      }

      const setProducts = setProductsResult.data;
      const results = [];

      for (const product of setProducts) {
        console.log(`Processing set product: ${product.title}`);
        const result = await this.processSetProduct(product.id);
        results.push({
          product: product.title,
          result
        });
        
        // Add delay to avoid API rate limits
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      return {
        success: true,
        data: {
          processedCount: results.filter(r => r.result.success).length,
          failedCount: results.filter(r => !r.result.success).length,
          results
        }
      };

    } catch (error) {
      console.error('Error processing all set products:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = new SetProcessorService();
