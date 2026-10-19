// Calendar & Schedule Tests for EDVANTA (Requirement 5)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import CalendarService from '../src/services/calendar.service.js';

describe('Requirement 5: Calendar & Working Saturday Calculations', () => {
  test('Second and Fourth Saturday Rule is accurately calculated', () => {
    // In October 2026:
    // 2026-10-03 is 1st Saturday (Day 3)
    // 2026-10-10 is 2nd Saturday (Day 10)
    // 2026-10-17 is 3rd Saturday (Day 17)
    // 2026-10-24 is 4th Saturday (Day 24)
    // 2026-10-31 is 5th Saturday (Day 31)

    assert.equal(CalendarService.getDayOfWeek('2026-10-03'), 6, '2026-10-03 must be Saturday');
    assert.equal(CalendarService.getDayOfWeek('2026-10-10'), 6, '2026-10-10 must be Saturday');
    assert.equal(CalendarService.getDayOfWeek('2026-10-17'), 6, '2026-10-17 must be Saturday');
    assert.equal(CalendarService.getDayOfWeek('2026-10-24'), 6, '2026-10-24 must be Saturday');
    assert.equal(CalendarService.getDayOfWeek('2026-10-31'), 6, '2026-10-31 must be Saturday');

    // Rule: SECOND_AND_FOURTH
    assert.equal(CalendarService.isWorkingSaturday('2026-10-03', 'SECOND_AND_FOURTH'), false, '1st Sat is NOT working');
    assert.equal(CalendarService.isWorkingSaturday('2026-10-10', 'SECOND_AND_FOURTH'), true, '2nd Sat IS working');
    assert.equal(CalendarService.isWorkingSaturday('2026-10-17', 'SECOND_AND_FOURTH'), false, '3rd Sat is NOT working');
    assert.equal(CalendarService.isWorkingSaturday('2026-10-24', 'SECOND_AND_FOURTH'), true, '4th Sat IS working');
    assert.equal(CalendarService.isWorkingSaturday('2026-10-31', 'SECOND_AND_FOURTH'), false, '5th Sat is NOT working');

    // Rule: ALL
    assert.equal(CalendarService.isWorkingSaturday('2026-10-03', 'ALL'), true, 'ALL: 1st Sat is working');
    assert.equal(CalendarService.isWorkingSaturday('2026-10-10', 'ALL'), true, 'ALL: 2nd Sat is working');

    // Rule: NONE
    assert.equal(CalendarService.isWorkingSaturday('2026-10-10', 'NONE'), false, 'NONE: 2nd Sat is NOT working');
    assert.equal(CalendarService.isWorkingSaturday('2026-10-24', 'NONE'), false, 'NONE: 4th Sat is NOT working');
  });

  test('Holidays and Sundays are strictly excluded from working days', () => {
    const holidays = new Set(['2026-10-02']); // Gandhi Jayanti (Friday)
    
    // Friday Gandhi Jayanti is holiday
    assert.equal(CalendarService.isWorkingDay('2026-10-02', 'SECOND_AND_FOURTH', holidays), false);

    // Regular Thursday is working
    assert.equal(CalendarService.isWorkingDay('2026-10-01', 'SECOND_AND_FOURTH', holidays), true);

    // Sunday is always non-working
    assert.equal(CalendarService.isWorkingDay('2026-10-04', 'SECOND_AND_FOURTH', holidays), false);
  });

  test('Working days range generator accurately computes working days in date window', () => {
    // 2026-10-01 (Thu) to 2026-10-07 (Wed)
    // Thu 1 (Work), Fri 2 (Holiday), Sat 3 (1st Sat - Off), Sun 4 (Off), Mon 5 (Work), Tue 6 (Work), Wed 7 (Work)
    // Total working days should be 4: Oct 1, 5, 6, 7.
    const holidays = new Set(['2026-10-02']);
    const workingDays = CalendarService.getWorkingDays('2026-10-01', '2026-10-07', 'SECOND_AND_FOURTH', holidays);

    assert.deepEqual(workingDays, ['2026-10-01', '2026-10-05', '2026-10-06', '2026-10-07']);
    assert.equal(workingDays.length, 4);
  });
});
