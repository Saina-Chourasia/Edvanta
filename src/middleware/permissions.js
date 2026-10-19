// Role-Based Access Control (RBAC) & Data Isolation Middleware for EDVANTA

import { db } from '../database/db.js';

/**
 * Require one of specified roles
 */
export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Access denied. Role '${req.user.role}' is not authorized for this resource. Required: ${allowedRoles.join(', ')}.`
      });
    }

    next();
  };
}

/**
 * Enforce campus boundary isolation.
 * Admin can access all campuses. Campus Managers can only access their assigned campus.
 */
export function requireCampusAccess(paramName = 'campusId') {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required.' });
    if (req.user.role === 'ADMIN') return next();

    const targetCampusId = req.params[paramName] || req.body[paramName] || req.query[paramName];
    if (!targetCampusId) return next(); // If not campus-specific, proceed

    if (req.user.campus_id && req.user.campus_id !== targetCampusId) {
      return res.status(403).json({
        error: `Access denied. You are only authorized to access campus '${req.user.campus_id}'.`
      });
    }

    next();
  };
}

/**
 * Ensure faculty can ONLY view/log sessions for subjects assigned to them.
 */
export function requireSubjectAccess(paramName = 'subjectId') {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required.' });
    if (req.user.role === 'ADMIN' || req.user.role === 'CAMPUS_MANAGER') return next();

    const targetSubjectId = req.params[paramName] || req.body[paramName] || req.query[paramName];
    if (!targetSubjectId) return next();

    const subject = db.get(`SELECT id, faculty_id, name, code FROM subjects WHERE id = ?`, [targetSubjectId]);
    if (!subject) {
      return res.status(404).json({ error: `Subject ${targetSubjectId} not found.` });
    }

    if (req.user.role === 'FACULTY' && subject.faculty_id !== req.user.id) {
      return res.status(403).json({
        error: `Access denied. You are not assigned to teach subject ${subject.code} (${subject.name}).`
      });
    }

    next();
  };
}

/**
 * Strictly prevent students from performing any mutation (POST, PUT, PATCH, DELETE)
 */
export function preventStudentMutations(req, res, next) {
  if (req.user && req.user.role === 'STUDENT') {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      return res.status(403).json({
        error: 'Forbidden. Students have read-only access to academic progression records.'
      });
    }
  }
  next();
}

export default {
  requireRole,
  requireCampusAccess,
  requireSubjectAccess,
  preventStudentMutations
};
