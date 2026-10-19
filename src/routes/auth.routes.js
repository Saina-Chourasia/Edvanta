// Authentication Routes for EDVANTA
// Supports standard credential login and 1-click test role login for hackathon review

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../database/db.js';
import { authenticate, generateToken } from '../middleware/auth.js';

const router = Router();

// Standard Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const user = db.get(`SELECT * FROM users WHERE LOWER(email) = LOWER(?)`, [email.trim()]);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = generateToken(user);
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        campus_id: user.campus_id,
        batch_name: user.batch_name
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error during authentication.' });
  }
});

// Quick 1-Click Role Login for demo and pair programming evaluation
router.post('/quick-login', (req, res) => {
  try {
    const { role, userId } = req.body;

    let user = null;
    if (userId) {
      user = db.get(`SELECT * FROM users WHERE id = ?`, [userId]);
    } else if (role) {
      user = db.get(`SELECT * FROM users WHERE role = ? LIMIT 1`, [role.toUpperCase()]);
    }

    if (!user) {
      return res.status(404).json({ error: 'Demo user not found for requested role.' });
    }

    const token = generateToken(user);
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        campus_id: user.campus_id,
        batch_name: user.batch_name
      }
    });
  } catch (error) {
    console.error('Quick login error:', error);
    res.status(500).json({ error: 'Internal server error during quick login.' });
  }
});

// Get Current Authenticated User Profile
router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

// List demo accounts for easy role switching in frontend
router.get('/demo-users', (req, res) => {
  const users = db.query(`
    SELECT u.id, u.email, u.name, u.role, u.campus_id, u.batch_name, c.name as campus_name
    FROM users u
    LEFT JOIN campuses c ON u.campus_id = c.id
    ORDER BY CASE u.role
      WHEN 'ADMIN' THEN 1
      WHEN 'CAMPUS_MANAGER' THEN 2
      WHEN 'FACULTY' THEN 3
      WHEN 'STUDENT' THEN 4
      ELSE 5 END
  `);
  res.json({ users });
});

export default router;
