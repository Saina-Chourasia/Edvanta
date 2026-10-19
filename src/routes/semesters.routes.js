// Semester and Academic Calendar Routes for EDVANTA
// Manages semesters, working Saturday rules, holidays, and exam windows

import { Router } from 'express';
import { db } from '../database/db.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole, preventStudentMutations } from '../middleware/permissions.js';
import { validateSemester } from '../middleware/validation.js';
import ProgressionService from '../services/progression.service.js';

const router = Router();

// Get list of semesters
router.get('/', (req, res) => {
  const { campus_id, track_id } = req.query;
  let sql = `
    SELECT s.*, c.name as campus_name, t.name as track_name
    FROM semesters s
    JOIN campuses c ON s.campus_id = c.id
    JOIN tracks t ON s.track_id = t.id
    WHERE 1=1
  `;
  const params = [];

  if (campus_id) {
    sql += ` AND s.campus_id = ?`;
    params.push(campus_id);
  }
  if (track_id) {
    sql += ` AND s.track_id = ?`;
    params.push(track_id);
  }

  sql += ` ORDER BY s.start_date DESC`;
  const semesters = db.query(sql, params);
  res.json({ semesters });
});

// Create semester (Admin only)
router.post('/', authenticate, requireRole('ADMIN'), validateSemester, (req, res) => {
  const {
    name,
    campus_id,
    track_id,
    batch_name,
    start_date,
    end_date,
    working_saturday_rule = 'SECOND_AND_FOURTH',
    target_finish_date
  } = req.body;

  const id = `sem_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;

  try {
    db.run(`
      INSERT INTO semesters (id, name, campus_id, track_id, batch_name, start_date, end_date, working_saturday_rule, target_finish_date, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `, [id, name, campus_id, track_id, batch_name, start_date, end_date, working_saturday_rule, target_finish_date]);

    res.status(201).json({ id, message: 'Semester created successfully.' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get calendar events / holidays for a semester
router.get('/:id/calendar', (req, res) => {
  const events = db.query(`
    SELECT * FROM calendar_events
    WHERE semester_id = ?
    ORDER BY event_date ASC
  `, [req.params.id]);

  res.json({ events });
});

// Add calendar event / holiday (Admin / Campus Manager)
router.post('/:id/calendar', authenticate, requireRole('ADMIN', 'CAMPUS_MANAGER'), (req, res) => {
  const { event_date, event_type, title, description, affects_schedule = 1 } = req.body;
  const semesterId = req.params.id;

  if (!event_date || !event_type || !title) {
    return res.status(400).json({ error: 'event_date, event_type, and title are required.' });
  }

  const semester = db.get(`SELECT * FROM semesters WHERE id = ?`, [semesterId]);
  if (!semester) {
    return res.status(404).json({ error: 'Semester not found.' });
  }

  if (req.user.role === 'CAMPUS_MANAGER' && req.user.campus_id && req.user.campus_id !== semester.campus_id) {
    return res.status(403).json({
      error: `Access denied. You can only add calendar events for your assigned campus '${req.user.campus_id}'.`
    });
  }

  const eventId = `ev_${semester.campus_id}_${event_date}_${Math.random().toString(36).substr(2, 4)}`;

  try {
    db.run(`
      INSERT INTO calendar_events (id, semester_id, campus_id, event_date, event_type, title, description, affects_schedule)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [eventId, semesterId, semester.campus_id, event_date, event_type, title, description || '', affects_schedule ? 1 : 0]);

    // Requirement 5: Adding a holiday must recalculate affected future planned topic dates!
    if (affects_schedule && event_type === 'HOLIDAY') {
      const subjects = db.query(`SELECT id FROM subjects WHERE semester_id = ?`, [semesterId]);
      for (const subj of subjects) {
        ProgressionService.generatePlannedTopicDates(subj.id);
      }
    }

    res.status(201).json({ id: eventId, message: 'Calendar event added and affected topic dates recalculated.' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Remove calendar event / holiday
router.delete('/:id/calendar/:eventId', authenticate, requireRole('ADMIN', 'CAMPUS_MANAGER'), (req, res) => {
  const { id: semesterId, eventId } = req.params;

  const event = db.get(`SELECT * FROM calendar_events WHERE id = ? AND semester_id = ?`, [eventId, semesterId]);
  if (!event) {
    return res.status(404).json({ error: 'Calendar event not found.' });
  }

  db.run(`DELETE FROM calendar_events WHERE id = ?`, [eventId]);

  // Recalculate affected subjects
  const subjects = db.query(`SELECT id FROM subjects WHERE semester_id = ?`, [semesterId]);
  for (const subj of subjects) {
    ProgressionService.generatePlannedTopicDates(subj.id);
  }

  res.json({ message: 'Calendar event removed and schedules updated.' });
});

// Get exam windows for a semester
router.get('/:id/exams', (req, res) => {
  const exams = db.query(`
    SELECT * FROM exam_windows
    WHERE semester_id = ?
    ORDER BY start_date ASC
  `, [req.params.id]);

  res.json({ exams });
});

export default router;
