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

    if (!(options.body instanceof FormData) && !headers['Content-Type']) {
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

  // Auth
  async login(email, password) {
    const data = await this.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    this.setToken(data.token);
    this.setCurrentUser(data.user);
    return data;
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
  }
};

window.API = API;
