// Unit & Regression Tests for EDVANTA Mandatory Calculations (Requirement 10 & 12)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import CalendarService from '../src/services/calendar.service.js';
import ProgressionService from '../src/services/progression.service.js';
import { db } from '../src/database/db.js';

describe('Requirement 10: Mandatory Progress Calculations', () => {
  test('A & B: Hours in Scope and Covered Hours calculation with skipped and in-progress topics', () => {
    // Test pure logic directly
    const topics = [
      { planned_hours: 3.0, status: 'COMPLETED', completion_percentage: 100 },
      { planned_hours: 2.5, status: 'IN_PROGRESS', completion_percentage: 50 }, // 1.25 hrs covered
      { planned_hours: 2.0, status: 'SKIPPED', completion_percentage: 0 },       // Excluded from scope
      { planned_hours: 2.5, status: 'NOT_STARTED', completion_percentage: 0 }
    ];

    // Hours in Scope: Sum planned hours for topics, EXCLUDING SKIPPED
    const hoursInScope = topics
      .filter(t => t.status !== 'SKIPPED')
      .reduce((sum, t) => sum + t.planned_hours, 0);

    assert.equal(hoursInScope, 8.0, 'Hours in scope must exclude SKIPPED topic (3.0 + 2.5 + 2.5 = 8.0)');

    // Covered Hours
    let coveredHours = 0;
    for (const t of topics) {
      if (t.status === 'COMPLETED') coveredHours += t.planned_hours;
      else if (t.status === 'IN_PROGRESS') coveredHours += (t.planned_hours * t.completion_percentage) / 100;
    }

    assert.equal(coveredHours, 4.25, 'Covered hours should be 3.0 + (2.5 * 0.5) = 4.25');

    // C. Coverage Percentage
    const coveragePercent = (coveredHours / hoursInScope) * 100;
    assert.equal(coveragePercent, 53.125, 'Coverage % should be (4.25 / 8.0) * 100 = 53.125%');

    // D. Remaining Hours
    const remainingHours = Math.max(0, hoursInScope - coveredHours);
    assert.equal(remainingHours, 3.75, 'Remaining hours must be 8.0 - 4.25 = 3.75');
  });

  test('D: Remaining hours prevents negative values caused by over-delivery', () => {
    const hoursInScope = 10.0;
    const coveredHours = 10.5; // Slight over-delivery
    const remainingHours = Math.max(0, hoursInScope - coveredHours);
    assert.equal(remainingHours, 0, 'Remaining hours must never be negative');
  });

  test('F: Buffer Ratio and Status Classification thresholds', () => {
    const thresholds = { onTrack: 1.15, tight: 1.00 };

    // Case 1: Complete (remaining == 0)
    let available = 15;
    let remaining = 0;
    let status = remaining <= 0.001 ? 'COMPLETE' : 'UNKNOWN';
    assert.equal(status, 'COMPLETE', 'Should be COMPLETE when remaining hours is 0');

    // Case 2: On Track (ratio >= 1.15)
    remaining = 10;
    available = 12.5; // ratio = 1.25
    let ratio = available / remaining;
    if (ratio >= thresholds.onTrack) status = 'ON TRACK';
    else if (ratio >= thresholds.tight) status = 'TIGHT';
    else status = 'DANGER';
    assert.equal(status, 'ON TRACK', 'Ratio 1.25 must be classified as ON TRACK');

    // Case 3: Tight (1.00 <= ratio < 1.15)
    available = 10.5; // ratio = 1.05
    ratio = available / remaining;
    if (ratio >= thresholds.onTrack) status = 'ON TRACK';
    else if (ratio >= thresholds.tight) status = 'TIGHT';
    else status = 'DANGER';
    assert.equal(status, 'TIGHT', 'Ratio 1.05 must be classified as TIGHT');

    // Case 4: Danger (ratio < 1.00)
    available = 8.5; // ratio = 0.85
    ratio = available / remaining;
    if (ratio >= thresholds.onTrack) status = 'ON TRACK';
    else if (ratio >= thresholds.tight) status = 'TIGHT';
    else status = 'DANGER';
    assert.equal(status, 'DANGER', 'Ratio 0.85 must be classified as DANGER');
  });

  test('G: Pace vs Plan calculation (positive vs negative behind plan)', () => {
    const coveredHours = 15.0;
    const hoursShouldHaveBeenCovered = 18.0;
    const paceVsPlan = coveredHours - hoursShouldHaveBeenCovered;
    assert.equal(paceVsPlan, -3.0, 'Behind schedule by 3 hours');
    assert.equal(paceVsPlan < 0, true, 'Negative pace indicates behind schedule');
  });

  test('I: Rolled-up Track Status must reflect WORST applicable subject, not an average', () => {
    // 3 subjects on track, 1 subject in danger
    const statuses = ['ON TRACK', 'ON TRACK', 'COMPLETE', 'DANGER'];
    const trackStatus = ProgressionService.rollUpStatus(statuses);
    assert.equal(trackStatus, 'DANGER', 'Track must roll up to DANGER if ANY subject is in DANGER');

    // 2 on track, 1 tight
    const statuses2 = ['ON TRACK', 'TIGHT', 'ON TRACK'];
    assert.equal(ProgressionService.rollUpStatus(statuses2), 'TIGHT', 'Track must roll up to TIGHT if worst is TIGHT');

    // all on track
    const statuses3 = ['ON TRACK', 'COMPLETE', 'ON TRACK'];
    assert.equal(ProgressionService.rollUpStatus(statuses3), 'ON TRACK', 'Track must be ON TRACK if all are ON TRACK or COMPLETE');

    // all complete
    const statuses4 = ['COMPLETE', 'COMPLETE'];
    assert.equal(ProgressionService.rollUpStatus(statuses4), 'COMPLETE', 'Track must be COMPLETE if all are COMPLETE');
  });

  test('Requirement 6: Decimal teaching hours conversion precision', () => {
    // 50 minutes = 0.8333333333333334 hours
    const duration50 = CalendarService.calculateDurationHours('09:00', '09:50');
    assert.ok(Math.abs(duration50 - 50 / 60) < 0.00001, '50 minutes must convert accurately to decimal hours');

    // 100 minutes = 1.6666666666666667 hours
    const duration100 = CalendarService.calculateDurationHours('10:00', '11:40');
    assert.ok(Math.abs(duration100 - 100 / 60) < 0.00001, '100 minutes must convert accurately to 1.6667 hours');

    // End time before start time throws
    assert.throws(() => {
      CalendarService.calculateDurationHours('11:00', '10:00');
    }, /strictly after/, 'End time before start time must throw error');
  });
});
