const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { logger } = require('../utils/logger');

// Extract token from request
const extractToken = (req) => {
  // Check Authorization header (Bearer token)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  
  // Check cookies
  if (req.cookies && req.cookies.authToken) {
    return req.cookies.authToken;
  }
  
  // Check query parameter (for webhooks/special cases)
  if (req.query.token) {
    return req.query.token;
  }
  
  return null;
};

// Main authentication middleware
const authenticate = async (req, res, next) => {
  try {
    const token = extractToken(req);
    
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        code: 'NO_TOKEN'
      });
    }

    const verification = await User.verifyAuthToken(token);
    
    if (!verification) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired token',
        code: 'INVALID_TOKEN'
      });
    }

    const { user, decoded } = verification;

    // Check if account is locked
    const isLocked = await User.isAccountLocked(user);
    if (isLocked) {
      return res.status(423).json({
        success: false,
        error: 'Account is temporarily locked',
        code: 'ACCOUNT_LOCKED'
      });
    }

    // Attach user info to request with session isolation
    req.user = user;
    req.tokenData = decoded;
    req.sessionId = `${user.id}_${decoded.iat}`;
    
    // Get user's accessible stores for session context
    const userStores = await User.getUserStores(user.id);
    req.userStores = userStores;
    req.userStoreIds = userStores.map(store => store.id);

    // Update logger context with user info
    if (req.logger) {
      req.logger = req.logger.child({
        userId: user.id,
        userEmail: user.email,
        userRole: user.role,
        sessionId: req.sessionId,
        accessibleStores: req.userStoreIds.length
      });
    }

    next();
  } catch (error) {
    req.logger?.error('Authentication middleware error', {
      error: error.message
    });
    
    res.status(500).json({
      success: false,
      error: 'Authentication failed',
      code: 'AUTH_ERROR'
    });
  }
};

// Optional authentication (doesn't fail if no token)
const optionalAuth = async (req, res, next) => {
  const token = extractToken(req);
  
  if (token) {
    try {
      const verification = await User.verifyAuthToken(token);
      if (verification && !await User.isAccountLocked(verification.user)) {
        req.user = verification.user;
        req.tokenData = verification.decoded;
        
        if (req.logger) {
          req.logger = req.logger.child({
            userId: verification.user.id,
            userEmail: verification.user.email,
            userRole: verification.user.role
          });
        }
      }
    } catch (error) {
      // Silently continue without authentication
      req.logger?.debug('Optional auth failed', { error: error.message });
    }
  }
  
  next();
};

// Role-based authorization
const requireRole = (requiredRole) => {
  const roleHierarchy = ['store_owner', 'manager', 'admin'];
  const requiredLevel = roleHierarchy.indexOf(requiredRole);
  
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        code: 'NO_AUTH'
      });
    }
    
    const userLevel = roleHierarchy.indexOf(req.user.role);
    
    if (userLevel < requiredLevel) {
      req.logger?.security('Insufficient permissions', {
        requiredRole,
        userRole: req.user.role,
        userId: req.user.id
      });
      
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions',
        code: 'INSUFFICIENT_ROLE',
        required: requiredRole,
        current: req.user.role
      });
    }
    
    next();
  };
};

// Store access authorization
const requireStoreAccess = (requiredRole = 'viewer') => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
          code: 'NO_AUTH'
        });
      }

      const storeId = req.params.storeId || req.body.storeId;
      
      if (!storeId) {
        return res.status(400).json({
          success: false,
          error: 'Store ID required',
          code: 'NO_STORE_ID'
        });
      }

      // Admin users have access to all stores
      if (req.user.role === 'admin') {
        return next();
      }

      // Check store-specific access
      const hasAccess = await User.hasStoreAccess(req.user.id, storeId, requiredRole);
      
      if (!hasAccess) {
        req.logger?.security('Store access denied', {
          userId: req.user.id,
          storeId,
          requiredRole,
          userRole: req.user.role
        });
        
        return res.status(403).json({
          success: false,
          error: 'Access denied to this store',
          code: 'STORE_ACCESS_DENIED',
          storeId,
          required: requiredRole
        });
      }

      next();
    } catch (error) {
      req.logger?.error('Store access check failed', {
        error: error.message,
        userId: req.user?.id,
        storeId: req.params.storeId || req.body.storeId
      });
      
      res.status(500).json({
        success: false,
        error: 'Access check failed',
        code: 'ACCESS_CHECK_ERROR'
      });
    }
  };
};

// Rate limiting per user
const userRateLimit = (maxRequests = 100, windowMs = 15 * 60 * 1000) => {
  const userRequests = new Map();
  
  return (req, res, next) => {
    if (!req.user) return next();
    
    const userId = req.user.id;
    const now = Date.now();
    const windowStart = now - windowMs;
    
    // Clean old entries
    if (userRequests.has(userId)) {
      const requests = userRequests.get(userId);
      const validRequests = requests.filter(time => time > windowStart);
      userRequests.set(userId, validRequests);
    }
    
    const userRequestCount = userRequests.get(userId)?.length || 0;
    
    if (userRequestCount >= maxRequests) {
      req.logger?.security('User rate limit exceeded', {
        userId,
        requestCount: userRequestCount,
        maxRequests
      });
      
      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded',
        code: 'USER_RATE_LIMIT',
        retryAfter: Math.ceil(windowMs / 1000)
      });
    }
    
    // Record this request
    const requests = userRequests.get(userId) || [];
    requests.push(now);
    userRequests.set(userId, requests);
    
    next();
  };
};

// Admin-only middleware (app owner access)
const requireAppOwner = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required',
      code: 'NO_AUTH'
    });
  }
  
  // Check if user is app owner (admin role)
  if (req.user.role !== 'admin') {
    req.logger?.security('App owner access denied', {
      userId: req.user.id,
      userRole: req.user.role,
      attemptedAccess: 'admin_panel'
    });
    
    return res.status(403).json({
      success: false,
      error: 'App owner access required',
      code: 'ADMIN_ACCESS_DENIED',
      userRole: req.user.role
    });
  }
  
  next();
};

// Refresh token middleware
const refreshToken = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        code: 'NO_AUTH'
      });
    }

    // Check if token is close to expiry (within 1 hour)
    const tokenExp = req.tokenData.exp * 1000; // Convert to milliseconds
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    
    if (tokenExp - now < oneHour) {
      // Generate new token
      const newToken = await User.generateAuthToken(req.user);
      
      // Set new token in cookie and header
      const cookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
      };
      
      res.cookie('authToken', newToken, cookieOptions);
      res.header('X-New-Token', newToken);
      
      req.logger?.info('Token refreshed', {
        userId: req.user.id,
        oldExp: new Date(tokenExp),
        newExp: new Date(now + 24 * 60 * 60 * 1000)
      });
    }
    
    next();
  } catch (error) {
    req.logger?.error('Token refresh failed', {
      error: error.message,
      userId: req.user?.id
    });
    
    // Continue without refresh - not critical
    next();
  }
};

module.exports = {
  authenticate,
  optionalAuth,
  requireRole,
  requireStoreAccess,
  requireAppOwner,
  userRateLimit,
  refreshToken,
  extractToken
};
