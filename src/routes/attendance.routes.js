// Attendance Management Routes for EDVANTA
// Implements secure, session-based class attendance workflow with Bluetooth Low Energy (BLE) support (Requirement 11)

import { Router } from 'express';
import { db } from '../database/db.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/permissions.js';

const router = Router();

// Helper to auto-expire past sessions
async function autoExpireSessions() {
  try {
    const nowIso = new Date().toISOString();
    await db.run(`
      UPDATE attendance_sessions
      SET is_active = 0, closed_at = CURRENT_TIMESTAMP
      WHERE is_active = 1 AND expires_at IS NOT NULL AND expires_at < ?
    `, [nowIso]);
  } catch (e) {
    // Graceful handling
  }
}

// -------------------------------------------------------------
// 1. Start Attendance Session (Faculty / Admin)
// -------------------------------------------------------------
router.post('/sessions/start', authenticate, async (req, res) => {
  if (req.user.role === 'STUDENT') {
    return res.status(403).json({ error: 'Students cannot initiate attendance sessions.' });
  }

  const { timetable_slot_id, subject_id, batch_name, campus_id, session_date, validity_minutes } = req.body;
  if (!subject_id || !batch_name || !campus_id) {
    return res.status(400).json({ error: 'Subject, batch name, and campus ID are required.' });
  }

  // Campus Manager boundary check
  if (req.user.role === 'CAMPUS_MANAGER' && req.user.campus_id && req.user.campus_id !== campus_id) {
    return res.status(403).json({ error: 'Unauthorized: Cannot initiate attendance for another campus.' });
  }

  // Faculty boundary check
  if (req.user.role === 'FACULTY') {
    const subject = await db.get(`SELECT * FROM subjects WHERE id = ?`, [subject_id]);
    if (!subject) {
      return res.status(404).json({ error: 'Subject not found.' });
    }
    if (subject.faculty_id && subject.faculty_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized: You are not the assigned instructor for this subject.' });
    }
  }

  const today = session_date || new Date().toISOString().split('T')[0];
  const sessionId = `att_sess_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const validMins = Number(validity_minutes) > 0 ? Number(validity_minutes) : 15;
  const expiresAt = new Date(Date.now() + validMins * 60000).toISOString();
  const bleServiceUuid = '0000ed01-0000-1000-8000-00805f9b34fb';
  const bleBeaconCode = `EDV-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

  try {
    await db.run(`
      INSERT INTO attendance_sessions (
        id, timetable_slot_id, subject_id, faculty_id, campus_id, batch_name, session_date,
        validity_minutes, expires_at, ble_service_uuid, ble_beacon_code, is_active
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `, [
      sessionId,
      timetable_slot_id || null,
      subject_id,
      req.user.id,
      campus_id,
      batch_name,
      today,
      validMins,
      expiresAt,
      bleServiceUuid,
      bleBeaconCode
    ]);

    const createdSession = await db.get(`
      SELECT s.*, subj.name as subject_name, subj.code as subject_code, c.name as campus_name
      FROM attendance_sessions s
      JOIN subjects subj ON s.subject_id = subj.id
      JOIN campuses c ON s.campus_id = c.id
      WHERE s.id = ?
    `, [sessionId]);

    res.status(201).json({
      session: createdSession,
      ble_beacon_code: bleBeaconCode,
      ble_service_uuid: bleServiceUuid,
      validity_minutes: validMins,
      expires_at: expiresAt,
      message: 'Attendance session initiated successfully.'
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to start attendance session: ${err.message}` });
  }
});

// -------------------------------------------------------------
// 2. Close Attendance Session (Faculty / Admin)
// -------------------------------------------------------------
router.post('/sessions/:id/close', authenticate, async (req, res) => {
  if (req.user.role === 'STUDENT') {
    return res.status(403).json({ error: 'Students cannot close attendance sessions.' });
  }

  const session = await db.get(`SELECT * FROM attendance_sessions WHERE id = ?`, [req.params.id]);
  if (!session) {
    return res.status(404).json({ error: 'Attendance session not found.' });
  }

  if (req.user.role === 'FACULTY' && session.faculty_id !== req.user.id) {
    return res.status(403).json({ error: 'Unauthorized: You cannot close another faculty member\'s attendance session.' });
  }

  try {
    await db.run(`
      UPDATE attendance_sessions
      SET is_active = 0, closed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [req.params.id]);

    res.json({ message: 'Attendance session closed.', sessionId: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 3. Query Active Attendance Sessions (Students / Faculty / Admin)
// -------------------------------------------------------------
router.get('/sessions/active', authenticate, async (req, res) => {
  await autoExpireSessions();

  try {
    if (req.user.role === 'STUDENT') {
      const studentCampus = req.user.campus_id;
      const studentBatch = req.user.batch_name;

      if (!studentCampus || !studentBatch) {
        return res.json({ activeSessions: [] });
      }

      const activeSessions = await db.query(`
        SELECT s.*, subj.name as subject_name, subj.code as subject_code, u.name as faculty_name
        FROM attendance_sessions s
        JOIN subjects subj ON s.subject_id = subj.id
        JOIN users u ON s.faculty_id = u.id
        WHERE s.campus_id = ? AND s.batch_name = ? AND s.is_active = 1
        ORDER BY s.created_at DESC
      `, [studentCampus, studentBatch]);

      // Check if student has already recorded attendance for each
      const sessionsWithStatus = await Promise.all(activeSessions.map(async sess => {
        const existing = await db.get(`
          SELECT id, status, marking_method, created_at FROM attendance_records
          WHERE attendance_session_id = ? AND student_id = ?
        `, [sess.id, req.user.id]);
        return {
          ...sess,
          hasSubmitted: Boolean(existing),
          submissionStatus: existing ? existing.status : null,
          marking_method: existing ? existing.marking_method : null,
          submittedAt: existing ? existing.created_at : null
        };
      }));

      return res.json({ activeSessions: sessionsWithStatus });
    }

    if (req.user.role === 'FACULTY') {
      const activeSessions = await db.query(`
        SELECT s.*, subj.name as subject_name, subj.code as subject_code,
          (SELECT COUNT(*) FROM users u WHERE u.role = 'STUDENT' AND u.campus_id = s.campus_id AND u.batch_name = s.batch_name) as total_enrolled,
          (SELECT COUNT(*) FROM attendance_records r WHERE r.attendance_session_id = s.id AND r.status = 'PRESENT') as present_count,
          (SELECT COUNT(*) FROM attendance_records r WHERE r.attendance_session_id = s.id AND r.status = 'ABSENT') as absent_count
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
        (SELECT COUNT(*) FROM users usr WHERE usr.role = 'STUDENT' AND usr.campus_id = s.campus_id AND usr.batch_name = s.batch_name) as total_enrolled,
        (SELECT COUNT(*) FROM attendance_records r WHERE r.attendance_session_id = s.id AND r.status = 'PRESENT') as present_count,
        (SELECT COUNT(*) FROM attendance_records r WHERE r.attendance_session_id = s.id AND r.status = 'ABSENT') as absent_count
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

    const activeSessions = await db.query(query, params);
    res.json({ activeSessions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 4. Session Roster & Live Counts (Faculty / Admin)
// -------------------------------------------------------------
router.get('/sessions/:id/roster', authenticate, async (req, res) => {
  if (req.user.role === 'STUDENT') {
    return res.status(403).json({ error: 'Unauthorized: Students cannot view class session rosters.' });
  }

  try {
    const session = await db.get(`
      SELECT s.*, subj.name as subject_name, subj.code as subject_code, c.name as campus_name
      FROM attendance_sessions s
      JOIN subjects subj ON s.subject_id = subj.id
      JOIN campuses c ON s.campus_id = c.id
      WHERE s.id = ?
    `, [req.params.id]);

    if (!session) {
      return res.status(404).json({ error: 'Attendance session not found.' });
    }

    if (req.user.role === 'FACULTY' && session.faculty_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized: Cannot view roster for another faculty member\'s class.' });
    }

    // Get all enrolled students in this campus and batch
    const enrolledStudents = await db.query(`
      SELECT u.id as student_id, u.name as student_name, u.email as student_email, u.phone as student_phone, u.batch_name,
             r.id as record_id, r.status, r.marking_method, r.notes, r.created_at as marked_at
      FROM users u
      LEFT JOIN attendance_records r ON r.student_id = u.id AND r.attendance_session_id = ?
      WHERE u.role = 'STUDENT' AND u.campus_id = ? AND u.batch_name = ?
      ORDER BY u.name ASC
    `, [session.id, session.campus_id, session.batch_name]);

    const totalEnrolled = enrolledStudents.length;
    const presentCount = enrolledStudents.filter(s => s.status === 'PRESENT').length;
    const absentCount = enrolledStudents.filter(s => s.status === 'ABSENT').length;
    const notMarkedCount = enrolledStudents.filter(s => !s.status).length;
    const attendanceRate = totalEnrolled > 0 ? Math.round((presentCount / totalEnrolled) * 100) : 0;

    res.json({
      session,
      roster: enrolledStudents.map(s => ({
        student_id: s.student_id,
        student_name: s.student_name,
        student_email: s.student_email,
        student_phone: s.student_phone,
        batch_name: s.batch_name,
        record_id: s.record_id || null,
        status: s.status || 'NOT_MARKED',
        marking_method: s.marking_method || null,
        notes: s.notes || null,
        marked_at: s.marked_at || null
      })),
      summary: {
        totalEnrolled,
        presentCount,
        absentCount,
        notMarkedCount,
        attendanceRate
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 5. Student Submit Attendance (Standard Web Check-In)
// -------------------------------------------------------------
router.post('/submit', authenticate, async (req, res) => {
  if (req.user.role !== 'STUDENT') {
    return res.status(403).json({ error: 'Only enrolled students can submit attendance.' });
  }

  const { attendance_session_id } = req.body;
  if (!attendance_session_id) {
    return res.status(400).json({ error: 'Attendance session ID is required.' });
  }

  try {
    const session = await db.get(`SELECT * FROM attendance_sessions WHERE id = ?`, [attendance_session_id]);
    if (!session) {
      return res.status(404).json({ error: 'Attendance session not found.' });
    }

    // Check if session has expired
    if (session.is_active !== 1 || (session.expires_at && new Date(session.expires_at) < new Date())) {
      if (session.is_active === 1) {
        await db.run(`UPDATE attendance_sessions SET is_active = 0, closed_at = CURRENT_TIMESTAMP WHERE id = ?`, [session.id]);
      }
      return res.status(400).json({ error: 'This attendance session has expired or is no longer accepting submissions.' });
    }

    // Verify campus and batch eligibility
    if (req.user.campus_id && req.user.campus_id !== session.campus_id) {
      return res.status(403).json({ error: 'Eligibility check failed: You are not enrolled in this campus.' });
    }
    if (req.user.batch_name && req.user.batch_name !== session.batch_name) {
      return res.status(403).json({ error: 'Eligibility check failed: You are not enrolled in this class batch.' });
    }

    // Check duplicate submission
    const existing = await db.get(`
      SELECT id FROM attendance_records
      WHERE attendance_session_id = ? AND student_id = ?
    `, [attendance_session_id, req.user.id]);
    if (existing) {
      return res.status(409).json({ error: 'Attendance already recorded for this session.' });
    }

    const recordId = `att_rec_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    await db.run(`
      INSERT INTO attendance_records (id, attendance_session_id, student_id, campus_id, status, marked_by, marking_method)
      VALUES (?, ?, ?, ?, 'PRESENT', 'STUDENT', 'PORTAL')
    `, [recordId, attendance_session_id, req.user.id, session.campus_id]);

    res.status(201).json({
      success: true,
      recordId,
      status: 'PRESENT',
      marking_method: 'PORTAL',
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
// 6. Student Submit Attendance via Bluetooth Low Energy (BLE)
// -------------------------------------------------------------
router.post('/submit-ble', authenticate, async (req, res) => {
  if (req.user.role !== 'STUDENT') {
    return res.status(403).json({ error: 'Only enrolled students can verify proximity attendance via Bluetooth.' });
  }

  const { attendance_session_id, ble_beacon_code, client_timestamp } = req.body;
  if (!attendance_session_id || !ble_beacon_code) {
    return res.status(400).json({ error: 'Attendance session ID and Bluetooth beacon code are required.' });
  }

  try {
    const session = await db.get(`SELECT * FROM attendance_sessions WHERE id = ?`, [attendance_session_id]);
    if (!session) {
      return res.status(404).json({ error: 'Attendance session not found.' });
    }

    // Check if session has expired
    if (session.is_active !== 1 || (session.expires_at && new Date(session.expires_at) < new Date())) {
      if (session.is_active === 1) {
        await db.run(`UPDATE attendance_sessions SET is_active = 0, closed_at = CURRENT_TIMESTAMP WHERE id = ?`, [session.id]);
      }
      return res.status(400).json({ error: 'This attendance session has expired or is no longer accepting Bluetooth check-ins.' });
    }

    // Validate BLE beacon code matches the active session
    if (session.ble_beacon_code && session.ble_beacon_code.trim().toUpperCase() !== ble_beacon_code.trim().toUpperCase()) {
      return res.status(403).json({ error: 'Bluetooth verification failed: Invalid beacon code for this session.' });
    }

    // Replay protection: client timestamp must be reasonably current (within 5 minutes)
    if (client_timestamp) {
      const ageMs = Math.abs(Date.now() - Number(client_timestamp));
      if (ageMs > 5 * 60 * 1000) {
        return res.status(400).json({ error: 'Bluetooth verification failed: Timestamp is outside the allowable proximity window.' });
      }
    }

    // Verify campus and batch eligibility
    if (req.user.campus_id && req.user.campus_id !== session.campus_id) {
      return res.status(403).json({ error: 'Eligibility check failed: You are not enrolled in this campus.' });
    }
    if (req.user.batch_name && req.user.batch_name !== session.batch_name) {
      return res.status(403).json({ error: 'Eligibility check failed: You are not enrolled in this class batch.' });
    }

    // Check duplicate submission
    const existing = await db.get(`
      SELECT id FROM attendance_records
      WHERE attendance_session_id = ? AND student_id = ?
    `, [attendance_session_id, req.user.id]);
    if (existing) {
      return res.status(409).json({ error: 'Attendance already recorded for this session.' });
    }

    const recordId = `att_rec_ble_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    await db.run(`
      INSERT INTO attendance_records (id, attendance_session_id, student_id, campus_id, status, marked_by, marking_method, notes)
      VALUES (?, ?, ?, ?, 'PRESENT', 'STUDENT', 'BLUETOOTH', 'Verified via BLE Proximity Beacon')
    `, [recordId, attendance_session_id, req.user.id, session.campus_id]);

    res.status(201).json({
      success: true,
      recordId,
      status: 'PRESENT',
      marking_method: 'BLUETOOTH',
      message: 'Bluetooth proximity attendance verified successfully!'
    });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Attendance already recorded for this session.' });
    }
    res.status(500).json({ error: `Failed to record Bluetooth attendance: ${err.message}` });
  }
});

// -------------------------------------------------------------
// 7. Manual Attendance Marking (Faculty / Admin)
// -------------------------------------------------------------
router.post('/mark-manual', authenticate, async (req, res) => {
  if (req.user.role === 'STUDENT') {
    return res.status(403).json({ error: 'Students cannot manually mark attendance.' });
  }

  const { attendance_session_id, student_id, status, notes } = req.body;
  if (!attendance_session_id || !student_id || !status) {
    return res.status(400).json({ error: 'Attendance session ID, student ID, and status are required.' });
  }

  if (!['PRESENT', 'ABSENT', 'EXCUSED'].includes(status)) {
    return res.status(400).json({ error: 'Valid status (PRESENT, ABSENT, EXCUSED) is required.' });
  }

  try {
    const session = await db.get(`SELECT * FROM attendance_sessions WHERE id = ?`, [attendance_session_id]);
    if (!session) {
      return res.status(404).json({ error: 'Attendance session not found.' });
    }

    if (req.user.role === 'FACULTY' && session.faculty_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized: Cannot mark attendance for another faculty member\'s class.' });
    }
    if (req.user.role === 'CAMPUS_MANAGER' && req.user.campus_id && req.user.campus_id !== session.campus_id) {
      return res.status(403).json({ error: 'Unauthorized: Cannot mark attendance for another campus.' });
    }

    // Verify student exists
    const student = await db.get(`SELECT id, name FROM users WHERE id = ? AND role = 'STUDENT'`, [student_id]);
    if (!student) {
      return res.status(404).json({ error: 'Student not found.' });
    }

    const auditNote = notes ? `${notes} (Marked by ${req.user.name})` : `Marked ${status} manually by ${req.user.name}`;

    const existing = await db.get(`
      SELECT id FROM attendance_records
      WHERE attendance_session_id = ? AND student_id = ?
    `, [attendance_session_id, student_id]);

    if (existing) {
      await db.run(`
        UPDATE attendance_records
        SET status = ?, notes = ?, marked_by = ?, marking_method = 'MANUAL', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [status, auditNote, req.user.role, existing.id]);
      const updated = await db.get(`SELECT * FROM attendance_records WHERE id = ?`, [existing.id]);
      return res.json({ success: true, record: updated, message: `Updated attendance for ${student.name}.` });
    }

    const recordId = `att_rec_man_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    await db.run(`
      INSERT INTO attendance_records (id, attendance_session_id, student_id, campus_id, status, marked_by, marking_method, notes)
      VALUES (?, ?, ?, ?, ?, ?, 'MANUAL', ?)
    `, [recordId, attendance_session_id, student_id, session.campus_id, status, req.user.role, auditNote]);

    const created = await db.get(`SELECT * FROM attendance_records WHERE id = ?`, [recordId]);
    res.status(201).json({ success: true, record: created, message: `Recorded attendance for ${student.name}.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 8. Finalize Unrecorded Students as Absent (Faculty / Admin)
// -------------------------------------------------------------
router.post('/sessions/:id/finalize-unrecorded', authenticate, async (req, res) => {
  if (req.user.role === 'STUDENT') {
    return res.status(403).json({ error: 'Students cannot finalize attendance sessions.' });
  }

  try {
    const session = await db.get(`SELECT * FROM attendance_sessions WHERE id = ?`, [req.params.id]);
    if (!session) {
      return res.status(404).json({ error: 'Attendance session not found.' });
    }

    if (req.user.role === 'FACULTY' && session.faculty_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized: Cannot finalize another faculty member\'s attendance session.' });
    }

    // Find all students in this batch who have NOT yet recorded attendance
    const unrecordedStudents = await db.query(`
      SELECT u.id, u.name FROM users u
      WHERE u.role = 'STUDENT' AND u.campus_id = ? AND u.batch_name = ?
        AND u.id NOT IN (
          SELECT r.student_id FROM attendance_records r WHERE r.attendance_session_id = ?
        )
    `, [session.campus_id, session.batch_name, session.id]);

    let finalizedCount = 0;
    for (const stu of unrecordedStudents) {
      const recId = `att_rec_abs_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      await db.run(`
        INSERT INTO attendance_records (id, attendance_session_id, student_id, campus_id, status, marked_by, marking_method, notes)
        VALUES (?, ?, ?, ?, 'ABSENT', ?, 'MANUAL', 'Marked absent at session finalization')
      `, [recId, session.id, stu.id, session.campus_id, req.user.role]);
      finalizedCount++;
    }

    // Also close the session
    await db.run(`UPDATE attendance_sessions SET is_active = 0, closed_at = CURRENT_TIMESTAMP WHERE id = ?`, [session.id]);

    res.json({
      success: true,
      finalizedCount,
      message: `Finalized session: marked ${finalizedCount} unrecorded students as ABSENT and closed session.`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 9. Review Attendance Records & History (With Search & Filters)
// -------------------------------------------------------------
router.get('/records', authenticate, async (req, res) => {
  try {
    // Student view: own records only
    if (req.user.role === 'STUDENT') {
      const { subject_id, status, date } = req.query;
      let sql = `
        SELECT r.*, s.session_date, s.batch_name, subj.name as subject_name, subj.code as subject_code, u.name as faculty_name
        FROM attendance_records r
        JOIN attendance_sessions s ON r.attendance_session_id = s.id
        JOIN subjects subj ON s.subject_id = subj.id
        JOIN users u ON s.faculty_id = u.id
        WHERE r.student_id = ?
      `;
      const params = [req.user.id];

      if (subject_id) { sql += ` AND s.subject_id = ?`; params.push(subject_id); }
      if (status) { sql += ` AND r.status = ?`; params.push(status); }
      if (date) { sql += ` AND s.session_date = ?`; params.push(date); }

      sql += ` ORDER BY s.session_date DESC, r.created_at DESC`;
      const records = await db.query(sql, params);

      const totalSessions = records.length;
      const presentCount = records.filter(r => r.status === 'PRESENT').length;
      const absentCount = records.filter(r => r.status === 'ABSENT').length;
      const percentage = totalSessions > 0 ? Math.round((presentCount / totalSessions) * 100) : 0;

      return res.json({
        records,
        summary: {
          totalSessions,
          presentCount,
          absentCount,
          attendancePercentage: percentage
        }
      });
    }

    // Faculty view: authorized classes
    if (req.user.role === 'FACULTY') {
      const { session_id, subject_id, batch_name, student_id, status, date } = req.query;
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
      if (student_id) { query += ` AND r.student_id = ?`; params.push(student_id); }
      if (status) { query += ` AND r.status = ?`; params.push(status); }
      if (date) { query += ` AND s.session_date = ?`; params.push(date); }

      query += ` ORDER BY s.session_date DESC, stu.name ASC`;
      const records = await db.query(query, params);

      // List recent sessions for filter
      const sessions = await db.query(`
        SELECT s.*, subj.name as subject_name, subj.code as subject_code,
          (SELECT COUNT(*) FROM attendance_records r WHERE r.attendance_session_id = s.id) as total_marked
        FROM attendance_sessions s
        JOIN subjects subj ON s.subject_id = subj.id
        WHERE s.faculty_id = ?
        ORDER BY s.session_date DESC, s.created_at DESC
        LIMIT 20
      `, [req.user.id]);

      const totalSessions = records.length;
      const presentCount = records.filter(r => r.status === 'PRESENT').length;
      const absentCount = records.filter(r => r.status === 'ABSENT').length;
      const percentage = totalSessions > 0 ? Math.round((presentCount / totalSessions) * 100) : 0;

      return res.json({
        records,
        sessions,
        summary: {
          totalSessions,
          presentCount,
          absentCount,
          attendancePercentage: percentage
        }
      });
    }

    // Admin / Campus Manager view
    const { campus_id, batch_name, subject_id, session_id, student_id, status, date } = req.query;
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
    if (student_id) { query += ` AND r.student_id = ?`; params.push(student_id); }
    if (status) { query += ` AND r.status = ?`; params.push(status); }
    if (date) { query += ` AND s.session_date = ?`; params.push(date); }

    query += ` ORDER BY s.session_date DESC, stu.name ASC LIMIT 100`;
    const records = await db.query(query, params);

    const sessions = await db.query(`
      SELECT s.*, subj.name as subject_name, c.name as campus_name,
        (SELECT COUNT(*) FROM attendance_records r WHERE r.attendance_session_id = s.id) as total_marked
      FROM attendance_sessions s
      JOIN subjects subj ON s.subject_id = subj.id
      JOIN campuses c ON s.campus_id = c.id
      ORDER BY s.session_date DESC LIMIT 20
    `);

    const totalSessions = records.length;
    const presentCount = records.filter(r => r.status === 'PRESENT').length;
    const absentCount = records.filter(r => r.status === 'ABSENT').length;
    const percentage = totalSessions > 0 ? Math.round((presentCount / totalSessions) * 100) : 0;

    res.json({
      records,
      sessions,
      summary: {
        totalSessions,
        presentCount,
        absentCount,
        attendancePercentage: percentage
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 10. Correct / Audit Attendance Record (Faculty / Admin only)
// -------------------------------------------------------------
router.put('/records/:id', authenticate, async (req, res) => {
  if (req.user.role === 'STUDENT') {
    return res.status(403).json({ error: 'Students cannot modify attendance records.' });
  }

  const { status, notes } = req.body;
  if (!status || !['PRESENT', 'ABSENT', 'EXCUSED'].includes(status)) {
    return res.status(400).json({ error: 'Valid status (PRESENT, ABSENT, EXCUSED) is required.' });
  }

  try {
    const record = await db.get(`
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

    await db.run(`
      UPDATE attendance_records
      SET status = ?, notes = ?, marked_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [status, auditNote, req.user.role, req.params.id]);

    const updatedRecord = await db.get(`SELECT * FROM attendance_records WHERE id = ?`, [req.params.id]);
    res.json({ record: updatedRecord, message: 'Attendance record updated successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 11. Attendance Dashboard Summary Metrics
// -------------------------------------------------------------
router.get('/dashboard-summary', authenticate, async (req, res) => {
  try {
    let studentCondition = '';
    const params = [];

    if (req.user.role === 'STUDENT') {
      studentCondition = 'AND r.student_id = ?';
      params.push(req.user.id);
    } else if (req.user.role === 'FACULTY') {
      studentCondition = 'AND s.faculty_id = ?';
      params.push(req.user.id);
    } else if (req.user.role === 'CAMPUS_MANAGER' && req.user.campus_id) {
      studentCondition = 'AND s.campus_id = ?';
      params.push(req.user.campus_id);
    }

    const records = await db.query(`
      SELECT r.status, r.marking_method, s.subject_id, subj.name as subject_name, subj.code as subject_code
      FROM attendance_records r
      JOIN attendance_sessions s ON r.attendance_session_id = s.id
      JOIN subjects subj ON s.subject_id = subj.id
      WHERE 1=1 ${studentCondition}
    `, params);

    const totalMarked = records.length;
    const presentCount = records.filter(r => r.status === 'PRESENT').length;
    const absentCount = records.filter(r => r.status === 'ABSENT').length;
    const bleCount = records.filter(r => r.marking_method === 'BLUETOOTH').length;
    const portalCount = records.filter(r => r.marking_method === 'PORTAL').length;
    const manualCount = records.filter(r => r.marking_method === 'MANUAL').length;
    const percentage = totalMarked > 0 ? Math.round((presentCount / totalMarked) * 100) : 0;

    // Subject breakdown
    const subjectMap = {};
    for (const r of records) {
      if (!subjectMap[r.subject_id]) {
        subjectMap[r.subject_id] = { code: r.subject_code, name: r.subject_name, total: 0, present: 0 };
      }
      subjectMap[r.subject_id].total++;
      if (r.status === 'PRESENT') subjectMap[r.subject_id].present++;
    }

    const subjectWise = Object.values(subjectMap).map(s => ({
      ...s,
      percentage: s.total > 0 ? Math.round((s.present / s.total) * 100) : 0
    }));

    res.json({
      totalMarked,
      presentCount,
      absentCount,
      bleCount,
      portalCount,
      manualCount,
      percentage,
      subjectWise
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to compute attendance dashboard: ${err.message}` });
  }
});

export default router;
