// Campuses and Tracks Routes for EDVANTA

import { Router } from 'express';
import { db } from '../database/db.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/permissions.js';

const router = Router();

// Get all campuses
router.get('/campuses', (req, res) => {
  const campuses = db.query(`SELECT * FROM campuses ORDER BY name ASC`);
  res.json({ campuses });
});

// Get all tracks
router.get('/tracks', (req, res) => {
  const tracks = db.query(`SELECT * FROM tracks ORDER BY name ASC`);
  res.json({ tracks });
});

// Admin add campus
router.post('/campuses', authenticate, requireRole('ADMIN'), (req, res) => {
  const { name, code, timezone = 'Asia/Kolkata' } = req.body;
  if (!name || !code) {
    return res.status(400).json({ error: 'Campus name and code are required.' });
  }

  const id = `camp_${code.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  try {
    db.run(`
      INSERT INTO campuses (id, name, code, timezone)
      VALUES (?, ?, ?, ?)
    `, [id, name, code.toUpperCase(), timezone]);
    res.status(201).json({ id, name, code, timezone });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
