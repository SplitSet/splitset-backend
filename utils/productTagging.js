/**
 * Product Tagging Utilities for SplitSet
 * Ensures consistent tagging across all product creation and updates
 */

class ProductTaggingService {
  constructor() {
    // Core tracking tags for billing and analytics
    this.coreTrackingTags = [
      'splitter',           // Primary tracking tag
      'splitset',           // App identifier
      'splitset-created',   // Created by SplitSet app
      'billing-tracked'     // Eligible for ₹9 billing
    ];
    
    // Additional tags by product type
    this.productTypeTags = {
      original: ['set-main', 'original-product'],
      component: ['component', 'auto-generated', 'set-component', 'hidden-component'],
      bundle: ['bundle', 'upsell', 'auto-bundle'],
      variant: ['variant', 'set-variant']
    };
  }

  /**
   * Get standardized tags for different product types
   */
  getTagsForProductType(productType, existingTags = '', additionalTags = []) {
    const existing = this.parseExistingTags(existingTags);
    const typeTags = this.productTypeTags[productType] || [];
    
    const allTags = [
      ...existing,
      ...this.coreTrackingTags,
      ...typeTags,
      ...additionalTags
    ];
    
    return this.normalizeTags(allTags);
  }

  /**
   * Parse existing tags string into array
   */
  parseExistingTags(tagsString) {
    if (!tagsString) return [];
    
    return tagsString
      .split(',')
      .map(tag => tag.trim())
      .filter(tag => tag.length > 0);
  }

  /**
   * Normalize tags - remove duplicates, trim, filter empty
   */
  normalizeTags(tags) {
    const normalized = tags
      .map(tag => tag.trim().toLowerCase())
      .filter(tag => tag.length > 0);
    
    // Remove duplicates while preserving order
    const unique = [...new Set(normalized)];
    
    return unique.join(',');
  }

  /**
   * Add tracking tags to original product when processed
   */
  getOriginalProductTags(existingTags, pieceCount) {
    return this.getTagsForProductType('original', existingTags, [
      `${pieceCount}-piece-set`,
      'cart-transform',
      'fast-bundle',
      'set-processed'
    ]);
  }

  /**
   * Add tracking tags to component products
   */
  getComponentProductTags(existingTags, componentName, componentIndex) {
    return this.getTagsForProductType('component', existingTags, [
      `component-${componentIndex + 1}`,
      `component-${componentName.toLowerCase().replace(/\s+/g, '-')}`,
      'set-part'
    ]);
  }

  /**
   * Add tracking tags to bundle products
   */
  getBundleProductTags(existingTags, bundleConfig) {
    const additionalTags = [
      'bundle-product',
      'upsell-bundle'
    ];
    
    if (bundleConfig.discount) {
      additionalTags.push(`discount-${bundleConfig.discount}pct`);
    }
    
    return this.getTagsForProductType('bundle', existingTags, additionalTags);
  }

  /**
   * Check if a product has tracking tags for billing
   */
  hasTrackingTags(tagsString) {
    if (!tagsString) return false;
    
    const tags = tagsString.toLowerCase();
    return this.coreTrackingTags.some(trackingTag => tags.includes(trackingTag));
  }

  /**
   * Check if a product was created by SplitSet (has our app-specific markers)
   */
  isCreatedBySplitSet(product) {
    const tags = (product.tags || '').toLowerCase();
    const hasAppTags = tags.includes('splitset-created') || 
                       tags.includes('splitset') ||
                       tags.includes('auto-generated') ||
                       tags.includes('set-component') ||
                       tags.includes('auto-bundle');
    
    // Also check metafields for our app namespace
    const hasAppMetafields = product.metafields?.some(mf => 
      mf.namespace === 'bundle_app' || 
      mf.namespace === 'splitset' ||
      mf.key === 'splitset_created'
    );
    
    // Check if product title indicates it's a set/component
    const title = (product.title || '').toLowerCase();
    const hasSetIndicators = title.includes('set') || 
                             title.includes('component') ||
                             title.includes('- bundle') ||
                             title.includes('top') || 
                             title.includes('bottom') ||
                             title.includes('dupatta');
    
    return hasAppTags || hasAppMetafields || (hasSetIndicators && hasAppTags);
  }

  /**
   * Add tracking tags to existing product if missing (ONLY if created by SplitSet)
   */
  ensureTrackingTags(existingTags, productType = 'original', product = null) {
    // If product object is provided, check if it was created by SplitSet
    if (product && !this.isCreatedBySplitSet(product)) {
      return existingTags; // Don't tag products not created by SplitSet
    }
    
    if (this.hasTrackingTags(existingTags)) {
      return existingTags; // Already has tracking tags
    }
    
    return this.getTagsForProductType(productType, existingTags);
  }

  /**
   * Safe tagging - only tag if we're certain this product was created by SplitSet
   */
  safeTagProduct(product, productType = 'original') {
    if (!this.isCreatedBySplitSet(product)) {
      return {
        shouldTag: false,
        reason: 'Product was not created by SplitSet',
        currentTags: product.tags || ''
      };
    }
    
    const newTags = this.ensureTrackingTags(product.tags || '', productType, product);
    
    return {
      shouldTag: true,
      reason: 'Product was created by SplitSet and needs tracking tags',
      currentTags: product.tags || '',
      newTags,
      changed: (product.tags || '') !== newTags
    };
  }

  /**
   * Get tags for order line item properties (when adding to cart)
   */
  getLineItemProperties(productType, originalProductId, componentIndex = null) {
    const properties = [
      { name: 'splitter', value: 'true' },
      { name: 'splitset', value: 'true' },
      { name: 'billing-tracked', value: 'true' },
      { name: '_splitset_created', value: new Date().toISOString() },
      { name: '_original_product_id', value: originalProductId.toString() }
    ];

    if (productType === 'component' && componentIndex !== null) {
      properties.push(
        { name: '_component_index', value: componentIndex.toString() },
        { name: '_component_type', value: productType }
      );
    }

    return properties;
  }

  /**
   * Validate that a product has proper SplitSet tagging
   */
  validateProductTagging(product) {
    const tags = product.tags || '';
    const hasTracking = this.hasTrackingTags(tags);
    
    return {
      isValid: hasTracking,
      hasSplitterTag: tags.toLowerCase().includes('splitter'),
      hasSplitsetTag: tags.toLowerCase().includes('splitset'),
      hasBillingTag: tags.toLowerCase().includes('billing-tracked'),
      hasCreatedTag: tags.toLowerCase().includes('splitset-created'),
      allTags: this.parseExistingTags(tags),
      missingTags: hasTracking ? [] : this.coreTrackingTags
    };
  }

  /**
   * Get comprehensive tagging report for debugging (ONLY for SplitSet-created products)
   */
  getTaggingReport(products) {
    // Filter to only SplitSet-created products
    const splitsetProducts = products.filter(product => this.isCreatedBySplitSet(product));
    
    const report = {
      totalProducts: products.length,
      splitsetProducts: splitsetProducts.length,
      nonSplitsetProducts: products.length - splitsetProducts.length,
      properlyTagged: 0,
      missingTags: 0,
      details: []
    };

    splitsetProducts.forEach(product => {
      const validation = this.validateProductTagging(product);
      
      if (validation.isValid) {
        report.properlyTagged++;
      } else {
        report.missingTags++;
      }
      
      report.details.push({
        id: product.id,
        title: product.title,
        isSplitSetProduct: true,
        validation
      });
    });

    return report;
  }
}

module.exports = new ProductTaggingService();
