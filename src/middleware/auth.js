// Authentication Middleware for EDVANTA
// Verifies JWT tokens and attaches authenticated user context to request

import jwt from 'jsonwebtoken';
import { db } from '../database/db.js';

export const JWT_SECRET = process.env.JWT_SECRET || 'edvanta-msot-academic-tracker-secret-2026';

export function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Authentication required. No authorization header provided.' });
  }

  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Fetch latest user info from DB to guarantee current role/campus
    const user = db.get(`
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
export function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return next();
  }

  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.get(`
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
