// Alerts & Missed Session Escalation Service for EDVANTA
// Detects unlogged teaching sessions:
// - End of scheduled day -> Reminder alert to assigned Faculty
// - > 48 hours unlogged -> Escalated alert to Campus Manager
// - Avoids duplicates and supports in-app simulation testing

import { db } from '../database/db.js';
import CalendarService from './calendar.service.js';

export class AlertsService {
  /**
   * Scan for scheduled timetable slots that have not been logged.
   * Generates reminders for Faculty and escalations for Campus Managers.
   * @param {string} asOfDate - Optional simulation date YYYY-MM-DD
   */
  static checkMissedLogs(asOfDate = null) {
    const today = asOfDate || this.getActiveDate();

    // Fetch active semesters
    const activeSemesters = db.query(`
      SELECT sem.*, c.name as campus_name
      FROM semesters sem
      JOIN campuses c ON sem.campus_id = c.id
      WHERE sem.is_active = 1
    `);

    const newAlertsCreated = [];

    for (const sem of activeSemesters) {
      // Holidays
      const holidaysRows = db.query(`
        SELECT event_date FROM calendar_events
        WHERE campus_id = ? AND semester_id = ? AND event_type = 'HOLIDAY' AND affects_schedule = 1
      `, [sem.campus_id, sem.id]);
      const holidaySet = new Set(holidaysRows.map(h => h.event_date));

      // Timetable slots in this semester
      const slots = db.query(`
        SELECT ts.*, s.code as subject_code, s.name as subject_name,
               u.name as faculty_name, u.email as faculty_email
        FROM timetable_slots ts
        JOIN subjects s ON ts.subject_id = s.id
        JOIN users u ON ts.faculty_id = u.id
        WHERE ts.semester_id = ?
      `, [sem.id]);

      // Find Campus Manager for this campus
      const campusManager = db.get(`
        SELECT id, name, email FROM users
        WHERE campus_id = ? AND role = 'CAMPUS_MANAGER'
        LIMIT 1
      `, [sem.campus_id]);

      // Scan days from semester start up to today
      let checkDate = sem.start_date;
      const endDate = today < sem.end_date ? today : sem.end_date;

      while (checkDate <= endDate) {
        if (CalendarService.isWorkingDay(checkDate, sem.working_saturday_rule, holidaySet)) {
          const dow = CalendarService.getDayOfWeek(checkDate);
          const daySlots = slots.filter(s => s.weekday === dow);

          for (const slot of daySlots) {
            // Check if a session was logged for this slot or subject on checkDate
            const session = db.get(`
              SELECT id, status FROM teaching_sessions
              WHERE session_date = ? AND (timetable_slot_id = ? OR subject_id = ?)
            `, [checkDate, slot.id, slot.subject_id]);

            if (!session) {
              // Session was NOT logged!
              const daysDiff = CalendarService.diffInDays(checkDate, today);
              const elapsedHours = daysDiff * 24;

              // Rule 1: Not logged by end of scheduled day -> Faculty Reminder
              if (elapsedHours >= 0 && elapsedHours < 48) {
                const alertId = `alt_rem_${slot.id}_${checkDate}`;
                const msg = `Reminder: Scheduled session for ${slot.subject_code} (${slot.start_time}-${slot.end_time}) on ${checkDate} has not been logged yet.`;
                
                const existing = db.get(`SELECT id FROM alerts WHERE id = ?`, [alertId]);
                if (!existing) {
                  db.run(`
                    INSERT INTO alerts (id, alert_type, recipient_user_id, recipient_role, campus_id, subject_id, slot_id, session_date, message, severity)
                    VALUES (?, 'MISSED_LOG_REMINDER', ?, 'FACULTY', ?, ?, ?, ?, ?, 'WARNING')
                  `, [alertId, slot.faculty_id, sem.campus_id, slot.subject_id, slot.id, checkDate, msg]);
                  newAlertsCreated.push({ alertId, type: 'MISSED_LOG_REMINDER', recipient: slot.faculty_name, checkDate });
                }
              }

              // Rule 2: Unlogged after 48 hours -> Escalate to Campus Manager
              if (elapsedHours >= 48) {
                const alertId = `alt_esc_${slot.id}_${checkDate}`;
                const msg = `ESCALATION: Faculty ${slot.faculty_name} has not logged ${slot.subject_code} for ${slot.batch_name} scheduled on ${checkDate} (>48 hours overdue).`;
                
                const existing = db.get(`SELECT id FROM alerts WHERE id = ?`, [alertId]);
                if (!existing && campusManager) {
                  db.run(`
                    INSERT INTO alerts (id, alert_type, recipient_user_id, recipient_role, campus_id, subject_id, slot_id, session_date, message, severity)
                    VALUES (?, 'ESCALATED_UNLOGGED', ?, 'CAMPUS_MANAGER', ?, ?, ?, ?, ?, 'DANGER')
                  `, [alertId, campusManager.id, sem.campus_id, slot.subject_id, slot.id, checkDate, msg]);
                  newAlertsCreated.push({ alertId, type: 'ESCALATED_UNLOGGED', recipient: campusManager.name, checkDate });
                }
              }
            }
          }
        }
        checkDate = CalendarService.addDays(checkDate, 1);
      }
    }

    return newAlertsCreated;
  }

