import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/server.js';

describe('Phase 4 & 5: Landing Page, Session Persistence, and Academic Data Fixes', () => {
  let server;
  let baseUrl;

  before(async () => {
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) await new Promise((r) => server.close(r));
  });

  test('GET /api/health returns valid system status and tagline', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'healthy');
    assert.match(data.system, /EDVANTA/i);
    assert.match(data.tagline, /Every Hour Counts/i);
  });

  test('POST /api/auth/login sets edvanta_token cookie and returns user context', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'faculty.cs@edvanta.msot.edu', password: 'edvanta123' })
    });

    assert.equal(res.status, 200);
    const setCookie = res.headers.get('set-cookie');
    assert.ok(setCookie, 'Response must include Set-Cookie header');
    assert.match(setCookie, /edvanta_token=/);
    assert.match(setCookie, /Path=\//);
    assert.match(setCookie, /SameSite=Lax/i);

    const data = await res.json();
    assert.ok(data.token);
    assert.equal(data.user.role, 'FACULTY');
    assert.equal(data.user.email, 'faculty.cs@edvanta.msot.edu');
  });

  test('Authenticated session persists via Cookie header without Authorization header', async () => {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'admin@edvanta.msot.edu', password: 'edvanta123' })
    });
    const { token } = await loginRes.json();

    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: {
        'Cookie': `edvanta_token=${token}`
      }
    });

    assert.equal(meRes.status, 200, 'Cookie-based session must authenticate successfully');
    const meData = await meRes.json();
    assert.equal(meData.user.role, 'ADMIN');
    assert.equal(meData.user.email, 'admin@edvanta.msot.edu');
  });

  test('POST /api/auth/logout invalidates session cookie', async () => {
    const res = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST'
    });
    assert.equal(res.status, 200);
    const setCookie = res.headers.get('set-cookie');
    assert.ok(setCookie);
    assert.match(setCookie, /Max-Age=0/);
  });

  test('Student attendance calculation returns 0% when no attendance records exist (not 100%)', async () => {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'student.aarav@edvanta.msot.edu', password: 'edvanta123' })
    });
    const { token } = await loginRes.json();

    const res = await fetch(`${baseUrl}/api/attendance/records`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.summary);
    if (data.summary.totalSessions === 0) {
      assert.equal(data.summary.attendancePercentage, 0, 'When 0 sessions exist, attendance percentage must be 0, not 100%');
    }
  });

  test('GET /api/sessions/today scopes results to student batch and campus', async () => {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'student.aarav@edvanta.msot.edu', password: 'edvanta123' })
    });
    const { token, user } = await loginRes.json();
    assert.equal(user.role, 'STUDENT');
    assert.equal(user.batch_name, 'Batch-2026-Mirai-A');

    const res = await fetch(`${baseUrl}/api/sessions/today`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.sessions));

    for (const item of data.sessions) {
      assert.equal(item.slot.batch_name, user.batch_name, `Slot batch must be ${user.batch_name}`);
      assert.equal(item.slot.campus_id, user.campus_id, `Slot campus must be ${user.campus_id}`);
    }
  });

  test('Sunset study-desk background image asset is accessible from public/assets', async () => {
    const res = await fetch(`${baseUrl}/assets/sunset_study_desk.jpg`);
    assert.equal(res.status, 200, 'sunset_study_desk.jpg asset must be served successfully');
    const contentType = res.headers.get('content-type');
    assert.match(contentType, /image\/(jpeg|jpg)/i);
  });
});
