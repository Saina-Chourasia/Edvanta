// Server-side Input Validation Middleware for EDVANTA

export function validateSessionLog(req, res, next) {
  const { subject_id, session_date, status, percentage_complete } = req.body;

  if (!subject_id) {
    return res.status(400).json({ error: 'Validation failed: subject_id is required.' });
  }

  if (!session_date || !/^\d{4}-\d{2}-\d{2}$/.test(session_date)) {
    return res.status(400).json({ error: 'Validation failed: session_date must be in YYYY-MM-DD format.' });
  }

  const validStatuses = ['COMPLETED', 'IN_PROGRESS', 'SKIPPED', 'MERGED', 'CANCELLED'];
  if (!status || !validStatuses.includes(status)) {
    return res.status(400).json({
      error: `Validation failed: status must be one of: ${validStatuses.join(', ')}.`
    });
  }

  if (percentage_complete !== undefined) {
    const pct = Number(percentage_complete);
    if (isNaN(pct) || pct < 0 || pct > 100) {
      return res.status(400).json({ error: 'Validation failed: percentage_complete must be a number between 0 and 100.' });
    }
  }

  next();
}

export function validateTimetableSlot(req, res, next) {
  const { campus_id, batch_name, subject_id, weekday, start_time, end_time } = req.body;

  if (!campus_id || !batch_name || !subject_id || weekday === undefined || !start_time || !end_time) {
    return res.status(400).json({ error: 'Validation failed: All slot fields are required.' });
  }

  const dow = Number(weekday);
  if (isNaN(dow) || dow < 1 || dow > 6) {
    return res.status(400).json({ error: 'Validation failed: weekday must be an integer between 1 (Mon) and 6 (Sat).' });
  }

  const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
  if (!timeRegex.test(start_time) || !timeRegex.test(end_time)) {
    return res.status(400).json({ error: 'Validation failed: start_time and end_time must be in HH:MM (24-hour) format.' });
  }

  if (start_time >= end_time) {
    return res.status(400).json({ error: 'Validation failed: end_time must be strictly after start_time.' });
  }

  next();
}

export function validateSemester(req, res, next) {
  const { name, campus_id, track_id, batch_name, start_date, end_date, target_finish_date, working_saturday_rule } = req.body;

  if (!name || !campus_id || !track_id || !batch_name || !start_date || !end_date || !target_finish_date) {
    return res.status(400).json({ error: 'Validation failed: Missing required semester configuration fields.' });
  }

  if (start_date >= end_date) {
    return res.status(400).json({ error: 'Validation failed: end_date must be after start_date.' });
  }

  if (target_finish_date < start_date || target_finish_date > end_date) {
    return res.status(400).json({ error: 'Validation failed: target_finish_date must fall within semester dates.' });
  }

  const validRules = ['ALL', 'NONE', 'SECOND_AND_FOURTH'];
  if (working_saturday_rule && !validRules.includes(working_saturday_rule)) {
    return res.status(400).json({ error: `Validation failed: working_saturday_rule must be one of: ${validRules.join(', ')}.` });
  }

  next();
}

export default {
  validateSessionLog,
  validateTimetableSlot,
  validateSemester
};
