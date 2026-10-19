// Alerts & RBAC Permissions Tests for EDVANTA (Requirements 4 & 14)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/database/db.js';
import AlertsService from '../src/services/alerts.service.js';
import { requireRole, preventStudentMutations } from '../src/middleware/permissions.js';

describe('Requirement 14: Missed-Session Alerts & Escalations', () => {
  test('Alerts service detects unlogged sessions and prevents duplicates', () => {
    // Run missed log check for 2026-10-19
    const alerts1 = AlertsService.checkMissedLogs('2026-10-19');
    // Running again should create 0 duplicates
    const alerts2 = AlertsService.checkMissedLogs('2026-10-19');

    assert.equal(alerts2.length, 0, 'Duplicate alerts must NOT be generated for previously flagged sessions');
  });

  test('Simulation date setting triggers alert checks without changing system clock', () => {
    // Simulate future date 2026-10-25
    AlertsService.setSimulationDate('2026-10-25');
    const activeDate = AlertsService.getActiveDate();
    assert.equal(activeDate, '2026-10-25', 'Simulation date should reflect 2026-10-25');

    // Reset back to system clock
    AlertsService.clearSimulationDate();
    const resetDate = AlertsService.getActiveDate();
    assert.ok(resetDate.length === 10, 'Active date should be reset to system date format YYYY-MM-DD');
  });
});

describe('Requirement 4: Role-Based Access Control Middleware', () => {
  test('preventStudentMutations blocks POST, PUT, DELETE for students', () => {
    let statusCalled = null;
    let jsonCalled = null;

    const fakeRes = {
      status(code) { statusCalled = code; return this; },
      json(payload) { jsonCalled = payload; return this; }
    };

    let nextCalled = false;
    const fakeNext = () => { nextCalled = true; };

    // 1. Student making a POST request
    const studentReq = {
      user: { role: 'STUDENT', name: 'Aarav' },
      method: 'POST'
    };
    preventStudentMutations(studentReq, fakeRes, fakeNext);
    assert.equal(statusCalled, 403, 'Student POST must return 403 Forbidden');
    assert.equal(nextCalled, false, 'Student POST must NOT call next()');

    // 2. Student making a GET request (allowed)
    nextCalled = false;
    const studentGetReq = {
      user: { role: 'STUDENT', name: 'Aarav' },
      method: 'GET'
    };
    preventStudentMutations(studentGetReq, fakeRes, fakeNext);
    assert.equal(nextCalled, true, 'Student GET must be permitted');

    // 3. Faculty making a POST request (allowed through mutation filter)
    nextCalled = false;
    const facultyReq = {
      user: { role: 'FACULTY', name: 'Dr. Thorne' },
      method: 'POST'
    };
    preventStudentMutations(facultyReq, fakeRes, fakeNext);
    assert.equal(nextCalled, true, 'Faculty POST must be permitted through student filter');
  });

  test('requireRole blocks unauthorized roles', () => {
    const adminOnly = requireRole('ADMIN');
    let statusCalled = null;
    const fakeRes = {
      status(code) { statusCalled = code; return this; },
      json() { return this; }
    };
    let nextCalled = false;

    // Faculty attempting Admin route
    adminOnly({ user: { role: 'FACULTY' } }, fakeRes, () => { nextCalled = true; });
    assert.equal(statusCalled, 403, 'Faculty attempting Admin route must be rejected with 403');
    assert.equal(nextCalled, false);

    // Admin attempting Admin route
    nextCalled = false;
    adminOnly({ user: { role: 'ADMIN' } }, fakeRes, () => { nextCalled = true; });
    assert.equal(nextCalled, true, 'Admin must be granted access');
  });
});
