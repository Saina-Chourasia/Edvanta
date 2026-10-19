// Realistic Seed Data for MSOT EDVANTA Platform
// Covers 4 campuses, 2 academic tracks, comprehensive lesson plans, timetables, and session records

import bcrypt from 'bcryptjs';
import { db } from './db.js';
import CalendarService from '../services/calendar.service.js';
import ProgressionService from '../services/progression.service.js';
import AlertsService from '../services/alerts.service.js';

export async function seedDatabase() {
  console.log('🌱 Starting EDVANTA database seed...');

  const passwordHash = await bcrypt.hash('edvanta123', 10);

  db.transaction((tx) => {
    // 1. Campuses
    const campuses = [
      { id: 'camp_hitech', name: 'HI-Tech Campus', code: 'HIT', timezone: 'Asia/Kolkata' },
      { id: 'camp_ratnam', name: 'Ratnam Campus', code: 'RAT', timezone: 'Asia/Kolkata' },
      { id: 'camp_rgib', name: 'RGIB Campus', code: 'RGB', timezone: 'Asia/Kolkata' },
      { id: 'camp_juj', name: 'JUJ Campus', code: 'JUJ', timezone: 'Asia/Kolkata' }
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

    // 4. Users (Admin, Campus Managers, Faculty, Students)
    const users = [
      {
        id: 'usr_admin',
        email: 'admin@edvanta.msot.edu',
        name: 'Prof. Rajesh Sharma (Dean & Program Director)',
        role: 'ADMIN',
        campus_id: null,
        batch_name: null
      },
      {
        id: 'usr_mgr_hitech',
        email: 'manager.hitech@edvanta.msot.edu',
        name: 'Vikram Malhotra',
        role: 'CAMPUS_MANAGER',
        campus_id: 'camp_hitech',
        batch_name: null
      },
      {
        id: 'usr_mgr_ratnam',
        email: 'manager.ratnam@edvanta.msot.edu',
        name: 'Sunita Rao',
        role: 'CAMPUS_MANAGER',
        campus_id: 'camp_ratnam',
        batch_name: null
      },
      {
        id: 'usr_mgr_rgib',
        email: 'manager.rgib@edvanta.msot.edu',
        name: 'Anil Deshmukh',
        role: 'CAMPUS_MANAGER',
        campus_id: 'camp_rgib',
        batch_name: null
      },
      {
        id: 'usr_mgr_juj',
        email: 'manager.juj@edvanta.msot.edu',
        name: 'Pooja Verma',
        role: 'CAMPUS_MANAGER',
        campus_id: 'camp_juj',
        batch_name: null
      },
      // Faculty
      {
        id: 'usr_fac_thorne',
        email: 'faculty.cs@edvanta.msot.edu',
        name: 'Dr. Aris Thorne',
        role: 'FACULTY',
        campus_id: 'camp_hitech',
        batch_name: null
      },
      {
        id: 'usr_fac_gupta',
        email: 'faculty.ai@edvanta.msot.edu',
        name: 'Prof. Neha Gupta',
        role: 'FACULTY',
        campus_id: 'camp_hitech',
        batch_name: null
      },
      {
        id: 'usr_fac_math',
        email: 'faculty.math@edvanta.msot.edu',
        name: 'Dr. K. Ramanujan',
        role: 'FACULTY',
        campus_id: 'camp_hitech',
        batch_name: null
      },
      {
        id: 'usr_fac_web',
        email: 'faculty.web@edvanta.msot.edu',
        name: 'Prof. Meera Sen',
        role: 'FACULTY',
        campus_id: 'camp_hitech',
        batch_name: null
      },
      // Students
      {
        id: 'usr_stu_aarav',
        email: 'student.aarav@edvanta.msot.edu',
        name: 'Aarav Mehta',
        role: 'STUDENT',
        campus_id: 'camp_hitech',
        batch_name: 'Batch-2026-Mirai-A'
      },
      {
        id: 'usr_stu_ananya',
        email: 'student.ananya@edvanta.msot.edu',
        name: 'Ananya Iyer',
        role: 'STUDENT',
        campus_id: 'camp_hitech',
        batch_name: 'Batch-2026-Univ-A'
      }
    ];

    for (const u of users) {
      tx.run(`
        INSERT INTO users (id, email, password_hash, name, role, campus_id, batch_name)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET email=excluded.email, name=excluded.name, role=excluded.role,
                                      campus_id=excluded.campus_id, batch_name=excluded.batch_name
      `, [u.id, u.email, passwordHash, u.name, u.role, u.campus_id, u.batch_name]);
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
        name: 'Fall 2026 - Ratnam Mirai (Sem 3)',
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
        id: 'sem_rgib_mirai',
        name: 'Fall 2026 - RGIB Mirai (Sem 3)',
        campus_id: 'camp_rgib',
        track_id: 'track_mirai',
        batch_name: 'Batch-2026-RGIB-M',
        start_date: '2026-08-01',
        end_date: '2026-12-15',
        working_saturday_rule: 'SECOND_AND_FOURTH',
        target_finish_date: '2026-11-20',
        is_active: 1
      },
      {
        id: 'sem_juj_univ',
        name: 'Fall 2026 - JUJ University (Sem 3)',
        campus_id: 'camp_juj',
        track_id: 'track_univ',
        batch_name: 'Batch-2026-JUJ-U',
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

    // 8. Subjects (HI-Tech Mirai Track Batch-2026-Mirai-A)
    const subjects = [
      {
        id: 'subj_cs301',
        semester_id: 'sem_hitech_mirai_a',
        campus_id: 'camp_hitech',
        track_id: 'track_mirai',
        code: 'CS301',
        name: 'Distributed Cloud Systems',
        faculty_id: 'usr_fac_thorne',
        planned_total_hours: 42.5,
        color: '#10b981' // Green
      },
      {
        id: 'subj_ai204',
        semester_id: 'sem_hitech_mirai_a',
        campus_id: 'camp_hitech',
        track_id: 'track_mirai',
        code: 'AI204',
        name: 'Applied Machine Learning',
        faculty_id: 'usr_fac_gupta',
        planned_total_hours: 38.0,
        color: '#3b82f6' // Blue
      },
      {
        id: 'subj_ma202',
        semester_id: 'sem_hitech_mirai_a',
        campus_id: 'camp_hitech',
        track_id: 'track_mirai',
        code: 'MA202',
        name: 'Discrete Math & Graph Algorithms',
        faculty_id: 'usr_fac_math',
        planned_total_hours: 36.0,
        color: '#ef4444' // Red / Danger
      },
      {
        id: 'subj_fs105',
        semester_id: 'sem_hitech_mirai_a',
        campus_id: 'camp_hitech',
        track_id: 'track_mirai',
        code: 'FS105',
        name: 'Modern Full-Stack Architectures',
        faculty_id: 'usr_fac_web',
        planned_total_hours: 34.0,
        color: '#8b5cf6' // Purple
      }
    ];

    for (const s of subjects) {
      tx.run(`
        INSERT INTO subjects (id, semester_id, campus_id, track_id, code, name, planned_total_hours, faculty_id, color)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, faculty_id=excluded.faculty_id,
                                      planned_total_hours=excluded.planned_total_hours, color=excluded.color
      `, [s.id, s.semester_id, s.campus_id, s.track_id, s.code, s.name, s.planned_total_hours, s.faculty_id, s.color]);
    }

    // 9. Timetable Slots with exact decimal hours
    // e.g. 50 mins = 0.8333 hrs, 100 mins = 1.6667 hrs
    const slots = [
      // CS301 (Mon, Wed, Fri) -> Total: 0.8333 + 1.6667 + 0.8333 = 3.3333 hrs/wk
      {
        id: 'slot_cs301_mon',
        campus_id: 'camp_hitech',
        track_id: 'track_mirai',
        semester_id: 'sem_hitech_mirai_a',
        batch_name: 'Batch-2026-Mirai-A',
        subject_id: 'subj_cs301',
        faculty_id: 'usr_fac_thorne',
        weekday: 1, // Mon
        start_time: '09:00',
        end_time: '09:50',
        duration_hours: CalendarService.calculateDurationHours('09:00', '09:50'),
        room: 'Lab-A1'
      },
      {
        id: 'slot_cs301_wed',
        campus_id: 'camp_hitech',
        track_id: 'track_mirai',
        semester_id: 'sem_hitech_mirai_a',
        batch_name: 'Batch-2026-Mirai-A',
        subject_id: 'subj_cs301',
        faculty_id: 'usr_fac_thorne',
        weekday: 3, // Wed
        start_time: '10:00',
        end_time: '11:40', // 100 min block
        duration_hours: CalendarService.calculateDurationHours('10:00', '11:40'),
        room: 'Lab-A1'
      },
      {
        id: 'slot_cs301_fri',
        campus_id: 'camp_hitech',
        track_id: 'track_mirai',
        semester_id: 'sem_hitech_mirai_a',
        batch_name: 'Batch-2026-Mirai-A',
        subject_id: 'subj_cs301',
        faculty_id: 'usr_fac_thorne',
        weekday: 5, // Fri
        start_time: '09:00',
        end_time: '09:50',
        duration_hours: CalendarService.calculateDurationHours('09:00', '09:50'),
        room: 'Lab-A1'
      },

      // AI204 (Tue, Thu, Sat)
      {
        id: 'slot_ai204_tue',
        campus_id: 'camp_hitech',
        track_id: 'track_mirai',
        semester_id: 'sem_hitech_mirai_a',
        batch_name: 'Batch-2026-Mirai-A',
        subject_id: 'subj_ai204',
        faculty_id: 'usr_fac_gupta',
        weekday: 2, // Tue
        start_time: '09:00',
        end_time: '10:40', // 100 mins
        duration_hours: CalendarService.calculateDurationHours('09:00', '10:40'),
        room: 'Hall-B2'
      },
      {
        id: 'slot_ai204_thu',
        campus_id: 'camp_hitech',
        track_id: 'track_mirai',
        semester_id: 'sem_hitech_mirai_a',
        batch_name: 'Batch-2026-Mirai-A',
        subject_id: 'subj_ai204',
        faculty_id: 'usr_fac_gupta',
        weekday: 4, // Thu
        start_time: '09:00',
        end_time: '09:50',
        duration_hours: CalendarService.calculateDurationHours('09:00', '09:50'),
        room: 'Hall-B2'
      },
      {
        id: 'slot_ai204_sat',
        campus_id: 'camp_hitech',
        track_id: 'track_mirai',
        semester_id: 'sem_hitech_mirai_a',
        batch_name: 'Batch-2026-Mirai-A',
        subject_id: 'subj_ai204',
        faculty_id: 'usr_fac_gupta',
        weekday: 6, // Sat (Working on 2nd and 4th Sat)
        start_time: '10:00',
        end_time: '11:40',
        duration_hours: CalendarService.calculateDurationHours('10:00', '11:40'),
        room: 'Hall-B2'
      },

      // MA202 (Mon, Wed, Fri afternoon)
      {
        id: 'slot_ma202_mon',
        campus_id: 'camp_hitech',
        track_id: 'track_mirai',
        semester_id: 'sem_hitech_mirai_a',
        batch_name: 'Batch-2026-Mirai-A',
        subject_id: 'subj_ma202',
        faculty_id: 'usr_fac_math',
        weekday: 1, // Mon
        start_time: '14:00',
        end_time: '14:50',
        duration_hours: CalendarService.calculateDurationHours('14:00', '14:50'),
        room: 'Hall-C1'
      },
      {
        id: 'slot_ma202_wed',
        campus_id: 'camp_hitech',
        track_id: 'track_mirai',
        semester_id: 'sem_hitech_mirai_a',
        batch_name: 'Batch-2026-Mirai-A',
        subject_id: 'subj_ma202',
        faculty_id: 'usr_fac_math',
        weekday: 3, // Wed
        start_time: '14:00',
        end_time: '14:50',
        duration_hours: CalendarService.calculateDurationHours('14:00', '14:50'),
        room: 'Hall-C1'
      },
      {
        id: 'slot_ma202_fri',
        campus_id: 'camp_hitech',
        track_id: 'track_mirai',
        semester_id: 'sem_hitech_mirai_a',
        batch_name: 'Batch-2026-Mirai-A',
        subject_id: 'subj_ma202',
        faculty_id: 'usr_fac_math',
        weekday: 5, // Fri
        start_time: '14:00',
        end_time: '14:50',
        duration_hours: CalendarService.calculateDurationHours('14:00', '14:50'),
        room: 'Hall-C1'
      },

      // FS105 (Tue, Thu afternoon)
      {
        id: 'slot_fs105_tue',
        campus_id: 'camp_hitech',
        track_id: 'track_mirai',
        semester_id: 'sem_hitech_mirai_a',
        batch_name: 'Batch-2026-Mirai-A',
        subject_id: 'subj_fs105',
        faculty_id: 'usr_fac_web',
        weekday: 2, // Tue
        start_time: '14:00',
        end_time: '15:40',
        duration_hours: CalendarService.calculateDurationHours('14:00', '15:40'),
        room: 'Lab-D'
      },
      {
        id: 'slot_fs105_thu',
        campus_id: 'camp_hitech',
        track_id: 'track_mirai',
        semester_id: 'sem_hitech_mirai_a',
        batch_name: 'Batch-2026-Mirai-A',
        subject_id: 'subj_fs105',
        faculty_id: 'usr_fac_web',
        weekday: 4, // Thu
        start_time: '14:00',
        end_time: '15:40',
        duration_hours: CalendarService.calculateDurationHours('14:00', '15:40'),
        room: 'Lab-D'
      }
    ];

    for (const slot of slots) {
      tx.run(`
        INSERT INTO timetable_slots (id, campus_id, track_id, semester_id, batch_name, subject_id, faculty_id, weekday, start_time, end_time, duration_hours, room)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET weekday=excluded.weekday, start_time=excluded.start_time, end_time=excluded.end_time, duration_hours=excluded.duration_hours
      `, [slot.id, slot.campus_id, slot.track_id, slot.semester_id, slot.batch_name, slot.subject_id, slot.faculty_id, slot.weekday, slot.start_time, slot.end_time, slot.duration_hours, slot.room]);
    }

    // 10. Lesson Plans / Syllabus
    // Let's create complete lesson plans for CS301 (Distributed Cloud Systems)
    const csTopics = [
      { unit: 1, uName: 'Cloud Fundamentals & Virtualization', seq: 1, title: 'Hypervisors, KVM & Containerization Primitives', hours: 2.0, scope: 'SESSIONAL', status: 'COMPLETED', pct: 100 },
      { unit: 1, uName: 'Cloud Fundamentals & Virtualization', seq: 2, title: 'OCI Runtime Spec & Linux Cgroups / Namespaces', hours: 2.5, scope: 'SESSIONAL', status: 'COMPLETED', pct: 100 },
      { unit: 1, uName: 'Cloud Fundamentals & Virtualization', seq: 3, title: 'Stateless vs Stateful Microservices Architecture', hours: 2.0, scope: 'SESSIONAL', status: 'COMPLETED', pct: 100 },
      { unit: 2, uName: 'Distributed Consensus & Coordination', seq: 4, title: 'CAP Theorem, PACELC & Eventual Consistency Models', hours: 2.5, scope: 'MID_TERM', status: 'COMPLETED', pct: 100 },
      { unit: 2, uName: 'Distributed Consensus & Coordination', seq: 5, title: 'Raft Consensus Algorithm: Leader Election & Log Replication', hours: 3.0, scope: 'MID_TERM', status: 'COMPLETED', pct: 100 },
      { unit: 2, uName: 'Distributed Consensus & Coordination', seq: 6, title: 'Paxos Protocols: Multi-Paxos & Vector Clocks', hours: 2.5, scope: 'MID_TERM', status: 'COMPLETED', pct: 100 },
      { unit: 3, uName: 'Kubernetes & Service Orchestration', seq: 7, title: 'Kubelet, API Server & Control Plane Internals', hours: 2.5, scope: 'MID_TERM', status: 'COMPLETED', pct: 100 },
      { unit: 3, uName: 'Kubernetes & Service Orchestration', seq: 8, title: 'Services, Ingress Controllers & Envoy Proxy Mesh', hours: 3.0, scope: 'MID_TERM', status: 'IN_PROGRESS', pct: 60 },
      { unit: 3, uName: 'Kubernetes & Service Orchestration', seq: 9, title: 'Custom Resource Definitions (CRDs) & Operator Pattern', hours: 2.5, scope: 'PUT', status: 'NOT_STARTED', pct: 0 },
      { unit: 4, uName: 'Distributed Storage & Caching', seq: 10, title: 'Consistent Hashing & Dynamo-style Ring Topologies', hours: 2.5, scope: 'PUT', status: 'NOT_STARTED', pct: 0 },
      { unit: 4, uName: 'Distributed Storage & Caching', seq: 11, title: 'Distributed Cache Invalidation & Write-Through Strategies', hours: 2.0, scope: 'PUT', status: 'NOT_STARTED', pct: 0 },
      { unit: 4, uName: 'Distributed Storage & Caching', seq: 12, title: 'Object Storage: S3 Protocol, Multipart & Erasure Coding', hours: 2.5, scope: 'PUT', status: 'NOT_STARTED', pct: 0 },
      { unit: 5, uName: 'Observability & Fault Tolerance', seq: 13, title: 'Distributed Tracing with OpenTelemetry & Jaeger', hours: 2.5, scope: 'END_TERM', status: 'NOT_STARTED', pct: 0 },
      { unit: 5, uName: 'Observability & Fault Tolerance', seq: 14, title: 'Circuit Breaking, Exponential Backoff & Chaos Engineering', hours: 2.5, scope: 'END_TERM', status: 'NOT_STARTED', pct: 0 },
      { unit: 5, uName: 'Observability & Fault Tolerance', seq: 15, title: 'Zero Trust Service Identity with SPIFFE/SPIRE', hours: 2.5, scope: 'END_TERM', status: 'NOT_STARTED', pct: 0 },
      { unit: 5, uName: 'Observability & Fault Tolerance', seq: 16, title: 'Capstone Review & Production Disaster Recovery Drill', hours: 3.0, scope: 'END_TERM', status: 'NOT_STARTED', pct: 0 }
    ];

    for (const t of csTopics) {
      const tId = `lp_cs301_${t.seq}`;
      tx.run(`
        INSERT INTO lesson_plans (id, subject_id, unit_number, unit_name, topic_number, topic_title, description, planned_hours, sequence_order, exam_scope, status, completion_percentage)
        VALUES (?, 'subj_cs301', ?, ?, ?, ?, 'Detailed engineering unit syllabus', ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET topic_title=excluded.topic_title, planned_hours=excluded.planned_hours, status=excluded.status, completion_percentage=excluded.completion_percentage
      `, [tId, t.unit, t.uName, t.seq, t.title, t.hours, t.seq, t.scope, t.status, t.pct]);
    }

    // AI204 Topics (Applied Machine Learning)
    const aiTopics = [
      { unit: 1, uName: 'Feature Engineering & Data Pipeline', seq: 1, title: 'Vectorization, Embeddings & Scaling Techniques', hours: 2.0, scope: 'SESSIONAL', status: 'COMPLETED', pct: 100 },
      { unit: 1, uName: 'Feature Engineering & Data Pipeline', seq: 2, title: 'Handling Imbalanced Datasets & SMOTE', hours: 2.0, scope: 'SESSIONAL', status: 'COMPLETED', pct: 100 },
      { unit: 2, uName: 'Supervised Learning & Ensemble Methods', seq: 3, title: 'Gradient Boosting: XGBoost & LightGBM Internals', hours: 3.0, scope: 'SESSIONAL', status: 'COMPLETED', pct: 100 },
      { unit: 2, uName: 'Supervised Learning & Ensemble Methods', seq: 4, title: 'Hyperparameter Tuning: Bayesian Optimization', hours: 2.5, scope: 'MID_TERM', status: 'COMPLETED', pct: 100 },
      { unit: 2, uName: 'Supervised Learning & Ensemble Methods', seq: 5, title: 'Model Evaluation: ROC-AUC, PR Curves & Calibration', hours: 2.5, scope: 'MID_TERM', status: 'COMPLETED', pct: 100 },
      { unit: 3, uName: 'Deep Neural Networks', seq: 6, title: 'Backpropagation, Optimizers (AdamW) & Regularization', hours: 3.0, scope: 'MID_TERM', status: 'IN_PROGRESS', pct: 40 },
      { unit: 3, uName: 'Deep Neural Networks', seq: 7, title: 'Convolutional Architectures & Vision Transformers', hours: 3.0, scope: 'PUT', status: 'NOT_STARTED', pct: 0 },
      { unit: 4, uName: 'Sequence Models & LLM Fundamentals', seq: 8, title: 'Self-Attention Mechanism & Transformer Encoder-Decoder', hours: 3.5, scope: 'PUT', status: 'NOT_STARTED', pct: 0 },
      { unit: 4, uName: 'Sequence Models & LLM Fundamentals', seq: 9, title: 'Fine-Tuning: LoRA, QLoRA & Quantization', hours: 3.0, scope: 'PUT', status: 'NOT_STARTED', pct: 0 },
      { unit: 5, uName: 'MLOps & Inference Serving', seq: 10, title: 'ONNX Runtime, TensorRT & Model Serving Latency Optimization', hours: 3.0, scope: 'END_TERM', status: 'NOT_STARTED', pct: 0 },
      { unit: 5, uName: 'MLOps & Inference Serving', seq: 11, title: 'Data Drift, Model Monitoring & Shadow Deployments', hours: 2.5, scope: 'END_TERM', status: 'NOT_STARTED', pct: 0 }
    ];

    for (const t of aiTopics) {
      const tId = `lp_ai204_${t.seq}`;
      tx.run(`
        INSERT INTO lesson_plans (id, subject_id, unit_number, unit_name, topic_number, topic_title, description, planned_hours, sequence_order, exam_scope, status, completion_percentage)
        VALUES (?, 'subj_ai204', ?, ?, ?, ?, 'Applied ML curriculum', ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET topic_title=excluded.topic_title, planned_hours=excluded.planned_hours, status=excluded.status, completion_percentage=excluded.completion_percentage
      `, [tId, t.unit, t.uName, t.seq, t.title, t.hours, t.seq, t.scope, t.status, t.pct]);
    }

    // MA202 Topics (Math & Graph Algorithms - INTENTIONALLY BEHIND SCHEDULE FOR TESTING DANGER WARNINGS)
    const mathTopics = [
      { unit: 1, uName: 'Propositional & Predicate Logic', seq: 1, title: 'Truth Tables, Normal Forms & SAT Solvers', hours: 2.5, scope: 'SESSIONAL', status: 'COMPLETED', pct: 100 },
      { unit: 1, uName: 'Propositional & Predicate Logic', seq: 2, title: 'Mathematical Induction & Well-Ordering Principle', hours: 2.5, scope: 'SESSIONAL', status: 'COMPLETED', pct: 100 },
      { unit: 2, uName: 'Combinatorics & Recurrence Relations', seq: 3, title: 'Generating Functions & Master Theorem', hours: 3.0, scope: 'MID_TERM', status: 'IN_PROGRESS', pct: 25 }, // Behind schedule!
      { unit: 2, uName: 'Combinatorics & Recurrence Relations', seq: 4, title: 'Inclusion-Exclusion & Pigeonhole Applications', hours: 2.5, scope: 'MID_TERM', status: 'NOT_STARTED', pct: 0 },
      { unit: 3, uName: 'Graph Theory & Networks', seq: 5, title: 'Graph Isomorphism, Eulerian & Hamiltonian Circuits', hours: 3.0, scope: 'MID_TERM', status: 'NOT_STARTED', pct: 0 },
      { unit: 3, uName: 'Graph Theory & Networks', seq: 6, title: 'Planar Graphs, Colorability & Four Color Theorem', hours: 2.5, scope: 'PUT', status: 'NOT_STARTED', pct: 0 },
      { unit: 3, uName: 'Graph Theory & Networks', seq: 7, title: 'Max Flow Min Cut & Ford-Fulkerson Algorithm', hours: 3.0, scope: 'PUT', status: 'NOT_STARTED', pct: 0 },
      { unit: 4, uName: 'Algebraic Structures', seq: 8, title: 'Groups, Rings, Fields & Finite Cyclic Groups', hours: 3.0, scope: 'END_TERM', status: 'NOT_STARTED', pct: 0 },
      { unit: 4, uName: 'Algebraic Structures', seq: 9, title: 'Cosets, Lagrange Theorem & Cryptographic Applications', hours: 3.0, scope: 'END_TERM', status: 'NOT_STARTED', pct: 0 }
    ];

    for (const t of mathTopics) {
      const tId = `lp_ma202_${t.seq}`;
      tx.run(`
        INSERT INTO lesson_plans (id, subject_id, unit_number, unit_name, topic_number, topic_title, description, planned_hours, sequence_order, exam_scope, status, completion_percentage)
        VALUES (?, 'subj_ma202', ?, ?, ?, ?, 'Discrete math syllabus', ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET topic_title=excluded.topic_title, planned_hours=excluded.planned_hours, status=excluded.status, completion_percentage=excluded.completion_percentage
      `, [tId, t.unit, t.uName, t.seq, t.title, t.hours, t.seq, t.scope, t.status, t.pct]);
    }

    // FS105 Topics (Modern Full-Stack Architectures)
    const webTopics = [
      { unit: 1, uName: 'Modern Frontend Architecture', seq: 1, title: 'DOM Engine, Event Loop & Hydration Internals', hours: 2.5, scope: 'SESSIONAL', status: 'COMPLETED', pct: 100 },
      { unit: 1, uName: 'Modern Frontend Architecture', seq: 2, title: 'State Management Patterns & Reactive Primitives', hours: 2.5, scope: 'SESSIONAL', status: 'COMPLETED', pct: 100 },
      { unit: 2, uName: 'API & Communication Protocols', seq: 3, title: 'RESTful API Standards, OpenAPI & JSON Schemas', hours: 2.5, scope: 'MID_TERM', status: 'COMPLETED', pct: 100 },
      { unit: 2, uName: 'API & Communication Protocols', seq: 4, title: 'WebSockets, SSE & Real-time Duplex Streaming', hours: 3.0, scope: 'MID_TERM', status: 'COMPLETED', pct: 100 },
      { unit: 3, uName: 'Security & Auth Engineering', seq: 5, title: 'OAuth2.0, OpenID Connect & JWT Rotation', hours: 3.0, scope: 'PUT', status: 'NOT_STARTED', pct: 0 },
      { unit: 3, uName: 'Security & Auth Engineering', seq: 6, title: 'OWASP Top 10: XSS, CSRF, CSP & CORS Deep Dive', hours: 2.5, scope: 'PUT', status: 'NOT_STARTED', pct: 0 },
      { unit: 4, uName: 'Performance & Production Delivery', seq: 7, title: 'Web Vitals, Bundle Splitting & CDN Edge Workers', hours: 3.0, scope: 'END_TERM', status: 'NOT_STARTED', pct: 0 }
    ];

    for (const t of webTopics) {
      const tId = `lp_fs105_${t.seq}`;
      tx.run(`
        INSERT INTO lesson_plans (id, subject_id, unit_number, unit_name, topic_number, topic_title, description, planned_hours, sequence_order, exam_scope, status, completion_percentage)
        VALUES (?, 'subj_fs105', ?, ?, ?, ?, 'Web architectures syllabus', ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET topic_title=excluded.topic_title, planned_hours=excluded.planned_hours, status=excluded.status, completion_percentage=excluded.completion_percentage
      `, [tId, t.unit, t.uName, t.seq, t.title, t.hours, t.seq, t.scope, t.status, t.pct]);
    }

    // 11. Teaching Sessions (Log historical deliveries)
    const sessions = [
      // CS301 (Logged consistently)
      {
        id: 'sess_cs_01',
        timetable_slot_id: 'slot_cs301_mon',
        subject_id: 'subj_cs301',
        faculty_id: 'usr_fac_thorne',
        campus_id: 'camp_hitech',
        batch_name: 'Batch-2026-Mirai-A',
        session_date: '2026-08-03',
        status: 'COMPLETED',
        percentage_complete: 100,
        topics_covered: 'Hypervisors, KVM & Containerization Primitives',
        topics_leftover: null,
        carry_forward_topic: null,
        classwork_status: 'Hands-on KVM VM instantiation',
        homework_status: 'Read Linux cgroups v2 documentation',
        notes: 'Great student engagement on container isolation mechanisms.',
        duration_hours: 0.8333
      },
      {
        id: 'sess_cs_02',
        timetable_slot_id: 'slot_cs301_wed',
        subject_id: 'subj_cs301',
        faculty_id: 'usr_fac_thorne',
        campus_id: 'camp_hitech',
        batch_name: 'Batch-2026-Mirai-A',
        session_date: '2026-08-05',
        status: 'COMPLETED',
        percentage_complete: 100,
        topics_covered: 'OCI Runtime Spec & Linux Cgroups / Namespaces',
        topics_leftover: null,
        carry_forward_topic: null,
        classwork_status: 'Custom container created with unshare & pivot_root',
        homework_status: 'Lab assignment 1 submitted via GitHub',
        notes: 'Demonstrated runc under the hood.',
        duration_hours: 1.6667
      },
      // MA202 had a CANCELLED class on 2026-08-10 due to faculty illness
      {
        id: 'sess_ma_canc_01',
        timetable_slot_id: 'slot_ma202_mon',
        subject_id: 'subj_ma202',
        faculty_id: 'usr_fac_math',
        campus_id: 'camp_hitech',
        batch_name: 'Batch-2026-Mirai-A',
        session_date: '2026-08-10',
        status: 'CANCELLED',
        percentage_complete: 0,
        topics_covered: null,
        topics_leftover: 'Truth Tables & SAT Solvers',
        carry_forward_topic: 'Truth Tables, Normal Forms & SAT Solvers',
        classwork_status: 'Cancelled',
        homework_status: 'Self study page 45-60',
        notes: 'Faculty medical leave. Session cancelled and rescheduled.',
        duration_hours: 0.8333
      }
    ];

    for (const sess of sessions) {
      tx.run(`
        INSERT INTO teaching_sessions (id, timetable_slot_id, subject_id, faculty_id, campus_id, batch_name, session_date, status, percentage_complete, topics_covered, topics_leftover, carry_forward_topic, classwork_status, homework_status, notes, duration_hours)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET status=excluded.status, percentage_complete=excluded.percentage_complete, notes=excluded.notes
      `, [sess.id, sess.timetable_slot_id, sess.subject_id, sess.faculty_id, sess.campus_id, sess.batch_name, sess.session_date, sess.status, sess.percentage_complete, sess.topics_covered, sess.topics_leftover, sess.carry_forward_topic, sess.classwork_status, sess.homework_status, sess.notes, sess.duration_hours]);
    }
  });

  // Calculate planned topic dates for all subjects
  console.log('📅 Calculating automatic planned topic dates...');
  for (const sId of ['subj_cs301', 'subj_ai204', 'subj_ma202', 'subj_fs105']) {
    ProgressionService.generatePlannedTopicDates(sId);
  }

  // Run alerts check for sample date
  console.log('🚨 Scanning missed log alerts...');
  AlertsService.checkMissedLogs('2026-10-19');

  console.log('✅ EDVANTA database seeded successfully with MSOT academic data!');
}

// Auto-run if executed directly
if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  seedDatabase().catch(err => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
}
