-- EDVANTA: Course Progression Tracker Database Schema
-- Designed for SQLite with clean abstraction for future PostgreSQL migration

CREATE TABLE IF NOT EXISTS campuses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  description TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  phone TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('ADMIN', 'CAMPUS_MANAGER', 'FACULTY', 'STUDENT')),
  campus_id TEXT REFERENCES campuses(id) ON DELETE SET NULL,
  batch_name TEXT, -- for students to associate with their specific batch
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS semesters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  campus_id TEXT NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  batch_name TEXT NOT NULL,
  start_date TEXT NOT NULL, -- YYYY-MM-DD
  end_date TEXT NOT NULL,   -- YYYY-MM-DD
  working_saturday_rule TEXT NOT NULL DEFAULT 'SECOND_AND_FOURTH' CHECK(working_saturday_rule IN ('ALL', 'NONE', 'SECOND_AND_FOURTH')),
  target_finish_date TEXT NOT NULL, -- YYYY-MM-DD (Target syllabus completion date before exams)
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY,
  semester_id TEXT NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
  campus_id TEXT NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  event_date TEXT NOT NULL, -- YYYY-MM-DD
  event_type TEXT NOT NULL CHECK(event_type IN ('HOLIDAY', 'ACADEMIC_EVENT', 'EXAM_DAY')),
  title TEXT NOT NULL,
  description TEXT,
  affects_schedule INTEGER NOT NULL DEFAULT 1, -- 1 = shifts topic dates, 0 = regular day
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(campus_id, semester_id, event_date, title)
);

