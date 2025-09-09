const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const StoreV2 = require('../models/StoreV2');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { validateBody } = require('../middleware/validation');
const { z } = require('zod');

// Validation schemas
const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  firstName: z.string().min(1).max(50),
  lastName: z.string().min(1).max(50),
  shopDomain: z.string().regex(/^[a-zA-Z0-9-]+\.myshopify\.com$/),
  accessToken: z.string().min(1),
  appId: z.string().optional(),
  appSecret: z.string().optional(),
  webhookSecret: z.string().optional()
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

const passwordResetRequestSchema = z.object({
  email: z.string().email()
});

const passwordResetSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(128)
});

// Register new user with store
router.post('/register',
  validateBody(registerSchema),
  async (req, res) => {
    try {
      const {
        email,
        password,
        firstName,
        lastName,
        shopDomain,
        accessToken,
        appId,
        appSecret,
        webhookSecret
      } = req.body;

      // Check if user already exists
      const existingUser = await User.findByEmail(email);
      if (existingUser) {
        return res.status(409).json({
          success: false,
          error: 'User already exists with this email',
          code: 'USER_EXISTS'
        });
      }

      // Check if store already exists
      const existingStore = await StoreV2.findByDomain(shopDomain);
      if (existingStore) {
        return res.status(409).json({
          success: false,
          error: 'Store already registered',
          code: 'STORE_EXISTS'
        });
      }

      // Create user
      const user = await User.create({
        email,
        password,
        firstName,
        lastName,
        role: 'store_owner'
      });

      // Create store with encrypted credentials
      const store = await StoreV2.create({
        shopDomain,
        accessToken,
        appId,
        appSecret,
        webhookSecret,
        scopes: ['read_products', 'write_products', 'read_orders'],
        plan: 'basic'
      });

      // Grant store access to user
      await User.grantStoreAccess(user.id, store.id, 'owner');

      // Generate auth token
      const authToken = await User.generateAuthToken(user);

      // Set secure cookie
      const cookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
      };
      
      res.cookie('authToken', authToken, cookieOptions);

      req.logger?.audit('User registered with store', {
        userId: user.id,
        storeId: store.id,
        shopDomain,
        email
      });

      res.status(201).json({
        success: true,
        message: 'Registration successful',
        data: {
          user: {
            id: user.id,
            email: user.email,
            firstName: user.first_name,
            lastName: user.last_name,
            role: user.role,
            emailVerified: user.email_verified
          },
          store: {
            id: store.id,
            shopDomain: store.shop_domain,
            plan: store.plan,
            status: store.status
          },
          token: authToken
        }
      });

    } catch (error) {
      req.logger?.error('Registration failed', {
        error: error.message,
        stack: error.stack,
        email: req.body.email,
        shopDomain: req.body.shopDomain
      });

      // In development, return detailed error for debugging
      const errorMessage = process.env.NODE_ENV === 'development' ? error.message : 'Registration failed';
      
      res.status(500).json({
        success: false,
        error: errorMessage,
        code: 'REGISTRATION_ERROR',
        ...(process.env.NODE_ENV === 'development' && { details: error.stack })
      });
    }
  }
);

// Login
router.post('/login',
  validateBody(loginSchema),
  async (req, res) => {
    try {
      const { email, password } = req.body;

      // Find user
      const user = await User.findByEmail(email);
      if (!user) {
        // Log failed attempt but don't reveal user doesn't exist
        req.logger?.security('Login attempt with non-existent email', {
          email,
          ip: req.ip
        });
        
        return res.status(401).json({
          success: false,
          error: 'Invalid email or password',
          code: 'INVALID_CREDENTIALS'
        });
      }

      // Check if account is locked
      const isLocked = await User.isAccountLocked(user);
      if (isLocked) {
        return res.status(423).json({
          success: false,
          error: 'Account is temporarily locked due to multiple failed attempts',
          code: 'ACCOUNT_LOCKED',
          lockedUntil: user.locked_until
        });
      }

      // Verify password
      const isPasswordValid = await User.verifyPassword(user, password);
      
      if (!isPasswordValid) {
        // Handle failed login attempt
        await User.handleLoginAttempt(email, false, req.ip);
        
        req.logger?.security('Failed login attempt', {
          email,
          ip: req.ip,
          attempts: (user.login_attempts || 0) + 1
        });

        return res.status(401).json({
          success: false,
          error: 'Invalid email or password',
          code: 'INVALID_CREDENTIALS'
        });
      }

      // Handle successful login
      const updatedUser = await User.handleLoginAttempt(email, true, req.ip);

      // Get user's stores
      const userStores = await User.getUserStores(user.id);

      // Generate auth token
      const authToken = await User.generateAuthToken(updatedUser);

      // Set secure cookie
      const cookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
      };
      
      res.cookie('authToken', authToken, cookieOptions);

      req.logger?.audit('User logged in', {
        userId: user.id,
        email,
        ip: req.ip,
        storeCount: userStores.length
      });

      res.json({
        success: true,
        message: 'Login successful',
        data: {
          user: {
            id: updatedUser.id,
            email: updatedUser.email,
            firstName: updatedUser.first_name,
            lastName: updatedUser.last_name,
            role: updatedUser.role,
            emailVerified: updatedUser.email_verified,
            lastLogin: updatedUser.last_login_at
          },
          stores: userStores.map(store => ({
            id: store.id,
            shopDomain: store.shop_domain,
            plan: store.plan,
            status: store.status,
            userRole: store.user_role,
            grantedAt: store.granted_at
          })),
          token: authToken
        }
      });

    } catch (error) {
      req.logger?.error('Login failed', {
        error: error.message,
        email: req.body.email
      });

      res.status(500).json({
        success: false,
        error: 'Login failed',
        code: 'LOGIN_ERROR'
      });
    }
  }
);

