/**
 * Metafield Definition Service
 * Creates metafield definitions to make them accessible on the storefront
 */

const axios = require('axios');

class MetafieldDefinitionService {
  constructor() {
    this.baseURL = `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/graphql.json`;
    this.accessToken = process.env.SHOPIFY_ACCESS_TOKEN;
    this.headers = {
      'X-Shopify-Access-Token': this.accessToken,
      'Content-Type': 'application/json'
    };
  }

  /**
   * Create metafield definitions for bundle app
   */
  async createBundleMetafieldDefinitions() {
    try {
      console.log('🚀 Creating metafield definitions for storefront access...');
      
      const definitions = [
        {
          name: 'Is Bundle',
          namespace: 'bundle_app',
          key: 'is_bundle',
          type: 'single_line_text_field',
          description: 'Indicates if product is a bundle'
        },
        {
          name: 'Bundle Config',
          namespace: 'bundle_app',
          key: 'bundle_config',
          type: 'json',
          description: 'Bundle configuration data'
        },
        {
          name: 'Component Products',
          namespace: 'bundle_app',
          key: 'component_products',
          type: 'json',
          description: 'List of component products in bundle'
        },
        {
          name: 'Cart Transform Config',
          namespace: 'bundle_app',
          key: 'cart_transform_config',
          type: 'json',
          description: 'Configuration for cart transformation'
        }
      ];

      const results = [];
      
      for (const def of definitions) {
        const query = `
          mutation CreateMetafieldDefinition($definition: MetafieldDefinitionInput!) {
            metafieldDefinitionCreate(definition: $definition) {
              createdDefinition {
                id
                name
                namespace
                key
              }
              userErrors {
                field
                message
              }
            }
          }
        `;

        const variables = {
          definition: {
            name: def.name,
            namespace: def.namespace,
            key: def.key,
            type: def.type,
            description: def.description,
            ownerType: 'PRODUCT',
            visibleToStorefrontApi: true,
            access: {
              storefront: 'PUBLIC_READ'
            }
          }
        };

        try {
          const response = await axios.post(
            this.baseURL,
            { query, variables },
            { headers: this.headers }
          );

          if (response.data.data?.metafieldDefinitionCreate?.createdDefinition) {
            console.log(`✅ Created definition: ${def.namespace}.${def.key}`);
            results.push(response.data.data.metafieldDefinitionCreate.createdDefinition);
          } else if (response.data.data?.metafieldDefinitionCreate?.userErrors?.length > 0) {
            const errors = response.data.data.metafieldDefinitionCreate.userErrors;
            if (errors.some(e => e.message.includes('already exists'))) {
              console.log(`⚠️ Definition already exists: ${def.namespace}.${def.key}`);
            } else {
              console.error(`❌ Error creating ${def.namespace}.${def.key}:`, errors);
            }
          }
        } catch (error) {
          console.error(`Error creating definition ${def.namespace}.${def.key}:`, error.message);
        }
      }

      console.log('✅ Metafield definitions setup complete');
      return { success: true, definitions: results };
      
    } catch (error) {
      console.error('Error creating metafield definitions:', error);
      throw error;
    }
  }

  /**
   * Update existing metafields to be storefront visible
   */
  async makeMetafieldsStorefrontVisible() {
    try {
      console.log('🔄 Making existing metafields storefront visible...');
      
      const query = `
        mutation UpdateMetafieldDefinition($id: ID!, $definition: MetafieldDefinitionUpdateInput!) {
          metafieldDefinitionUpdate(id: $id, definition: $definition) {
            updatedDefinition {
              id
              visibleToStorefrontApi
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      // First, get existing definitions
      const listQuery = `
        query {
          metafieldDefinitions(first: 100, ownerType: PRODUCT, namespace: "bundle_app") {
            edges {
              node {
                id
                name
                namespace
                key
                visibleToStorefrontApi
              }
            }
          }
        }
      `;

      const listResponse = await axios.post(
        this.baseURL,
        { query: listQuery },
        { headers: this.headers }
      );

      const definitions = listResponse.data.data?.metafieldDefinitions?.edges || [];
      
      for (const edge of definitions) {
        const def = edge.node;
        if (!def.visibleToStorefrontApi) {
          const variables = {
            id: def.id,
            definition: {
              visibleToStorefrontApi: true,
              access: {
                storefront: 'PUBLIC_READ'
              }
            }
          };

          const response = await axios.post(
            this.baseURL,
            { query, variables },
            { headers: this.headers }
          );

          if (response.data.data?.metafieldDefinitionUpdate?.updatedDefinition) {
            console.log(`✅ Made visible: ${def.namespace}.${def.key}`);
          }
        } else {
          console.log(`✓ Already visible: ${def.namespace}.${def.key}`);
        }
      }

      return { success: true };
    } catch (error) {
      console.error('Error updating metafield visibility:', error);
      throw error;
    }
  }
}

module.exports = new MetafieldDefinitionService();
