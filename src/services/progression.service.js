// Progression & Calculation Service for EDVANTA
// Implements mandatory syllabus progression rules, automatic planned topic date generation,
// buffer ratio analysis, pace-vs-plan metrics, and rolled-up status.

import { db } from '../database/db.js';
import CalendarService from './calendar.service.js';

export class ProgressionService {
  /**
   * Fetch current system thresholds or defaults
   */
  static async getThresholds() {
    const onTrackSetting = await db.get("SELECT value FROM system_settings WHERE key = 'buffer_ratio_on_track'");
    const tightSetting = await db.get("SELECT value FROM system_settings WHERE key = 'buffer_ratio_tight'");
    return {
      onTrack: onTrackSetting ? parseFloat(onTrackSetting.value) : 1.15,
      tight: tightSetting ? parseFloat(tightSetting.value) : 1.00
    };
  }

  /**
   * Get active simulation date or fallback to current local date
   */
  static async getToday(asOfDate = null) {
    if (asOfDate) return asOfDate;
    const simSetting = await db.get("SELECT value FROM system_settings WHERE key = 'simulation_date'");
    if (simSetting && simSetting.value) {
      return simSetting.value;
    }
    return CalendarService.formatDate(new Date());
  }

  /**
   * Automatically generate and assign planned topic dates for a subject
   * Based on semester start date, timetable slots, working Saturday rules, and holidays.
   */
  static async generatePlannedTopicDates(subjectId) {
    const subject = await db.get(`
      SELECT s.*, sem.start_date as semester_start, sem.end_date as semester_end,
             sem.working_saturday_rule, sem.target_finish_date
      FROM subjects s
      JOIN semesters sem ON s.semester_id = sem.id
      WHERE s.id = ?
    `, [subjectId]);

    if (!subject) throw new Error(`Subject with ID ${subjectId} not found`);

    // Fetch campus holidays
    const holidaysRows = await db.query(`
      SELECT event_date FROM calendar_events
      WHERE campus_id = ? AND semester_id = ? AND event_type = 'HOLIDAY' AND affects_schedule = 1
    `, [subject.campus_id, subject.semester_id]);
    const holidaySet = new Set(holidaysRows.map(h => h.event_date));

    // Fetch timetable slots for this subject
    const timetableSlots = await db.query(`
      SELECT weekday, duration_hours, start_time
      FROM timetable_slots
      WHERE subject_id = ?
      ORDER BY weekday ASC, start_time ASC
    `, [subjectId]);

    if (timetableSlots.length === 0) {
      console.warn(`No timetable slots found for subject ${subject.code}`);
      return;
    }

    // Map weekday (1..6) -> total slots & durations
    // e.g. weekday 1 has slots [ { duration_hours: 0.8333 }, ... ]
    const slotsByWeekday = {};
    for (const slot of timetableSlots) {
      if (!slotsByWeekday[slot.weekday]) slotsByWeekday[slot.weekday] = [];
      slotsByWeekday[slot.weekday].push(slot);
    }

    // Fetch topics in sequence order
    const topics = await db.query(`
      SELECT id, sequence_order, planned_hours, status
      FROM lesson_plans
      WHERE subject_id = ?
      ORDER BY sequence_order ASC
    `, [subjectId]);

    if (topics.length === 0) return;

    // Check for cancelled sessions to exclude those slots from topic scheduling
    const cancelledSessions = await db.query(`
      SELECT session_date FROM teaching_sessions
      WHERE subject_id = ? AND status = 'CANCELLED'
    `, [subjectId]);
    const cancelledDateSet = new Set(cancelledSessions.map(cs => cs.session_date));

    // Simulation allocation loop:
    // Iterate day-by-day starting from semester_start up to semester_end
    let currentDate = subject.semester_start;
    let topicIndex = 0;
    let currentTopicRemainingHours = topics[0].planned_hours;

    const topicDates = new Map(); // topicId -> assigned planned_date

    while (currentDate <= subject.semester_end && topicIndex < topics.length) {
      const isWorking = CalendarService.isWorkingDay(currentDate, subject.working_saturday_rule, holidaySet);
      const isCancelledDay = cancelledDateSet.has(currentDate);

      if (isWorking && !isCancelledDay) {
        const dayOfWeek = CalendarService.getDayOfWeek(currentDate);
        const daySlots = slotsByWeekday[dayOfWeek] || [];

        for (const slot of daySlots) {
          let slotRemainingCapacity = slot.duration_hours;

          while (slotRemainingCapacity > 0.001 && topicIndex < topics.length) {
            const topic = topics[topicIndex];
            
            // If topic hasn't been assigned a planned_date yet, assign it to currentDate
            if (!topicDates.has(topic.id)) {
              topicDates.set(topic.id, currentDate);
            }

            // If topic is marked SKIPPED, skip allocation
            if (topic.status === 'SKIPPED') {
              topicIndex++;
              if (topicIndex < topics.length) {
                currentTopicRemainingHours = topics[topicIndex].planned_hours;
              }
              continue;
            }

            if (currentTopicRemainingHours <= slotRemainingCapacity) {
              slotRemainingCapacity -= currentTopicRemainingHours;
              topicIndex++;
              if (topicIndex < topics.length) {
                currentTopicRemainingHours = topics[topicIndex].planned_hours;
              }
            } else {
              currentTopicRemainingHours -= slotRemainingCapacity;
              slotRemainingCapacity = 0;
            }
          }

          if (topicIndex >= topics.length) break;
        }
      }

      currentDate = CalendarService.addDays(currentDate, 1);
    }

    // Update lesson_plans with calculated planned_date
    await db.transaction(async (tx) => {
      for (const [topicId, pDate] of topicDates.entries()) {
        await tx.run(`UPDATE lesson_plans SET planned_date = ? WHERE id = ?`, [pDate, topicId]);
      }
    });
  }

