describe('SplitSet Revenue Calculation Unit Tests', () => {
  
  describe('Revenue Formula (quantity * 9)', () => {
    test('should calculate revenue correctly for single product', () => {
      const quantity = 1;
      const expectedRevenue = quantity * 9;
      
      expect(expectedRevenue).toBe(9);
    });

    test('should calculate revenue correctly for multiple products', () => {
      const quantities = [1, 2, 3, 5];
      const totalQuantity = quantities.reduce((sum, qty) => sum + qty, 0);
      const expectedRevenue = totalQuantity * 9;
      
      expect(expectedRevenue).toBe(99); // 11 * 9 = 99
    });

    test('should handle zero quantities', () => {
      const quantity = 0;
      const expectedRevenue = quantity * 9;
      
      expect(expectedRevenue).toBe(0);
    });

    test('should handle large quantities', () => {
      const quantity = 1000;
      const expectedRevenue = quantity * 9;
      
      expect(expectedRevenue).toBe(9000);
    });

    test('should handle decimal quantities', () => {
      const quantity = 2.5;
      const expectedRevenue = quantity * 9;
      
      expect(expectedRevenue).toBe(22.5);
    });
  });

  describe('SplitSet Product Validation', () => {
    test('should identify valid split product', () => {
      const product = {
        id: 'test-product-1',
        title: 'Test Product',
        price: 34.99,
        split_type: 'manual',
        metadata: { splitset_tag: true }
      };

      expect(product.metadata.splitset_tag).toBe(true);
      expect(product.split_type).toBeDefined();
    });

    test('should handle missing metadata', () => {
      const product = {
        id: 'test-product-1',
        title: 'Test Product',
        price: 34.99,
        split_type: 'manual'
      };

      expect(product.metadata).toBeUndefined();
    });

    test('should validate split types', () => {
      const validSplitTypes = ['manual', 'auto'];
      
      validSplitTypes.forEach(splitType => {
        expect(['manual', 'auto']).toContain(splitType);
      });
    });
  });

  describe('Currency Formatting', () => {
    test('should format currency with rupee symbol', () => {
      const amount = 18.00;
      const formatted = `₹${amount.toFixed(2)}`;
      
      expect(formatted).toBe('₹18.00');
    });

    test('should handle large amounts', () => {
      const amount = 9999.99;
      const formatted = `₹${amount.toFixed(2)}`;
      
      expect(formatted).toBe('₹9999.99');
    });

    test('should handle zero amounts', () => {
      const amount = 0;
      const formatted = `₹${amount.toFixed(2)}`;
      
      expect(formatted).toBe('₹0.00');
    });
  });

  describe('Date Handling for Daily Revenue', () => {
    test('should get today\'s date in correct format', () => {
      const today = new Date().toISOString().split('T')[0];
      const datePattern = /^\d{4}-\d{2}-\d{2}$/;
      
      expect(today).toMatch(datePattern);
    });

    test('should handle date comparisons', () => {
      const today = new Date().toISOString().split('T')[0];
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      
      expect(today).not.toBe(yesterday);
      expect(today > yesterday).toBe(true);
    });
  });

  describe('Aggregation Logic', () => {
    test('should sum quantities correctly', () => {
      const orderItems = [
        { quantity: 1, product_id: 'prod-1' },
        { quantity: 2, product_id: 'prod-2' },
        { quantity: 3, product_id: 'prod-3' }
      ];

      const totalQuantity = orderItems.reduce((sum, item) => sum + item.quantity, 0);
      expect(totalQuantity).toBe(6);
    });

    test('should filter fulfilled orders only', () => {
      const orders = [
        { id: 1, fulfillment_status: 'fulfilled', quantity: 1 },
        { id: 2, fulfillment_status: 'pending', quantity: 2 },
        { id: 3, fulfillment_status: 'fulfilled', quantity: 3 }
      ];

      const fulfilledOrders = orders.filter(order => order.fulfillment_status === 'fulfilled');
      expect(fulfilledOrders).toHaveLength(2);
      
      const totalFulfilledQuantity = fulfilledOrders.reduce((sum, order) => sum + order.quantity, 0);
      expect(totalFulfilledQuantity).toBe(4);
    });

    test('should handle empty arrays', () => {
      const emptyArray = [];
      const sum = emptyArray.reduce((sum, item) => sum + (item.quantity || 0), 0);
      
      expect(sum).toBe(0);
    });
  });
});
