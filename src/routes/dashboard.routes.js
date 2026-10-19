// Executive Dashboard and Analytics Routes for EDVANTA
// Computes multi-level KPIs, pace vs plan, rolled-up track health, and traceability data

import { Router } from 'express';
import { db } from '../database/db.js';
import { authenticate } from '../middleware/auth.js';
import ProgressionService from '../services/progression.service.js';

const router = Router();

router.get('/overview', authenticate, (req, res) => {
  const { campus_id, track_id, semester_id, batch_name, subject_id, as_of_date } = req.query;

  let subjectsQuery = `
    SELECT s.id, s.code, s.name, s.color, s.campus_id, s.track_id, s.semester_id,
           c.name as campus_name, t.name as track_name, sem.name as semester_name,
           sem.batch_name, u.name as faculty_name
    FROM subjects s
    JOIN campuses c ON s.campus_id = c.id
    JOIN tracks t ON s.track_id = t.id
    JOIN semesters sem ON s.semester_id = sem.id
    LEFT JOIN users u ON s.faculty_id = u.id
    WHERE 1=1
  `;
  const params = [];

  // Role-based restrictions
  if (req.user.role === 'CAMPUS_MANAGER') {
    subjectsQuery += ` AND s.campus_id = ?`;
    params.push(req.user.campus_id);
  } else if (req.user.role === 'FACULTY') {
    subjectsQuery += ` AND s.faculty_id = ?`;
    params.push(req.user.id);
  } else if (req.user.role === 'STUDENT' && req.user.batch_name) {
    subjectsQuery += ` AND sem.batch_name = ?`;
    params.push(req.user.batch_name);
  }

  // Query filters
  if (campus_id) { subjectsQuery += ` AND s.campus_id = ?`; params.push(campus_id); }
  if (track_id) { subjectsQuery += ` AND s.track_id = ?`; params.push(track_id); }
  if (semester_id) { subjectsQuery += ` AND s.semester_id = ?`; params.push(semester_id); }
  if (batch_name) { subjectsQuery += ` AND sem.batch_name = ?`; params.push(batch_name); }
  if (subject_id) { subjectsQuery += ` AND s.id = ?`; params.push(subject_id); }

  subjectsQuery += ` ORDER BY s.code ASC`;
  const subjects = db.query(subjectsQuery, params);

  // Calculate progression for each subject
  const subjectProgressList = [];
  let totalHoursInScope = 0;
  let totalCoveredHours = 0;
  let totalRemainingHours = 0;
  let totalAvailableHours = 0;
  let totalOverdueTopics = 0;

  let countOnTrack = 0;
  let countTight = 0;
  let countDanger = 0;
  let countComplete = 0;

  for (const subj of subjects) {
    try {
      const p = ProgressionService.calculateSubjectProgress(subj.id, as_of_date);
      subjectProgressList.push(p);

      totalHoursInScope += p.hoursInScope;
      totalCoveredHours += p.coveredHours;
      totalRemainingHours += p.remainingHours;
      totalAvailableHours += p.availableHours;
      totalOverdueTopics += p.overdueTopicsCount;

      if (p.status === 'COMPLETE') countComplete++;
      else if (p.status === 'ON TRACK') countOnTrack++;
      else if (p.status === 'TIGHT') countTight++;
      else if (p.status === 'DANGER') countDanger++;
    } catch (err) {
      console.error(`Error calculating progress for ${subj.code}:`, err.message);
    }
  }

  // Rolled-up Track Status (MANDATORY: Worst-case subject status, never an average!)
  const subjectStatuses = subjectProgressList.map(s => s.status);
  const overallTrackStatus = ProgressionService.rollUpStatus(subjectStatuses);

  // Overall Coverage %
  const overallCoveragePercent = totalHoursInScope > 0
    ? Number(((totalCoveredHours / totalHoursInScope) * 100).toFixed(2))
    : 100.0;

  // Overall Buffer Ratio
  const overallBufferRatio = totalRemainingHours > 0
    ? Number((totalAvailableHours / totalRemainingHours).toFixed(2))
    : 99.99;

  // Pace vs Plan summary
  const totalExpectedHoursByToday = subjectProgressList.reduce((acc, curr) => acc + curr.hoursExpectedByToday, 0);
  const overallPaceVsPlan = Number((totalCoveredHours - totalExpectedHoursByToday).toFixed(2));

  // Upcoming Examinations for relevant semester(s)
  const semIds = [...new Set(subjects.map(s => s.semester_id))];
  let upcomingExams = [];
  if (semIds.length > 0) {
    const placeholders = semIds.map(() => '?').join(',');
    upcomingExams = db.query(`
      SELECT ew.*, sem.name as semester_name, sem.batch_name
      FROM exam_windows ew
      JOIN semesters sem ON ew.semester_id = sem.id
      WHERE ew.semester_id IN (${placeholders})
      ORDER BY ew.start_date ASC
    `, semIds);
  }

  res.json({
    asOfDate: ProgressionService.getToday(as_of_date),
    filtersApplied: {
      campus_id: campus_id || null,
      track_id: track_id || null,
      semester_id: semester_id || null,
      batch_name: batch_name || null,
      subject_id: subject_id || null
    },
    summary: {
      totalSubjects: subjectProgressList.length,
      rolledUpTrackStatus: overallTrackStatus,
      statusCounts: {
        onTrack: countOnTrack,
        tight: countTight,
        danger: countDanger,
        complete: countComplete
      },
      hours: {
        inScope: Number(totalHoursInScope.toFixed(2)),
        covered: Number(totalCoveredHours.toFixed(2)),
        remaining: Number(totalRemainingHours.toFixed(2)),
        available: Number(totalAvailableHours.toFixed(2)),
        coveragePercent: overallCoveragePercent,
        bufferRatio: overallBufferRatio,
        paceVsPlan: overallPaceVsPlan,
        isBehindPlan: overallPaceVsPlan < -0.01,
        overdueTopics: totalOverdueTopics
      }
    },
    subjects: subjectProgressList,
    upcomingExams
  });
});

export default router;
