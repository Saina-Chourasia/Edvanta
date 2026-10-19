// CSV Import and Export Routes for EDVANTA
// Validates headers, data types, and references inside database transactions with rollback on failure

import { Router } from 'express';
import multer from 'multer';
import { db } from '../database/db.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/permissions.js';
import CalendarService from '../services/calendar.service.js';
import ProgressionService from '../services/progression.service.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Lightweight CSV line parser handling quotes
function parseCSV(text) {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return { headers: [], rows: [] };
  }
  const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };

  const parseRow = (line) => {
    const row = [];
    let insideQuotes = false;
    let current = '';

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (insideQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          insideQuotes = !insideQuotes;
        }
      } else if (char === ',' && !insideQuotes) {
        row.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    row.push(current.trim());
    return row;
  };

  const headers = parseRow(lines[0]).map(h => h.trim().toLowerCase());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseRow(lines[i]);
    if (values.length === headers.length || values.some(v => v !== '')) {
      const obj = { _rowNumber: i + 1 };
      for (let j = 0; j < headers.length; j++) {
        obj[headers[j]] = values[j] !== undefined ? values[j] : '';
      }
      rows.push(obj);
    }
  }

  return { headers, rows };
}

// 1. Import Calendar & Holidays CSV
router.post('/calendar', authenticate, requireRole('ADMIN', 'CAMPUS_MANAGER'), upload.single('file'), (req, res) => {
  let csvContent = '';
  if (req.file) {
    csvContent = req.file.buffer.toString('utf8');
  } else if (typeof req.body.csvText === 'string') {
    csvContent = req.body.csvText;
  } else {
    return res.status(400).json({ error: 'No CSV file or csvText payload provided.' });
  }

  const { headers, rows } = parseCSV(csvContent);
  if (!headers || headers.length === 0) {
    return res.status(400).json({ error: 'CSV file is empty or contains no valid rows.' });
  }

  const requiredHeaders = ['semester_id', 'campus_id', 'event_date', 'event_type', 'title'];
  const missingHeaders = requiredHeaders.filter(h => !headers.includes(h));
  if (missingHeaders.length > 0) {
    return res.status(400).json({
      error: `CSV validation failed: Missing required header(s): ${missingHeaders.join(', ')}`
    });
  }

  if (!rows || rows.length === 0) {
    return res.status(400).json({ error: 'CSV file contains headers but no data rows.' });
  }

  // Campus Manager boundary enforcement
  if (req.user.role === 'CAMPUS_MANAGER') {
    const invalidCampus = rows.find(r => r.campus_id && r.campus_id !== req.user.campus_id);
    if (invalidCampus) {
      return res.status(403).json({
        error: `Access denied. Campus Manager can only import calendar events for assigned campus '${req.user.campus_id}'.`
      });
    }
  }

  const errors = [];
  const validRecords = [];

  for (const row of rows) {
    const { _rowNumber, semester_id, campus_id, event_date, event_type, title, description, affects_schedule } = row;

    if (!semester_id) errors.push(`Row ${_rowNumber}: semester_id is required`);
    if (!campus_id) errors.push(`Row ${_rowNumber}: campus_id is required`);
    if (!event_date || !/^\d{4}-\d{2}-\d{2}$/.test(event_date)) {
      errors.push(`Row ${_rowNumber}: event_date must be in YYYY-MM-DD format (got "${event_date}")`);
    }
    const validTypes = ['HOLIDAY', 'ACADEMIC_EVENT', 'EXAM_DAY'];
    if (!validTypes.includes((event_type || '').toUpperCase())) {
      errors.push(`Row ${_rowNumber}: event_type must be one of: ${validTypes.join(', ')}`);
    }
    if (!title) errors.push(`Row ${_rowNumber}: title is required`);

    // Reference validation
    if (semester_id && campus_id) {
      const sem = db.get(`SELECT id FROM semesters WHERE id = ?`, [semester_id]);
      if (!sem) errors.push(`Row ${_rowNumber}: semester_id '${semester_id}' does not exist`);

      const camp = db.get(`SELECT id FROM campuses WHERE id = ?`, [campus_id]);
      if (!camp) errors.push(`Row ${_rowNumber}: campus_id '${campus_id}' does not exist`);
    }

    if (errors.length === 0) {
      validRecords.push({
        id: `ev_${campus_id}_${event_date}_${Math.random().toString(36).substr(2, 4)}`,
        semester_id,
        campus_id,
        event_date,
        event_type: event_type.toUpperCase(),
        title,
        description: description || '',
        affects_schedule: affects_schedule === '0' || affects_schedule === 'false' ? 0 : 1
      });
    }
  }

  if (errors.length > 0) {
    return res.status(422).json({
      error: 'CSV contains validation errors. No records were imported.',
      rowErrors: errors
    });
  }

  try {
    db.transaction((tx) => {
      for (const rec of validRecords) {
        tx.run(`
          INSERT INTO calendar_events (id, semester_id, campus_id, event_date, event_type, title, description, affects_schedule)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(campus_id, semester_id, event_date, title) DO UPDATE SET
            event_type = excluded.event_type, description = excluded.description, affects_schedule = excluded.affects_schedule
        `, [rec.id, rec.semester_id, rec.campus_id, rec.event_date, rec.event_type, rec.title, rec.description, rec.affects_schedule]);
      }
    });

    // Recalculate schedules for affected semesters
    const semIds = [...new Set(validRecords.map(r => r.semester_id))];
    for (const semId of semIds) {
      const subjects = db.query(`SELECT id FROM subjects WHERE semester_id = ?`, [semId]);
      for (const subj of subjects) {
        ProgressionService.generatePlannedTopicDates(subj.id);
      }
    }

    res.json({
      message: `Successfully imported ${validRecords.length} calendar event(s). Topic progression recalculated.`,
      importedCount: validRecords.length
    });
  } catch (err) {
    res.status(500).json({ error: `Transaction rollback: ${err.message}` });
  }
});

