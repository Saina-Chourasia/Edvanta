// Timetable Management Routes for EDVANTA
// Handles weekly timetable scheduling, duration conversions, and slot validations

import { Router } from 'express';
import { db } from '../database/db.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole, requireCampusAccess } from '../middleware/permissions.js';
import { validateTimetableSlot } from '../middleware/validation.js';
import CalendarService from '../services/calendar.service.js';
import ProgressionService from '../services/progression.service.js';

const router = Router();

// Get timetable slots
router.get('/', (req, res) => {
  const { campus_id, track_id, semester_id, batch_name, subject_id, faculty_id } = req.query;
  let sql = `
    SELECT ts.*, s.code as subject_code, s.name as subject_name, s.color as subject_color,
           u.name as faculty_name, c.name as campus_name, t.name as track_name
    FROM timetable_slots ts
    JOIN subjects s ON ts.subject_id = s.id
    JOIN users u ON ts.faculty_id = u.id
    JOIN campuses c ON ts.campus_id = c.id
    JOIN tracks t ON ts.track_id = t.id
    WHERE 1=1
  `;
  const params = [];

  if (campus_id) { sql += ` AND ts.campus_id = ?`; params.push(campus_id); }
  if (track_id) { sql += ` AND ts.track_id = ?`; params.push(track_id); }
  if (semester_id) { sql += ` AND ts.semester_id = ?`; params.push(semester_id); }
  if (batch_name) { sql += ` AND ts.batch_name = ?`; params.push(batch_name); }
  if (subject_id) { sql += ` AND ts.subject_id = ?`; params.push(subject_id); }
  if (faculty_id) { sql += ` AND ts.faculty_id = ?`; params.push(faculty_id); }

  sql += ` ORDER BY ts.weekday ASC, ts.start_time ASC`;
  const slots = db.query(sql, params);

  // Group summary by subject and weekday
  const summaryBySubject = {};
  for (const slot of slots) {
    if (!summaryBySubject[slot.subject_code]) {
      summaryBySubject[slot.subject_code] = {
        subject_name: slot.subject_name,
        total_weekly_hours: 0,
        slots_count: 0
      };
    }
    summaryBySubject[slot.subject_code].total_weekly_hours += slot.duration_hours;
    summaryBySubject[slot.subject_code].slots_count++;
  }

  res.json({ slots, summaryBySubject });
});

// Add timetable slot (Admin or Campus Manager)
router.post('/', authenticate, requireRole('ADMIN', 'CAMPUS_MANAGER'), requireCampusAccess('campus_id'), validateTimetableSlot, (req, res) => {
  const {
    campus_id,
    track_id,
    semester_id,
    batch_name,
    subject_id,
    faculty_id,
    weekday,
    start_time,
    end_time,
    room = ''
  } = req.body;

  // Calculate duration in exact decimal hours (Requirement 6)
  let duration_hours = 0;
  try {
    duration_hours = CalendarService.calculateDurationHours(start_time, end_time);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  // Check for duplicate slot in same campus/batch/weekday/start_time
  const existing = db.get(`
    SELECT id FROM timetable_slots
    WHERE campus_id = ? AND batch_name = ? AND weekday = ? AND start_time = ?
  `, [campus_id, batch_name, weekday, start_time]);

  if (existing) {
    return res.status(409).json({
      error: `Conflict: A timetable slot already exists for ${batch_name} on weekday ${weekday} at ${start_time}.`
    });
  }

  const slotId = `slot_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;

  try {
    db.run(`
      INSERT INTO timetable_slots (id, campus_id, track_id, semester_id, batch_name, subject_id, faculty_id, weekday, start_time, end_time, duration_hours, room)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [slotId, campus_id, track_id, semester_id, batch_name, subject_id, faculty_id, weekday, start_time, end_time, duration_hours, room]);

    // Recalculate planned dates for the affected subject
    ProgressionService.generatePlannedTopicDates(subject_id);

    res.status(201).json({
      id: slotId,
      duration_hours: Number(duration_hours.toFixed(4)),
      message: 'Timetable slot created and syllabus progression recalculated.'
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete timetable slot
router.delete('/:id', authenticate, requireRole('ADMIN', 'CAMPUS_MANAGER'), (req, res) => {
  const slot = db.get(`SELECT * FROM timetable_slots WHERE id = ?`, [req.params.id]);
  if (!slot) {
    return res.status(404).json({ error: 'Timetable slot not found.' });
  }

  db.run(`DELETE FROM timetable_slots WHERE id = ?`, [req.params.id]);
  ProgressionService.generatePlannedTopicDates(slot.subject_id);

  res.json({ message: 'Timetable slot deleted and progression recalculated.' });
});

export default router;
