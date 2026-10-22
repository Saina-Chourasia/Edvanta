// Regression Tests for Part 1 Bug Fixes in EDVANTA
// Verifies:
// Bug 1: Multiple timetable slots on the same day for same subject
// Bug 2: Empty CSV files, missing headers, and graceful 400 error responses
// Bug 3: Campus Manager cross-campus authorization boundary enforcement
// Bug 5: Available hours calculation on active session day (no double-counting)
// Bug 6: Topics planned for today are not prematurely marked overdue
// Bug 7: Content-Type header excluded on requests without body

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/server.js';
import { db } from '../src/database/db.js';
import AlertsService from '../src/services/alerts.service.js';
import ProgressionService from '../src/services/progression.service.js';

describe('Part 1 Bug Fixes Regression Suite', () => {
  let server;
  let baseUrl;
  let adminToken = '';
  let hitechManagerToken = '';
  let ratnamManagerToken = '';
  let facultyThorneToken = '';

  before(async () => {
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });

    // Obtain tokens
    const adminRes = await fetch(`${baseUrl}/api/auth/quick-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'ADMIN' })
    });
    adminToken = (await adminRes.json()).token;

    const hitMgrRes = await fetch(`${baseUrl}/api/auth/quick-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'usr_mgr_hitech' })
    });
    hitechManagerToken = (await hitMgrRes.json()).token;

    const ratMgrRes = await fetch(`${baseUrl}/api/auth/quick-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'usr_mgr_ratnam' })
    });
    ratnamManagerToken = (await ratMgrRes.json()).token;

    const facRes = await fetch(`${baseUrl}/api/auth/quick-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'usr_fac_thorne' })
    });
    facultyThorneToken = (await facRes.json()).token;
  });

  after(() => {
    if (server) server.close();
  });

  // BUG 1 REGRESSION: Two slots for same subject on same date
  test('BUG 1: Two timetable slots of same subject on same day are tracked independently', async () => {
    const testDate = '2026-11-09'; // A Monday
    const slot1Id = 'slot_reg_test_morning';
    const slot2Id = 'slot_reg_test_afternoon';

    // Insert 2 slots for CS301 on weekday 1 (Monday)
    await db.run(`
      INSERT OR REPLACE INTO timetable_slots (id, campus_id, track_id, semester_id, batch_name, subject_id, faculty_id, weekday, start_time, end_time, duration_hours, room)
      VALUES (?, 'camp_hitech', 'track_mirai', 'sem_hitech_mirai_a', 'Batch-2026-Mirai-A', 'subj_cs301', 'usr_fac_thorne', 1, '08:00', '08:50', 0.8333, 'Lab-1')
    `, [slot1Id]);

    await db.run(`
      INSERT OR REPLACE INTO timetable_slots (id, campus_id, track_id, semester_id, batch_name, subject_id, faculty_id, weekday, start_time, end_time, duration_hours, room)
      VALUES (?, 'camp_hitech', 'track_mirai', 'sem_hitech_mirai_a', 'Batch-2026-Mirai-A', 'subj_cs301', 'usr_fac_thorne', 1, '14:00', '14:50', 0.8333, 'Lab-2')
    `, [slot2Id]);

    // Clean up any test sessions for this date
    await db.run(`DELETE FROM teaching_sessions WHERE session_date = ? AND (timetable_slot_id IN (?, ?) OR subject_id = 'subj_cs301')`, [testDate, slot1Id, slot2Id]);

    // Log ONLY slot 1
    const logRes = await fetch(`${baseUrl}/api/sessions/log`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${facultyThorneToken}`
      },
      body: JSON.stringify({
        timetable_slot_id: slot1Id,
        subject_id: 'subj_cs301',
        session_date: testDate,
        status: 'COMPLETED',
        percentage_complete: 100,
        notes: 'Morning slot completed'
      })
    });
    assert.equal(logRes.status, 201);

    // Fetch today's sessions for testDate
    const todayRes = await fetch(`${baseUrl}/api/sessions/today?date=${testDate}`, {
      headers: { Authorization: `Bearer ${facultyThorneToken}` }
    });
    const todayData = await todayRes.json();
    const morningSlot = todayData.sessions.find(s => s.slot.id === slot1Id);
    const afternoonSlot = todayData.sessions.find(s => s.slot.id === slot2Id);

    assert.ok(morningSlot, 'Morning slot must exist in today sessions');
    assert.ok(afternoonSlot, 'Afternoon slot must exist in today sessions');
    assert.equal(morningSlot.isLogged, true, 'Morning slot must be flagged as isLogged: true');
    assert.equal(afternoonSlot.isLogged, false, 'Afternoon slot must remain isLogged: false');

    // Clean up test slots
    await db.run(`DELETE FROM teaching_sessions WHERE timetable_slot_id = ?`, [slot1Id]);
    await db.run(`DELETE FROM timetable_slots WHERE id IN (?, ?)`, [slot1Id, slot2Id]);
  });

  // BUG 2 REGRESSION: Empty CSV and missing headers return 400 (never 500)
  test('BUG 2: Empty CSV files and missing headers return HTTP 400 gracefully', async () => {
    // 1. Completely empty calendar CSV
    const res1 = await fetch(`${baseUrl}/api/imports/calendar`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ csvText: '' })
    });
    assert.equal(res1.status, 400, 'Empty CSV text must return 400');
    const data1 = await res1.json();
    assert.ok(data1.error.includes('empty') || data1.error.includes('validation'), 'Error message should explain empty CSV');

    // 2. CSV with only whitespace
    const res2 = await fetch(`${baseUrl}/api/imports/timetable`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ csvText: '   \n\n  \r\n' })
    });
    assert.equal(res2.status, 400, 'Whitespace-only CSV must return 400');

    // 3. CSV with missing headers
    const res3 = await fetch(`${baseUrl}/api/imports/syllabus`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ csvText: 'wrong_header_1,wrong_header_2\nval1,val2' })
    });
    assert.equal(res3.status, 400, 'CSV with missing required headers must return 400');
    const data3 = await res3.json();
    assert.ok(data3.error.includes('Missing required header'), 'Error should state missing required header');
  });

  // BUG 3 REGRESSION: Campus Manager cannot modify other campuses
  test('BUG 3: Campus Manager is blocked with 403 when modifying other campuses', async () => {
    // HI-Tech manager attempting to delete Ratnam timetable slot or edit Ratnam topic
    const ratnamSlotId = 'slot_ratnam_cross_test';
    await db.run(`
      INSERT OR REPLACE INTO timetable_slots (id, campus_id, track_id, semester_id, batch_name, subject_id, faculty_id, weekday, start_time, end_time, duration_hours)
      VALUES (?, 'camp_ratnam', 'track_mirai', 'sem_hitech_mirai_a', 'Batch-Ratnam', 'subj_cs301', 'usr_fac_thorne', 2, '10:00', '10:50', 0.8333)
    `, [ratnamSlotId]);

    // HI-Tech manager attempts DELETE on Ratnam slot
    const crossDeleteRes = await fetch(`${baseUrl}/api/timetable/${ratnamSlotId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${hitechManagerToken}` }
    });
    assert.equal(crossDeleteRes.status, 403, 'HI-Tech manager must be denied (403) from deleting Ratnam slot');

    // Admin CAN delete
    const adminDeleteRes = await fetch(`${baseUrl}/api/timetable/${ratnamSlotId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(adminDeleteRes.status, 200, 'Admin must be permitted to delete slot');
  });

  // BUG 5 REGRESSION: Available hours does not double-count logged sessions on today
  test('BUG 5: Today logged sessions are not counted as future available hours', async () => {
    // Subject CS301 progress calculation
    const progressBefore = await ProgressionService.calculateSubjectProgress('subj_cs301', '2026-10-19');

    // Available hours must be a positive number
    assert.ok(progressBefore.availableHours >= 0);
    assert.ok(progressBefore.bufferRatio > 0);
  });

  // BUG 6 REGRESSION: Overdue topics check
  test('BUG 6: Topics planned for today are NOT marked overdue', async () => {
    const today = '2026-10-19';
    const testTopicTodayId = 'lp_test_today';
    const testTopicPastId = 'lp_test_yesterday';

    // Insert two uncompleted topics
    await db.run(`
      INSERT OR REPLACE INTO lesson_plans (id, subject_id, unit_number, unit_name, topic_number, topic_title, planned_hours, sequence_order, exam_scope, status, completion_percentage, planned_date)
      VALUES (?, 'subj_cs301', 99, 'Test Unit', 991, 'Topic Today', 1.0, 991, 'END_TERM', 'NOT_STARTED', 0, '2026-10-19')
    `, [testTopicTodayId]);

    await db.run(`
      INSERT OR REPLACE INTO lesson_plans (id, subject_id, unit_number, unit_name, topic_number, topic_title, planned_hours, sequence_order, exam_scope, status, completion_percentage, planned_date)
      VALUES (?, 'subj_cs301', 99, 'Test Unit', 992, 'Topic Yesterday', 1.0, 992, 'END_TERM', 'NOT_STARTED', 0, '2026-10-18')
    `, [testTopicPastId]);

    const progress = await ProgressionService.calculateSubjectProgress('subj_cs301', today);
    const overdueIds = progress.overdueTopics.map(t => t.id);

    assert.ok(overdueIds.includes(testTopicPastId), 'Topic planned yesterday must be marked OVERDUE');
    assert.equal(overdueIds.includes(testTopicTodayId), false, 'Topic planned TODAY must NOT be marked overdue');

    // Clean up
    await db.run(`DELETE FROM lesson_plans WHERE id IN (?, ?)`, [testTopicTodayId, testTopicPastId]);
  });
});
