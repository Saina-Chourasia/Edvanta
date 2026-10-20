import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/database/db.js';
import ProgressionService from '../src/services/progression.service.js';

test('Portal Flows: Student enrolled subjects and progression contract', async () => {
  // Query student Aarav Mehta
  const student = db.get("SELECT * FROM users WHERE email = 'student.aarav@edvanta.msot.edu'");
  assert.ok(student, 'Student Aarav Mehta exists');
  assert.equal(student.role, 'STUDENT');
  assert.equal(student.batch_name, 'Batch-2026-Mirai-A');

  // Verify progression calculations for student's batch
  const subjects = db.query(`
    SELECT s.id, s.code, s.name, s.semester_id, u.name as faculty_name
    FROM subjects s
    JOIN semesters sem ON s.semester_id = sem.id
    LEFT JOIN users u ON s.faculty_id = u.id
    WHERE sem.batch_name = ?
    ORDER BY s.code ASC
  `, [student.batch_name]);

  assert.ok(subjects.length > 0, 'Student has enrolled subjects');

  for (const s of subjects) {
    const p = ProgressionService.calculateSubjectProgress(s.id, '2026-10-20');
    assert.ok(p.id, 'Subject has id');
    assert.ok(p.code, 'Subject has code');
    assert.ok(p.name, 'Subject has name');
    assert.ok(p.faculty_name, 'Subject has faculty_name');
    assert.ok(typeof p.progressPercentage === 'number', 'progressPercentage is number');
    assert.ok(typeof p.total_hours === 'number', 'total_hours is number');
    assert.ok(typeof p.coveredHours === 'number', 'coveredHours is number');
    assert.ok(typeof p.remainingHours === 'number', 'remainingHours is number');
  }
});

test('Portal Flows: Faculty Fast Lesson Logger scheduled sessions on Tuesday', async () => {
  const faculty = db.get("SELECT * FROM users WHERE email = 'faculty.cs@edvanta.msot.edu'");
  assert.ok(faculty, 'Faculty Dr. Aris Thorne exists');
  assert.equal(faculty.role, 'FACULTY');

  // Query timetable slot on Tuesday (weekday = 2)
  const tuesdaySlot = db.get(`
    SELECT ts.*, s.code as subject_code, s.name as subject_name, u.name as faculty_name
    FROM timetable_slots ts
    JOIN subjects s ON ts.subject_id = s.id
    JOIN users u ON ts.faculty_id = u.id
    WHERE ts.weekday = 2 AND ts.faculty_id = ?
  `, [faculty.id]);

  assert.ok(tuesdaySlot, 'Tuesday timetable slot exists for Dr. Thorne');
  assert.equal(tuesdaySlot.subject_code, 'CS301');
  assert.equal(tuesdaySlot.start_time, '15:00');
  assert.equal(tuesdaySlot.end_time, '15:50');

  // Next topic in syllabus
  const nextTopic = db.get(`
    SELECT id, topic_title, status, planned_hours
    FROM lesson_plans
    WHERE subject_id = ? AND status != 'COMPLETED' AND status != 'SKIPPED'
    ORDER BY sequence_order ASC
    LIMIT 1
  `, [tuesdaySlot.subject_id]);

  assert.ok(nextTopic, 'Next topic exists to pre-fill session logger');
  assert.equal(nextTopic.id, 'lp_cs301_4');
});

test('Portal Flows: Exam readiness windows for student semester', async () => {
  const student = db.get("SELECT * FROM users WHERE email = 'student.aarav@edvanta.msot.edu'");
  const sem = db.get("SELECT id FROM semesters WHERE batch_name = ?", [student.batch_name]);
  assert.ok(sem, 'Semester exists for student batch');

  const exams = ProgressionService.getExamReadiness(sem.id, null, '2026-10-20');
  assert.ok(Array.isArray(exams), 'Exams returns an array');
  assert.ok(exams.length > 0, 'Exams list is not empty');

  const firstExam = exams[0];
  assert.ok(firstExam.examId, 'Exam has examId');
  assert.ok(firstExam.examType, 'Exam has examType');
  assert.ok(firstExam.startDate, 'Exam has startDate');
  assert.ok(firstExam.endDate, 'Exam has endDate');
  assert.ok(typeof firstExam.inScopeHours === 'number', 'inScopeHours is number');
  assert.ok(typeof firstExam.coveredHours === 'number', 'coveredHours is number');
  assert.ok(typeof firstExam.remainingHours === 'number', 'remainingHours is number');
  assert.ok(typeof firstExam.availableHoursBeforeExam === 'number', 'availableHoursBeforeExam is number');
});
