// Integration Tests for Part 2 & Part 3: Authentication, Portals, and Phone/Email Login

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/server.js';
import { db } from '../src/database/db.js';

describe('Part 2 & Part 3: Real Authentication & Portals RBAC Tests', () => {
  let server;
  let baseUrl;

  before(async () => {
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });
  });

  after(() => {
    if (server) server.close();
  });

  // 1. Email Login
  test('User can log in using registered email address', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@edvanta.msot.edu',
        password: 'edvanta123'
      })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.token, 'Token must be returned');
    assert.equal(data.user.role, 'ADMIN');
    assert.equal(data.user.email, 'admin@edvanta.msot.edu');
    assert.equal(data.user.password_hash, undefined, 'password_hash must never be exposed');
  });

  // 2. Phone Login
  test('User can log in using registered phone number', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: '9876543220', // Dr. Aris Thorne
        password: 'edvanta123'
      })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.token, 'Token must be returned');
    assert.equal(data.user.role, 'FACULTY');
    assert.equal(data.user.phone, '9876543220');
  });

  // 3. Generic Identifier field (email or phone in same input)
  test('User can log in using identifier field with phone', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: '9876543230', // Aarav Mehta (Student)
        password: 'edvanta123'
      })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.user.role, 'STUDENT');
  });

  // 4. Invalid credentials rejection
  test('Login rejects invalid password and non-existent identifier', async () => {
    const res1 = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@edvanta.msot.edu',
        password: 'wrongpassword'
      })
    });
    assert.equal(res1.status, 401);

    const res2 = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'nobody@edvanta.msot.edu',
        password: 'edvanta123'
      })
    });
    assert.equal(res2.status, 401);
  });

  // 5. Password Change Flow
  test('User can change password securely', async () => {
    // Login as student
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'student.ananya@edvanta.msot.edu',
        password: 'edvanta123'
      })
    });
    const { token } = await loginRes.json();

    // Attempt change with wrong current password -> 401
    const badChangeRes = await fetch(`${baseUrl}/api/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        currentPassword: 'wrongpassword',
        newPassword: 'newsecurepass123'
      })
    });
    assert.equal(badChangeRes.status, 401);

    // Attempt change with too short password -> 400
    const shortChangeRes = await fetch(`${baseUrl}/api/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        currentPassword: 'edvanta123',
        newPassword: '123'
      })
    });
    assert.equal(shortChangeRes.status, 400);

    // Successful change
    const okChangeRes = await fetch(`${baseUrl}/api/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        currentPassword: 'edvanta123',
        newPassword: 'newsecurepass123'
      })
    });
    assert.equal(okChangeRes.status, 200);

    // Verify login with new password works
    const newLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'student.ananya@edvanta.msot.edu',
        password: 'newsecurepass123'
      })
    });
    assert.equal(newLoginRes.status, 200);

    // Restore original password
    const restoreToken = (await newLoginRes.json()).token;
    await fetch(`${baseUrl}/api/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${restoreToken}`
      },
      body: JSON.stringify({
        currentPassword: 'newsecurepass123',
        newPassword: 'edvanta123'
      })
    });
  });

  // 6. Admin Account Provisioning Flow
  test('Admin can create faculty and student accounts; non-admin is blocked', async () => {
    // Admin login
    const adminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@edvanta.msot.edu',
        password: 'edvanta123'
      })
    });
    const { token: adminToken } = await adminLoginRes.json();

    // Faculty login
    const facLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'faculty.cs@edvanta.msot.edu',
        password: 'edvanta123'
      })
    });
    const { token: facultyToken } = await facLoginRes.json();

    // Faculty trying to create user -> 403 Forbidden
    const unauthRes = await fetch(`${baseUrl}/api/auth/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${facultyToken}`
      },
      body: JSON.stringify({
        email: 'newfac@edvanta.msot.edu',
        name: 'New Faculty',
        role: 'FACULTY',
        password: 'password123'
      })
    });
    assert.equal(unauthRes.status, 403, 'Faculty cannot create user accounts');

    // Admin creating a student
    const testStudentEmail = `test_student_${Date.now()}@edvanta.msot.edu`;
    const createRes = await fetch(`${baseUrl}/api/auth/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        email: testStudentEmail,
        phone: `999${Date.now().toString().slice(-7)}`,
        name: 'Test Student',
        role: 'STUDENT',
        campus_id: 'camp_hitech',
        batch_name: 'Batch-2026-Mirai-A',
        password: 'studentpass123'
      })
    });
    assert.equal(createRes.status, 201);
    const createdData = await createRes.json();
    assert.equal(createdData.user.email, testStudentEmail);

    // Clean up created test user
    db.run(`DELETE FROM users WHERE email = ?`, [testStudentEmail]);
  });

  // 7. Exactly Three Primary Portals (Requirement 2)
  test('Exactly three login portals (Admin, Faculty, Student) are supported', async () => {
    // Admin Portal login
    const adminRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'admin@edvanta.msot.edu', password: 'edvanta123' })
    });
    assert.equal(adminRes.status, 200);
    const adminData = await adminRes.json();
    assert.equal(adminData.user.role, 'ADMIN', 'Admin portal user must have ADMIN role');

    // Faculty Portal login
    const facRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'faculty.cs@edvanta.msot.edu', password: 'edvanta123' })
    });
    assert.equal(facRes.status, 200);
    const facData = await facRes.json();
    assert.equal(facData.user.role, 'FACULTY', 'Faculty portal user must have FACULTY role');

    // Student Portal login
    const studRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'student.aarav@edvanta.msot.edu', password: 'edvanta123' })
    });
    assert.equal(studRes.status, 200);
    const studData = await studRes.json();
    assert.equal(studData.user.role, 'STUDENT', 'Student portal user must have STUDENT role');
  });

  // 8. Three Campuses: HI-Tech, Jagannath, and Rathinam (Requirement 12)
  test('Campuses include HI-Tech, Jagannath, and Rathinam with exact naming', async () => {
    const res = await fetch(`${baseUrl}/api/campuses`);
    assert.equal(res.status, 200);
    const data = await res.json();
    const campusMap = Object.fromEntries(data.campuses.map(c => [c.id, c.name]));

    assert.equal(campusMap['camp_hitech'], 'HI-Tech Campus');
    assert.equal(campusMap['camp_juj'], 'Jagannath Campus');
    assert.equal(campusMap['camp_ratnam'], 'Rathinam Campus');
  });

  // 9. Protect Private Pages and APIs Against Unauthorized Access (Requirement 7)
  test('Private APIs reject unauthenticated requests with HTTP 401', async () => {
    // Unauthenticated /api/auth/me -> 401
    const meRes = await fetch(`${baseUrl}/api/auth/me`);
    assert.equal(meRes.status, 401, '/api/auth/me must require authentication');

    // Unauthenticated /api/auth/users -> 401
    const usersRes = await fetch(`${baseUrl}/api/auth/users`);
    assert.equal(usersRes.status, 401, '/api/auth/users must require authentication');

    // Unauthenticated /api/sessions/today -> 401
    const sessRes = await fetch(`${baseUrl}/api/sessions/today`);
    assert.equal(sessRes.status, 401, '/api/sessions/today must require authentication');

    // Invalid token /api/auth/me -> 401
    const badTokenRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: 'Bearer invalid.token.value' }
    });
    assert.equal(badTokenRes.status, 401, 'Invalid token must be rejected with 401');
  });
});
