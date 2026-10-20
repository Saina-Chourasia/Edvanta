// Exam Readiness Assessment Routes for EDVANTA
// Evaluates readiness against upcoming examination milestones with hour-weighted progress

import { Router } from 'express';
import { db } from '../database/db.js';
import { authenticate } from '../middleware/auth.js';
import ProgressionService from '../services/progression.service.js';

const router = Router();

router.get('/readiness', authenticate, (req, res) => {
  const { semester_id, subject_id, as_of_date } = req.query;

  // Determine target semester(s)
  let targetSemesterId = semester_id;
  if (!targetSemesterId) {
    if (req.user.batch_name) {
      const studentSem = db.get(`SELECT id FROM semesters WHERE batch_name = ? LIMIT 1`, [req.user.batch_name]);
      if (studentSem) targetSemesterId = studentSem.id;
    }
  }

  if (!targetSemesterId) {
    // Default to first active semester
    const firstActive = db.get(`SELECT id FROM semesters WHERE is_active = 1 LIMIT 1`);
    if (firstActive) targetSemesterId = firstActive.id;
  }

  if (!targetSemesterId) {
    return res.json({ exams: [] });
  }

  try {
    const exams = ProgressionService.getExamReadiness(targetSemesterId, subject_id, as_of_date);
    res.json({
      semesterId: targetSemesterId,
      asOfDate: ProgressionService.getToday(as_of_date),
      exams,
      examWindows: exams
    });
  } catch (err) {
    console.error('Exam readiness error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