CREATE TABLE IF NOT EXISTS exam_windows (
  id TEXT PRIMARY KEY,
  semester_id TEXT NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
  exam_type TEXT NOT NULL CHECK(exam_type IN ('SESSIONAL', 'MID_TERM', 'PUT', 'END_TERM')),
  name TEXT NOT NULL,
  start_date TEXT NOT NULL, -- YYYY-MM-DD
  end_date TEXT NOT NULL,   -- YYYY-MM-DD
  weightage REAL DEFAULT 25.0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS subjects (
  id TEXT PRIMARY KEY,
  semester_id TEXT NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
  campus_id TEXT NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  planned_total_hours REAL NOT NULL DEFAULT 0.0,
  faculty_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  color TEXT DEFAULT '#3b82f6',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(semester_id, code)
);

CREATE TABLE IF NOT EXISTS timetable_slots (
  id TEXT PRIMARY KEY,
  campus_id TEXT NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  semester_id TEXT NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
  batch_name TEXT NOT NULL,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  faculty_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK(weekday BETWEEN 1 AND 6), -- 1=Monday, 6=Saturday
  start_time TEXT NOT NULL, -- HH:MM (24-hour format)
  end_time TEXT NOT NULL,   -- HH:MM (24-hour format)
  duration_hours REAL NOT NULL, -- decimal hours, e.g. 50 mins = 0.8333
  room TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(campus_id, batch_name, weekday, start_time)
);

CREATE TABLE IF NOT EXISTS lesson_plans (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  unit_number INTEGER NOT NULL,
  unit_name TEXT NOT NULL,
  topic_number INTEGER NOT NULL,
  topic_title TEXT NOT NULL,
  description TEXT,
  planned_hours REAL NOT NULL CHECK(planned_hours > 0),
  sequence_order INTEGER NOT NULL,
  exam_scope TEXT NOT NULL DEFAULT 'END_TERM' CHECK(exam_scope IN ('SESSIONAL', 'MID_TERM', 'PUT', 'END_TERM', 'ALL')),
  status TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK(status IN ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED')),
  completion_percentage REAL NOT NULL DEFAULT 0.0 CHECK(completion_percentage >= 0 AND completion_percentage <= 100),
  planned_date TEXT, -- YYYY-MM-DD calculated by progression service
  actual_date TEXT,  -- YYYY-MM-DD when logged
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(subject_id, sequence_order)
);

CREATE TABLE IF NOT EXISTS teaching_sessions (
  id TEXT PRIMARY KEY,
  timetable_slot_id TEXT REFERENCES timetable_slots(id) ON DELETE SET NULL,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  faculty_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campus_id TEXT NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  batch_name TEXT NOT NULL,
  session_date TEXT NOT NULL, -- YYYY-MM-DD
  status TEXT NOT NULL CHECK(status IN ('COMPLETED', 'IN_PROGRESS', 'SKIPPED', 'MERGED', 'CANCELLED')),
  percentage_complete REAL NOT NULL DEFAULT 100.0,
  topics_covered TEXT,       -- comma-separated or JSON list of topic titles/IDs
  topics_leftover TEXT,
  carry_forward_topic TEXT,
  classwork_status TEXT,     -- e.g. 'Lab Exercises Completed', 'Problems Solved'
  homework_status TEXT,      -- e.g. 'Assignment #2 Assigned'
  notes TEXT,
  duration_hours REAL NOT NULL DEFAULT 0.0,
  logged_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  alert_type TEXT NOT NULL CHECK(alert_type IN ('MISSED_LOG_REMINDER', 'ESCALATED_UNLOGGED', 'DANGER_STATUS_WARNING')),
  recipient_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  recipient_role TEXT NOT NULL CHECK(recipient_role IN ('FACULTY', 'CAMPUS_MANAGER', 'ADMIN')),
  campus_id TEXT REFERENCES campuses(id) ON DELETE CASCADE,
  subject_id TEXT REFERENCES subjects(id) ON DELETE CASCADE,
  slot_id TEXT REFERENCES timetable_slots(id) ON DELETE CASCADE,
  session_date TEXT NOT NULL,
  message TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'WARNING' CHECK(severity IN ('INFO', 'WARNING', 'DANGER')),
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(slot_id, session_date, alert_type)
);

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT
);

-- Requirement 11: Real Attendance Management System
CREATE TABLE IF NOT EXISTS attendance_sessions (
  id TEXT PRIMARY KEY,
  timetable_slot_id TEXT REFERENCES timetable_slots(id) ON DELETE SET NULL,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  faculty_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campus_id TEXT NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  batch_name TEXT NOT NULL,
  session_date TEXT NOT NULL, -- YYYY-MM-DD
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  closed_at DATETIME
);

CREATE TABLE IF NOT EXISTS attendance_records (
  id TEXT PRIMARY KEY,
  attendance_session_id TEXT NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campus_id TEXT NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('PRESENT', 'ABSENT', 'EXCUSED')),
  marked_by TEXT NOT NULL CHECK(marked_by IN ('STUDENT', 'FACULTY', 'ADMIN')),
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(attendance_session_id, student_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_subjects_semester ON subjects(semester_id);
CREATE INDEX IF NOT EXISTS idx_subjects_campus ON subjects(campus_id);
CREATE INDEX IF NOT EXISTS idx_timetable_batch ON timetable_slots(campus_id, batch_name);
CREATE INDEX IF NOT EXISTS idx_timetable_faculty ON timetable_slots(faculty_id);
CREATE INDEX IF NOT EXISTS idx_lesson_subject ON lesson_plans(subject_id);
CREATE INDEX IF NOT EXISTS idx_sessions_subject ON teaching_sessions(subject_id);
CREATE INDEX IF NOT EXISTS idx_sessions_faculty ON teaching_sessions(faculty_id);
CREATE INDEX IF NOT EXISTS idx_sessions_date ON teaching_sessions(session_date);
CREATE INDEX IF NOT EXISTS idx_alerts_user ON alerts(recipient_user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_att_sess_campus_batch ON attendance_sessions(campus_id, batch_name, is_active);
CREATE INDEX IF NOT EXISTS idx_att_sess_faculty ON attendance_sessions(faculty_id, is_active);
CREATE INDEX IF NOT EXISTS idx_att_rec_session ON attendance_records(attendance_session_id);
CREATE INDEX IF NOT EXISTS idx_att_rec_student ON attendance_records(student_id);
