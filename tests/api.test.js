// End-to-End REST API Integration Tests for EDVANTA

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/server.js';
import { db } from '../src/database/db.js';

describe('EDVANTA REST API End-to-End Tests', () => {
  let server;
  let baseUrl;
  let adminToken = '';
  let facultyToken = '';
  let studentToken = '';

  before(async () => {
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // Obtain tokens for different roles
    const adminRes = await fetch(`${baseUrl}/api/auth/quick-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'ADMIN' })
    });
    const adminData = await adminRes.json();
    adminToken = adminData.token;

    const facRes = await fetch(`${baseUrl}/api/auth/quick-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'usr_fac_thorne' })
    });
    const facData = await facRes.json();
    facultyToken = facData.token;

    const stuRes = await fetch(`${baseUrl}/api/auth/quick-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'STUDENT' })
    });
    const stuData = await stuRes.json();
    studentToken = stuData.token;
  });

  after(() => {
    if (server) server.close();
  });

  test('GET /api/health returns system metadata', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'healthy');
    assert.equal(data.tagline, 'Every Hour Counts, Every Goal Matters');
  });

  test('GET /api/dashboard/overview returns rolled up metrics and subjects', async () => {
    const res = await fetch(`${baseUrl}/api/dashboard/overview`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.summary, 'Summary must be present');
    assert.ok(data.summary.totalSubjects >= 4, 'Should contain at least 4 subjects');
    assert.ok(['ON TRACK', 'TIGHT', 'DANGER', 'COMPLETE'].includes(data.summary.rolledUpTrackStatus));
    assert.ok(Array.isArray(data.subjects));
  });

  test('GET /api/sessions/today returns scheduled slots with pre-filled topics', async () => {
    const res = await fetch(`${baseUrl}/api/sessions/today?date=2026-08-03`, {
      headers: { Authorization: `Bearer ${facultyToken}` }
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.activeDate, '2026-08-03');
    assert.ok(Array.isArray(data.sessions));
  });

  test('POST /api/sessions/log logs session in under 60s flow and updates progress', async () => {
    const payload = {
      subject_id: 'subj_cs301',
      session_date: '2026-08-07',
      status: 'COMPLETED',
      percentage_complete: 100,
      topic_id: 'lp_cs301_3',
      topics_covered: 'Stateless vs Stateful Microservices Architecture',
      notes: 'Logged via API test flow',
      duration_hours: 0.8333
    };

    const res = await fetch(`${baseUrl}/api/sessions/log`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${facultyToken}`
      },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    assert.ok(data.sessionId);
    assert.ok(data.progress);

    // Clean up created test session so test runs remain idempotent
    if (data.sessionId) {
      await db.run('DELETE FROM teaching_sessions WHERE id = ?', [data.sessionId]);
    }
  });

  test('POST /api/sessions/log rejects unauthorized faculty trying to log other subjects', async () => {
    // Dr. Thorne (CS) tries to log for Math (MA202)
    const payload = {
      subject_id: 'subj_ma202',
      session_date: '2026-08-07',
      status: 'COMPLETED'
    };

    const res = await fetch(`${baseUrl}/api/sessions/log`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${facultyToken}`
      },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 403, 'Should be 403 Forbidden for unauthorized faculty subject logging');
  });

  test('POST /api/sessions/log rejects Student role with 403', async () => {
    const payload = {
      subject_id: 'subj_cs301',
      session_date: '2026-08-07',
      status: 'COMPLETED'
    };

    const res = await fetch(`${baseUrl}/api/sessions/log`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`
      },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 403, 'Student cannot log sessions');
  });

  test('GET /api/exams/readiness returns exam windows with hour-weighted progress', async () => {
    const res = await fetch(`${baseUrl}/api/exams/readiness`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.exams));
    assert.ok(data.exams.length > 0, 'Exams list should not be empty');
  });
});