// Logout
router.post('/logout', authenticate, async (req, res) => {
  try {
    // Clear auth cookie
    res.clearCookie('authToken');

    req.logger?.audit('User logged out', {
      userId: req.user.id,
      email: req.user.email
    });

    res.json({
      success: true,
      message: 'Logout successful'
    });

  } catch (error) {
    req.logger?.error('Logout failed', {
      error: error.message,
      userId: req.user?.id
    });

    res.status(500).json({
      success: false,
      error: 'Logout failed'
    });
  }
});

// Get current user profile
router.get('/me', authenticate, async (req, res) => {
  try {
    const userStores = await User.getUserStores(req.user.id);

    res.json({
      success: true,
      data: {
        user: {
          id: req.user.id,
          email: req.user.email,
          firstName: req.user.first_name,
          lastName: req.user.last_name,
          role: req.user.role,
          emailVerified: req.user.email_verified,
          lastLogin: req.user.last_login_at,
          preferences: req.user.preferences ? JSON.parse(req.user.preferences) : {}
        },
        stores: userStores.map(store => ({
          id: store.id,
          shopDomain: store.shop_domain,
          plan: store.plan,
          status: store.status,
          userRole: store.user_role,
          grantedAt: store.granted_at,
          currentMonthOrders: store.current_month_orders || 0,
          currentMonthCharges: parseFloat(store.current_month_charges || 0)
        }))
      }
    });

  } catch (error) {
    req.logger?.error('Failed to get user profile', {
      error: error.message,
      userId: req.user?.id
    });

    res.status(500).json({
      success: false,
      error: 'Failed to get profile'
    });
  }
});

// Test encryption (temporary endpoint for debugging)
router.get('/test-encryption', async (req, res) => {
  try {
    const encryptionService = require('../utils/encryption');
    const testData = 'test-encryption-data';
    const encrypted = encryptionService.encrypt(testData);
    const decrypted = encryptionService.decrypt(encrypted);
    
    res.json({
      success: true,
      data: {
        hasEncryptionKey: !!process.env.ENCRYPTION_KEY,
        encryptionKeyLength: process.env.ENCRYPTION_KEY ? process.env.ENCRYPTION_KEY.length : 0,
        testPassed: decrypted === testData,
        environment: process.env.NODE_ENV
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      hasEncryptionKey: !!process.env.ENCRYPTION_KEY
    });
  }
});

// Update user profile
router.put('/me',
  authenticate,
  validateBody(z.object({
    firstName: z.string().min(1).max(50).optional(),
    lastName: z.string().min(1).max(50).optional(),
    preferences: z.object({}).optional()
  })),
  async (req, res) => {
    try {
      const { firstName, lastName, preferences } = req.body;
      
      const updates = {};
      if (firstName) updates.first_name = firstName;
      if (lastName) updates.last_name = lastName;
      if (preferences) updates.preferences = JSON.stringify(preferences);

      const updatedUser = await User.update(req.user.id, updates);

      req.logger?.audit('User profile updated', {
        userId: req.user.id,
        updates: Object.keys(updates)
      });

      res.json({
        success: true,
        message: 'Profile updated successfully',
        data: {
          user: {
            id: updatedUser.id,
            email: updatedUser.email,
            firstName: updatedUser.first_name,
            lastName: updatedUser.last_name,
            role: updatedUser.role,
            preferences: updatedUser.preferences ? JSON.parse(updatedUser.preferences) : {}
          }
        }
      });

    } catch (error) {
      req.logger?.error('Failed to update profile', {
        error: error.message,
        userId: req.user?.id
      });

      res.status(500).json({
        success: false,
        error: 'Failed to update profile'
      });
    }
  }
);

// Change password
router.post('/change-password',
  authenticate,
  validateBody(z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8).max(128)
  })),
  async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body;

      // Verify current password
      const isCurrentValid = await User.verifyPassword(req.user, currentPassword);
      if (!isCurrentValid) {
        return res.status(400).json({
          success: false,
          error: 'Current password is incorrect',
          code: 'INVALID_CURRENT_PASSWORD'
        });
      }

      // Update password
      await User.update(req.user.id, { password: newPassword });

      req.logger?.audit('Password changed', {
        userId: req.user.id,
        email: req.user.email
      });

      res.json({
        success: true,
        message: 'Password changed successfully'
      });

    } catch (error) {
      req.logger?.error('Failed to change password', {
        error: error.message,
        userId: req.user?.id
      });

      res.status(500).json({
        success: false,
        error: 'Failed to change password'
      });
    }
  }
);

