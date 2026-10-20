// EDVANTA API Client Module
// Connects frontend to the Express REST API with JWT authentication

const API = {
  baseUrl: '',

  getToken() {
    return localStorage.getItem('edvanta_token') || '';
  },

  setToken(token) {
    if (token) localStorage.setItem('edvanta_token', token);
    else localStorage.removeItem('edvanta_token');
  },

  getCurrentUser() {
    const raw = localStorage.getItem('edvanta_user');
    return raw ? JSON.parse(raw) : null;
  },

  setCurrentUser(user) {
    if (user) localStorage.setItem('edvanta_user', JSON.stringify(user));
    else localStorage.removeItem('edvanta_user');
  },

  async request(endpoint, options = {}) {
    const headers = options.headers || {};
    const token = this.getToken();

    if (token && !headers['Authorization']) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    // Only set Content-Type: application/json if there is a non-FormData body payload
    // Do not add Content-Type to GET or HEAD requests that have no body
    if (options.body && !(options.body instanceof FormData) && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    try {
      const res = await fetch(`${this.baseUrl}${endpoint}`, {
        ...options,
        headers
      });

      if (res.status === 401 && !endpoint.includes('/auth/login') && !endpoint.includes('/auth/quick-login')) {
        console.warn('Session expired or unauthorized. Re-authenticating...');
      }

      const contentType = res.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || `HTTP error ${res.status}`);
        }
        return data;
      }

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP error ${res.status}`);
      }

      return res;
    } catch (err) {
      console.error(`API Error [${endpoint}]:`, err);
      throw err;
    }
  },

  // Shared Duration-Formatting Utility (Requirement Part 6)
  formatDuration(decimalHours) {
    if (decimalHours === null || decimalHours === undefined || isNaN(decimalHours)) return '0 min';
    const totalMins = Math.round(Number(decimalHours) * 60);
    if (totalMins <= 0) return '0 min';
    const hrs = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    if (hrs === 0) return `${mins} min`;
    if (mins === 0) return `${hrs} ${hrs === 1 ? 'hr' : 'hrs'}`;
    return `${hrs} ${hrs === 1 ? 'hr' : 'hrs'} ${mins} min`;
  },

  // Auth
  async login(identifier, password) {
    const data = await this.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, password })
    });
    this.setToken(data.token);
    this.setCurrentUser(data.user);
    return data;
  },

  async changePassword(currentPassword, newPassword) {
    return this.request('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword })
    });
  },

  async createUser(userData) {
    return this.request('/api/auth/users', {
      method: 'POST',
      body: JSON.stringify(userData)
    });
  },

  async getUsers(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/api/auth/users${query ? '?' + query : ''}`);
  },

  async quickLogin(role, userId) {
    const data = await this.request('/api/auth/quick-login', {
      method: 'POST',
      body: JSON.stringify({ role, userId })
    });
    this.setToken(data.token);
    this.setCurrentUser(data.user);
    return data;
  },

  async getMe() {
    const data = await this.request('/api/auth/me');
    this.setCurrentUser(data.user);
    return data.user;
  },

  async getDemoUsers() {
    return this.request('/api/auth/demo-users');
  },

  logout() {
    this.setToken(null);
    this.setCurrentUser(null);
  },

  // Metadata
  async getCampuses() {
    return this.request('/api/campuses');
  },

  async getTracks() {
    return this.request('/api/tracks');
  },

  async getSemesters(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/api/semesters${query ? '?' + query : ''}`);
  },

  // Dashboard & Progression
  async getDashboard(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/api/dashboard/overview${query ? '?' + query : ''}`);
  },

  // Student Portal Progression (Requirement 5 & 13)
  async getStudentProgress() {
    const user = this.getCurrentUser();
    const batchName = (user && user.batch_name) ? user.batch_name : '';
    const res = await this.getDashboard({ batch_name: batchName });
    const subjects = (res.subjects || []).map(s => ({
      id: s.id || s.subjectId,
      subjectId: s.subjectId || s.id,
      code: s.code,
      name: s.name,
      faculty_name: s.faculty_name || s.facultyName || 'Assigned Faculty',
      progressPercentage: s.coveragePercent !== undefined ? s.coveragePercent : (s.progressPercentage || 0),
      coveragePercent: s.coveragePercent !== undefined ? s.coveragePercent : (s.progressPercentage || 0),
      coveredHours: s.coveredHours || 0,
      total_hours: s.hoursInScope !== undefined ? s.hoursInScope : (s.total_hours || 0),
      hoursInScope: s.hoursInScope !== undefined ? s.hoursInScope : (s.total_hours || 0),
      remainingHours: s.remainingHours || 0,
      availableHours: s.availableHours || 0,
      bufferRatio: s.bufferRatio || 0,
      status: s.status || 'ON TRACK',
      overdueTopicsCount: s.overdueTopicsCount || 0
    }));
    return { ...res, subjects };
  },

  // Sessions
  async getTodaySessions(date = null) {
    const query = date ? `?date=${date}` : '';
    return this.request(`/api/sessions/today${query}`);
  },

  async getSessionHistory(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/api/sessions/history${query ? '?' + query : ''}`);
  },

  async logSession(payload) {
    return this.request('/api/sessions/log', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  // Exam Readiness
  async getExamReadiness(semesterId = null, subjectId = null) {
    const params = new URLSearchParams();
    if (semesterId) params.append('semester_id', semesterId);
    if (subjectId) params.append('subject_id', subjectId);
    const query = params.toString();
    return this.request(`/api/exams/readiness${query ? '?' + query : ''}`);
  },

  // Timetable
  async getTimetable(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/api/timetable${query ? '?' + query : ''}`);
  },

  async addTimetableSlot(payload) {
    return this.request('/api/timetable', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  async deleteTimetableSlot(id) {
    return this.request(`/api/timetable/${id}`, { method: 'DELETE' });
  },

  // Syllabus
  async getSubjects(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/api/syllabus/subjects${query ? '?' + query : ''}`);
  },

  async getSubjectTopics(subjectId) {
    return this.request(`/api/syllabus/subjects/${subjectId}/topics`);
  },

  async updateTopic(topicId, data) {
    return this.request(`/api/syllabus/topics/${topicId}`, {
      method: 'PATCH',
      body: JSON.stringify(data)
    });
  },

  async recalculateSubject(subjectId) {
    return this.request(`/api/syllabus/subjects/${subjectId}/recalculate`, {
      method: 'POST'
    });
  },

  // Calendar
  async getSemesterCalendar(semesterId) {
    return this.request(`/api/semesters/${semesterId}/calendar`);
  },

  async addCalendarEvent(semesterId, payload) {
    return this.request(`/api/semesters/${semesterId}/calendar`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  async deleteCalendarEvent(semesterId, eventId) {
    return this.request(`/api/semesters/${semesterId}/calendar/${eventId}`, {
      method: 'DELETE'
    });
  },

  // Alerts
  async getAlerts() {
    return this.request('/api/alerts');
  },

  async markAlertRead(alertId) {
    return this.request(`/api/alerts/${alertId}/read`, { method: 'POST' });
  },

  async simulateDate(dateStr) {
    return this.request('/api/alerts/simulate', {
      method: 'POST',
      body: JSON.stringify({ date: dateStr })
    });
  },

  async resetSimulation() {
    return this.request('/api/alerts/reset-simulation', { method: 'POST' });
  },

  // CSV Imports
  async importCSV(type, csvTextOrFormData) {
    if (csvTextOrFormData instanceof FormData) {
      return this.request(`/api/imports/${type}`, {
        method: 'POST',
        body: csvTextOrFormData
      });
    } else {
      return this.request(`/api/imports/${type}`, {
        method: 'POST',
        body: JSON.stringify({ csvText: csvTextOrFormData })
      });
    }
  },

  // Attendance Management (Requirement 11)
  async getActiveAttendanceSessions() {
    return this.request('/api/attendance/sessions/active');
  },

  async startAttendanceSession(data) {
    return this.request('/api/attendance/sessions/start', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  async closeAttendanceSession(sessionId) {
    return this.request(`/api/attendance/sessions/${sessionId}/close`, {
      method: 'POST'
    });
  },

  async submitAttendance(sessionId) {
    return this.request('/api/attendance/submit', {
      method: 'POST',
      body: JSON.stringify({ attendance_session_id: sessionId })
    });
  },

  async getAttendanceRecords(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/api/attendance/records${query ? '?' + query : ''}`);
  },

  async updateAttendanceRecord(id, data) {
    return this.request(`/api/attendance/records/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  }
};

window.API = API;
window.formatDuration = (hrs) => API.formatDuration(hrs);
