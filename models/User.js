const db = require('../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

class User {
  static tableName = 'users';

  static async findById(id) {
    return await db(this.tableName).where({ id }).first();
  }

  static async findByEmail(email) {
    return await db(this.tableName).where({ email: email.toLowerCase() }).first();
  }

  static async create(userData) {
    const { email, password, firstName, lastName, role = 'store_owner' } = userData;
    
    // Hash password
    const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);
    
    const [id] = await db(this.tableName).insert({
      email: email.toLowerCase(),
      password_hash: passwordHash,
      first_name: firstName,
      last_name: lastName,
      role,
      email_verification_token: crypto.randomBytes(32).toString('hex')
    });

    return await this.findById(id);
  }

  static async update(id, updates) {
    const updateData = { ...updates };
    
    // Handle password update
    if (updateData.password) {
      const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
      updateData.password_hash = await bcrypt.hash(updateData.password, saltRounds);
      delete updateData.password;
    }
    
    // Handle email update
    if (updateData.email) {
      updateData.email = updateData.email.toLowerCase();
    }

    await db(this.tableName).where({ id }).update(updateData);
    return await this.findById(id);
  }

  static async verifyPassword(user, password) {
    return await bcrypt.compare(password, user.password_hash);
  }

  static async generateAuthToken(user) {
    const payload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      iat: Math.floor(Date.now() / 1000)
    };

    const secret = process.env.JWT_SECRET || 'your-secret-key';
    const expiresIn = process.env.JWT_EXPIRES_IN || '24h';

    return jwt.sign(payload, secret, { expiresIn });
  }

  static async verifyAuthToken(token) {
    try {
      const secret = process.env.JWT_SECRET || 'your-secret-key';
      const decoded = jwt.verify(token, secret);
      
      // Check if user still exists and is active
      const user = await this.findById(decoded.userId);
      if (!user || user.status !== 'active') {
        return null;
      }

      return { user, decoded };
    } catch (error) {
      return null;
    }
  }

  static async handleLoginAttempt(email, success, ip = null) {
    const user = await this.findByEmail(email);
    if (!user) return null;

    if (success) {
      // Reset login attempts and update last login
      await db(this.tableName).where({ id: user.id }).update({
        login_attempts: 0,
        locked_until: null,
        last_login_at: new Date(),
        last_login_ip: ip
      });
    } else {
      // Increment login attempts
      const newAttempts = (user.login_attempts || 0) + 1;
      const maxAttempts = parseInt(process.env.MAX_LOGIN_ATTEMPTS) || 5;
      const lockoutMinutes = parseInt(process.env.LOCKOUT_MINUTES) || 30;
      
      const updateData = { login_attempts: newAttempts };
      
      // Lock account if too many attempts
      if (newAttempts >= maxAttempts) {
        updateData.locked_until = new Date(Date.now() + lockoutMinutes * 60 * 1000);
      }
      
      await db(this.tableName).where({ id: user.id }).update(updateData);
    }

    return await this.findById(user.id);
  }

  static async isAccountLocked(user) {
    if (!user.locked_until) return false;
    
    const now = new Date();
    const lockedUntil = new Date(user.locked_until);
    
    if (now > lockedUntil) {
      // Unlock account
      await db(this.tableName).where({ id: user.id }).update({
        locked_until: null,
        login_attempts: 0
      });
      return false;
    }
    
    return true;
  }

  static async generatePasswordResetToken(email) {
    const user = await this.findByEmail(email);
    if (!user) return null;

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await db(this.tableName).where({ id: user.id }).update({
      password_reset_token: resetToken,
      password_reset_expires: resetExpires
    });

    return { user, resetToken };
  }

  static async resetPassword(token, newPassword) {
    const user = await db(this.tableName)
      .where({ password_reset_token: token })
      .where('password_reset_expires', '>', new Date())
      .first();

    if (!user) return null;

    const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
    const passwordHash = await bcrypt.hash(newPassword, saltRounds);

    await db(this.tableName).where({ id: user.id }).update({
      password_hash: passwordHash,
      password_reset_token: null,
      password_reset_expires: null,
      login_attempts: 0,
      locked_until: null
    });

    return await this.findById(user.id);
  }

  static async verifyEmail(token) {
    const user = await db(this.tableName)
      .where({ email_verification_token: token })
      .first();

    if (!user) return null;

    await db(this.tableName).where({ id: user.id }).update({
      email_verified: true,
      email_verification_token: null
    });

    return await this.findById(user.id);
  }

  // Get user's accessible stores
  static async getUserStores(userId, includeInactive = false) {
    let query = db('user_stores as us')
      .join('stores as s', 'us.store_id', 's.id')
      .where('us.user_id', userId)
      .where('us.status', 'active');

    if (!includeInactive) {
      query = query.where('s.status', 'active');
    }

    const stores = await query.select(
      's.*',
      'us.role as user_role',
      'us.permissions as user_permissions',
      'us.granted_at'
    );

    return stores;
  }

  // Check if user has access to a specific store
  static async hasStoreAccess(userId, storeId, requiredRole = null) {
    let query = db('user_stores')
      .where({ user_id: userId, store_id: storeId, status: 'active' });

    if (requiredRole) {
      const roleHierarchy = ['viewer', 'manager', 'admin', 'owner'];
      const requiredLevel = roleHierarchy.indexOf(requiredRole);
      const userAccess = await query.first();
      
      if (!userAccess) return false;
      
      const userLevel = roleHierarchy.indexOf(userAccess.role);
      return userLevel >= requiredLevel;
    }

    const access = await query.first();
    return !!access;
  }

  // Grant store access to user
  static async grantStoreAccess(userId, storeId, role = 'viewer', grantedBy = null) {
    const existing = await db('user_stores')
      .where({ user_id: userId, store_id: storeId })
      .first();

    if (existing) {
      // Update existing access
      await db('user_stores')
        .where({ user_id: userId, store_id: storeId })
        .update({ role, status: 'active', granted_by: grantedBy });
    } else {
      // Create new access
      await db('user_stores').insert({
        user_id: userId,
        store_id: storeId,
        role,
        granted_by: grantedBy
      });
    }

    return true;
  }

  // Revoke store access
  static async revokeStoreAccess(userId, storeId) {
    await db('user_stores')
      .where({ user_id: userId, store_id: storeId })
      .update({ status: 'inactive' });

    return true;
  }

  static async list(filters = {}) {
    let query = db(this.tableName);
    
    if (filters.status) {
      query = query.where({ status: filters.status });
    }
    
    if (filters.role) {
      query = query.where({ role: filters.role });
    }
    
    if (filters.email) {
      query = query.where('email', 'like', `%${filters.email}%`);
    }

    return await query
      .select('id', 'email', 'first_name', 'last_name', 'role', 'status', 'last_login_at', 'created_at')
      .orderBy('created_at', 'desc');
  }

  static async delete(id) {
    // This will cascade delete user_stores due to foreign key constraint
    return await db(this.tableName).where({ id }).del();
  }
}

module.exports = User;