// Request password reset
router.post('/forgot-password',
  validateBody(passwordResetRequestSchema),
  async (req, res) => {
    try {
      const { email } = req.body;

      const result = await User.generatePasswordResetToken(email);
      
      if (result) {
        req.logger?.audit('Password reset requested', {
          userId: result.user.id,
          email
        });
        
        // In a real app, you'd send an email here
        // For now, we'll return the token (remove in production)
        if (process.env.NODE_ENV === 'development') {
          res.json({
            success: true,
            message: 'Password reset token generated',
            resetToken: result.resetToken // Remove this in production!
          });
        } else {
          res.json({
            success: true,
            message: 'If an account with this email exists, you will receive a password reset email'
          });
        }
      } else {
        // Don't reveal whether user exists
        res.json({
          success: true,
          message: 'If an account with this email exists, you will receive a password reset email'
        });
      }

    } catch (error) {
      req.logger?.error('Password reset request failed', {
        error: error.message,
        email: req.body.email
      });

      res.status(500).json({
        success: false,
        error: 'Password reset request failed'
      });
    }
  }
);

// Reset password with token
router.post('/reset-password',
  validateBody(passwordResetSchema),
  async (req, res) => {
    try {
      const { token, password } = req.body;

      const user = await User.resetPassword(token, password);
      
      if (!user) {
        return res.status(400).json({
          success: false,
          error: 'Invalid or expired reset token',
          code: 'INVALID_RESET_TOKEN'
        });
      }

      req.logger?.audit('Password reset completed', {
        userId: user.id,
        email: user.email
      });

      res.json({
        success: true,
        message: 'Password reset successful'
      });

    } catch (error) {
      req.logger?.error('Password reset failed', {
        error: error.message,
        token: req.body.token?.substring(0, 8) + '...'
      });

      res.status(500).json({
        success: false,
        error: 'Password reset failed'
      });
    }
  }
);

// Verify email
router.post('/verify-email',
  validateBody(z.object({
    token: z.string().min(1)
  })),
  async (req, res) => {
    try {
      const { token } = req.body;

      const user = await User.verifyEmail(token);
      
      if (!user) {
        return res.status(400).json({
          success: false,
          error: 'Invalid or expired verification token',
          code: 'INVALID_VERIFICATION_TOKEN'
        });
      }

      req.logger?.audit('Email verified', {
        userId: user.id,
        email: user.email
      });

      res.json({
        success: true,
        message: 'Email verified successfully'
      });

    } catch (error) {
      req.logger?.error('Email verification failed', {
        error: error.message
      });

      res.status(500).json({
        success: false,
        error: 'Email verification failed'
      });
    }
  }
);

// Check authentication status
router.get('/status', optionalAuth, async (req, res) => {
  if (req.user) {
    const userStores = await User.getUserStores(req.user.id);
    
    res.json({
      success: true,
      authenticated: true,
      data: {
        user: {
          id: req.user.id,
          email: req.user.email,
          firstName: req.user.first_name,
          lastName: req.user.last_name,
          role: req.user.role
        },
        storeCount: userStores.length
      }
    });
  } else {
    res.json({
      success: true,
      authenticated: false
    });
  }
});

// Validate token endpoint
router.post('/validate', authenticate, async (req, res) => {
  res.json({
    success: true,
    valid: true,
    data: {
      userId: req.user.id,
      email: req.user.email,
      role: req.user.role,
      tokenExp: req.tokenData.exp
    }
  });
});

module.exports = router;
