// Calculations & Curriculum Regression Suite
// Verifies Part 5 (7 Subjects), Part 6 (Duration Formatting), Part 7 (Calculations Audit)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import CalendarService from '../src/services/calendar.service.js';
import ProgressionService from '../src/services/progression.service.js';
import { db } from '../src/database/db.js';

describe('Part 5: Curriculum Subjects Verification', () => {
  test('All 7 requested subjects exist in database with accurate names and codes', () => {
    const requiredNames = [
      'DSA',
      'Web Development',
      'Math',
      'Physics',
      'CAD',
      'Soft Skills',
      'IT'
    ];

    const subjects = db.query(`SELECT code, name, planned_total_hours FROM subjects`);
    const foundNames = subjects.map(s => s.name);

    for (const reqName of requiredNames) {
      assert.ok(foundNames.includes(reqName), `Database must contain subject: ${reqName}`);
      const s = subjects.find(sub => sub.name === reqName);
      assert.ok(s.code, `Subject ${reqName} must have a subject code`);
      assert.ok(s.planned_total_hours > 0, `Subject ${reqName} must have planned_total_hours > 0`);
    }
  });

  test('Campuses include HI-Tech, Rathinam, Jagannath, and RGI without duplication', () => {
    const campuses = db.query(`SELECT id, name FROM campuses`);
    const campusNames = campuses.map(c => c.name);

    assert.ok(campusNames.includes('HI-Tech Campus'), 'HI-Tech Campus must exist');
    assert.ok(campusNames.includes('Rathinam Campus'), 'Rathinam Campus must exist');
    assert.ok(campusNames.includes('Jagannath Campus'), 'Jagannath Campus must exist');
    assert.ok(campusNames.includes('RGI Campus'), 'RGI Campus must exist');
    assert.strictEqual(campuses.length, 4, 'Should have exactly 4 campuses');
  });
});

describe('Part 6: Human-Readable Duration Formatting (Exact Specification)', () => {
  test('Formats 50 minutes as "50 min"', () => {
    const result = CalendarService.formatDuration(50 / 60);
    assert.strictEqual(result, '50 min');
  });

  test('Formats 1 hour as "1 hr"', () => {
    const result = CalendarService.formatDuration(1);
    assert.strictEqual(result, '1 hr');
  });

  test('Formats 1 hour 40 minutes as "1 hr 40 min"', () => {
    const result = CalendarService.formatDuration(1 + 40 / 60);
    assert.strictEqual(result, '1 hr 40 min');
  });

  test('Formats 2 hours as "2 hrs"', () => {
    const result = CalendarService.formatDuration(2);
    assert.strictEqual(result, '2 hrs');
  });

  test('Formats 15 hours 50 minutes as "15 hrs 50 min"', () => {
    const result = CalendarService.formatDuration(15 + 50 / 60);
    assert.strictEqual(result, '15 hrs 50 min');
  });

  test('Formats 0 hours as "0 min"', () => {
    const result = CalendarService.formatDuration(0);
    assert.strictEqual(result, '0 min');
  });

  test('Handles null/undefined/NaN gracefully', () => {
    assert.strictEqual(CalendarService.formatDuration(null), '0 min');
    assert.strictEqual(CalendarService.formatDuration(undefined), '0 min');
    assert.strictEqual(CalendarService.formatDuration(NaN), '0 min');
  });
});

describe('Part 7: Calculations Audit (Progression Engine)', () => {
  test('calculateSubjectProgress returns verified progression metrics for seeded subject', () => {
    const dsa = db.get(`SELECT id FROM subjects WHERE code = 'DSA101' LIMIT 1`);
    assert.ok(dsa, 'DSA101 subject must exist');

    const progress = ProgressionService.calculateSubjectProgress(dsa.id, '2026-10-19');
    assert.ok(progress.hoursInScope > 0, 'Hours in scope must be positive');
    assert.ok(typeof progress.coveredHours === 'number', 'Covered hours must be numeric');
    assert.ok(typeof progress.remainingHours === 'number', 'Remaining hours must be numeric');
    assert.ok(typeof progress.availableHours === 'number', 'Available hours must be numeric');
    assert.ok(typeof progress.bufferRatio === 'number', 'Buffer ratio must be numeric');
    assert.ok(typeof progress.paceVsPlan === 'number', 'Pace vs plan must be numeric');
    assert.ok(['ON TRACK', 'TIGHT', 'DANGER', 'COMPLETE'].includes(progress.status), 'Status must be valid');
  });

  test('rollUpStatus strictly implements Zero Masking rule', () => {
    assert.strictEqual(ProgressionService.rollUpStatus(['ON TRACK', 'ON TRACK', 'DANGER', 'TIGHT']), 'DANGER');
    assert.strictEqual(ProgressionService.rollUpStatus(['ON TRACK', 'TIGHT', 'COMPLETE']), 'TIGHT');
    assert.strictEqual(ProgressionService.rollUpStatus(['ON TRACK', 'ON TRACK']), 'ON TRACK');
    assert.strictEqual(ProgressionService.rollUpStatus(['COMPLETE', 'COMPLETE']), 'COMPLETE');
  });
});

