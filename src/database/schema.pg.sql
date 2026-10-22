-- ==============================================================================
-- EDVANTA Course Progression Tracker - PostgreSQL / Neon DDL Schema
-- Compatible with PostgreSQL 15+ and Neon Serverless Postgres
-- Translates SQLite types to robust PostgreSQL enterprise standards:
--   TEXT -> VARCHAR(n) / TEXT
--   DATETIME -> TIMESTAMPTZ (with timezone awareness)
--   DATE strings -> DATE
--   REAL -> DOUBLE PRECISION
--   INTEGER booleans -> SMALLINT CHECK(val IN (0, 1))
-- ==============================================================================

-- 1. Campuses
CREATE TABLE IF NOT EXISTS campuses (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  code VARCHAR(64) NOT NULL UNIQUE,
  timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 2. Curriculum Tracks
CREATE TABLE IF NOT EXISTS tracks (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  code VARCHAR(64) NOT NULL UNIQUE,
  description TEXT
);

-- 3. Users & Role-Based Access Control
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  phone VARCHAR(32) UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(32) NOT NULL CHECK(role IN ('ADMIN', 'CAMPUS_MANAGER', 'FACULTY', 'STUDENT')),
  campus_id VARCHAR(64) REFERENCES campuses(id) ON DELETE SET NULL,
  batch_name VARCHAR(128),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 4. Semesters & Academic Calendars
CREATE TABLE IF NOT EXISTS semesters (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  campus_id VARCHAR(64) NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  track_id VARCHAR(64) NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  batch_name VARCHAR(128) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  working_saturday_rule VARCHAR(32) NOT NULL DEFAULT 'SECOND_AND_FOURTH' CHECK(working_saturday_rule IN ('ALL', 'NONE', 'SECOND_AND_FOURTH')),
  target_finish_date DATE NOT NULL,
  is_active SMALLINT NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 5. Calendar Events (Holidays, Academic Events, Exam Days)
CREATE TABLE IF NOT EXISTS calendar_events (
  id VARCHAR(64) PRIMARY KEY,
  semester_id VARCHAR(64) NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
  campus_id VARCHAR(64) NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  event_date DATE NOT NULL,
  event_type VARCHAR(32) NOT NULL CHECK(event_type IN ('HOLIDAY', 'ACADEMIC_EVENT', 'EXAM_DAY')),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  affects_schedule SMALLINT NOT NULL DEFAULT 1 CHECK(affects_schedule IN (0, 1)),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_calendar_event UNIQUE (campus_id, semester_id, event_date, title)
);

-- 6. Exam Windows & Milestones
CREATE TABLE IF NOT EXISTS exam_windows (
  id VARCHAR(64) PRIMARY KEY,
  semester_id VARCHAR(64) NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
  exam_type VARCHAR(32) NOT NULL CHECK(exam_type IN ('SESSIONAL', 'MID_TERM', 'PUT', 'END_TERM')),
  name VARCHAR(255) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  weightage DOUBLE PRECISION DEFAULT 25.0,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 7. Subjects & Curriculum Scope
CREATE TABLE IF NOT EXISTS subjects (
  id VARCHAR(64) PRIMARY KEY,
  semester_id VARCHAR(64) NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
  campus_id VARCHAR(64) NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  track_id VARCHAR(64) NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  code VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  planned_total_hours DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  faculty_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
  color VARCHAR(32) DEFAULT '#3b82f6',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_subject_code UNIQUE (semester_id, code)
);

-- 8. Timetable Slots
CREATE TABLE IF NOT EXISTS timetable_slots (
  id VARCHAR(64) PRIMARY KEY,
  campus_id VARCHAR(64) NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  track_id VARCHAR(64) NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  semester_id VARCHAR(64) NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
  batch_name VARCHAR(128) NOT NULL,
  subject_id VARCHAR(64) NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  faculty_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK(weekday BETWEEN 1 AND 6),
  start_time VARCHAR(16) NOT NULL,
  end_time VARCHAR(16) NOT NULL,
  duration_hours DOUBLE PRECISION NOT NULL,
  room VARCHAR(128),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_timetable_slot UNIQUE (campus_id, batch_name, weekday, start_time)
);

-- 9. Lesson Plans & Syllabus Topics
CREATE TABLE IF NOT EXISTS lesson_plans (
  id VARCHAR(64) PRIMARY KEY,
  subject_id VARCHAR(64) NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  unit_number INTEGER NOT NULL,
  unit_name VARCHAR(255) NOT NULL,
  topic_number INTEGER NOT NULL,
  topic_title VARCHAR(255) NOT NULL,
  description TEXT,
  planned_hours DOUBLE PRECISION NOT NULL CHECK(planned_hours > 0),
  sequence_order INTEGER NOT NULL,
  exam_scope VARCHAR(32) NOT NULL DEFAULT 'END_TERM' CHECK(exam_scope IN ('SESSIONAL', 'MID_TERM', 'PUT', 'END_TERM', 'ALL')),
  status VARCHAR(32) NOT NULL DEFAULT 'NOT_STARTED' CHECK(status IN ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED')),
  completion_percentage DOUBLE PRECISION NOT NULL DEFAULT 0.0 CHECK(completion_percentage >= 0 AND completion_percentage <= 100),
  planned_date DATE,
  actual_date DATE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_lesson_plan_sequence UNIQUE (subject_id, sequence_order)
);

-- 10. Teaching Sessions (Logged Lectures & Labs)
CREATE TABLE IF NOT EXISTS teaching_sessions (
  id VARCHAR(64) PRIMARY KEY,
  timetable_slot_id VARCHAR(64) REFERENCES timetable_slots(id) ON DELETE SET NULL,
  subject_id VARCHAR(64) NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  faculty_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campus_id VARCHAR(64) NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  batch_name VARCHAR(128) NOT NULL,
  session_date DATE NOT NULL,
  status VARCHAR(32) NOT NULL CHECK(status IN ('COMPLETED', 'IN_PROGRESS', 'SKIPPED', 'MERGED', 'CANCELLED')),
  percentage_complete DOUBLE PRECISION NOT NULL DEFAULT 100.0,
  topics_covered TEXT,
  topics_leftover TEXT,
  carry_forward_topic TEXT,
  classwork_status TEXT,
  homework_status TEXT,
  notes TEXT,
  duration_hours DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  logged_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 11. Alerts & Escalations
CREATE TABLE IF NOT EXISTS alerts (
  id VARCHAR(64) PRIMARY KEY,
  alert_type VARCHAR(32) NOT NULL CHECK(alert_type IN ('MISSED_LOG_REMINDER', 'ESCALATED_UNLOGGED', 'DANGER_STATUS_WARNING')),
  recipient_user_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
  recipient_role VARCHAR(32) NOT NULL CHECK(recipient_role IN ('FACULTY', 'CAMPUS_MANAGER', 'ADMIN')),
  campus_id VARCHAR(64) REFERENCES campuses(id) ON DELETE CASCADE,
  subject_id VARCHAR(64) REFERENCES subjects(id) ON DELETE CASCADE,
  slot_id VARCHAR(64) REFERENCES timetable_slots(id) ON DELETE CASCADE,
  session_date DATE NOT NULL,
  message TEXT NOT NULL,
  severity VARCHAR(32) NOT NULL DEFAULT 'WARNING' CHECK(severity IN ('INFO', 'WARNING', 'DANGER')),
  is_read SMALLINT NOT NULL DEFAULT 0 CHECK(is_read IN (0, 1)),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_alert_slot_date_type UNIQUE (slot_id, session_date, alert_type)
);

-- 12. System Settings & Simulation Environment
CREATE TABLE IF NOT EXISTS system_settings (
  key VARCHAR(64) PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT
);

-- 13. Attendance Sessions
CREATE TABLE IF NOT EXISTS attendance_sessions (
  id VARCHAR(64) PRIMARY KEY,
  timetable_slot_id VARCHAR(64) REFERENCES timetable_slots(id) ON DELETE SET NULL,
  subject_id VARCHAR(64) NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  faculty_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campus_id VARCHAR(64) NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  batch_name VARCHAR(128) NOT NULL,
  session_date DATE NOT NULL,
  validity_minutes INTEGER NOT NULL DEFAULT 15,
  expires_at TIMESTAMPTZ,
  ble_service_uuid VARCHAR(128) DEFAULT '0000ed01-0000-1000-8000-00805f9b34fb',
  ble_beacon_code VARCHAR(128),
  is_active SMALLINT NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  closed_at TIMESTAMPTZ
);

-- 14. Attendance Records
CREATE TABLE IF NOT EXISTS attendance_records (
  id VARCHAR(64) PRIMARY KEY,
  attendance_session_id VARCHAR(64) NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
  student_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campus_id VARCHAR(64) NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  status VARCHAR(32) NOT NULL CHECK(status IN ('PRESENT', 'ABSENT', 'EXCUSED')),
  marked_by VARCHAR(32) NOT NULL CHECK(marked_by IN ('STUDENT', 'FACULTY', 'ADMIN')),
  marking_method VARCHAR(32) NOT NULL DEFAULT 'PORTAL' CHECK(marking_method IN ('PORTAL', 'BLUETOOTH', 'MANUAL', 'ADMIN')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_att_session_student UNIQUE (attendance_session_id, student_id)
);

-- 15. Telegram Bot Links
CREATE TABLE IF NOT EXISTS telegram_links (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  telegram_chat_id VARCHAR(64) NOT NULL UNIQUE,
  telegram_username VARCHAR(128),
  first_name VARCHAR(128),
  linked_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 16. Telegram One-Time Link Codes
CREATE TABLE IF NOT EXISTS telegram_link_codes (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash VARCHAR(128) NOT NULL UNIQUE,
  expires_at BIGINT NOT NULL,
  used SMALLINT NOT NULL DEFAULT 0 CHECK(used IN (0, 1)),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 17. WhatsApp Platform Links
CREATE TABLE IF NOT EXISTS whatsapp_links (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  phone_number VARCHAR(32) NOT NULL UNIQUE,
  verified_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  notifications_enabled SMALLINT NOT NULL DEFAULT 1 CHECK(notifications_enabled IN (0, 1)),
  notify_attendance SMALLINT NOT NULL DEFAULT 1 CHECK(notify_attendance IN (0, 1)),
  notify_schedule SMALLINT NOT NULL DEFAULT 1 CHECK(notify_schedule IN (0, 1)),
  notify_progress SMALLINT NOT NULL DEFAULT 1 CHECK(notify_progress IN (0, 1)),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 18. WhatsApp Verification Codes
CREATE TABLE IF NOT EXISTS whatsapp_link_codes (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone_number VARCHAR(32) NOT NULL,
  code_hash VARCHAR(128) NOT NULL UNIQUE,
  expires_at BIGINT NOT NULL,
  used SMALLINT NOT NULL DEFAULT 0 CHECK(used IN (0, 1)),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 19. WhatsApp Audit Logs
CREATE TABLE IF NOT EXISTS whatsapp_logs (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
  phone_number VARCHAR(32) NOT NULL,
  message_type VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  message_id VARCHAR(128),
  payload TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================================================
-- Indexes for Query Performance and Relational Lookups
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_users_campus ON users(campus_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_semesters_campus ON semesters(campus_id);
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
CREATE INDEX IF NOT EXISTS idx_tg_links_chat_id ON telegram_links(telegram_chat_id);
CREATE INDEX IF NOT EXISTS idx_tg_links_user ON telegram_links(user_id);
CREATE INDEX IF NOT EXISTS idx_tg_link_codes_user ON telegram_link_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_tg_link_codes_hash ON telegram_link_codes(code_hash);
CREATE INDEX IF NOT EXISTS idx_wa_links_user ON whatsapp_links(user_id);
CREATE INDEX IF NOT EXISTS idx_wa_links_phone ON whatsapp_links(phone_number);
CREATE INDEX IF NOT EXISTS idx_wa_link_codes_user ON whatsapp_link_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_wa_link_codes_hash ON whatsapp_link_codes(code_hash);
CREATE INDEX IF NOT EXISTS idx_wa_logs_user ON whatsapp_logs(user_id);
