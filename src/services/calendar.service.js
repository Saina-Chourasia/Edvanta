// Calendar & Schedule Service for EDVANTA
// Handles working Saturdays, campus holidays, working day calculations, and teaching duration

export class CalendarService {
  /**
   * Parse YYYY-MM-DD string to local Date object (midnight)
   * Avoids UTC drift by parsing components explicitly.
   */
  static parseDate(dateStr) {
    if (!dateStr) return null;
    const parts = dateStr.split('-');
    if (parts.length !== 3) return new Date(dateStr);
    return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  }

  /**
   * Format Date object to YYYY-MM-DD string
   */
  static formatDate(date) {
    if (!date || isNaN(date.getTime())) return '';
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /**
   * Add N calendar days to a YYYY-MM-DD string
   */
  static addDays(dateStr, days) {
    const d = this.parseDate(dateStr);
    d.setDate(d.getDate() + days);
    return this.formatDate(d);
  }

  /**
   * Returns difference in calendar days (date2 - date1)
   */
  static diffInDays(dateStr1, dateStr2) {
    const d1 = this.parseDate(dateStr1);
    const d2 = this.parseDate(dateStr2);
    const diffTime = d2.getTime() - d1.getTime();
    return Math.round(diffTime / (1000 * 60 * 60 * 24));
  }

  /**
   * Returns Day of Week (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
   */
  static getDayOfWeek(dateStr) {
    const d = this.parseDate(dateStr);
    return d.getDay();
  }

  /**
   * Check whether a given Saturday is a working day based on rule:
   * - 'ALL': Every Saturday is a working day
   * - 'NONE': No Saturday is a working day
   * - 'SECOND_AND_FOURTH': 2nd and 4th Saturdays of the month are working days
   */
  static isWorkingSaturday(dateStr, rule = 'SECOND_AND_FOURTH') {
    const d = this.parseDate(dateStr);
    if (d.getDay() !== 6) return false;

    if (rule === 'ALL') return true;
    if (rule === 'NONE') return false;

    // SECOND_AND_FOURTH
    const dayOfMonth = d.getDate();
    const isSecondSaturday = dayOfMonth >= 8 && dayOfMonth <= 14;
    const isFourthSaturday = dayOfMonth >= 22 && dayOfMonth <= 28;

    return isSecondSaturday || isFourthSaturday;
  }

  /**
   * Check whether dateStr is a working academic day
   * @param {string} dateStr - 'YYYY-MM-DD'
   * @param {string} saturdayRule - 'ALL', 'NONE', 'SECOND_AND_FOURTH'
   * @param {Set<string>|Array<string>} holidays - Set or array of holiday YYYY-MM-DD strings
   */
  static isWorkingDay(dateStr, saturdayRule = 'SECOND_AND_FOURTH', holidays = new Set()) {
    const holidaySet = holidays instanceof Set ? holidays : new Set(holidays);
    if (holidaySet.has(dateStr)) {
      return false;
    }

    const dayOfWeek = this.getDayOfWeek(dateStr);
    if (dayOfWeek === 0) {
      // Sunday is always a non-working day
      return false;
    }

    if (dayOfWeek === 6) {
      // Saturday depends on rule
      return this.isWorkingSaturday(dateStr, saturdayRule);
    }

    // Monday through Friday are working days
    return true;
  }

  /**
   * Get all working dates between startDateStr and endDateStr (inclusive)
   */
  static getWorkingDays(startDateStr, endDateStr, saturdayRule = 'SECOND_AND_FOURTH', holidays = new Set()) {
    const workingDays = [];
    const holidaySet = holidays instanceof Set ? holidays : new Set(holidays);
    let current = startDateStr;

    while (current <= endDateStr) {
      if (this.isWorkingDay(current, saturdayRule, holidaySet)) {
        workingDays.push(current);
      }
      current = this.addDays(current, 1);
    }

    return workingDays;
  }

  /**
   * Calculate exact teaching duration in decimal hours from HH:MM strings.
   * e.g., '09:00' to '09:50' = 50 minutes = 0.8333333333333334 hours
   */
  static calculateDurationHours(startTime, endTime) {
    if (!startTime || !endTime) return 0;
    const [startH, startM] = startTime.split(':').map(Number);
    const [endH, endM] = endTime.split(':').map(Number);

    const startTotalMins = startH * 60 + startM;
    const endTotalMins = endH * 60 + endM;

    const diffMins = endTotalMins - startTotalMins;
    if (diffMins <= 0) {
      throw new Error(`End time (${endTime}) must be strictly after start time (${startTime})`);
    }

    return diffMins / 60;
  }

  /**
   * Format decimal hours nicely into hours and minutes
   * e.g., 0.8333 -> "50 min", 1.0 -> "1 hr", 1.6667 -> "1 hr 40 min", 15.8333 -> "15 hrs 50 min"
   */
  static formatDuration(decimalHours) {
    if (decimalHours === null || decimalHours === undefined || isNaN(decimalHours)) return '0 min';
    const totalMinutes = Math.round(Number(decimalHours) * 60);
    if (totalMinutes === 0) return '0 min';
    const hrs = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    if (hrs === 0) return `${mins} min`;
    if (mins === 0) return `${hrs} ${hrs === 1 ? 'hr' : 'hrs'}`;
    return `${hrs} ${hrs === 1 ? 'hr' : 'hrs'} ${mins} min`;
  }

  static formatHours(hours, decimals = 2) {
    if (hours === null || hours === undefined || isNaN(hours)) return '0.00';
    return Number(hours).toFixed(decimals);
  }
}

export default CalendarService;
