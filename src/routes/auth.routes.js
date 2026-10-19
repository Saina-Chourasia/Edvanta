// Authentication Routes for EDVANTA
// Production-ready authentication supporting Email or Phone login, password management, and RBAC

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../database/db.js';
import { authenticate, generateToken } from '../middleware/auth.js';
import { requireRole } from '../middleware/permissions.js';

const router = Router();

// 1. Standard Login (Accepts email OR phone number + password)
router.post('/login', async (req, res) => {
  try {
    const { identifier, email, phone, password } = req.body;
    const inputId = (identifier || email || phone || '').trim();

    if (!inputId || !password) {
      return res.status(400).json({ error: 'Email/Phone and password are required.' });
    }

    const user = db.get(`
      SELECT u.*, c.name as campus_name
      FROM users u
      LEFT JOIN campuses c ON u.campus_id = c.id
      WHERE LOWER(u.email) = LOWER(?) OR u.phone = ?
    `, [inputId, inputId]);

    if (!user) {
      return res.status(401).json({ error: 'Invalid email/phone or password.' });
    }

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid email/phone or password.' });
    }

    const token = generateToken(user);
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone || null,
        name: user.name,
        role: user.role,
        campus_id: user.campus_id,
        campus_name: user.campus_name || null,
        batch_name: user.batch_name
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error during authentication.' });
  }
});

// 2. Change Password Flow (Authenticated)
router.post('/change-password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required.' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters long.' });
    }

    const user = db.get(`SELECT * FROM users WHERE id = ?`, [req.user.id]);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const isValid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    db.run(`UPDATE users SET password_hash = ? WHERE id = ?`, [newHash, user.id]);

    res.json({ message: 'Password changed successfully.' });
  } catch (err) {
    console.error('Password change error:', err);
    res.status(500).json({ error: 'Failed to update password.' });
  }
});

// 3. Admin Account Creation Flow (Controlled user provisioning)
router.post('/users', authenticate, requireRole('ADMIN'), async (req, res) => {
  try {
    const { email, phone, name, role, campus_id, batch_name, password } = req.body;

    if (!email || !name || !role || !password) {
      return res.status(400).json({ error: 'Email, name, role, and password are required.' });
    }

    const allowedRoles = ['CAMPUS_MANAGER', 'FACULTY', 'STUDENT'];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ error: `Invalid role. Allowed roles: ${allowedRoles.join(', ')}` });
    }

    // Check unique email
    const existingEmail = db.get(`SELECT id FROM users WHERE LOWER(email) = LOWER(?)`, [email.trim()]);
    if (existingEmail) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    // Check unique phone if provided
    if (phone) {
      const existingPhone = db.get(`SELECT id FROM users WHERE phone = ?`, [phone.trim()]);
      if (existingPhone) {
        return res.status(409).json({ error: 'An account with this phone number already exists.' });
      }
    }

    const hash = await bcrypt.hash(password, 10);
    const userId = `usr_${role.toLowerCase().slice(0, 3)}_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;

    db.run(`
      INSERT INTO users (id, email, phone, password_hash, name, role, campus_id, batch_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      userId,
      email.trim().toLowerCase(),
      phone ? phone.trim() : null,
      hash,
      name.trim(),
      role,
      campus_id || null,
      batch_name || null
    ]);

    res.status(201).json({
      message: 'Account created successfully.',
      user: {
        id: userId,
        email: email.trim().toLowerCase(),
        phone: phone ? phone.trim() : null,
        name: name.trim(),
        role,
        campus_id: campus_id || null,
        batch_name: batch_name || null
      }
    });
  } catch (err) {
    console.error('Account creation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 4. Logout Endpoint
router.post('/logout', (req, res) => {
  res.json({ message: 'Logged out successfully.' });
});

// 5. Get Current Authenticated User Profile
router.get('/me', authenticate, (req, res) => {
  const user = db.get(`
    SELECT u.id, u.email, u.phone, u.name, u.role, u.campus_id, u.batch_name, c.name as campus_name
    FROM users u
    LEFT JOIN campuses c ON u.campus_id = c.id
    WHERE u.id = ?
  `, [req.user.id]);

  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }
  res.json({ user });
});

// 6. Test Suite & Developer Token Generator (Preserved for automated tests)
router.post('/quick-login', (req, res) => {
  try {
    const { role, userId } = req.body;

    let user = null;
    if (userId) {
      user = db.get(`
        SELECT u.*, c.name as campus_name
        FROM users u
        LEFT JOIN campuses c ON u.campus_id = c.id
        WHERE u.id = ?
      `, [userId]);
    } else if (role) {
      user = db.get(`
        SELECT u.*, c.name as campus_name
        FROM users u
        LEFT JOIN campuses c ON u.campus_id = c.id
        WHERE u.role = ?
        LIMIT 1
      `, [role.toUpperCase()]);
    }

    if (!user) {
      return res.status(404).json({ error: 'User not found for requested role.' });
    }

    const token = generateToken(user);
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone || null,
        name: user.name,
        role: user.role,
        campus_id: user.campus_id,
        campus_name: user.campus_name || null,
        batch_name: user.batch_name
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error during quick login.' });
  }
});

// 7. Get users list (for Admin management)
router.get('/users', authenticate, requireRole('ADMIN'), (req, res) => {
  const users = db.query(`
    SELECT u.id, u.email, u.phone, u.name, u.role, u.campus_id, u.batch_name, c.name as campus_name, u.created_at
    FROM users u
    LEFT JOIN campuses c ON u.campus_id = c.id
    ORDER BY CASE u.role
      WHEN 'ADMIN' THEN 1
      WHEN 'CAMPUS_MANAGER' THEN 2
      WHEN 'FACULTY' THEN 3
      WHEN 'STUDENT' THEN 4
      ELSE 5 END, u.name ASC
  `);
  res.json({ users });
});

export default router;