  /**
   * Get active date from system settings or real date
   */
  static getActiveDate() {
    const simSetting = db.get("SELECT value FROM system_settings WHERE key = 'simulation_date'");
    if (simSetting && simSetting.value) {
      return simSetting.value;
    }
    return CalendarService.formatDate(new Date());
  }

  /**
   * Set simulation date for time-based testing
   */
  static setSimulationDate(dateStr) {
    db.run(`
      INSERT INTO system_settings (key, value, description)
      VALUES ('simulation_date', ?, 'Test simulation date for alert and pace calculations')
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `, [dateStr]);
    return this.checkMissedLogs(dateStr);
  }

  /**
   * Reset simulation date back to system local date
   */
  static clearSimulationDate() {
    db.run(`DELETE FROM system_settings WHERE key = 'simulation_date'`);
    return this.getActiveDate();
  }

  /**
   * Fetch alerts with role/campus filtering
   */
  static getAlerts(user) {
    if (!user) return [];

    if (user.role === 'ADMIN') {
      return db.query(`
        SELECT a.*, s.code as subject_code, s.name as subject_name, c.name as campus_name
        FROM alerts a
        LEFT JOIN subjects s ON a.subject_id = s.id
        LEFT JOIN campuses c ON a.campus_id = c.id
        ORDER BY a.created_at DESC
        LIMIT 100
      `);
    }

    if (user.role === 'CAMPUS_MANAGER') {
      return db.query(`
        SELECT a.*, s.code as subject_code, s.name as subject_name, c.name as campus_name
        FROM alerts a
        LEFT JOIN subjects s ON a.subject_id = s.id
        LEFT JOIN campuses c ON a.campus_id = c.id
        WHERE a.campus_id = ?
        ORDER BY a.created_at DESC
        LIMIT 100
      `, [user.campus_id]);
    }

    if (user.role === 'FACULTY') {
      return db.query(`
        SELECT a.*, s.code as subject_code, s.name as subject_name, c.name as campus_name
        FROM alerts a
        LEFT JOIN subjects s ON a.subject_id = s.id
        LEFT JOIN campuses c ON a.campus_id = c.id
        WHERE a.recipient_user_id = ?
        ORDER BY a.created_at DESC
        LIMIT 100
      `, [user.id]);
    }

    return []; // Students do not receive administrative alerts
  }

  /**
   * Mark alert as read
   */
  static markAsRead(alertId) {
    return db.run(`UPDATE alerts SET is_read = 1 WHERE id = ?`, [alertId]);
  }
}

export default AlertsService;
