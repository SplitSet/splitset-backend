/**
 * Dynamic Variant Service
 * Handles dynamic variant mapping for bundle products
 * Eliminates hardcoded variant IDs and provides runtime error resistance
 */

const shopifyService = require('./shopifyService');

class DynamicVariantService {
  /**
   * Update bundle product with dynamic variant mappings
   */
  async updateBundleVariantMapping(bundleProductId, componentProducts) {
    try {
      console.log(`Updating dynamic variant mapping for bundle ${bundleProductId}`);
      
      // Get the main bundle product
      const bundleResult = await shopifyService.getProduct(bundleProductId);
      if (!bundleResult.success) {
        throw new Error(`Failed to fetch bundle product: ${bundleResult.error}`);
      }
      
      const bundleProduct = bundleResult.data;
      
      // Build comprehensive component data with variant mappings
      const enhancedComponentData = await this.buildEnhancedComponentData(componentProducts);
      
      // Build variant sync mapping
      const variantSyncMapping = await this.buildVariantSyncMapping(bundleProduct, enhancedComponentData);
      
      // Update metafields with dynamic data
      const metafields = [
        {
          namespace: 'bundle_app',
          key: 'component_products',
          value: JSON.stringify(enhancedComponentData),
          type: 'json_string'
        },
        {
          namespace: 'bundle_app',
          key: 'variant_sync_mapping',
          value: JSON.stringify(variantSyncMapping),
          type: 'json_string'
        },
        {
          namespace: 'bundle_app',
          key: 'dynamic_variant_config',
          value: JSON.stringify({
            enabled: true,
            lastUpdated: new Date().toISOString(),
            componentCount: enhancedComponentData.length,
            availableSizes: Object.keys(variantSyncMapping.componentVariantsBySize),
            fallbackHandles: enhancedComponentData.map(c => c.handle)
          }),
          type: 'json_string'
        }
      ];
      
      await shopifyService.updateProductMetafields(bundleProductId, metafields);
      
      console.log(`✅ Updated dynamic variant mapping for bundle ${bundleProductId}`);
      console.log(`Available sizes: ${Object.keys(variantSyncMapping.componentVariantsBySize).join(', ')}`);
      
      return {
        success: true,
        data: {
          componentData: enhancedComponentData,
          variantMapping: variantSyncMapping
        }
      };
      
    } catch (error) {
      console.error('Error updating bundle variant mapping:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Build enhanced component data with complete variant information
   */
  async buildEnhancedComponentData(componentProducts) {
    const enhancedComponents = [];
    
    for (const component of componentProducts) {
      // Get fresh component data to ensure we have latest variants
      const componentResult = await shopifyService.getProduct(component.id);
      if (!componentResult.success) {
        console.warn(`Could not fetch fresh data for component ${component.id}, using provided data`);
        enhancedComponents.push(this.enhanceComponentData(component));
        continue;
      }
      
      const freshComponent = componentResult.data;
      enhancedComponents.push(this.enhanceComponentData(freshComponent));
    }
    
    return enhancedComponents;
  }
  
  /**
   * Enhance individual component data with variant mappings
   */
  enhanceComponentData(component) {
    // Detect component type from title/handle
    const componentType = this.detectComponentType(component.title, component.handle);
    
    // Build variant mapping by size
    const variantMapping = {};
    const sizeVariants = {};
    
    component.variants.forEach(variant => {
      const size = this.extractSize(variant);
      if (size) {
        const sizeKey = size.toUpperCase();
        variantMapping[sizeKey] = variant.id;
        sizeVariants[sizeKey] = {
          id: variant.id,
          title: variant.title,
          price: variant.price,
          available: variant.available !== false,
          inventory_quantity: variant.inventory_quantity || 0,
          option1: variant.option1,
          option2: variant.option2,
          option3: variant.option3
        };
      }
    });
    
    return {
      id: component.id,
      handle: component.handle,
      title: component.title,
      price: component.variants[0]?.price || 0,
      image: component.images?.[0]?.src || null,
      componentType: componentType,
      variants: component.variants.map(v => ({
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
      options: component.options || [],
      variantMapping: variantMapping,
      sizeVariants: sizeVariants,
      lastUpdated: new Date().toISOString()
    };
  }
  
  /**
   * Build variant sync mapping for the entire bundle
   */
  async buildVariantSyncMapping(bundleProduct, componentData) {
    const variantSyncMapping = {
      bundleProductId: bundleProduct.id,
      lastUpdated: new Date().toISOString(),
      mainProductVariants: {},
      componentVariantsBySize: {},
      sizeAvailability: {}
    };
    
    // Map main product variants
    bundleProduct.variants.forEach(variant => {
      const size = this.extractSize(variant);
      if (size) {
        const sizeKey = size.toUpperCase();
        variantSyncMapping.mainProductVariants[sizeKey] = {
          id: variant.id,
          title: variant.title,
          price: variant.price,
          size: sizeKey,
          available: variant.available !== false
        };
      }
    });
    
    // Build component variants by size
    componentData.forEach(component => {
      Object.keys(component.sizeVariants).forEach(size => {
        const sizeKey = size.toUpperCase();
        
        if (!variantSyncMapping.componentVariantsBySize[sizeKey]) {
          variantSyncMapping.componentVariantsBySize[sizeKey] = {};
        }
        
        if (!variantSyncMapping.sizeAvailability[sizeKey]) {
          variantSyncMapping.sizeAvailability[sizeKey] = {
            available: true,
            components: {}
          };
        }
        
        const variantData = component.sizeVariants[sizeKey];
        variantSyncMapping.componentVariantsBySize[sizeKey][component.componentType] = {
          variantId: variantData.id,
          productId: component.id,
          title: variantData.title,
          price: variantData.price,
          available: variantData.available,
          inventory_quantity: variantData.inventory_quantity
        };
        
        // Track availability
        variantSyncMapping.sizeAvailability[sizeKey].components[component.componentType] = variantData.available;
        
        // If any component is unavailable, mark the size as unavailable
        if (!variantData.available) {
          variantSyncMapping.sizeAvailability[sizeKey].available = false;
        }
      });
    });
    
    return variantSyncMapping;
  }
  
  /**
   * Detect component type from title or handle
   */
  detectComponentType(title, handle) {
    const titleLower = title.toLowerCase();
    const handleLower = handle.toLowerCase();
    
    const typeMap = [
      { keywords: ['top', 'shirt', 'blouse', 'kurta'], type: 'Top' },
      { keywords: ['bottom', 'pant', 'trouser', 'palazzo', 'sharara'], type: 'Bottom' },
      { keywords: ['jacket', 'blazer', 'coat', 'cardigan'], type: 'Jacket' },
      { keywords: ['dupatta', 'scarf', 'stole', 'shawl'], type: 'Dupatta' },
      { keywords: ['skirt', 'lehenga'], type: 'Skirt' },
      { keywords: ['dress', 'gown'], type: 'Dress' }
    ];
    
    for (const { keywords, type } of typeMap) {
      if (keywords.some(keyword => titleLower.includes(keyword) || handleLower.includes(keyword))) {
        return type;
      }
    }
    
    return 'Component';
  }
  
  /**
   * Extract size from variant (option1, option2, option3, or title)
   */
  extractSize(variant) {
    const possibleSizes = [variant.option1, variant.option2, variant.option3, variant.title];
    
    for (const size of possibleSizes) {
      if (size && this.isValidSize(size)) {
        return size;
      }
    }
    
    return null;
  }
  
  /**
   * Check if a string represents a valid size
   */
  isValidSize(str) {
    if (!str) return false;
    
    const sizeStr = str.toString().toUpperCase().trim();
    const validSizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', '2XL', '3XL', '4XL', '5XL'];
    const numericSizes = /^\d+$/.test(sizeStr); // 28, 30, 32, etc.
    
    return validSizes.includes(sizeStr) || numericSizes;
  }
  
  /**
   * Refresh variant mapping for an existing bundle
   */
  async refreshBundleVariantMapping(bundleProductId) {
    try {
      console.log(`Refreshing variant mapping for bundle ${bundleProductId}`);
      
      // Get current component products from metafields
      const bundleResult = await shopifyService.getProduct(bundleProductId);
      if (!bundleResult.success) {
        throw new Error(`Failed to fetch bundle product: ${bundleResult.error}`);
      }
      
      const bundleProduct = bundleResult.data;
      const metafields = bundleProduct.metafields || [];
      
      // Find component products metafield
      const componentMetafield = metafields.find(m => 
        m.namespace === 'bundle_app' && m.key === 'component_products'
      );
      
      if (!componentMetafield) {
        throw new Error('No component products metafield found');
      }
      
      const componentData = JSON.parse(componentMetafield.value);
      const componentIds = componentData.map(c => c.id);
      
      // Fetch fresh component products
      const freshComponents = [];
      for (const componentId of componentIds) {
        const componentResult = await shopifyService.getProduct(componentId);
        if (componentResult.success) {
          freshComponents.push(componentResult.data);
        }
      }
      
      if (freshComponents.length === 0) {
        throw new Error('No valid component products found');
      }
      
      // Update with fresh data
      return await this.updateBundleVariantMapping(bundleProductId, freshComponents);
      
    } catch (error) {
      console.error('Error refreshing bundle variant mapping:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Get variant mapping for a specific bundle and size
   */
  async getBundleVariantMapping(bundleProductId, size) {
    try {
      const bundleResult = await shopifyService.getProduct(bundleProductId);
      if (!bundleResult.success) {
        throw new Error(`Failed to fetch bundle product: ${bundleResult.error}`);
      }
      
      const bundleProduct = bundleResult.data;
      const metafields = bundleProduct.metafields || [];
      
      const variantMappingMetafield = metafields.find(m => 
        m.namespace === 'bundle_app' && m.key === 'variant_sync_mapping'
      );
      
      if (!variantMappingMetafield) {
        throw new Error('No variant sync mapping found');
      }
      
      const variantMapping = JSON.parse(variantMappingMetafield.value);
      const sizeKey = size.toUpperCase();
      
      if (!variantMapping.componentVariantsBySize[sizeKey]) {
        throw new Error(`Size ${size} not available for this bundle`);
      }
      
      return {
        success: true,
        data: variantMapping.componentVariantsBySize[sizeKey]
      };
      
    } catch (error) {
      console.error('Error getting bundle variant mapping:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = new DynamicVariantService();