// 2. Import Timetable CSV
router.post('/timetable', authenticate, requireRole('ADMIN', 'CAMPUS_MANAGER'), upload.single('file'), (req, res) => {
  let csvContent = '';
  if (req.file) csvContent = req.file.buffer.toString('utf8');
  else if (typeof req.body.csvText === 'string') csvContent = req.body.csvText;
  else return res.status(400).json({ error: 'No CSV file or csvText payload provided.' });

  const { headers, rows } = parseCSV(csvContent);
  if (!headers || headers.length === 0) {
    return res.status(400).json({ error: 'CSV file is empty or contains no valid rows.' });
  }

  const requiredHeaders = ['campus_id', 'track_id', 'semester_id', 'batch_name', 'subject_code', 'faculty_email', 'weekday', 'start_time', 'end_time'];
  const missingHeaders = requiredHeaders.filter(h => !headers.includes(h));
  if (missingHeaders.length > 0) {
    return res.status(400).json({
      error: `CSV validation failed: Missing required header(s): ${missingHeaders.join(', ')}`
    });
  }

  if (!rows || rows.length === 0) {
    return res.status(400).json({ error: 'CSV file contains headers but no data rows.' });
  }

  // Campus Manager boundary enforcement
  if (req.user.role === 'CAMPUS_MANAGER') {
    const invalidCampus = rows.find(r => r.campus_id && r.campus_id !== req.user.campus_id);
    if (invalidCampus) {
      return res.status(403).json({
        error: `Access denied. Campus Manager can only import timetables for assigned campus '${req.user.campus_id}'.`
      });
    }
  }

  const errors = [];
  const validRecords = [];

  for (const row of rows) {
    const { _rowNumber, campus_id, track_id, semester_id, batch_name, subject_code, faculty_email, weekday, start_time, end_time, room } = row;

    const dow = parseInt(weekday, 10);
    if (isNaN(dow) || dow < 1 || dow > 6) {
      errors.push(`Row ${_rowNumber}: weekday must be an integer 1-6 (got "${weekday}")`);
    }

    const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (!timeRegex.test(start_time) || !timeRegex.test(end_time)) {
      errors.push(`Row ${_rowNumber}: start_time and end_time must be HH:MM format (got ${start_time}-${end_time})`);
    } else if (start_time >= end_time) {
      errors.push(`Row ${_rowNumber}: end_time must be after start_time`);
    }

    // Lookup references
    const subject = db.get(`SELECT id FROM subjects WHERE LOWER(code) = LOWER(?)`, [subject_code]);
    if (!subject) errors.push(`Row ${_rowNumber}: Unknown subject code '${subject_code}'`);

    const faculty = db.get(`SELECT id FROM users WHERE LOWER(email) = LOWER(?)`, [faculty_email]);
    if (!faculty) errors.push(`Row ${_rowNumber}: Unknown faculty email '${faculty_email}'`);

    let durationHours = 0;
    try {
      durationHours = CalendarService.calculateDurationHours(start_time, end_time);
    } catch (e) {
      errors.push(`Row ${_rowNumber}: ${e.message}`);
    }

    if (errors.length === 0 && subject && faculty) {
      validRecords.push({
        id: `slot_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
        campus_id,
        track_id,
        semester_id,
        batch_name,
        subject_id: subject.id,
        faculty_id: faculty.id,
        weekday: dow,
        start_time,
        end_time,
        duration_hours: durationHours,
        room: room || ''
      });
    }
  }

  if (errors.length > 0) {
    return res.status(422).json({
      error: 'CSV contains validation errors. No timetable records imported.',
      rowErrors: errors
    });
  }

  try {
    db.transaction((tx) => {
      for (const rec of validRecords) {
        tx.run(`
          INSERT INTO timetable_slots (id, campus_id, track_id, semester_id, batch_name, subject_id, faculty_id, weekday, start_time, end_time, duration_hours, room)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(campus_id, batch_name, weekday, start_time) DO UPDATE SET
            end_time = excluded.end_time, duration_hours = excluded.duration_hours, faculty_id = excluded.faculty_id
        `, [rec.id, rec.campus_id, rec.track_id, rec.semester_id, rec.batch_name, rec.subject_id, rec.faculty_id, rec.weekday, rec.start_time, rec.end_time, rec.duration_hours, rec.room]);
      }
    });

    const affectedSubjectIds = [...new Set(validRecords.map(r => r.subject_id))];
    for (const sId of affectedSubjectIds) {
      ProgressionService.generatePlannedTopicDates(sId);
    }

    res.json({
      message: `Successfully imported ${validRecords.length} timetable slot(s).`,
      importedCount: validRecords.length
    });
  } catch (err) {
    res.status(500).json({ error: `Transaction rollback: ${err.message}` });
  }
});

// 3. Import Syllabus / Lesson Plans CSV
router.post('/syllabus', authenticate, upload.single('file'), (req, res) => {
  let csvContent = '';
  if (req.file) csvContent = req.file.buffer.toString('utf8');
  else if (typeof req.body.csvText === 'string') csvContent = req.body.csvText;
  else return res.status(400).json({ error: 'No CSV file or csvText payload provided.' });

  const { headers, rows } = parseCSV(csvContent);
  if (!headers || headers.length === 0) {
    return res.status(400).json({ error: 'CSV file is empty or contains no valid rows.' });
  }

  const requiredHeaders = ['subject_code', 'unit_number', 'unit_name', 'topic_title', 'planned_hours', 'sequence_order', 'exam_scope'];
  const missingHeaders = requiredHeaders.filter(h => !headers.includes(h));
  if (missingHeaders.length > 0) {
    return res.status(400).json({
      error: `CSV validation failed: Missing required header(s): ${missingHeaders.join(', ')}`
    });
  }

  if (!rows || rows.length === 0) {
    return res.status(400).json({ error: 'CSV file contains headers but no data rows.' });
  }

  // Campus Manager boundary enforcement
  if (req.user.role === 'CAMPUS_MANAGER') {
    for (const row of rows) {
      const subj = db.get(`SELECT campus_id FROM subjects WHERE LOWER(code) = LOWER(?)`, [row.subject_code]);
      if (subj && subj.campus_id !== req.user.campus_id) {
        return res.status(403).json({
          error: `Access denied. Campus Manager can only import syllabus for assigned campus '${req.user.campus_id}'.`
        });
      }
    }
  }

  const errors = [];
  const validRecords = [];

  for (const row of rows) {
    const { _rowNumber, subject_code, unit_number, unit_name, topic_title, description, planned_hours, sequence_order, exam_scope } = row;

    const uNum = parseInt(unit_number, 10);
    if (isNaN(uNum) || uNum <= 0) errors.push(`Row ${_rowNumber}: unit_number must be a positive integer`);

    const seq = parseInt(sequence_order, 10);
    if (isNaN(seq) || seq <= 0) errors.push(`Row ${_rowNumber}: sequence_order must be a positive integer`);

    const hours = parseFloat(planned_hours);
    if (isNaN(hours) || hours <= 0) errors.push(`Row ${_rowNumber}: planned_hours must be a positive decimal number`);

    const validScopes = ['SESSIONAL', 'MID_TERM', 'PUT', 'END_TERM', 'ALL'];
    if (!validScopes.includes((exam_scope || '').toUpperCase())) {
      errors.push(`Row ${_rowNumber}: exam_scope must be one of: ${validScopes.join(', ')}`);
    }

    const subject = db.get(`SELECT id, faculty_id FROM subjects WHERE LOWER(code) = LOWER(?)`, [subject_code]);
    if (!subject) {
      errors.push(`Row ${_rowNumber}: Unknown subject code '${subject_code}'`);
    } else if (req.user.role === 'FACULTY' && subject.faculty_id !== req.user.id) {
      errors.push(`Row ${_rowNumber}: Access denied: You are not authorized to update lesson plans for subject '${subject_code}'`);
    }

    if (errors.length === 0 && subject) {
      validRecords.push({
        id: `lp_${subject.id}_${seq}`,
        subject_id: subject.id,
        unit_number: uNum,
        unit_name,
        topic_number: seq,
        topic_title,
        description: description || '',
        planned_hours: hours,
        sequence_order: seq,
        exam_scope: exam_scope.toUpperCase()
      });
    }
  }

  if (errors.length > 0) {
    return res.status(422).json({
      error: 'CSV contains validation errors. No syllabus topics imported.',
      rowErrors: errors
    });
  }

  try {
    db.transaction((tx) => {
      for (const rec of validRecords) {
        tx.run(`
          INSERT INTO lesson_plans (id, subject_id, unit_number, unit_name, topic_number, topic_title, description, planned_hours, sequence_order, exam_scope, status, completion_percentage)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NOT_STARTED', 0)
          ON CONFLICT(subject_id, sequence_order) DO UPDATE SET
            topic_title = excluded.topic_title, planned_hours = excluded.planned_hours, exam_scope = excluded.exam_scope
        `, [rec.id, rec.subject_id, rec.unit_number, rec.unit_name, rec.topic_number, rec.topic_title, rec.description, rec.planned_hours, rec.sequence_order, rec.exam_scope]);
      }
    });

    const affectedSubjectIds = [...new Set(validRecords.map(r => r.subject_id))];
    for (const sId of affectedSubjectIds) {
      ProgressionService.generatePlannedTopicDates(sId);
    }

    res.json({
      message: `Successfully imported ${validRecords.length} lesson plan topic(s). Progression recalculated.`,
      importedCount: validRecords.length
    });
  } catch (err) {
    res.status(500).json({ error: `Transaction rollback: ${err.message}` });
  }
});

// 4. Export Progress Report to CSV
router.get('/export/progress-report', authenticate, (req, res) => {
  const subjects = db.query(`SELECT id FROM subjects ORDER BY code ASC`);
  const rows = [];

  for (const s of subjects) {
    try {
      const p = ProgressionService.calculateSubjectProgress(s.id);
      rows.push([
        p.code,
        `"${p.name.replace(/"/g, '""')}"`,
        `"${p.campusName}"`,
        `"${p.trackName}"`,
        `"${p.batchName}"`,
        p.hoursInScope,
        p.coveredHours,
        p.remainingHours,
        p.coveragePercent + '%',
        p.availableHours,
        p.bufferRatio,
        p.status,
        p.paceVsPlan,
        p.overdueTopicsCount
      ].join(','));
    } catch (e) {}
  }

  const csvHeader = 'Subject Code,Subject Name,Campus,Track,Batch,Hours In Scope,Covered Hours,Remaining Hours,Coverage %,Available Hours,Buffer Ratio,Status,Pace vs Plan,Overdue Topics\n';
  const csvContent = csvHeader + rows.join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="edvanta-progress-report.csv"');
  res.send(csvContent);
});

