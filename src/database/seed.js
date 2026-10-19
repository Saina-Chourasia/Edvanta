// Comprehensive Realistic Seed Data for MSOT EDVANTA Platform
// Supports 4 campuses (including Jagannath, HI-Tech, Ratnam, RGIB),
// 7 core curriculum subjects (DSA, Web Development, Math, Physics, CAD, Soft Skills, IT),
// comprehensive lesson plans, timetables, and session records.

import bcrypt from 'bcryptjs';
import { db } from './db.js';
import CalendarService from '../services/calendar.service.js';
import ProgressionService from '../services/progression.service.js';
import AlertsService from '../services/alerts.service.js';

export async function seedDatabase() {
  console.log('🌱 Starting EDVANTA database seed...');

  const passwordHash = await bcrypt.hash('edvanta123', 10);

  db.transaction((tx) => {
    // 1. Campuses (Reconciled with HI-Tech, Rathinam, Jagannath, RGIB)
    const campuses = [
      { id: 'camp_hitech', name: 'HI-Tech Campus', code: 'HIT', timezone: 'Asia/Kolkata' },
      { id: 'camp_ratnam', name: 'Rathinam Campus', code: 'RAT', timezone: 'Asia/Kolkata' },
      { id: 'camp_juj', name: 'Jagannath Campus', code: 'JAG', timezone: 'Asia/Kolkata' },
      { id: 'camp_rgib', name: 'RGI Campus', code: 'RGI', timezone: 'Asia/Kolkata' }
    ];

    for (const c of campuses) {
      tx.run(`
        INSERT INTO campuses (id, name, code, timezone)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, code=excluded.code
      `, [c.id, c.name, c.code, c.timezone]);
    }

    // 2. Tracks
    const tracks = [
      { id: 'track_mirai', name: 'Mirai Track', code: 'MIRAI', description: 'Industry-integrated intensive curriculum' },
      { id: 'track_univ', name: 'University Track', code: 'UNIVERSITY', description: 'Core degree syllabus and theoretical foundation' }
    ];

    for (const t of tracks) {
      tx.run(`
        INSERT INTO tracks (id, name, code, description)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description
      `, [t.id, t.name, t.code, t.description]);
    }

    // 3. System Settings
    const settings = [
      { key: 'buffer_ratio_on_track', value: '1.15', description: 'Minimum buffer ratio for ON TRACK status' },
      { key: 'buffer_ratio_tight', value: '1.00', description: 'Minimum buffer ratio for TIGHT status' },
      { key: 'academic_year', value: '2026-2027', description: 'Current Academic Session' },
      { key: 'simulation_date', value: '2026-10-19', description: 'Default simulated current date' }
    ];

    for (const s of settings) {
      tx.run(`
        INSERT INTO system_settings (key, value, description)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value
      `, [s.key, s.value, s.description]);
    }

    // 4. Users (Admin, Campus Managers, Faculty, Students) with Phone & Email
    const users = [
      {
        id: 'usr_admin',
        email: 'admin@edvanta.msot.edu',
        phone: '9876543210',
        name: 'Prof. Rajesh Sharma (Dean & Program Director)',
        role: 'ADMIN',
        campus_id: null,
        batch_name: null
      },
      {
        id: 'usr_mgr_hitech',
        email: 'manager.hitech@edvanta.msot.edu',
        phone: '9876543211',
        name: 'Vikram Malhotra',
        role: 'CAMPUS_MANAGER',
        campus_id: 'camp_hitech',
        batch_name: null
      },
      {
        id: 'usr_mgr_ratnam',
        email: 'manager.ratnam@edvanta.msot.edu',
        phone: '9876543212',
        name: 'Sunita Rao',
        role: 'CAMPUS_MANAGER',
        campus_id: 'camp_ratnam',
        batch_name: null
      },
      {
        id: 'usr_mgr_juj',
        email: 'manager.jagannath@edvanta.msot.edu',
        phone: '9876543213',
        name: 'Pooja Verma',
        role: 'CAMPUS_MANAGER',
        campus_id: 'camp_juj',
        batch_name: null
      },
      {
        id: 'usr_mgr_rgib',
        email: 'manager.rgib@edvanta.msot.edu',
        phone: '9876543214',
        name: 'Anil Deshmukh',
        role: 'CAMPUS_MANAGER',
        campus_id: 'camp_rgib',
        batch_name: null
      },
      // Faculty for 7 subjects
      {
        id: 'usr_fac_thorne',
        email: 'faculty.cs@edvanta.msot.edu',
        phone: '9876543220',
        name: 'Dr. Aris Thorne',
        role: 'FACULTY',
        campus_id: 'camp_hitech',
        batch_name: null
      },
      {
        id: 'usr_fac_dsa',
        email: 'faculty.dsa@edvanta.msot.edu',
        phone: '9876543227',
        name: 'Prof. Arjun Nambiar',
        role: 'FACULTY',
        campus_id: 'camp_hitech',
        batch_name: null
      },
      {
        id: 'usr_fac_web',
        email: 'faculty.web@edvanta.msot.edu',
        phone: '9876543221',
        name: 'Prof. Meera Sen',
        role: 'FACULTY',
        campus_id: 'camp_hitech',
        batch_name: null
      },
      {
        id: 'usr_fac_math',
        email: 'faculty.math@edvanta.msot.edu',
        phone: '9876543222',
        name: 'Dr. K. Ramanujan',
        role: 'FACULTY',
        campus_id: 'camp_hitech',
        batch_name: null
      },
      {
        id: 'usr_fac_physics',
        email: 'faculty.physics@edvanta.msot.edu',
        phone: '9876543223',
        name: 'Dr. H. C. Verma',
        role: 'FACULTY',
        campus_id: 'camp_hitech',
        batch_name: null
      },
      {
        id: 'usr_fac_cad',
        email: 'faculty.cad@edvanta.msot.edu',
        phone: '9876543224',
        name: 'Prof. S. R. Pillai',
        role: 'FACULTY',
        campus_id: 'camp_hitech',
        batch_name: null
      },
      {
        id: 'usr_fac_softskills',
        email: 'faculty.softskills@edvanta.msot.edu',
        phone: '9876543225',
        name: 'Dr. Ananya Roy',
        role: 'FACULTY',
        campus_id: 'camp_hitech',
        batch_name: null
      },
      {
        id: 'usr_fac_it',
        email: 'faculty.it@edvanta.msot.edu',
        phone: '9876543226',
        name: 'Prof. Neha Gupta',
        role: 'FACULTY',
        campus_id: 'camp_hitech',
        batch_name: null
      },
      // Students
      {
        id: 'usr_stu_aarav',
        email: 'student.aarav@edvanta.msot.edu',
        phone: '9876543230',
        name: 'Aarav Mehta',
        role: 'STUDENT',
        campus_id: 'camp_hitech',
        batch_name: 'Batch-2026-Mirai-A'
      },
      {
        id: 'usr_stu_ananya',
        email: 'student.ananya@edvanta.msot.edu',
        phone: '9876543231',
        name: 'Ananya Iyer',
        role: 'STUDENT',
        campus_id: 'camp_hitech',
        batch_name: 'Batch-2026-Univ-A'
      }
    ];

    for (const u of users) {
      tx.run(`
        INSERT INTO users (id, email, phone, password_hash, name, role, campus_id, batch_name)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET email=excluded.email, phone=excluded.phone, name=excluded.name, role=excluded.role,
                                      campus_id=excluded.campus_id, batch_name=excluded.batch_name
      `, [u.id, u.email, u.phone, passwordHash, u.name, u.role, u.campus_id, u.batch_name]);
    }

    // 5. Semesters
    const semesters = [
      {
        id: 'sem_hitech_mirai_a',
        name: 'Fall 2026 - Mirai Track (Sem 3)',
        campus_id: 'camp_hitech',
        track_id: 'track_mirai',
        batch_name: 'Batch-2026-Mirai-A',
        start_date: '2026-08-01',
        end_date: '2026-12-15',
        working_saturday_rule: 'SECOND_AND_FOURTH',
        target_finish_date: '2026-11-20',
        is_active: 1
      },
      {
        id: 'sem_hitech_univ_a',
        name: 'Fall 2026 - Univ Track (Sem 3)',
        campus_id: 'camp_hitech',
        track_id: 'track_univ',
        batch_name: 'Batch-2026-Univ-A',
        start_date: '2026-08-01',
        end_date: '2026-12-15',
        working_saturday_rule: 'SECOND_AND_FOURTH',
        target_finish_date: '2026-11-20',
        is_active: 1
      },
      {
        id: 'sem_ratnam_mirai',
        name: 'Fall 2026 - Rathinam Mirai (Sem 3)',
        campus_id: 'camp_ratnam',
        track_id: 'track_mirai',
        batch_name: 'Batch-2026-Ratnam-M',
        start_date: '2026-08-01',
        end_date: '2026-12-15',
        working_saturday_rule: 'ALL',
        target_finish_date: '2026-11-20',
        is_active: 1
      },
      {
        id: 'sem_juj_univ',
        name: 'Fall 2026 - Jagannath Univ (Sem 3)',
        campus_id: 'camp_juj',
        track_id: 'track_univ',
        batch_name: 'Batch-2026-JAG-U',
        start_date: '2026-08-01',
        end_date: '2026-12-15',
        working_saturday_rule: 'NONE',
        target_finish_date: '2026-11-20',
        is_active: 1
      }
    ];

    for (const sem of semesters) {
      tx.run(`
        INSERT INTO semesters (id, name, campus_id, track_id, batch_name, start_date, end_date, working_saturday_rule, target_finish_date, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, start_date=excluded.start_date, end_date=excluded.end_date,
                                      working_saturday_rule=excluded.working_saturday_rule, target_finish_date=excluded.target_finish_date
      `, [sem.id, sem.name, sem.campus_id, sem.track_id, sem.batch_name, sem.start_date, sem.end_date, sem.working_saturday_rule, sem.target_finish_date, sem.is_active]);
    }

    // 6. Calendar Events & Holidays
    const holidays = [
      { semester_id: 'sem_hitech_mirai_a', campus_id: 'camp_hitech', event_date: '2026-08-15', event_type: 'HOLIDAY', title: 'Independence Day', affects_schedule: 1 },
      { semester_id: 'sem_hitech_mirai_a', campus_id: 'camp_hitech', event_date: '2026-09-04', event_type: 'HOLIDAY', title: 'Janmashtami', affects_schedule: 1 },
      { semester_id: 'sem_hitech_mirai_a', campus_id: 'camp_hitech', event_date: '2026-10-02', event_type: 'HOLIDAY', title: 'Gandhi Jayanti', affects_schedule: 1 },
      { semester_id: 'sem_hitech_mirai_a', campus_id: 'camp_hitech', event_date: '2026-10-20', event_type: 'HOLIDAY', title: 'Dussehra', affects_schedule: 1 },
      { semester_id: 'sem_hitech_mirai_a', campus_id: 'camp_hitech', event_date: '2026-11-08', event_type: 'HOLIDAY', title: 'Diwali Eve', affects_schedule: 1 },
      { semester_id: 'sem_hitech_mirai_a', campus_id: 'camp_hitech', event_date: '2026-11-09', event_type: 'HOLIDAY', title: 'Diwali Day', affects_schedule: 1 },
      { semester_id: 'sem_hitech_mirai_a', campus_id: 'camp_hitech', event_date: '2026-11-10', event_type: 'HOLIDAY', title: 'Govardhan Puja', affects_schedule: 1 }
    ];

    for (const h of holidays) {
      const hId = `ev_${h.campus_id}_${h.event_date}`;
      tx.run(`
        INSERT INTO calendar_events (id, semester_id, campus_id, event_date, event_type, title, description, affects_schedule)
        VALUES (?, ?, ?, ?, ?, ?, 'Official Gazetted Holiday', ?)
        ON CONFLICT(campus_id, semester_id, event_date, title) DO NOTHING
      `, [hId, h.semester_id, h.campus_id, h.event_date, h.event_type, h.title, h.affects_schedule]);
    }

    // 7. Exam Windows
    const exams = [
      { id: 'exam_sess1', semester_id: 'sem_hitech_mirai_a', exam_type: 'SESSIONAL', name: 'Sessional Assessment 1', start_date: '2026-09-14', end_date: '2026-09-18', weightage: 15.0 },
      { id: 'exam_midterm', semester_id: 'sem_hitech_mirai_a', exam_type: 'MID_TERM', name: 'Mid-Term Examinations', start_date: '2026-10-12', end_date: '2026-10-17', weightage: 25.0 },
      { id: 'exam_put', semester_id: 'sem_hitech_mirai_a', exam_type: 'PUT', name: 'Pre-University Test (PUT)', start_date: '2026-11-23', end_date: '2026-11-28', weightage: 20.0 },
      { id: 'exam_endterm', semester_id: 'sem_hitech_mirai_a', exam_type: 'END_TERM', name: 'Final End-Term Examination', start_date: '2026-12-07', end_date: '2026-12-14', weightage: 40.0 }
    ];

    for (const e of exams) {
      tx.run(`
        INSERT INTO exam_windows (id, semester_id, exam_type, name, start_date, end_date, weightage)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, start_date=excluded.start_date, end_date=excluded.end_date, weightage=excluded.weightage
      `, [e.id, e.semester_id, e.exam_type, e.name, e.start_date, e.end_date, e.weightage]);
    }

    // 8. The 7 Requested Curriculum Subjects (+ CS301 compatibility)
    const subjects = [
      {
        id: 'subj_dsa',
        semester_id: 'sem_hitech_mirai_a',
        campus_id: 'camp_hitech',
        track_id: 'track_mirai',
        code: 'DSA101',
        name: 'DSA',
        faculty_id: 'usr_fac_dsa',
        planned_total_hours: 40.0,
        color: '#10b981' // Emerald
      },
      {
        id: 'subj_web',
        semester_id: 'sem_hitech_mirai_a',
        campus_id: 'camp_hitech',
        track_id: 'track_mirai',
        code: 'WEB102',
        name: 'Web Development',
        faculty_id: 'usr_fac_web',
        planned_total_hours: 40.0,
        color: '#06b6d4' // Cyan
      },
      {
        id: 'subj_math',
        semester_id: 'sem_hitech_mirai_a',
        campus_id: 'camp_hitech',
        track_id: 'track_mirai',
        code: 'MTH103',
        name: 'Math',
        faculty_id: 'usr_fac_math',
        planned_total_hours: 36.0,
        color: '#8b5cf6' // Purple
      },
      {
        id: 'subj_physics',
        semester_id: 'sem_hitech_mirai_a',
        campus_id: 'camp_hitech',
        track_id: 'track_mirai',
        code: 'PHY104',
        name: 'Physics',
        faculty_id: 'usr_fac_physics',
        planned_total_hours: 36.0,
        color: '#f59e0b' // Amber
      },
      {
        id: 'subj_cad',
        semester_id: 'sem_hitech_mirai_a',
        campus_id: 'camp_hitech',
        track_id: 'track_mirai',
        code: 'CAD105',
        name: 'CAD',
        faculty_id: 'usr_fac_cad',
        planned_total_hours: 32.0,
        color: '#ec4899' // Pink
      },
      {
        id: 'subj_softskills',
        semester_id: 'sem_hitech_mirai_a',
        campus_id: 'camp_hitech',
        track_id: 'track_mirai',
        code: 'SS106',
        name: 'Soft Skills',
        faculty_id: 'usr_fac_softskills',
        planned_total_hours: 28.0,
        color: '#14b8a6' // Teal
      },
      {
        id: 'subj_it',
        semester_id: 'sem_hitech_mirai_a',
        campus_id: 'camp_hitech',
        track_id: 'track_mirai',
        code: 'IT107',
        name: 'IT',
        faculty_id: 'usr_fac_it',
        planned_total_hours: 36.0,
        color: '#6366f1' // Indigo
      },
      // Backward compatibility subject for existing test suite
      {
        id: 'subj_cs301',
        semester_id: 'sem_hitech_mirai_a',
        campus_id: 'camp_hitech',
        track_id: 'track_mirai',
        code: 'CS301',
        name: 'Distributed Cloud Systems',
        faculty_id: 'usr_fac_thorne',
        planned_total_hours: 42.5,
        color: '#3b82f6'
      }
    ];

    for (const s of subjects) {
      tx.run(`
        INSERT INTO subjects (id, semester_id, campus_id, track_id, code, name, planned_total_hours, faculty_id, color)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, code=excluded.code, faculty_id=excluded.faculty_id,
                                      planned_total_hours=excluded.planned_total_hours, color=excluded.color
      `, [s.id, s.semester_id, s.campus_id, s.track_id, s.code, s.name, s.planned_total_hours, s.faculty_id, s.color]);
    }

    // 9. Timetable Slots across the week
    const slots = [
      // DSA (Mon 09:00-09:50, Wed 10:00-11:40, Fri 09:00-09:50)
      { id: 'slot_dsa_mon', campus_id: 'camp_hitech', track_id: 'track_mirai', semester_id: 'sem_hitech_mirai_a', batch_name: 'Batch-2026-Mirai-A', subject_id: 'subj_dsa', faculty_id: 'usr_fac_dsa', weekday: 1, start_time: '09:00', end_time: '09:50', room: 'Lab-A1' },
      { id: 'slot_dsa_wed', campus_id: 'camp_hitech', track_id: 'track_mirai', semester_id: 'sem_hitech_mirai_a', batch_name: 'Batch-2026-Mirai-A', subject_id: 'subj_dsa', faculty_id: 'usr_fac_dsa', weekday: 3, start_time: '10:00', end_time: '11:40', room: 'Lab-A1' },
      { id: 'slot_dsa_fri', campus_id: 'camp_hitech', track_id: 'track_mirai', semester_id: 'sem_hitech_mirai_a', batch_name: 'Batch-2026-Mirai-A', subject_id: 'subj_dsa', faculty_id: 'usr_fac_dsa', weekday: 5, start_time: '09:00', end_time: '09:50', room: 'Lab-A1' },

      // Web Development (Tue 09:00-10:40, Thu 09:00-09:50, Sat 10:00-11:40)
      { id: 'slot_web_tue', campus_id: 'camp_hitech', track_id: 'track_mirai', semester_id: 'sem_hitech_mirai_a', batch_name: 'Batch-2026-Mirai-A', subject_id: 'subj_web', faculty_id: 'usr_fac_web', weekday: 2, start_time: '09:00', end_time: '10:40', room: 'Lab-W1' },
      { id: 'slot_web_thu', campus_id: 'camp_hitech', track_id: 'track_mirai', semester_id: 'sem_hitech_mirai_a', batch_name: 'Batch-2026-Mirai-A', subject_id: 'subj_web', faculty_id: 'usr_fac_web', weekday: 4, start_time: '09:00', end_time: '09:50', room: 'Lab-W1' },
      { id: 'slot_web_sat', campus_id: 'camp_hitech', track_id: 'track_mirai', semester_id: 'sem_hitech_mirai_a', batch_name: 'Batch-2026-Mirai-A', subject_id: 'subj_web', faculty_id: 'usr_fac_web', weekday: 6, start_time: '10:00', end_time: '11:40', room: 'Lab-W1' },

      // Math (Mon 14:00-14:50, Wed 14:00-14:50, Fri 14:00-14:50)
      { id: 'slot_math_mon', campus_id: 'camp_hitech', track_id: 'track_mirai', semester_id: 'sem_hitech_mirai_a', batch_name: 'Batch-2026-Mirai-A', subject_id: 'subj_math', faculty_id: 'usr_fac_math', weekday: 1, start_time: '14:00', end_time: '14:50', room: 'Hall-M1' },
      { id: 'slot_math_wed', campus_id: 'camp_hitech', track_id: 'track_mirai', semester_id: 'sem_hitech_mirai_a', batch_name: 'Batch-2026-Mirai-A', subject_id: 'subj_math', faculty_id: 'usr_fac_math', weekday: 3, start_time: '14:00', end_time: '14:50', room: 'Hall-M1' },
      { id: 'slot_math_fri', campus_id: 'camp_hitech', track_id: 'track_mirai', semester_id: 'sem_hitech_mirai_a', batch_name: 'Batch-2026-Mirai-A', subject_id: 'subj_math', faculty_id: 'usr_fac_math', weekday: 5, start_time: '14:00', end_time: '14:50', room: 'Hall-M1' },

      // Physics (Tue 14:00-14:50, Thu 14:00-15:40)
      { id: 'slot_phy_tue', campus_id: 'camp_hitech', track_id: 'track_mirai', semester_id: 'sem_hitech_mirai_a', batch_name: 'Batch-2026-Mirai-A', subject_id: 'subj_physics', faculty_id: 'usr_fac_physics', weekday: 2, start_time: '14:00', end_time: '14:50', room: 'Physics-Lab' },
      { id: 'slot_phy_thu', campus_id: 'camp_hitech', track_id: 'track_mirai', semester_id: 'sem_hitech_mirai_a', batch_name: 'Batch-2026-Mirai-A', subject_id: 'subj_physics', faculty_id: 'usr_fac_physics', weekday: 4, start_time: '14:00', end_time: '15:40', room: 'Physics-Lab' },

      // CAD (Mon 15:00-16:40, Thu 11:00-11:50)
      { id: 'slot_cad_mon', campus_id: 'camp_hitech', track_id: 'track_mirai', semester_id: 'sem_hitech_mirai_a', batch_name: 'Batch-2026-Mirai-A', subject_id: 'subj_cad', faculty_id: 'usr_fac_cad', weekday: 1, start_time: '15:00', end_time: '16:40', room: 'CAD-Studio' },
      { id: 'slot_cad_thu', campus_id: 'camp_hitech', track_id: 'track_mirai', semester_id: 'sem_hitech_mirai_a', batch_name: 'Batch-2026-Mirai-A', subject_id: 'subj_cad', faculty_id: 'usr_fac_cad', weekday: 4, start_time: '11:00', end_time: '11:50', room: 'CAD-Studio' },

      // Soft Skills (Wed 15:00-16:40)
      { id: 'slot_ss_wed', campus_id: 'camp_hitech', track_id: 'track_mirai', semester_id: 'sem_hitech_mirai_a', batch_name: 'Batch-2026-Mirai-A', subject_id: 'subj_softskills', faculty_id: 'usr_fac_softskills', weekday: 3, start_time: '15:00', end_time: '16:40', room: 'Auditorium' },

      // IT (Tue 11:00-11:50, Fri 10:00-11:40)
      { id: 'slot_it_tue', campus_id: 'camp_hitech', track_id: 'track_mirai', semester_id: 'sem_hitech_mirai_a', batch_name: 'Batch-2026-Mirai-A', subject_id: 'subj_it', faculty_id: 'usr_fac_it', weekday: 2, start_time: '11:00', end_time: '11:50', room: 'IT-Lab-3' },
      { id: 'slot_it_fri', campus_id: 'camp_hitech', track_id: 'track_mirai', semester_id: 'sem_hitech_mirai_a', batch_name: 'Batch-2026-Mirai-A', subject_id: 'subj_it', faculty_id: 'usr_fac_it', weekday: 5, start_time: '10:00', end_time: '11:40', room: 'IT-Lab-3' },

      // Backward compatible slots for Dr. Thorne (CS301)
      { id: 'slot_cs301_mon', campus_id: 'camp_hitech', track_id: 'track_mirai', semester_id: 'sem_hitech_mirai_a', batch_name: 'Batch-2026-Mirai-A', subject_id: 'subj_cs301', faculty_id: 'usr_fac_thorne', weekday: 1, start_time: '11:00', end_time: '11:50', room: 'Cloud-Lab' }
    ];

    tx.run("DELETE FROM timetable_slots WHERE semester_id = 'sem_hitech_mirai_a'");
    for (const slot of slots) {
      const dur = CalendarService.calculateDurationHours(slot.start_time, slot.end_time);
      tx.run(`
        INSERT INTO timetable_slots (id, campus_id, track_id, semester_id, batch_name, subject_id, faculty_id, weekday, start_time, end_time, duration_hours, room)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [slot.id, slot.campus_id, slot.track_id, slot.semester_id, slot.batch_name, slot.subject_id, slot.faculty_id, slot.weekday, slot.start_time, slot.end_time, dur, slot.room]);
    }

    // 10. Lesson Plans (Curriculum Topics) for All 7 Subjects
    const lessonPlansData = [
      // DSA
      {
        subject_id: 'subj_dsa',
        topics: [
          { unit: 1, unitName: 'Arrays & Two Pointers', seq: 1, title: 'Array Representations, Dynamic Sizing & Prefix Sums', hours: 2.0, scope: 'SESSIONAL', status: 'COMPLETED', pct: 100 },
          { unit: 1, unitName: 'Arrays & Two Pointers', seq: 2, title: 'Two Pointers & Sliding Window Algorithms', hours: 2.5, scope: 'SESSIONAL', status: 'COMPLETED', pct: 100 },
          { unit: 1, unitName: 'Arrays & Two Pointers', seq: 3, title: 'Binary Search on Value Spaces', hours: 2.5, scope: 'SESSIONAL', status: 'COMPLETED', pct: 100 },
          { unit: 2, unitName: 'Linked Lists & Stacks', seq: 4, title: 'Singly, Doubly & Circular Linked Lists Manipulation', hours: 3.0, scope: 'MID_TERM', status: 'COMPLETED', pct: 100 },
          { unit: 2, unitName: 'Linked Lists & Stacks', seq: 5, title: 'Monotonic Stacks, Queues & Deque Applications', hours: 3.0, scope: 'MID_TERM', status: 'COMPLETED', pct: 100 },
          { unit: 2, unitName: 'Linked Lists & Stacks', seq: 6, title: 'Recursion Trees & Backtracking Frameworks', hours: 3.5, scope: 'MID_TERM', status: 'IN_PROGRESS', pct: 60 },
          { unit: 3, unitName: 'Trees & Heaps', seq: 7, title: 'Binary Tree Traversals (Iterative & Recursive)', hours: 3.0, scope: 'PUT', status: 'NOT_STARTED', pct: 0 },
          { unit: 3, unitName: 'Trees & Heaps', seq: 8, title: 'Binary Search Trees: Balancing & Rotations', hours: 3.5, scope: 'PUT', status: 'NOT_STARTED', pct: 0 },
          { unit: 3, unitName: 'Trees & Heaps', seq: 9, title: 'Binary Heaps, Priority Queues & Top-K Problems', hours: 3.0, scope: 'PUT', status: 'NOT_STARTED', pct: 0 },
          { unit: 4, unitName: 'Graphs & Dynamic Programming', seq: 10, title: 'Graph Representations, BFS & DFS Pathfinding', hours: 4.0, scope: 'END_TERM', status: 'NOT_STARTED', pct: 0 },
          { unit: 4, unitName: 'Graphs & Dynamic Programming', seq: 11, title: 'Dijkstra, Bellman-Ford & Minimum Spanning Trees', hours: 4.0, scope: 'END_TERM', status: 'NOT_STARTED', pct: 0 },
          { unit: 4, unitName: 'Graphs & Dynamic Programming', seq: 12, title: '1D & 2D Dynamic Programming Patterns', hours: 5.5, scope: 'END_TERM', status: 'NOT_STARTED', pct: 0 }
        ]
      },
      // Web Development
      {
        subject_id: 'subj_web',
        topics: [
          { unit: 1, unitName: 'HTML5 & Modern Layouts', seq: 1, title: 'Semantic HTML5, Accessibility & SEO Fundamentals', hours: 2.0, scope: 'SESSIONAL', status: 'COMPLETED', pct: 100 },
          { unit: 1, unitName: 'HTML5 & Modern Layouts', seq: 2, title: 'CSS Grid, Flexbox & Responsive Breakpoints', hours: 2.5, scope: 'SESSIONAL', status: 'COMPLETED', pct: 100 },
          { unit: 1, unitName: 'HTML5 & Modern Layouts', seq: 3, title: 'CSS Custom Properties & Design Token Systems', hours: 2.0, scope: 'SESSIONAL', status: 'COMPLETED', pct: 100 },
          { unit: 2, unitName: 'JavaScript Deep Dive', seq: 4, title: 'Closures, Prototypes & Event Loop Mechanics', hours: 3.0, scope: 'MID_TERM', status: 'COMPLETED', pct: 100 },
          { unit: 2, unitName: 'JavaScript Deep Dive', seq: 5, title: 'Asynchronous JS: Promises, Async/Await & Fetch', hours: 3.0, scope: 'MID_TERM', status: 'COMPLETED', pct: 100 },
          { unit: 2, unitName: 'JavaScript Deep Dive', seq: 6, title: 'DOM Virtualization & Client-Side State Architectures', hours: 3.5, scope: 'MID_TERM', status: 'IN_PROGRESS', pct: 75 },
          { unit: 3, unitName: 'Backend & APIs', seq: 7, title: 'Node.js Core Modules & Express Router Pipelines', hours: 3.0, scope: 'PUT', status: 'NOT_STARTED', pct: 0 },
          { unit: 3, unitName: 'Backend & APIs', seq: 8, title: 'RESTful API Standards, JWT Authentication & CORS', hours: 3.5, scope: 'PUT', status: 'NOT_STARTED', pct: 0 },
          { unit: 3, unitName: 'Backend & APIs', seq: 9, title: 'Relational Database Schema & SQLite WAL Mode', hours: 3.5, scope: 'PUT', status: 'NOT_STARTED', pct: 0 },
          { unit: 4, unitName: 'Production & Full-Stack', seq: 10, title: 'Real-Time WebSockets & Server-Sent Events', hours: 4.0, scope: 'END_TERM', status: 'NOT_STARTED', pct: 0 },
          { unit: 4, unitName: 'Production & Full-Stack', seq: 11, title: 'Security Best Practices: XSS, CSRF & SQL Injection', hours: 4.0, scope: 'END_TERM', status: 'NOT_STARTED', pct: 0 },
          { unit: 4, unitName: 'Production & Full-Stack', seq: 12, title: 'Docker Containerization & Production CI/CD', hours: 6.0, scope: 'END_TERM', status: 'NOT_STARTED', pct: 0 }
        ]
      },
      // Math
      {
        subject_id: 'subj_math',
        topics: [
          { unit: 1, unitName: 'Linear Algebra', seq: 1, title: 'Matrix Algebra, Determinants & Rank of Matrices', hours: 2.5, scope: 'SESSIONAL', status: 'COMPLETED', pct: 100 },
          { unit: 1, unitName: 'Linear Algebra', seq: 2, title: 'Eigenvalues, Eigenvectors & Diagonalization', hours: 3.0, scope: 'SESSIONAL', status: 'COMPLETED', pct: 100 },
          { unit: 2, unitName: 'Calculus & Optimization', seq: 3, title: 'Partial Derivatives & Gradient Vectors', hours: 3.0, scope: 'MID_TERM', status: 'COMPLETED', pct: 100 },
          { unit: 2, unitName: 'Calculus & Optimization', seq: 4, title: 'Lagrange Multipliers & Constrained Optimization', hours: 3.0, scope: 'MID_TERM', status: 'COMPLETED', pct: 100 },
          { unit: 3, unitName: 'Probability & Statistics', seq: 5, title: 'Conditional Probability & Bayes Theorem', hours: 3.0, scope: 'PUT', status: 'NOT_STARTED', pct: 0 },
          { unit: 3, unitName: 'Probability & Statistics', seq: 6, title: 'Random Variables & Probability Density Functions', hours: 3.5, scope: 'PUT', status: 'NOT_STARTED', pct: 0 },
          { unit: 4, unitName: 'Discrete Mathematics', seq: 7, title: 'Mathematical Induction & Recurrence Relations', hours: 4.0, scope: 'END_TERM', status: 'NOT_STARTED', pct: 0 },
          { unit: 4, unitName: 'Discrete Mathematics', seq: 8, title: 'Graph Theory: Isomorphisms, Euler & Hamilton Paths', hours: 5.0, scope: 'END_TERM', status: 'NOT_STARTED', pct: 0 }
        ]
      },
      // Physics
      {
        subject_id: 'subj_physics',
        topics: [
          { unit: 1, unitName: 'Mechanics & Oscillations', seq: 1, title: 'Newtonian Dynamics, Friction & Conservation Laws', hours: 2.5, scope: 'SESSIONAL', status: 'COMPLETED', pct: 100 },
          { unit: 1, unitName: 'Mechanics & Oscillations', seq: 2, title: 'Simple Harmonic Motion & Damped Oscillations', hours: 3.0, scope: 'SESSIONAL', status: 'COMPLETED', pct: 100 },
          { unit: 2, unitName: 'Electromagnetism', seq: 3, title: 'Coulomb Law, Gauss Law & Electric Potential', hours: 3.5, scope: 'MID_TERM', status: 'COMPLETED', pct: 100 },
          { unit: 2, unitName: 'Electromagnetism', seq: 4, title: 'Magnetic Fields, Ampere Law & Electromagnetic Induction', hours: 3.5, scope: 'MID_TERM', status: 'IN_PROGRESS', pct: 50 },
          { unit: 3, unitName: 'Wave Optics', seq: 5, title: 'Interference, Young Double Slit & Diffraction Grating', hours: 3.5, scope: 'PUT', status: 'NOT_STARTED', pct: 0 },
          { unit: 3, unitName: 'Wave Optics', seq: 6, title: 'Polarization, Lasers & Optical Fibers', hours: 4.0, scope: 'PUT', status: 'NOT_STARTED', pct: 0 },
          { unit: 4, unitName: 'Modern Physics', seq: 7, title: 'Photoelectric Effect & Wave-Particle Duality', hours: 4.0, scope: 'END_TERM', status: 'NOT_STARTED', pct: 0 },
          { unit: 4, unitName: 'Modern Physics', seq: 8, title: 'Schrodinger Equation & Semiconductor Fundamentals', hours: 5.0, scope: 'END_TERM', status: 'NOT_STARTED', pct: 0 }
        ]
      },
      // CAD
      {
        subject_id: 'subj_cad',
        topics: [
          { unit: 1, unitName: 'Drafting Fundamentals', seq: 1, title: 'Orthographic Projections & Standard Engineering Views', hours: 2.5, scope: 'SESSIONAL', status: 'COMPLETED', pct: 100 },
          { unit: 1, unitName: 'Drafting Fundamentals', seq: 2, title: 'Geometric Dimensioning & Tolerancing (GD&T)', hours: 2.5, scope: 'SESSIONAL', status: 'COMPLETED', pct: 100 },
          { unit: 2, unitName: '2D Parametric Modeling', seq: 3, title: 'Parametric Constraints, Tangency & Curvature Controls', hours: 3.0, scope: 'MID_TERM', status: 'COMPLETED', pct: 100 },
          { unit: 2, unitName: '2D Parametric Modeling', seq: 4, title: 'Revolve, Sweep & Loft Sketching Primitives', hours: 3.0, scope: 'MID_TERM', status: 'COMPLETED', pct: 100 },
          { unit: 3, unitName: '3D Solid Modeling', seq: 5, title: 'Feature Trees, Filleting, Chamfering & Rib Features', hours: 3.5, scope: 'PUT', status: 'NOT_STARTED', pct: 0 },
          { unit: 3, unitName: '3D Solid Modeling', seq: 6, title: 'Multi-Component Assembly & Interference Analysis', hours: 3.5, scope: 'PUT', status: 'NOT_STARTED', pct: 0 },
          { unit: 4, unitName: 'Simulation & Export', seq: 7, title: 'Finite Element Analysis (FEA) Stress Simulation', hours: 4.0, scope: 'END_TERM', status: 'NOT_STARTED', pct: 0 },
          { unit: 4, unitName: 'Simulation & Export', seq: 8, title: 'BOM Generation, Sheet Metal & 3D Print File Preparation', hours: 4.0, scope: 'END_TERM', status: 'NOT_STARTED', pct: 0 }
        ]
      },
      // Soft Skills
      {
        subject_id: 'subj_softskills',
        topics: [
          { unit: 1, unitName: 'Business Communication', seq: 1, title: 'Corporate Email Etiquette & Technical Documentation', hours: 2.0, scope: 'SESSIONAL', status: 'COMPLETED', pct: 100 },
          { unit: 1, unitName: 'Business Communication', seq: 2, title: 'Active Listening & Cross-Functional Articulation', hours: 2.0, scope: 'SESSIONAL', status: 'COMPLETED', pct: 100 },
          { unit: 2, unitName: 'Presentation & Pitching', seq: 3, title: 'Slide Architecture & Data Storytelling', hours: 2.5, scope: 'MID_TERM', status: 'COMPLETED', pct: 100 },
          { unit: 2, unitName: 'Presentation & Pitching', seq: 4, title: 'Technical Demos & Executive Pitch Delivery', hours: 2.5, scope: 'MID_TERM', status: 'IN_PROGRESS', pct: 80 },
          { unit: 3, unitName: 'Teamwork & Conflict', seq: 5, title: 'Constructive Code Reviews & Feedback Loops', hours: 3.0, scope: 'PUT', status: 'NOT_STARTED', pct: 0 },
          { unit: 3, unitName: 'Teamwork & Conflict', seq: 6, title: 'Negotiation Strategies & Stakeholder Management', hours: 3.0, scope: 'PUT', status: 'NOT_STARTED', pct: 0 },
          { unit: 4, unitName: 'Career & Interviews', seq: 7, title: 'ATS-Optimized Engineering Resume Architecture', hours: 3.0, scope: 'END_TERM', status: 'NOT_STARTED', pct: 0 },
          { unit: 4, unitName: 'Career & Interviews', seq: 8, title: 'Behavioral STAR Method & Live Mock Interviews', hours: 4.0, scope: 'END_TERM', status: 'NOT_STARTED', pct: 0 }
        ]
      },
      // IT
      {
        subject_id: 'subj_it',
        topics: [
          { unit: 1, unitName: 'OS & CLI Mastery', seq: 1, title: 'Linux File Hierarchy, Permissions & Bash Tooling', hours: 2.5, scope: 'SESSIONAL', status: 'COMPLETED', pct: 100 },
          { unit: 1, unitName: 'OS & CLI Mastery', seq: 2, title: 'Process Management, Systemd & Cron Automation', hours: 2.5, scope: 'SESSIONAL', status: 'COMPLETED', pct: 100 },
          { unit: 2, unitName: 'Networking Protocols', seq: 3, title: 'TCP/IP, Subnetting, DNS, DHCP & NAT Configurations', hours: 3.0, scope: 'MID_TERM', status: 'COMPLETED', pct: 100 },
          { unit: 2, unitName: 'Networking Protocols', seq: 4, title: 'HTTP/HTTPS, TLS Handshakes & Network Firewalls', hours: 3.0, scope: 'MID_TERM', status: 'COMPLETED', pct: 100 },
          { unit: 3, unitName: 'Information Security', seq: 5, title: 'IAM, Principle of Least Privilege & SSH Keys', hours: 3.5, scope: 'PUT', status: 'NOT_STARTED', pct: 0 },
          { unit: 3, unitName: 'Information Security', seq: 6, title: 'Data Encryption at Rest & in Transit', hours: 3.5, scope: 'PUT', status: 'NOT_STARTED', pct: 0 },
          { unit: 4, unitName: 'Cloud & Infrastructure', seq: 7, title: 'Cloud Computing Models (IaaS, PaaS, SaaS) & VPCs', hours: 4.0, scope: 'END_TERM', status: 'NOT_STARTED', pct: 0 },
          { unit: 4, unitName: 'Cloud & Infrastructure', seq: 8, title: 'Infrastructure as Code & Automated Server Provisioning', hours: 5.0, scope: 'END_TERM', status: 'NOT_STARTED', pct: 0 }
        ]
      },
      // Backward compatibility topics for CS301
      {
        subject_id: 'subj_cs301',
        topics: [
          { unit: 1, unitName: 'Cloud Fundamentals', seq: 1, title: 'Hypervisors, KVM & Containerization Primitives', hours: 3.0, scope: 'SESSIONAL', status: 'COMPLETED', pct: 100 },
          { unit: 1, unitName: 'Cloud Fundamentals', seq: 2, title: 'OCI Runtime Spec & Linux Cgroups / Namespaces', hours: 3.0, scope: 'SESSIONAL', status: 'COMPLETED', pct: 100 },
          { unit: 1, unitName: 'Cloud Fundamentals', seq: 3, title: 'Stateless vs Stateful Microservices Architecture', hours: 3.5, scope: 'SESSIONAL', status: 'COMPLETED', pct: 100 },
          { unit: 2, unitName: 'Distributed Systems', seq: 4, title: 'CAP Theorem, PACELC & Eventual Consistency Models', hours: 4.0, scope: 'MID_TERM', status: 'IN_PROGRESS', pct: 50 },
          { unit: 2, unitName: 'Distributed Systems', seq: 5, title: 'Raft Consensus Algorithm: Leader Election & Log Replication', hours: 4.5, scope: 'MID_TERM', status: 'NOT_STARTED', pct: 0 },
          { unit: 3, unitName: 'Orchestration', seq: 6, title: 'Kubernetes Pod Lifecycle & CNI Network Overlays', hours: 5.0, scope: 'PUT', status: 'NOT_STARTED', pct: 0 },
          { unit: 4, unitName: 'Storage & Reliability', seq: 7, title: 'Distributed Storage & High Availability Topologies', hours: 6.0, scope: 'END_TERM', status: 'NOT_STARTED', pct: 0 }
        ]
      }
    ];

    for (const group of lessonPlansData) {
      for (const t of group.topics) {
        const lpId = `lp_${group.subject_id.replace('subj_', '')}_${t.seq}`;
        tx.run(`
          INSERT INTO lesson_plans (id, subject_id, unit_number, unit_name, topic_number, topic_title, description, planned_hours, sequence_order, exam_scope, status, completion_percentage)
          VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?)
          ON CONFLICT(subject_id, sequence_order) DO UPDATE SET
            topic_title=excluded.topic_title, planned_hours=excluded.planned_hours, exam_scope=excluded.exam_scope,
            status=excluded.status, completion_percentage=excluded.completion_percentage
        `, [lpId, group.subject_id, t.unit, t.unitName, t.seq, t.title, t.hours, t.seq, t.scope, t.status, t.pct]);
      }
    }

    // 11. Historical Teaching Session Records for Realistic Dashboard Data
    const sessions = [
      // DSA completed sessions
      { id: 'sess_dsa_1', slot_id: 'slot_dsa_mon', subject_id: 'subj_dsa', faculty_id: 'usr_fac_dsa', date: '2026-08-03', status: 'COMPLETED', pct: 100, topic: 'Array Representations, Dynamic Sizing & Prefix Sums', dur: 0.8333 },
      { id: 'sess_dsa_2', slot_id: 'slot_dsa_wed', subject_id: 'subj_dsa', faculty_id: 'usr_fac_dsa', date: '2026-08-05', status: 'COMPLETED', pct: 100, topic: 'Two Pointers & Sliding Window Algorithms', dur: 1.6667 },
      { id: 'sess_dsa_3', slot_id: 'slot_dsa_fri', subject_id: 'subj_dsa', faculty_id: 'usr_fac_dsa', date: '2026-08-07', status: 'COMPLETED', pct: 100, topic: 'Binary Search on Value Spaces', dur: 0.8333 },
      { id: 'sess_dsa_4', slot_id: 'slot_dsa_mon', subject_id: 'subj_dsa', faculty_id: 'usr_fac_dsa', date: '2026-08-10', status: 'COMPLETED', pct: 100, topic: 'Singly, Doubly & Circular Linked Lists Manipulation', dur: 0.8333 },
      { id: 'sess_dsa_5', slot_id: 'slot_dsa_wed', subject_id: 'subj_dsa', faculty_id: 'usr_fac_dsa', date: '2026-08-12', status: 'COMPLETED', pct: 100, topic: 'Monotonic Stacks, Queues & Deque Applications', dur: 1.6667 },
      { id: 'sess_dsa_6', slot_id: 'slot_dsa_fri', subject_id: 'subj_dsa', faculty_id: 'usr_fac_dsa', date: '2026-08-14', status: 'IN_PROGRESS', pct: 60, topic: 'Recursion Trees & Backtracking Frameworks', dur: 0.8333 },

      // Web Dev completed sessions
      { id: 'sess_web_1', slot_id: 'slot_web_tue', subject_id: 'subj_web', faculty_id: 'usr_fac_web', date: '2026-08-04', status: 'COMPLETED', pct: 100, topic: 'Semantic HTML5, Accessibility & SEO Fundamentals', dur: 1.6667 },
      { id: 'sess_web_2', slot_id: 'slot_web_thu', subject_id: 'subj_web', faculty_id: 'usr_fac_web', date: '2026-08-06', status: 'COMPLETED', pct: 100, topic: 'CSS Grid, Flexbox & Responsive Breakpoints', dur: 0.8333 },
      { id: 'sess_web_3', slot_id: 'slot_web_sat', subject_id: 'subj_web', faculty_id: 'usr_fac_web', date: '2026-08-08', status: 'COMPLETED', pct: 100, topic: 'CSS Custom Properties & Design Token Systems', dur: 1.6667 },
      { id: 'sess_web_4', slot_id: 'slot_web_tue', subject_id: 'subj_web', faculty_id: 'usr_fac_web', date: '2026-08-11', status: 'COMPLETED', pct: 100, topic: 'Closures, Prototypes & Event Loop Mechanics', dur: 1.6667 },
      { id: 'sess_web_5', slot_id: 'slot_web_thu', subject_id: 'subj_web', faculty_id: 'usr_fac_web', date: '2026-08-13', status: 'COMPLETED', pct: 100, topic: 'Asynchronous JS: Promises, Async/Await & Fetch', dur: 0.8333 },

      // Math sessions
      { id: 'sess_math_1', slot_id: 'slot_math_mon', subject_id: 'subj_math', faculty_id: 'usr_fac_math', date: '2026-08-03', status: 'COMPLETED', pct: 100, topic: 'Matrix Algebra, Determinants & Rank of Matrices', dur: 0.8333 },
      { id: 'sess_math_2', slot_id: 'slot_math_wed', subject_id: 'subj_math', faculty_id: 'usr_fac_math', date: '2026-08-05', status: 'COMPLETED', pct: 100, topic: 'Eigenvalues, Eigenvectors & Diagonalization', dur: 0.8333 },
      { id: 'sess_math_3', slot_id: 'slot_math_fri', subject_id: 'subj_math', faculty_id: 'usr_fac_math', date: '2026-08-07', status: 'COMPLETED', pct: 100, topic: 'Partial Derivatives & Gradient Vectors', dur: 0.8333 },

      // Physics sessions
      { id: 'sess_phy_1', slot_id: 'slot_phy_tue', subject_id: 'subj_physics', faculty_id: 'usr_fac_physics', date: '2026-08-04', status: 'COMPLETED', pct: 100, topic: 'Newtonian Dynamics, Friction & Conservation Laws', dur: 0.8333 },
      { id: 'sess_phy_2', slot_id: 'slot_phy_thu', subject_id: 'subj_physics', faculty_id: 'usr_fac_physics', date: '2026-08-06', status: 'COMPLETED', pct: 100, topic: 'Simple Harmonic Motion & Damped Oscillations', dur: 1.6667 },
      { id: 'sess_phy_3', slot_id: 'slot_phy_tue', subject_id: 'subj_physics', faculty_id: 'usr_fac_physics', date: '2026-08-11', status: 'COMPLETED', pct: 100, topic: 'Coulomb Law, Gauss Law & Electric Potential', dur: 0.8333 },

      // CAD sessions
      { id: 'sess_cad_1', slot_id: 'slot_cad_mon', subject_id: 'subj_cad', faculty_id: 'usr_fac_cad', date: '2026-08-03', status: 'COMPLETED', pct: 100, topic: 'Orthographic Projections & Standard Engineering Views', dur: 1.6667 },
      { id: 'sess_cad_2', slot_id: 'slot_cad_thu', subject_id: 'subj_cad', faculty_id: 'usr_fac_cad', date: '2026-08-06', status: 'COMPLETED', pct: 100, topic: 'Geometric Dimensioning & Tolerancing (GD&T)', dur: 0.8333 },

      // Soft Skills session
      { id: 'sess_ss_1', slot_id: 'slot_ss_wed', subject_id: 'subj_softskills', faculty_id: 'usr_fac_softskills', date: '2026-08-05', status: 'COMPLETED', pct: 100, topic: 'Corporate Email Etiquette & Technical Documentation', dur: 1.6667 },

      // IT sessions
      { id: 'sess_it_1', slot_id: 'slot_it_tue', subject_id: 'subj_it', faculty_id: 'usr_fac_it', date: '2026-08-04', status: 'COMPLETED', pct: 100, topic: 'Linux File Hierarchy, Permissions & Bash Tooling', dur: 0.8333 },
      { id: 'sess_it_2', slot_id: 'slot_it_fri', subject_id: 'subj_it', faculty_id: 'usr_fac_it', date: '2026-08-07', status: 'COMPLETED', pct: 100, topic: 'Process Management, Systemd & Cron Automation', dur: 1.6667 },

      // CS301 session for test compatibility
      { id: 'sess_cs301_test', slot_id: 'slot_cs301_mon', subject_id: 'subj_cs301', faculty_id: 'usr_fac_thorne', date: '2026-08-03', status: 'COMPLETED', pct: 100, topic: 'Hypervisors, KVM & Containerization Primitives', dur: 0.8333 }
    ];

    for (const s of sessions) {
      tx.run(`
        INSERT INTO teaching_sessions (
          id, timetable_slot_id, subject_id, faculty_id, campus_id, batch_name,
          session_date, status, percentage_complete, topics_covered, duration_hours
        ) VALUES (?, ?, ?, ?, 'camp_hitech', 'Batch-2026-Mirai-A', ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING
      `, [s.id, s.slot_id, s.subject_id, s.faculty_id, s.date, s.status, s.pct, s.topic, s.dur]);
    }
  });

  // Calculate planned topic dates for all subjects
  console.log('📅 Calculating automatic planned topic dates...');
  const allSubjects = db.query('SELECT id FROM subjects');
  for (const s of allSubjects) {
    try {
      ProgressionService.generatePlannedTopicDates(s.id);
    } catch (e) {
      // Slot-less subjects handled gracefully
    }
  }

  // Scan missed logs
  console.log('🚨 Scanning missed log alerts...');
  AlertsService.checkMissedLogs('2026-10-19');

  console.log('✅ EDVANTA database seeded successfully with MSOT academic data!');
}

if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  seedDatabase();
}

export default seedDatabase;
