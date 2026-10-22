// Daily Session Logging Routes for EDVANTA
// Optimized for mobile-first faculty logging in under 60 seconds

import { Router } from 'express';
import { db } from '../database/db.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole, preventStudentMutations } from '../middleware/permissions.js';
import { validateSessionLog } from '../middleware/validation.js';
import CalendarService from '../services/calendar.service.js';
import ProgressionService from '../services/progression.service.js';
import AlertsService from '../services/alerts.service.js';

const router = Router();

// Get scheduled sessions for today (pre-fills topic, slot, hours for <60s flow)
router.get('/today', authenticate, async (req, res) => {
  try {
    const activeDate = await ProgressionService.getToday(req.query.date);
    const dow = CalendarService.getDayOfWeek(activeDate);

    let sql = `
      SELECT ts.*, s.code as subject_code, s.name as subject_name, s.color as subject_color,
             c.name as campus_name, t.name as track_name, u.name as faculty_name
      FROM timetable_slots ts
      JOIN subjects s ON ts.subject_id = s.id
      JOIN campuses c ON ts.campus_id = c.id
      JOIN tracks t ON ts.track_id = t.id
      JOIN users u ON ts.faculty_id = u.id
      WHERE ts.weekday = ?
    `;
    const params = [dow];

    // Role-based filtering for scheduled slots
    if (req.user.role === 'FACULTY') {
      sql += ` AND ts.faculty_id = ?`;
      params.push(req.user.id);
    } else if (req.user.role === 'CAMPUS_MANAGER') {
      sql += ` AND ts.campus_id = ?`;
      params.push(req.user.campus_id);
    } else if (req.user.role === 'STUDENT') {
      if (req.user.campus_id) {
        sql += ` AND ts.campus_id = ?`;
        params.push(req.user.campus_id);
      }
      if (req.user.batch_name) {
        sql += ` AND ts.batch_name = ?`;
        params.push(req.user.batch_name);
      }
    } else {
      if (req.query.campus_id) {
        sql += ` AND ts.campus_id = ?`;
        params.push(req.query.campus_id);
      }
      if (req.query.batch_name) {
        sql += ` AND ts.batch_name = ?`;
        params.push(req.query.batch_name);
      }
    }

    sql += ` ORDER BY ts.start_time ASC`;
    const slots = await db.query(sql, params);

    // For each scheduled slot, look up:
    // 1. Any existing logged session for activeDate
    // 2. The next planned topic in sequence to pre-fill
    const todaySessions = await Promise.all(slots.map(async slot => {
      const existingLog = await db.get(`
        SELECT * FROM teaching_sessions
        WHERE session_date = ? AND (
          timetable_slot_id = ?
          OR (timetable_slot_id IS NULL AND subject_id = ? AND batch_name = ? AND campus_id = ?)
        )
        LIMIT 1
      `, [activeDate, slot.id, slot.subject_id, slot.batch_name, slot.campus_id]);

      // Next upcoming topic in syllabus
      const nextTopic = await db.get(`
        SELECT id, unit_number, unit_name, topic_number, topic_title, planned_hours, status, completion_percentage
        FROM lesson_plans
        WHERE subject_id = ? AND status != 'COMPLETED' AND status != 'SKIPPED'
        ORDER BY sequence_order ASC
        LIMIT 1
      `, [slot.subject_id]);

      return {
        slot,
        sessionDate: activeDate,
        isLogged: !!existingLog,
        loggedSession: existingLog || null,
        suggestedTopic: nextTopic || null
      };
    }));

    res.json({
      activeDate,
      dayOfWeek: dow,
      dayName: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dow],
      sessions: todaySessions
    });
  } catch (err) {
    console.error('Sessions today error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get session history
router.get('/history', authenticate, async (req, res) => {
  const { subject_id, campus_id, faculty_id, start_date, end_date } = req.query;
  let sql = `
    SELECT sess.*, s.code as subject_code, s.name as subject_name,
           u.name as faculty_name, c.name as campus_name
    FROM teaching_sessions sess
    JOIN subjects s ON sess.subject_id = s.id
    JOIN users u ON sess.faculty_id = u.id
    JOIN campuses c ON sess.campus_id = c.id
    WHERE 1=1
  `;
  const params = [];

  if (subject_id) { sql += ` AND sess.subject_id = ?`; params.push(subject_id); }
  if (campus_id) { sql += ` AND sess.campus_id = ?`; params.push(campus_id); }
  if (faculty_id) { sql += ` AND sess.faculty_id = ?`; params.push(faculty_id); }
  if (start_date) { sql += ` AND sess.session_date >= ?`; params.push(start_date); }
  if (end_date) { sql += ` AND sess.session_date <= ?`; params.push(end_date); }

  // Role-based boundary restrictions
  if (req.user.role === 'FACULTY') {
    sql += ` AND sess.faculty_id = ?`;
    params.push(req.user.id);
  } else if (req.user.role === 'CAMPUS_MANAGER') {
    sql += ` AND sess.campus_id = ?`;
    params.push(req.user.campus_id);
  } else if (req.user.role === 'STUDENT') {
    if (req.user.batch_name) {
      sql += ` AND sess.batch_name = ?`;
      params.push(req.user.batch_name);
    }
    if (req.user.campus_id) {
      sql += ` AND sess.campus_id = ?`;
      params.push(req.user.campus_id);
    }
  }

  sql += ` ORDER BY sess.session_date DESC, sess.logged_at DESC LIMIT 100`;
  try {
    const sessions = await db.query(sql, params);
    res.json({ sessions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fast Session Logging Endpoint (<60s Flow)
router.post('/log', authenticate, preventStudentMutations, validateSessionLog, async (req, res) => {
  const {
    timetable_slot_id = null,
    subject_id,
    session_date,
    status, // COMPLETED, IN_PROGRESS, SKIPPED, MERGED, CANCELLED
    percentage_complete = 100,
    topic_id = null,
    topics_covered = '',
    topics_leftover = '',
    carry_forward_topic = '',
    classwork_status = '',
    homework_status = '',
    notes = '',
    duration_hours = null
  } = req.body;

  // Authorization check: Faculty can only log for assigned subject
  const subject = await db.get(`SELECT * FROM subjects WHERE id = ?`, [subject_id]);
  if (!subject) {
    return res.status(404).json({ error: 'Subject not found.' });
  }

  if (req.user.role === 'FACULTY' && subject.faculty_id !== req.user.id) {
    return res.status(403).json({
      error: `Access denied. You are not authorized to log sessions for subject ${subject.code} (${subject.name}).`
    });
  }

  // Derive duration hours
  let finalDuration = duration_hours;
  if (!finalDuration && timetable_slot_id) {
    const slot = await db.get(`SELECT duration_hours FROM timetable_slots WHERE id = ?`, [timetable_slot_id]);
    if (slot) finalDuration = slot.duration_hours;
  }
  if (!finalDuration) finalDuration = 0.8333; // Default 50 mins

  // If status is CANCELLED, duration is 0
  if (status === 'CANCELLED') {
    finalDuration = 0.0;
  }

  const sessionId = `sess_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;

  try {
    await db.transaction(async (tx) => {
      // 1. Insert teaching session log
      await tx.run(`
        INSERT INTO teaching_sessions (
          id, timetable_slot_id, subject_id, faculty_id, campus_id, batch_name,
          session_date, status, percentage_complete, topics_covered, topics_leftover,
          carry_forward_topic, classwork_status, homework_status, notes, duration_hours,
          logged_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `, [
        sessionId,
        timetable_slot_id,
        subject.id,
        req.user.role === 'FACULTY' ? req.user.id : (subject.faculty_id || req.user.id),
        subject.campus_id,
        req.body.batch_name || 'Batch-2026-Mirai-A',
        session_date,
        status,
        percentage_complete,
        topics_covered,
        topics_leftover,
        carry_forward_topic,
        classwork_status,
        homework_status,
        notes,
        finalDuration
      ]);

      // 2. Update Lesson Plan topic status if specified
      if (topic_id) {
        if (status === 'COMPLETED') {
          await tx.run(`
            UPDATE lesson_plans
            SET status = 'COMPLETED', completion_percentage = 100, actual_date = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `, [session_date, topic_id]);
        } else if (status === 'IN_PROGRESS') {
          await tx.run(`
            UPDATE lesson_plans
            SET status = 'IN_PROGRESS', completion_percentage = ?, actual_date = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `, [percentage_complete, session_date, topic_id]);
        } else if (status === 'SKIPPED') {
          await tx.run(`
            UPDATE lesson_plans
            SET status = 'SKIPPED', completion_percentage = 0, actual_date = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `, [session_date, topic_id]);
        }
      }

      // If any unread missed log alert exists for this slot & date, mark it resolved
      if (timetable_slot_id) {
        await tx.run(`
          UPDATE alerts SET is_read = 1
          WHERE slot_id = ? AND session_date = ?
        `, [timetable_slot_id, session_date]);
      }
    });

    // 3. Recalculate planned topic dates for subject (e.g. shifts from cancellation or completion)
    await ProgressionService.generatePlannedTopicDates(subject.id);

    // 4. Return updated subject progress metrics
    const updatedProgress = await ProgressionService.calculateSubjectProgress(subject.id);

    res.status(201).json({
      sessionId,
      message: 'Teaching session logged successfully in record time.',
      progress: updatedProgress
    });
  } catch (err) {
    console.error('Session log error:', err);
    res.status(400).json({ error: err.message });
  }
});

export default router;