// 5. Download Sample Templates
router.get('/export/template/:type', (req, res) => {
  const { type } = req.params;
  let template = '';
  let filename = '';

  if (type === 'calendar') {
    filename = 'template-calendar.csv';
    template = `semester_id,campus_id,event_date,event_type,title,description,affects_schedule\nsem_hitech_mirai_a,camp_hitech,2026-11-26,HOLIDAY,Constitution Day,National Holiday,1\n`;
  } else if (type === 'timetable') {
    filename = 'template-timetable.csv';
    template = `campus_id,track_id,semester_id,batch_name,subject_code,faculty_email,weekday,start_time,end_time,room\ncamp_hitech,track_mirai,sem_hitech_mirai_a,Batch-2026-Mirai-A,CS301,faculty.cs@edvanta.msot.edu,1,09:00,09:50,Lab-A1\n`;
  } else if (type === 'syllabus') {
    filename = 'template-syllabus.csv';
    template = `subject_code,unit_number,unit_name,topic_title,description,planned_hours,sequence_order,exam_scope\nCS301,1,Cloud Foundations,Virtual Machines & Hypervisors,KVM vs ESXi,2.0,1,SESSIONAL\n`;
  } else {
    return res.status(400).json({ error: 'Invalid template type. Allowed: calendar, timetable, syllabus' });
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(template);
});

export default router;
