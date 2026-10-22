// Syllabus and Lesson Plan Routes for EDVANTA
// Manages subjects, units, topics, planned hours, exam scopes, and completion tracking

import { Router } from 'express';
import { db } from '../database/db.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole, requireSubjectAccess } from '../middleware/permissions.js';
import ProgressionService from '../services/progression.service.js';

const router = Router();

// Get subjects list
router.get('/subjects', async (req, res) => {
  const { semester_id, campus_id, track_id, faculty_id } = req.query;
  let sql = `
    SELECT s.*, c.name as campus_name, t.name as track_name, sem.name as semester_name,
           sem.batch_name, u.name as faculty_name, u.email as faculty_email
    FROM subjects s
    JOIN campuses c ON s.campus_id = c.id
    JOIN tracks t ON s.track_id = t.id
    JOIN semesters sem ON s.semester_id = sem.id
    LEFT JOIN users u ON s.faculty_id = u.id
    WHERE 1=1
  `;
  const params = [];

  if (semester_id) { sql += ` AND s.semester_id = ?`; params.push(semester_id); }
  if (campus_id) { sql += ` AND s.campus_id = ?`; params.push(campus_id); }
  if (track_id) { sql += ` AND s.track_id = ?`; params.push(track_id); }
  if (faculty_id) { sql += ` AND s.faculty_id = ?`; params.push(faculty_id); }

  sql += ` ORDER BY s.code ASC`;
  try {
    const subjects = await db.query(sql, params);
    res.json({ subjects });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get topics for a specific subject
router.get('/subjects/:id/topics', async (req, res) => {
  const subjectId = req.params.id;
  try {
    const topics = await db.query(`
      SELECT lp.*, s.code as subject_code, s.name as subject_name
      FROM lesson_plans lp
      JOIN subjects s ON lp.subject_id = s.id
      WHERE lp.subject_id = ?
      ORDER BY lp.sequence_order ASC
    `, [subjectId]);

    res.json({ topics });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add topic to subject (Admin or Assigned Faculty)
router.post('/subjects/:id/topics', authenticate, requireSubjectAccess('id'), async (req, res) => {
  const subjectId = req.params.id;
  const {
    unit_number,
    unit_name,
    topic_number,
    topic_title,
    description = '',
    planned_hours,
    sequence_order,
    exam_scope = 'END_TERM'
  } = req.body;

  if (!unit_number || !unit_name || !topic_title || !planned_hours || !sequence_order) {
    return res.status(400).json({ error: 'unit_number, unit_name, topic_title, planned_hours, and sequence_order are required.' });
  }

  const hours = parseFloat(planned_hours);
  if (isNaN(hours) || hours <= 0) {
    return res.status(400).json({ error: 'planned_hours must be a positive number.' });
  }

  const topicId = `lp_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;

  try {
    await db.run(`
      INSERT INTO lesson_plans (id, subject_id, unit_number, unit_name, topic_number, topic_title, description, planned_hours, sequence_order, exam_scope, status, completion_percentage)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NOT_STARTED', 0)
    `, [topicId, subjectId, unit_number, unit_name, topic_number || sequence_order, topic_title, description, hours, sequence_order, exam_scope]);

    // Recalculate planned dates
    await ProgressionService.generatePlannedTopicDates(subjectId);

    res.status(201).json({ id: topicId, message: 'Topic created and syllabus timeline recalculated.' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update topic status / completion (Admin or Assigned Faculty)
router.patch('/topics/:id', authenticate, async (req, res) => {
  const topic = await db.get(`SELECT * FROM lesson_plans WHERE id = ?`, [req.params.id]);
  if (!topic) {
    return res.status(404).json({ error: 'Topic not found.' });
  }

  const subject = await db.get(`SELECT campus_id, faculty_id FROM subjects WHERE id = ?`, [topic.subject_id]);
  if (!subject) {
    return res.status(404).json({ error: 'Subject not found.' });
  }

  // Permission check: Admin, Campus Manager (own campus), or assigned Faculty
  if (req.user.role === 'CAMPUS_MANAGER') {
    if (req.user.campus_id && req.user.campus_id !== subject.campus_id) {
      return res.status(403).json({
        error: `Access denied: You can only update topics for subjects in your assigned campus '${req.user.campus_id}'.`
      });
    }
  } else if (req.user.role === 'FACULTY') {
    if (subject.faculty_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied: You are not assigned to this subject.' });
    }
  } else if (req.user.role === 'STUDENT') {
    return res.status(403).json({ error: 'Students have read-only access.' });
  }

  const { status, completion_percentage, actual_date } = req.body;
  let updateStatus = topic.status;
  let updatePct = topic.completion_percentage;
  let updateActualDate = topic.actual_date;

  if (status !== undefined) {
    const valid = ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED'];
    if (!valid.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Valid values: ${valid.join(', ')}` });
    }
    updateStatus = status;
    if (status === 'COMPLETED') updatePct = 100;
    if (status === 'NOT_STARTED') updatePct = 0;
  }

  if (completion_percentage !== undefined) {
    const pct = parseFloat(completion_percentage);
    if (isNaN(pct) || pct < 0 || pct > 100) {
      return res.status(400).json({ error: 'completion_percentage must be between 0 and 100.' });
    }
    updatePct = pct;
    if (pct === 100) updateStatus = 'COMPLETED';
    else if (pct > 0 && updateStatus !== 'SKIPPED') updateStatus = 'IN_PROGRESS';
  }

  if (actual_date !== undefined) {
    updateActualDate = actual_date;
  }

  try {
    await db.run(`
      UPDATE lesson_plans
      SET status = ?, completion_percentage = ?, actual_date = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [updateStatus, updatePct, updateActualDate, topic.id]);

    // Recalculate planned dates for any cascading shifts
    await ProgressionService.generatePlannedTopicDates(topic.subject_id);

    res.json({ message: 'Topic updated and progression refreshed.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Force recalculate planned dates for a subject
router.post('/subjects/:id/recalculate', authenticate, async (req, res) => {
  try {
    await ProgressionService.generatePlannedTopicDates(req.params.id);
    const progress = await ProgressionService.calculateSubjectProgress(req.params.id);
    res.json({ message: 'Progression dates successfully recalculated.', progress });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
