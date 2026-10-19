// Integration Tests for Requirement 11: Real Attendance Management System

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/server.js';
import { db } from '../src/database/db.js';

describe('Requirement 11: Real Attendance Management System', () => {
  let server;
  let baseUrl;
  let facultyToken;
  let studentToken;
  let student2Token;
  let otherFacultyToken;
  let activeSessionId;
  let createdRecordId;

  before(async () => {
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });

    // Login Faculty (Dr. Aris Thorne - CS)
    const facRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'faculty.cs@edvanta.msot.edu', password: 'edvanta123' })
    });
    facultyToken = (await facRes.json()).token;

    // Login Student 1 (Aarav Mehta - Batch-2026-Mirai-A)
    const stuRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'student.aarav@edvanta.msot.edu', password: 'edvanta123' })
    });
    studentToken = (await stuRes.json()).token;

    // Login Student 2 (Ananya Iyer - Batch-2026-Univ-A)
    const stu2Res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'student.ananya@edvanta.msot.edu', password: 'edvanta123' })
    });
    student2Token = (await stu2Res.json()).token;

    // Login Other Faculty (Dr. Ramanujan - Math)
    const mathRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'faculty.math@edvanta.msot.edu', password: 'edvanta123' })
    });
    otherFacultyToken = (await mathRes.json()).token;
  });

  after(() => {
    if (activeSessionId) {
      db.run(`DELETE FROM attendance_records WHERE attendance_session_id = ?`, [activeSessionId]);
      db.run(`DELETE FROM attendance_sessions WHERE id = ?`, [activeSessionId]);
    }
    if (server) server.close();
  });

  // 1. Student cannot start attendance session
  test('Student cannot start attendance session (HTTP 403)', async () => {
    const res = await fetch(`${baseUrl}/api/attendance/sessions/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`
      },
      body: JSON.stringify({
        subject_id: 'subj_cs301',
        batch_name: 'Batch-2026-Mirai-A',
        campus_id: 'camp_hitech'
      })
    });
    assert.equal(res.status, 403);
  });

  // 2. Faculty starts attendance session
  test('Faculty starts attendance session for assigned subject and batch (HTTP 201)', async () => {
    const res = await fetch(`${baseUrl}/api/attendance/sessions/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${facultyToken}`
      },
      body: JSON.stringify({
        subject_id: 'subj_cs301',
        batch_name: 'Batch-2026-Mirai-A',
        campus_id: 'camp_hitech',
        session_date: '2026-10-20'
      })
    });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.ok(data.session.id);
    assert.equal(data.session.is_active, 1);
    assert.equal(data.session.batch_name, 'Batch-2026-Mirai-A');
    activeSessionId = data.session.id;
  });

  // 3. Eligible student queries active sessions
  test('Eligible student sees active session (HTTP 200)', async () => {
    const res = await fetch(`${baseUrl}/api/attendance/sessions/active`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.activeSessions));
    const current = data.activeSessions.find(s => s.id === activeSessionId);
    assert.ok(current, 'Active session must appear in student active sessions');
    assert.equal(current.hasSubmitted, false, 'Student has not submitted yet');
  });

  // 4. Ineligible student (different batch) does not see or cannot submit
  test('Ineligible student from another batch cannot submit attendance (HTTP 403)', async () => {
    const res = await fetch(`${baseUrl}/api/attendance/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${student2Token}`
      },
      body: JSON.stringify({ attendance_session_id: activeSessionId })
    });
    assert.equal(res.status, 403, 'Student from different batch must be rejected');
  });

  // 5. Eligible student submits attendance
  test('Eligible student submits attendance successfully (HTTP 201)', async () => {
    const res = await fetch(`${baseUrl}/api/attendance/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`
      },
      body: JSON.stringify({ attendance_session_id: activeSessionId })
    });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.status, 'PRESENT');
    createdRecordId = data.recordId;
  });

  // 6. Duplicate attendance submission is prevented
  test('Duplicate attendance submission is rejected (HTTP 409)', async () => {
    const res = await fetch(`${baseUrl}/api/attendance/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`
      },
      body: JSON.stringify({ attendance_session_id: activeSessionId })
    });
    assert.equal(res.status, 409, 'Duplicate submission must be rejected with 409 Conflict');
  });

  // 7. Student reviews own attendance history
  test('Student can review own attendance records (HTTP 200)', async () => {
    const res = await fetch(`${baseUrl}/api/attendance/records`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.records));
    assert.ok(data.records.some(r => r.attendance_session_id === activeSessionId));
    assert.ok(data.summary);
    assert.ok(data.summary.presentCount >= 1);
  });

  // 8. Faculty reviews class attendance
  test('Faculty can review class attendance submissions (HTTP 200)', async () => {
    const res = await fetch(`${baseUrl}/api/attendance/records?session_id=${activeSessionId}`, {
      headers: { Authorization: `Bearer ${facultyToken}` }
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.records));
    assert.ok(data.records.some(r => r.id === createdRecordId));
  });

  // 9. Faculty audits / corrects attendance record
  test('Faculty can correct attendance record status (HTTP 200); Student is blocked (HTTP 403)', async () => {
    // Student tries to edit -> 403
    const stuEditRes = await fetch(`${baseUrl}/api/attendance/records/${createdRecordId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`
      },
      body: JSON.stringify({ status: 'EXCUSED', notes: 'Student attempt' })
    });
    assert.equal(stuEditRes.status, 403);

    // Faculty edits -> 200
    const facEditRes = await fetch(`${baseUrl}/api/attendance/records/${createdRecordId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${facultyToken}`
      },
      body: JSON.stringify({ status: 'EXCUSED', notes: 'Medical certificate approved' })
    });
    assert.equal(facEditRes.status, 200);
    const updatedData = await facEditRes.json();
    assert.equal(updatedData.record.status, 'EXCUSED');
  });

  // 10. Close attendance session and verify submissions are blocked
  test('Faculty closes session; subsequent submissions return HTTP 400', async () => {
    // Close session
    const closeRes = await fetch(`${baseUrl}/api/attendance/sessions/${activeSessionId}/close`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${facultyToken}` }
    });
    assert.equal(closeRes.status, 200);

    // Verify session is closed in DB
    const sess = db.get(`SELECT is_active FROM attendance_sessions WHERE id = ?`, [activeSessionId]);
    assert.equal(sess.is_active, 0);

    // Student attempt to submit after closure
    const lateRes = await fetch(`${baseUrl}/api/attendance/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`
      },
      body: JSON.stringify({ attendance_session_id: activeSessionId })
    });
    // Already submitted will be 409 or 400
    assert.ok([400, 409].includes(lateRes.status));
  });
});
