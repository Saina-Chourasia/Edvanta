// Attendance Management Routes for EDVANTA
// Implements secure, session-based class attendance workflow (Requirement 11)

import { Router } from 'express';
import { db } from '../database/db.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/permissions.js';

const router = Router();

// -------------------------------------------------------------
// 1. Start Attendance Session (Faculty / Admin)
// -------------------------------------------------------------
router.post('/sessions/start', authenticate, (req, res) => {
  if (req.user.role === 'STUDENT') {
    return res.status(403).json({ error: 'Students cannot initiate attendance sessions.' });
  }

  const { timetable_slot_id, subject_id, batch_name, campus_id, session_date } = req.body;
  if (!subject_id || !batch_name || !campus_id) {
    return res.status(400).json({ error: 'Subject, batch name, and campus ID are required.' });
  }

  // Campus Manager boundary check
  if (req.user.role === 'CAMPUS_MANAGER' && req.user.campus_id && req.user.campus_id !== campus_id) {
    return res.status(403).json({ error: 'Unauthorized: Cannot initiate attendance for another campus.' });
  }

  // Faculty boundary check
  if (req.user.role === 'FACULTY') {
    const subject = db.get(`SELECT * FROM subjects WHERE id = ?`, [subject_id]);
    if (!subject) {
      return res.status(404).json({ error: 'Subject not found.' });
    }
    if (subject.faculty_id && subject.faculty_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized: You are not the assigned instructor for this subject.' });
    }
  }

  const today = session_date || new Date().toISOString().split('T')[0];
  const sessionId = `att_sess_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  try {
    db.run(`
      INSERT INTO attendance_sessions (id, timetable_slot_id, subject_id, faculty_id, campus_id, batch_name, session_date, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `, [sessionId, timetable_slot_id || null, subject_id, req.user.id, campus_id, batch_name, today]);

    const createdSession = db.get(`
      SELECT s.*, subj.name as subject_name, subj.code as subject_code, c.name as campus_name
      FROM attendance_sessions s
      JOIN subjects subj ON s.subject_id = subj.id
      JOIN campuses c ON s.campus_id = c.id
      WHERE s.id = ?
    `, [sessionId]);

    res.status(201).json({ session: createdSession, message: 'Attendance session initiated successfully.' });
  } catch (err) {
    res.status(500).json({ error: `Failed to start attendance session: ${err.message}` });
  }
});

// -------------------------------------------------------------
// 2. Close Attendance Session (Faculty / Admin)
// -------------------------------------------------------------
router.post('/sessions/:id/close', authenticate, (req, res) => {
  if (req.user.role === 'STUDENT') {
    return res.status(403).json({ error: 'Students cannot close attendance sessions.' });
  }

  const session = db.get(`SELECT * FROM attendance_sessions WHERE id = ?`, [req.params.id]);
  if (!session) {
    return res.status(404).json({ error: 'Attendance session not found.' });
  }

  if (req.user.role === 'FACULTY' && session.faculty_id !== req.user.id) {
    return res.status(403).json({ error: 'Unauthorized: You cannot close another faculty member\'s attendance session.' });
  }

  db.run(`
    UPDATE attendance_sessions
    SET is_active = 0, closed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [req.params.id]);

  res.json({ message: 'Attendance session closed.', sessionId: req.params.id });
});

// -------------------------------------------------------------
// 3. Query Active Attendance Sessions (Students / Faculty)
// -------------------------------------------------------------
router.get('/sessions/active', authenticate, (req, res) => {
  if (req.user.role === 'STUDENT') {
    const studentCampus = req.user.campus_id;
    const studentBatch = req.user.batch_name;

    if (!studentCampus || !studentBatch) {
      return res.json({ activeSessions: [] });
    }

    const activeSessions = db.query(`
      SELECT s.*, subj.name as subject_name, subj.code as subject_code, u.name as faculty_name
      FROM attendance_sessions s
      JOIN subjects subj ON s.subject_id = subj.id
      JOIN users u ON s.faculty_id = u.id
      WHERE s.campus_id = ? AND s.batch_name = ? AND s.is_active = 1
      ORDER BY s.created_at DESC
    `, [studentCampus, studentBatch]);

    // Check if student has already recorded attendance for each
    const sessionsWithStatus = activeSessions.map(sess => {
      const existing = db.get(`
        SELECT id, status, created_at FROM attendance_records
        WHERE attendance_session_id = ? AND student_id = ?
      `, [sess.id, req.user.id]);
      return {
        ...sess,
        hasSubmitted: Boolean(existing),
        submissionStatus: existing ? existing.status : null,
        submittedAt: existing ? existing.created_at : null
      };
    });

    return res.json({ activeSessions: sessionsWithStatus });
  }

  if (req.user.role === 'FACULTY') {
    const activeSessions = db.query(`
      SELECT s.*, subj.name as subject_name, subj.code as subject_code,
        (SELECT COUNT(*) FROM attendance_records r WHERE r.attendance_session_id = s.id AND r.status = 'PRESENT') as present_count
      FROM attendance_sessions s
      JOIN subjects subj ON s.subject_id = subj.id
      WHERE s.faculty_id = ? AND s.is_active = 1
      ORDER BY s.created_at DESC
    `, [req.user.id]);
    return res.json({ activeSessions });
  }

  // Admin / Campus Manager
  let query = `
    SELECT s.*, subj.name as subject_name, subj.code as subject_code, u.name as faculty_name,
      (SELECT COUNT(*) FROM attendance_records r WHERE r.attendance_session_id = s.id AND r.status = 'PRESENT') as present_count
    FROM attendance_sessions s
    JOIN subjects subj ON s.subject_id = subj.id
    JOIN users u ON s.faculty_id = u.id
    WHERE s.is_active = 1
  `;
  const params = [];
  if (req.user.role === 'CAMPUS_MANAGER' && req.user.campus_id) {
    query += ` AND s.campus_id = ?`;
    params.push(req.user.campus_id);
  }
  query += ` ORDER BY s.created_at DESC`;

  const activeSessions = db.query(query, params);
  res.json({ activeSessions });
});