  /**
   * Calculate complete progression metrics for a specific subject
   */
  static async calculateSubjectProgress(subjectId, asOfDate = null) {
    const today = await this.getToday(asOfDate);
    const thresholds = await this.getThresholds();

    const subject = await db.get(`
      SELECT s.*, sem.start_date as semester_start, sem.end_date as semester_end,
             sem.working_saturday_rule, sem.target_finish_date,
             c.name as campus_name, t.name as track_name, sem.batch_name,
             u.name as faculty_name
      FROM subjects s
      JOIN semesters sem ON s.semester_id = sem.id
      JOIN campuses c ON s.campus_id = c.id
      JOIN tracks t ON s.track_id = t.id
      LEFT JOIN users u ON s.faculty_id = u.id
      WHERE s.id = ?
    `, [subjectId]);

    if (!subject) throw new Error(`Subject ${subjectId} not found`);

    // Fetch all topics for subject
    const topics = await db.query(`
      SELECT id, topic_title, planned_hours, status, completion_percentage, planned_date, exam_scope
      FROM lesson_plans
      WHERE subject_id = ?
      ORDER BY sequence_order ASC
    `, [subjectId]);

    // A. HOURS IN SCOPE: Sum planned hours for topics, EXCLUDING SKIPPED
    let hoursInScope = 0;
    let coveredHours = 0;
    let hoursThatShouldHaveBeenCoveredByToday = 0;
    let overdueCount = 0;
    const overdueTopicsList = [];

    for (const topic of topics) {
      if (topic.status === 'SKIPPED') {
        continue; // Skipped topics are excluded from hours in scope
      }

      const pHours = Number(topic.planned_hours) || 0;
      hoursInScope += pHours;

      // B. COVERED HOURS:
      // Completed: 100%
      // In-Progress: planned * completion_percentage / 100
      if (topic.status === 'COMPLETED') {
        coveredHours += pHours;
      } else if (topic.status === 'IN_PROGRESS') {
        const pct = Math.max(0, Math.min(100, Number(topic.completion_percentage) || 0));
        coveredHours += (pHours * pct) / 100;
      }

      // Check expected coverage by today
      if (topic.planned_date && topic.planned_date <= today) {
        hoursThatShouldHaveBeenCoveredByToday += pHours;

        // H. OVERDUE TOPICS: planned_date has strictly passed (< today) and not fully covered
        if (topic.planned_date < today && topic.status !== 'COMPLETED' && topic.status !== 'SKIPPED') {
          overdueCount++;
          overdueTopicsList.push({
            id: topic.id,
            title: topic.topic_title,
            planned_date: topic.planned_date,
            status: topic.status,
            completion_percentage: topic.completion_percentage,
            planned_hours: pHours
          });
        }
      }
    }

    // C. COVERAGE PERCENTAGE
    let coveragePercent = 0;
    if (hoursInScope > 0) {
      coveragePercent = (coveredHours / hoursInScope) * 100;
    } else {
      coveragePercent = 100.0;
    }

    // D. REMAINING HOURS: prevent negative values
    const remainingHours = Math.max(0, hoursInScope - coveredHours);

    // E. AVAILABLE HOURS:
    // Timetable hours remaining between today and target_finish_date (inclusive)
    const holidaysRows = await db.query(`
      SELECT event_date FROM calendar_events
      WHERE campus_id = ? AND semester_id = ? AND event_type = 'HOLIDAY' AND affects_schedule = 1
    `, [subject.campus_id, subject.semester_id]);
    const holidaySet = new Set(holidaysRows.map(h => h.event_date));

    const timetableSlots = await db.query(`
      SELECT weekday, duration_hours
      FROM timetable_slots
      WHERE subject_id = ?
    `, [subjectId]);

    const weeklyHoursByDay = {};
    for (const slot of timetableSlots) {
      weeklyHoursByDay[slot.weekday] = (weeklyHoursByDay[slot.weekday] || 0) + Number(slot.duration_hours);
    }

    let availableHours = 0;
    let calcStart = today;
    // If target finish date is in the past or semester hasn't started yet:
    if (today < subject.semester_start) {
      calcStart = subject.semester_start;
    }

    const calcEnd = subject.target_finish_date;
    if (calcStart <= calcEnd) {
      let cur = calcStart;
      while (cur <= calcEnd) {
        if (CalendarService.isWorkingDay(cur, subject.working_saturday_rule, holidaySet)) {
          const dow = CalendarService.getDayOfWeek(cur);
          if (weeklyHoursByDay[dow]) {
            let dayHours = weeklyHoursByDay[dow];
            // If evaluating today, subtract hours from sessions already logged for this subject today
            // to avoid double-counting completed sessions as future available capacity
            if (cur === today) {
              const loggedToday = await db.get(`
                SELECT COALESCE(SUM(duration_hours), 0) as logged_hours
                FROM teaching_sessions
                WHERE subject_id = ? AND session_date = ? AND status != 'CANCELLED'
              `, [subjectId, today]);
              const alreadyLogged = loggedToday ? Number(loggedToday.logged_hours) : 0;
              dayHours = Math.max(0, dayHours - alreadyLogged);
            }
            availableHours += dayHours;
          }
        }
        cur = CalendarService.addDays(cur, 1);
      }
    }

    // F. BUFFER RATIO
    // bufferRatio = availableHours / remainingHours
    let bufferRatio = 0;
    let status = 'ON TRACK';

    if (remainingHours <= 0.001) {
      bufferRatio = 99.99; // fully complete
      status = 'COMPLETE';
    } else {
      bufferRatio = availableHours / remainingHours;
      if (bufferRatio >= thresholds.onTrack) {
        status = 'ON TRACK';
      } else if (bufferRatio >= thresholds.tight) {
        status = 'TIGHT';
      } else {
        status = 'DANGER';
      }
    }

    // G. PACE VS PLAN
    // paceVsPlan = coveredHours - hoursThatShouldHaveBeenCoveredByToday
    const paceVsPlan = coveredHours - hoursThatShouldHaveBeenCoveredByToday;

    return {
      id: subject.id,
      subjectId: subject.id,
      code: subject.code,
      name: subject.name,
      faculty_name: subject.faculty_name || 'Assigned Faculty',
      campusId: subject.campus_id,
      campusName: subject.campus_name,
      trackId: subject.track_id,
      trackName: subject.track_name,
      batchName: subject.batch_name,
      semesterId: subject.semester_id,
      targetFinishDate: subject.target_finish_date,
      asOfDate: today,

      // Core calculation outputs
      hoursInScope: Number(hoursInScope.toFixed(4)),
      total_hours: Number(hoursInScope.toFixed(4)),
      coveredHours: Number(coveredHours.toFixed(4)),
      remainingHours: Number(remainingHours.toFixed(4)),
      coveragePercent: Number(coveragePercent.toFixed(2)),
      progressPercentage: Number(coveragePercent.toFixed(2)),
      availableHours: Number(availableHours.toFixed(4)),
      bufferRatio: Number(bufferRatio.toFixed(2)),
      status, // 'COMPLETE', 'ON TRACK', 'TIGHT', 'DANGER'
      
      hoursExpectedByToday: Number(hoursThatShouldHaveBeenCoveredByToday.toFixed(4)),
      paceVsPlan: Number(paceVsPlan.toFixed(2)), // negative means behind plan
      isBehindPlan: paceVsPlan < -0.01,

      overdueTopicsCount: overdueCount,
      overdueTopics: overdueTopicsList,
      totalTopicsCount: topics.length
    };
  }

