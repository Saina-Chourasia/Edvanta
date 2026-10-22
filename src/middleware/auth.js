// Authentication Middleware for EDVANTA
// Verifies JWT tokens and attaches authenticated user context to request

import jwt from 'jsonwebtoken';
import { db } from '../database/db.js';

export const JWT_SECRET = process.env.JWT_SECRET || 'edvanta-msot-academic-tracker-secret-2026';

export async function authenticate(req, res, next) {
  let token = null;
  const authHeader = req.headers.authorization;
  if (authHeader) {
    token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  } else if (req.headers.cookie) {
    const match = req.headers.cookie.match(/(?:^|;\s*)edvanta_token=([^;]+)/);
    if (match) token = decodeURIComponent(match[1]);
  }

  if (!token) {
    return res.status(401).json({ error: 'Authentication required. No authorization header provided.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Fetch latest user info from DB to guarantee current role/campus
    const user = await db.get(`
      SELECT id, email, name, role, campus_id, batch_name
      FROM users
      WHERE id = ?
    `, [decoded.id]);

    if (!user) {
      return res.status(401).json({ error: 'User account no longer exists.' });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired authentication token.' });
  }
}

// Optional auth - populates req.user if token is valid, but does not block if missing
export async function optionalAuth(req, res, next) {
  let token = null;
  const authHeader = req.headers.authorization;
  if (authHeader) {
    token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  } else if (req.headers.cookie) {
    const match = req.headers.cookie.match(/(?:^|;\s*)edvanta_token=([^;]+)/);
    if (match) token = decodeURIComponent(match[1]);
  }

  if (!token) {
    return next();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await db.get(`
      SELECT id, email, name, role, campus_id, batch_name
      FROM users
      WHERE id = ?
    `, [decoded.id]);
    if (user) req.user = user;
  } catch (err) {
    // ignore in optional
  }
  next();
}

export function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      campus_id: user.campus_id,
      name: user.name,
      batch_name: user.batch_name
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

export default { authenticate, optionalAuth, generateToken, JWT_SECRET };