// -------------------------------------------------------------
// 4. Student Submit Attendance
// -------------------------------------------------------------
router.post('/submit', authenticate, (req, res) => {
  if (req.user.role !== 'STUDENT') {
    return res.status(403).json({ error: 'Only enrolled students can submit attendance.' });
  }

  const { attendance_session_id } = req.body;
  if (!attendance_session_id) {
    return res.status(400).json({ error: 'Attendance session ID is required.' });
  }

  const session = db.get(`SELECT * FROM attendance_sessions WHERE id = ?`, [attendance_session_id]);
  if (!session) {
    return res.status(404).json({ error: 'Attendance session not found.' });
  }

  if (session.is_active !== 1) {
    return res.status(400).json({ error: 'This attendance session has ended or is no longer accepting submissions.' });
  }

  // Verify campus and batch eligibility
  if (req.user.campus_id && req.user.campus_id !== session.campus_id) {
    return res.status(403).json({ error: 'Eligibility check failed: You are not enrolled in this campus.' });
  }
  if (req.user.batch_name && req.user.batch_name !== session.batch_name) {
    return res.status(403).json({ error: 'Eligibility check failed: You are not enrolled in this class batch.' });
  }

  // Check duplicate submission
  const existing = db.get(`
    SELECT id FROM attendance_records
    WHERE attendance_session_id = ? AND student_id = ?
  `, [attendance_session_id, req.user.id]);
  if (existing) {
    return res.status(409).json({ error: 'Attendance already recorded for this session.' });
  }

  const recordId = `att_rec_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  try {
    db.run(`
      INSERT INTO attendance_records (id, attendance_session_id, student_id, campus_id, status, marked_by)
      VALUES (?, ?, ?, ?, 'PRESENT', 'STUDENT')
    `, [recordId, attendance_session_id, req.user.id, session.campus_id]);

    res.status(201).json({
      success: true,
      recordId,
      status: 'PRESENT',
      message: 'Attendance recorded successfully!'
    });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Attendance already recorded for this session.' });
    }
    res.status(500).json({ error: `Failed to record attendance: ${err.message}` });
  }
});

// -------------------------------------------------------------
// 5. Review Attendance Records
// -------------------------------------------------------------
router.get('/records', authenticate, (req, res) => {
  // Student view: own records only
  if (req.user.role === 'STUDENT') {
    const records = db.query(`
      SELECT r.*, s.session_date, s.batch_name, subj.name as subject_name, subj.code as subject_code, u.name as faculty_name
      FROM attendance_records r
      JOIN attendance_sessions s ON r.attendance_session_id = s.id
      JOIN subjects subj ON s.subject_id = subj.id
      JOIN users u ON s.faculty_id = u.id
      WHERE r.student_id = ?
      ORDER BY s.session_date DESC, r.created_at DESC
    `, [req.user.id]);

    const totalSessions = records.length;
    const presentCount = records.filter(r => r.status === 'PRESENT').length;
    const percentage = totalSessions > 0 ? Math.round((presentCount / totalSessions) * 100) : 100;

    return res.json({
      records,
      summary: {
        totalSessions,
        presentCount,
        absentCount: totalSessions - presentCount,
        attendancePercentage: percentage
      }
    });
  }

  // Faculty view: authorized classes
  if (req.user.role === 'FACULTY') {
    const { session_id, subject_id, batch_name } = req.query;
    let query = `
      SELECT r.*, s.session_date, s.batch_name, subj.name as subject_name, subj.code as subject_code,
             stu.name as student_name, stu.email as student_email, stu.phone as student_phone
      FROM attendance_records r
      JOIN attendance_sessions s ON r.attendance_session_id = s.id
      JOIN subjects subj ON s.subject_id = subj.id
      JOIN users stu ON r.student_id = stu.id
      WHERE s.faculty_id = ?
    `;
    const params = [req.user.id];

    if (session_id) { query += ` AND s.id = ?`; params.push(session_id); }
    if (subject_id) { query += ` AND s.subject_id = ?`; params.push(subject_id); }
    if (batch_name) { query += ` AND s.batch_name = ?`; params.push(batch_name); }

    query += ` ORDER BY s.session_date DESC, stu.name ASC`;
    const records = db.query(query, params);

    // List recent sessions for filter
    const sessions = db.query(`
      SELECT s.*, subj.name as subject_name, subj.code as subject_code,
        (SELECT COUNT(*) FROM attendance_records r WHERE r.attendance_session_id = s.id) as total_marked
      FROM attendance_sessions s
      JOIN subjects subj ON s.subject_id = subj.id
      WHERE s.faculty_id = ?
      ORDER BY s.session_date DESC, s.created_at DESC
      LIMIT 20
    `, [req.user.id]);

    return res.json({ records, sessions });
  }

  // Admin / Campus Manager view
  const { campus_id, batch_name, subject_id, session_id } = req.query;
  let query = `
    SELECT r.*, s.session_date, s.batch_name, subj.name as subject_name, subj.code as subject_code,
           stu.name as student_name, stu.email as student_email, fac.name as faculty_name, c.name as campus_name
    FROM attendance_records r
    JOIN attendance_sessions s ON r.attendance_session_id = s.id
    JOIN subjects subj ON s.subject_id = subj.id
    JOIN users stu ON r.student_id = stu.id
    JOIN users fac ON s.faculty_id = fac.id
    JOIN campuses c ON s.campus_id = c.id
    WHERE 1=1
  `;
  const params = [];

  if (req.user.role === 'CAMPUS_MANAGER' && req.user.campus_id) {
    query += ` AND s.campus_id = ?`;
    params.push(req.user.campus_id);
  } else if (campus_id) {
    query += ` AND s.campus_id = ?`;
    params.push(campus_id);
  }

  if (batch_name) { query += ` AND s.batch_name = ?`; params.push(batch_name); }
  if (subject_id) { query += ` AND s.subject_id = ?`; params.push(subject_id); }
  if (session_id) { query += ` AND s.id = ?`; params.push(session_id); }

  query += ` ORDER BY s.session_date DESC, stu.name ASC LIMIT 100`;
  const records = db.query(query, params);

  const sessions = db.query(`
    SELECT s.*, subj.name as subject_name, c.name as campus_name,
      (SELECT COUNT(*) FROM attendance_records r WHERE r.attendance_session_id = s.id) as total_marked
    FROM attendance_sessions s
    JOIN subjects subj ON s.subject_id = subj.id
    JOIN campuses c ON s.campus_id = c.id
    ORDER BY s.session_date DESC LIMIT 20
  `);

  res.json({ records, sessions });
});

// -------------------------------------------------------------
// 6. Correct / Audit Attendance Record (Faculty / Admin only)
// -------------------------------------------------------------
router.put('/records/:id', authenticate, (req, res) => {
  if (req.user.role === 'STUDENT') {
    return res.status(403).json({ error: 'Students cannot modify attendance records.' });
  }

  const { status, notes } = req.body;
  if (!status || !['PRESENT', 'ABSENT', 'EXCUSED'].includes(status)) {
    return res.status(400).json({ error: 'Valid status (PRESENT, ABSENT, EXCUSED) is required.' });
  }

  const record = db.get(`
    SELECT r.*, s.faculty_id, s.campus_id
    FROM attendance_records r
    JOIN attendance_sessions s ON r.attendance_session_id = s.id
    WHERE r.id = ?
  `, [req.params.id]);

  if (!record) {
    return res.status(404).json({ error: 'Attendance record not found.' });
  }

  // Authorization check
  if (req.user.role === 'FACULTY' && record.faculty_id !== req.user.id) {
    return res.status(403).json({ error: 'Unauthorized: Cannot modify attendance for another faculty member\'s class.' });
  }
  if (req.user.role === 'CAMPUS_MANAGER' && req.user.campus_id && req.user.campus_id !== record.campus_id) {
    return res.status(403).json({ error: 'Unauthorized: Cannot modify attendance for another campus.' });
  }

  const auditNote = notes ? `${notes} (Modified by ${req.user.name})` : `Status updated to ${status} by ${req.user.name}`;

  db.run(`
    UPDATE attendance_records
    SET status = ?, notes = ?, marked_by = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [status, auditNote, req.user.role, req.params.id]);

  const updatedRecord = db.get(`SELECT * FROM attendance_records WHERE id = ?`, [req.params.id]);
  res.json({ record: updatedRecord, message: 'Attendance record updated successfully.' });
});

export default router;