  /**
   * Calculate Track roll-up status for a set of subjects
   * MANDATORY: Track overall status must reflect its WORST applicable subject, not an average!
   */
  static rollUpStatus(subjectStatuses) {
    if (!subjectStatuses || subjectStatuses.length === 0) return 'COMPLETE';

    const hasDanger = subjectStatuses.some(s => s === 'DANGER');
    if (hasDanger) return 'DANGER';

    const hasTight = subjectStatuses.some(s => s === 'TIGHT');
    if (hasTight) return 'TIGHT';

    const hasOnTrack = subjectStatuses.some(s => s === 'ON TRACK');
    if (hasOnTrack) return 'ON TRACK';

    return 'COMPLETE';
  }

  /**
   * Get Exam Readiness for a semester or subject
   */
  static async getExamReadiness(semesterId, subjectId = null, asOfDate = null) {
    const today = await this.getToday(asOfDate);
    const thresholds = await this.getThresholds();

    // Fetch exams for this semester
    let examsQuery = `
      SELECT ew.*, sem.campus_id, sem.working_saturday_rule
      FROM exam_windows ew
      JOIN semesters sem ON ew.semester_id = sem.id
      WHERE ew.semester_id = ?
      ORDER BY ew.start_date ASC
    `;
    const exams = await db.query(examsQuery, [semesterId]);

    // Subjects in scope
    let subjectsQuery = `SELECT id, code, name, semester_id, campus_id FROM subjects WHERE semester_id = ?`;
    const subjectsParams = [semesterId];
    if (subjectId) {
      subjectsQuery += ` AND id = ?`;
      subjectsParams.push(subjectId);
    }
    const subjects = await db.query(subjectsQuery, subjectsParams);

    const results = [];

    for (const exam of exams) {
      // Holidays
      const holidaysRows = await db.query(`
        SELECT event_date FROM calendar_events
        WHERE campus_id = ? AND semester_id = ? AND event_type = 'HOLIDAY' AND affects_schedule = 1
      `, [exam.campus_id, exam.semester_id]);
      const holidaySet = new Set(holidaysRows.map(h => h.event_date));

      let examTotalInScopeHours = 0;
      let examCoveredHours = 0;
      let examAvailableHours = 0;
      const subjectBreakdowns = [];

      for (const subj of subjects) {
        // Topics applicable to this exam:
        // exam_scope can be exact exam_type or 'ALL'
        const inScopeTopics = await db.query(`
          SELECT id, topic_title, planned_hours, status, completion_percentage
          FROM lesson_plans
          WHERE subject_id = ? AND (exam_scope = ? OR exam_scope = 'ALL')
        `, [subj.id, exam.exam_type]);

        let subjInScopeHours = 0;
        let subjCoveredHours = 0;

        for (const t of inScopeTopics) {
          if (t.status === 'SKIPPED') continue;
          const pHours = Number(t.planned_hours) || 0;
          subjInScopeHours += pHours;

          if (t.status === 'COMPLETED') {
            subjCoveredHours += pHours;
          } else if (t.status === 'IN_PROGRESS') {
            const pct = Math.max(0, Math.min(100, Number(t.completion_percentage) || 0));
            subjCoveredHours += (pHours * pct) / 100;
          }
        }

        // Available hours before exam starts (from today to exam.start_date - 1)
        const dayBeforeExam = CalendarService.addDays(exam.start_date, -1);
        let subjAvailHours = 0;

        if (today <= dayBeforeExam) {
          const timetableSlots = await db.query(`
            SELECT weekday, duration_hours FROM timetable_slots WHERE subject_id = ?
          `, [subj.id]);
          const slotMap = {};
          for (const s of timetableSlots) {
            slotMap[s.weekday] = (slotMap[s.weekday] || 0) + Number(s.duration_hours);
          }

          let cur = today;
          while (cur <= dayBeforeExam) {
            if (CalendarService.isWorkingDay(cur, exam.working_saturday_rule, holidaySet)) {
              const dow = CalendarService.getDayOfWeek(cur);
              if (slotMap[dow]) {
                let dayHours = slotMap[dow];
                if (cur === today) {
                  const loggedToday = await db.get(`
                    SELECT COALESCE(SUM(duration_hours), 0) as logged_hours
                    FROM teaching_sessions
                    WHERE subject_id = ? AND session_date = ? AND status != 'CANCELLED'
                  `, [subj.id, today]);
                  const alreadyLogged = loggedToday ? Number(loggedToday.logged_hours) : 0;
                  dayHours = Math.max(0, dayHours - alreadyLogged);
                }
                subjAvailHours += dayHours;
              }
            }
            cur = CalendarService.addDays(cur, 1);
          }
        }

        const subjRemainingHours = Math.max(0, subjInScopeHours - subjCoveredHours);
        let subjBuffer = 99.99;
        let subjRisk = 'LOW_RISK';

        if (subjRemainingHours > 0.001) {
          subjBuffer = subjAvailHours / subjRemainingHours;
          if (subjBuffer >= thresholds.onTrack) {
            subjRisk = 'LOW_RISK'; // ON TRACK
          } else if (subjBuffer >= thresholds.tight) {
            subjRisk = 'MEDIUM_RISK'; // TIGHT
          } else {
            subjRisk = 'HIGH_RISK'; // DANGER
          }
        } else {
          subjRisk = 'READY'; // 100% complete
        }

        examTotalInScopeHours += subjInScopeHours;
        examCoveredHours += subjCoveredHours;
        examAvailableHours += subjAvailHours;

        subjectBreakdowns.push({
          subjectId: subj.id,
          code: subj.code,
          name: subj.name,
          inScopeHours: Number(subjInScopeHours.toFixed(2)),
          coveredHours: Number(subjCoveredHours.toFixed(2)),
          remainingHours: Number(subjRemainingHours.toFixed(2)),
          coveragePercent: subjInScopeHours > 0 ? Number(((subjCoveredHours / subjInScopeHours) * 100).toFixed(2)) : 100,
          availableHoursBeforeExam: Number(subjAvailHours.toFixed(2)),
          bufferRatio: Number(subjBuffer.toFixed(2)),
          riskStatus: subjRisk
        });
      }

      const examRemainingHours = Math.max(0, examTotalInScopeHours - examCoveredHours);
      const overallCoverage = examTotalInScopeHours > 0
        ? Number(((examCoveredHours / examTotalInScopeHours) * 100).toFixed(2))
        : 100;

      let overallBuffer = 99.99;
      let overallRisk = 'LOW_RISK';

      if (examRemainingHours > 0.001) {
        overallBuffer = examAvailableHours / examRemainingHours;
        if (overallBuffer >= thresholds.onTrack) {
          overallRisk = 'LOW_RISK';
        } else if (overallBuffer >= thresholds.tight) {
          overallRisk = 'MEDIUM_RISK';
        } else {
          overallRisk = 'HIGH_RISK';
        }
      } else {
        overallRisk = 'READY';
      }

      // Roll up to worst risk among subjects
      const worstRisk = subjectBreakdowns.some(s => s.riskStatus === 'HIGH_RISK')
        ? 'HIGH_RISK'
        : subjectBreakdowns.some(s => s.riskStatus === 'MEDIUM_RISK')
        ? 'MEDIUM_RISK'
        : overallRisk;

      results.push({
        examId: exam.id,
        examType: exam.exam_type,
        name: exam.name,
        startDate: exam.start_date,
        endDate: exam.end_date,
        weightage: exam.weightage,
        inScopeHours: Number(examTotalInScopeHours.toFixed(2)),
        coveredHours: Number(examCoveredHours.toFixed(2)),
        remainingHours: Number(examRemainingHours.toFixed(2)),
        coveragePercent: overallCoverage,
        availableHoursBeforeExam: Number(examAvailableHours.toFixed(2)),
        bufferRatio: Number(overallBuffer.toFixed(2)),
        riskStatus: worstRisk,
        subjects: subjectBreakdowns
      });
    }

    return results;
  }
}

export default ProgressionService;
