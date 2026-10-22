// Campuses and Tracks Routes for EDVANTA

import { Router } from 'express';
import { db } from '../database/db.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/permissions.js';

const router = Router();

// Get all campuses
router.get('/campuses', async (req, res) => {
  try {
    const campuses = await db.query(`SELECT * FROM campuses ORDER BY name ASC`);
    res.json({ campuses });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all tracks
router.get('/tracks', async (req, res) => {
  try {
    const tracks = await db.query(`SELECT * FROM tracks ORDER BY name ASC`);
    res.json({ tracks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin add campus
router.post('/campuses', authenticate, requireRole('ADMIN'), async (req, res) => {
  const { name, code, timezone = 'Asia/Kolkata' } = req.body;
  if (!name || !code) {
    return res.status(400).json({ error: 'Campus name and code are required.' });
  }

  const id = `camp_${code.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  try {
    await db.run(`
      INSERT INTO campuses (id, name, code, timezone)
      VALUES (?, ?, ?, ?)
    `, [id, name, code.toUpperCase(), timezone]);
    res.status(201).json({ id, name, code, timezone });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
