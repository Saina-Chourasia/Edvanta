// EDVANTA Client Application Controller
// Modernized Role-Based Portals (Admin, Faculty, Student) with Landing Page, Left Sidebar, and Real Attendance Management

document.addEventListener('DOMContentLoaded', async () => {
  const App = {
    user: null,
    campuses: [],
    tracks: [],
    semesters: [],
    activeTab: 'dashboard',
    selectedLoginPortal: 'FACULTY',
    activeFilters: {
      campus_id: '',
      track_id: '',
      semester_id: '',
      as_of_date: ''
    },
    dashboardData: null,
    todaySessionsData: null,
    currentActiveAttendanceSessionId: null,
    stopwatchInterval: null,
    stopwatchSeconds: 0,
    sidebarCollapsed: false,
    charts: {
      hours: null,
      status: null
    },

    // -------------------------------------------------------------
    // INITIALIZATION & PUBLIC LANDING PAGE (Section 2)
    // -------------------------------------------------------------
    async init() {
      console.log('🚀 Initializing EDVANTA MSOT Educational Platform...');
      this.bindEvents();

      const token = API.getToken();
      if (token) {
        try {
          this.user = await API.getMe();
          await this.onLoginSuccess();
        } catch (e) {
          console.warn('Session token expired or invalid:', e.message);
          API.logout();
          this.showLandingPage();
        }
      } else {
        // Requirement 2: Show Landing Page first when opening website
        this.showLandingPage();
      }
    },

    // Show Public Landing Page
    showLandingPage(event) {
      if (event) event.preventDefault();

      const landing = document.getElementById('landingView');
      const login = document.getElementById('loginView');
      const shell = document.getElementById('appShell');
      const publicNav = document.getElementById('publicTopNav');

      if (landing) landing.style.display = 'flex';
      if (login) login.style.display = 'none';
      if (shell) shell.style.display = 'none';
      if (publicNav) publicNav.style.display = 'block';

      window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    // Show 3-Portal Login Page (Section 4)
    showLoginView(noticeMessage, targetPortal = 'FACULTY') {
      const landing = document.getElementById('landingView');
      const login = document.getElementById('loginView');
      const shell = document.getElementById('appShell');
      const publicNav = document.getElementById('publicTopNav');

      if (landing) landing.style.display = 'none';
      if (login) login.style.display = 'flex';
      if (shell) shell.style.display = 'none';
      if (publicNav) publicNav.style.display = 'block';

      this.selectLoginPortal(targetPortal);

      const noticeBanner = document.getElementById('loginNoticeBanner');
      const noticeMsg = document.getElementById('loginNoticeMessage');
      if (noticeBanner) {
        if (noticeMessage) {
          if (noticeMsg) noticeMsg.textContent = noticeMessage;
          noticeBanner.style.display = 'flex';
        } else {
          noticeBanner.style.display = 'none';
        }
      }

      const errBanner = document.getElementById('loginErrorBanner');
      if (errBanner) errBanner.style.display = 'none';

      window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    // Select Active Portal on Login View (Section 4)
    selectLoginPortal(role) {
      this.selectedLoginPortal = role;

      const adminCard = document.getElementById('portalCardAdmin');
      const facCard = document.getElementById('portalCardFaculty');
      const stuCard = document.getElementById('portalCardStudent');

      if (adminCard) adminCard.classList.toggle('selected', role === 'ADMIN');
      if (facCard) facCard.classList.toggle('selected', role === 'FACULTY');
      if (stuCard) stuCard.classList.toggle('selected', role === 'STUDENT');

      const heading = document.getElementById('loginPortalHeading');
      const subtitle = document.getElementById('loginPortalSubtitle');
      const submitBtn = document.getElementById('btnLoginSubmit');

      if (role === 'ADMIN') {
        if (heading) heading.textContent = 'Sign In to Admin Portal';
        if (subtitle) subtitle.textContent = 'Dean & Campus Administrator Authentication';
        if (submitBtn) submitBtn.textContent = 'Sign In to Admin Portal →';
      } else if (role === 'FACULTY') {
        if (heading) heading.textContent = 'Sign In to Faculty Portal';
        if (subtitle) subtitle.textContent = 'Professor & Instructor Course Progression';
        if (submitBtn) submitBtn.textContent = 'Sign In to Faculty Portal →';
      } else if (role === 'STUDENT') {
        if (heading) heading.textContent = 'Sign In to Student Portal';
        if (subtitle) subtitle.textContent = 'Enrolled Student Class Timetable & Attendance';
        if (submitBtn) submitBtn.textContent = 'Sign In to Student Portal →';
      }

      const input = document.getElementById('loginIdentifier');
      if (input) input.focus();
    },

    // 1-Click Feature Card Navigation on Landing Page (Section 3)
    handleFeatureCardClick(feature) {
      if (this.user) {
        this.switchTab(feature);
      } else {
        const featureNames = {
          curriculum: 'Academic Progression',
          calendar: 'Timetable',
          attendance: 'Attendance Management',
          dashboard: 'Reports & Insights'
        };
        const name = featureNames[feature] || 'academic features';
        const roleTarget = feature === 'dashboard' ? 'ADMIN' : (feature === 'attendance' ? 'FACULTY' : 'STUDENT');
        this.showLoginView(`Please sign in to access ${name}.`, roleTarget);
      }
    },

    // Evaluator Quick-Fill Accounts Reference (Section 4 - Exactly 3 Entries)
    fillDemoLogin(identifier, password, portalRole = 'FACULTY') {
      this.selectLoginPortal(portalRole);
      const idInput = document.getElementById('loginIdentifier');
      const passInput = document.getElementById('loginPassword');
      if (idInput) idInput.value = identifier;
      if (passInput) passInput.value = password;
      this.handleLogin();
    },

    // -------------------------------------------------------------
    // AUTHENTICATED APP SHELL & LEFT SIDEBAR (Section 6)
    // -------------------------------------------------------------
    async onLoginSuccess() {
      if (!this.user) return;

      // Hide public pages, show App Shell
      const landing = document.getElementById('landingView');
      const login = document.getElementById('loginView');
      const shell = document.getElementById('appShell');
      const publicNav = document.getElementById('publicTopNav');

      if (landing) landing.style.display = 'none';
      if (login) login.style.display = 'none';
      if (publicNav) publicNav.style.display = 'none';
      if (shell) shell.style.display = 'flex';

      // Update Header & Sidebar UI
      this.updateHeaderUI();

      // Render role-specific navigation tabs in sidebar
      this.renderNavTabsForRole();

      // Load metadata (Campuses, Tracks, Semesters)
      await this.loadInitialMetadata();

      // Select default tab for user's role
      let defaultTab = 'dashboard';
      if (this.user.role === 'FACULTY') {
        defaultTab = 'logger';
      } else if (this.user.role === 'STUDENT') {
        defaultTab = 'student';
      }

      this.switchTab(defaultTab);
      this.startAlertsPolling();
    },

    updateHeaderUI() {
      if (!this.user) return;

      const portalBadge = document.getElementById('portalRoleBadge');
      const topbarPill = document.getElementById('currentPortalNamePill');

      let portalLabel = '👑 ADMIN PORTAL';
      if (this.user.role === 'FACULTY') portalLabel = '👨‍🏫 FACULTY PORTAL';
      if (this.user.role === 'STUDENT') portalLabel = '🎓 STUDENT PORTAL';

      if (portalBadge) {
        portalBadge.className = `portal-badge ${this.user.role}`;
        portalBadge.textContent = portalLabel;
      }
      if (topbarPill) {
        topbarPill.textContent = portalLabel;
      }

      const nameDisplay = document.getElementById('userDisplayName');
      if (nameDisplay) nameDisplay.textContent = this.user.name;

      const campusDisplay = document.getElementById('userCampusDisplay');
      if (campusDisplay) {
        campusDisplay.textContent = this.user.campus_name || (this.user.role === 'ADMIN' ? 'All Campuses' : 'Campus');
      }

      const avatarCircle = document.getElementById('userAvatarCircle');
      if (avatarCircle) {
        avatarCircle.textContent = (this.user.name || 'U').charAt(0).toUpperCase();
      }

      // Hide simulation date pill for students
      const simPill = document.getElementById('simDatePillWrapper');
      if (simPill) {
        simPill.style.display = this.user.role === 'STUDENT' ? 'none' : 'flex';
      }
    },

    // Render Left Sidebar Navigation Links (Section 5 & 6)
    renderNavTabsForRole() {
      const container = document.getElementById('sidebarNavContainer');
      if (!container || !this.user) return;

      let tabs = [];
      if (this.user.role === 'ADMIN' || this.user.role === 'CAMPUS_MANAGER') {
        tabs = [
          { id: 'dashboard', icon: '📊', label: 'Dashboard & Pacing' },
          { id: 'attendance', icon: '⏱️', label: 'Attendance Management' },
          { id: 'curriculum', icon: '📚', label: '7 Subjects Curriculum' },
          { id: 'calendar', icon: '📅', label: 'Master Timetable' },
          { id: 'users', icon: '👥', label: 'User Accounts' },
          { id: 'alerts', icon: '🚨', label: 'Alerts & Escalations' },
          { id: 'imports', icon: '📁', label: 'CSV Import & Export' }
        ];
      } else if (this.user.role === 'FACULTY') {
        tabs = [
          { id: 'logger', icon: '⚡', label: 'Fast Session Logger' },
          { id: 'attendance', icon: '⏱️', label: 'Class Attendance' },
          { id: 'calendar', icon: '📅', label: 'My Teaching Schedule' },
          { id: 'curriculum', icon: '📚', label: 'My Subjects & Topics' },
          { id: 'history', icon: '🕒', label: 'Session History' },
          { id: 'alerts', icon: '🔔', label: 'Teaching Reminders' }
        ];
      } else if (this.user.role === 'STUDENT') {
        tabs = [
          { id: 'student', icon: '🎓', label: 'My Enrolled Subjects' },
          { id: 'attendance', icon: '⏱️', label: 'My Attendance' },
          { id: 'calendar', icon: '📅', label: 'My Class Timetable' },
          { id: 'exams', icon: '🎯', label: 'Exam Readiness & Dates' }
        ];
      }

      container.innerHTML = tabs.map(t => `
        <button type="button" class="sidebar-nav-item ${t.id === this.activeTab ? 'active' : ''}" data-tab="${t.id}" onclick="App.switchTab('${t.id}')">
          <span class="nav-icon">${t.icon}</span>
          <span>${t.label}</span>
        </button>
      `).join('');
    },

    toggleSidebarDesktop() {
      const sidebar = document.getElementById('appSidebar');
      if (sidebar) {
        this.sidebarCollapsed = !this.sidebarCollapsed;
        sidebar.classList.toggle('collapsed', this.sidebarCollapsed);
      }
    },

    toggleSidebarMobile(open) {
      const sidebar = document.getElementById('appSidebar');
      const backdrop = document.getElementById('mobileNavBackdrop');
      if (sidebar) sidebar.classList.toggle('mobile-open', open);
      if (backdrop) backdrop.classList.toggle('show', open);
    },

    bindEvents() {
      // Filter Inputs
      ['campusFilter', 'trackFilter', 'semesterFilter'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
          el.addEventListener('change', () => {
            this.activeFilters.campus_id = document.getElementById('campusFilter').value;
            this.activeFilters.track_id = document.getElementById('trackFilter').value;
            this.activeFilters.semester_id = document.getElementById('semesterFilter').value;
            this.loadDashboard();
          });
        }
      });

      // Reset Simulation Button
      const resetSimBtn = document.getElementById('btnResetSim');
      if (resetSimBtn) {
        resetSimBtn.addEventListener('click', async () => {
          await API.resetSimulation();
          this.showToast('Simulation date reset to system clock', 'success');
          await this.refreshActiveTab();
        });
      }

      // Advance 2 Days Button
      const adv2Btn = document.getElementById('btnAdvance2Days');
      if (adv2Btn) {
        adv2Btn.addEventListener('click', async () => {
          const current = this.dashboardData ? this.dashboardData.asOfDate : '2026-10-19';
          const parts = current.split('-').map(Number);
          const d = new Date(parts[0], parts[1] - 1, parts[2] + 2);
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          const nextDate = `${y}-${m}-${day}`;

          await API.simulateDate(nextDate);
          this.showToast(`Simulation advanced to ${nextDate}. Checked missed logs!`, 'info');
          await this.refreshActiveTab();
        });
      }
    },

    handleBrandClick(event) {
      if (event) event.preventDefault();
      if (!this.user) {
        this.showLandingPage();
      } else if (this.user.role === 'STUDENT') {
        this.switchTab('student');
      } else if (this.user.role === 'FACULTY') {
        this.switchTab('logger');
      } else {
        this.switchTab('dashboard');
      }
    },

    // -------------------------------------------------------------
    // AUTH ACTIONS (Section 4 & 13)
    // -------------------------------------------------------------
    async handleLogin() {
      const idInput = document.getElementById('loginIdentifier');
      const passInput = document.getElementById('loginPassword');
      const errBanner = document.getElementById('loginErrorBanner');
      const errMsg = document.getElementById('loginErrorMessage');

      const identifier = idInput ? idInput.value.trim() : '';
      const password = passInput ? passInput.value : '';

      if (!identifier || !password) {
        if (errBanner) {
          errBanner.style.display = 'flex';
          if (errMsg) errMsg.textContent = 'Please enter both your registered email or phone and password.';
        }
        return;
      }

      const submitBtn = document.getElementById('btnLoginSubmit');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Authenticating...';
      }

      try {
        const data = await API.login(identifier, password);
        this.user = data.user;
        if (errBanner) errBanner.style.display = 'none';
        this.showToast(`Welcome back, ${this.user.name}!`, 'success');
        await this.onLoginSuccess();
      } catch (err) {
        if (errBanner) {
          errBanner.style.display = 'flex';
          if (errMsg) errMsg.textContent = err.message || 'Invalid email/phone or password.';
        }
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Sign In to Portal →';
        }
      }
    },

    handleLogout() {
      API.logout();
      this.user = null;
      this.showToast('You have been signed out successfully.', 'info');
      this.showLandingPage();
    },

    togglePasswordVisibility(inputId) {
      const input = document.getElementById(inputId);
      if (input) {
        input.type = input.type === 'password' ? 'text' : 'password';
      }
    },

    openChangePasswordModal() {
      const modal = document.getElementById('changePasswordModal');
      const err = document.getElementById('changePasswordError');
      if (err) err.style.display = 'none';
      if (modal) modal.style.display = 'flex';
    },

    async submitChangePassword() {
      const curPass = document.getElementById('currentPassword').value;
      const newPass = document.getElementById('newPassword').value;
      const confPass = document.getElementById('confirmPassword').value;
      const errBanner = document.getElementById('changePasswordError');
      const errMsg = document.getElementById('changePasswordErrorMsg');

      if (newPass !== confPass) {
        if (errBanner) {
          errBanner.style.display = 'flex';
          errMsg.textContent = 'New passwords do not match.';
        }
        return;
      }

      if (newPass.length < 6) {
        if (errBanner) {
          errBanner.style.display = 'flex';
          errMsg.textContent = 'Password must be at least 6 characters.';
        }
        return;
      }

      try {
        await API.changePassword(curPass, newPass);
        this.closeModal('changePasswordModal');
        this.showToast('Password changed successfully!', 'success');
      } catch (err) {
        if (errBanner) {
          errBanner.style.display = 'flex';
          errMsg.textContent = err.message;
        }
      }
    },

    // -------------------------------------------------------------
    // NAVIGATION & TAB SWITCHING (Section 6)
    // -------------------------------------------------------------
    switchTab(tabId) {
      if (!this.user) {
        this.showLoginView('Please sign in to access your portal dashboard.');
        return;
      }

      // Close mobile drawer if open
      this.toggleSidebarMobile(false);

      // Section 13: Role-based navigation guards
      const adminTabs = ['dashboard', 'attendance', 'curriculum', 'calendar', 'users', 'alerts', 'imports'];
      const facultyTabs = ['logger', 'attendance', 'calendar', 'curriculum', 'history', 'alerts'];
      const studentTabs = ['student', 'attendance', 'calendar', 'exams'];

      const role = this.user.role;
      let isAllowed = false;
      if (role === 'ADMIN' || role === 'CAMPUS_MANAGER') {
        isAllowed = adminTabs.includes(tabId);
      } else if (role === 'FACULTY') {
        isAllowed = facultyTabs.includes(tabId);
      } else if (role === 'STUDENT') {
        isAllowed = studentTabs.includes(tabId);
      }

      if (!isAllowed) {
        this.showToast('Access restricted: You do not have permission to view this section.', 'warning');
        const fallbackTab = role === 'STUDENT' ? 'student' : (role === 'FACULTY' ? 'logger' : 'dashboard');
        tabId = fallbackTab;
      }

      this.activeTab = tabId;

      document.querySelectorAll('.sidebar-nav-item').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === tabId);
      });

      document.querySelectorAll('.tab-view-content').forEach(view => {
        view.style.display = view.id === `view-${tabId}` ? 'block' : 'none';
      });

      this.refreshActiveTab();
    },

    async refreshActiveTab() {
      if (!this.user) return;

      if (this.activeTab === 'dashboard') {
        await this.loadDashboard();
      } else if (this.activeTab === 'attendance') {
        await this.loadAttendanceView();
      } else if (this.activeTab === 'curriculum') {
        await this.loadCurriculumView();
      } else if (this.activeTab === 'users') {
        await this.loadUsersView();
      } else if (this.activeTab === 'logger') {
        await this.loadTodayLogger();
      } else if (this.activeTab === 'exams') {
        await this.loadExamReadiness();
      } else if (this.activeTab === 'student') {
        await this.loadStudentView();
      } else if (this.activeTab === 'calendar') {
        await this.loadCalendarAndTimetable();
      } else if (this.activeTab === 'history') {
        await this.loadSessionHistory();
      } else if (this.activeTab === 'alerts') {
        await this.loadAlertsView();
      } else if (this.activeTab === 'imports') {
        await this.loadImportsView();
      }

      this.checkAlertsBadge();
    },

    async checkAlertsBadge() {
      try {
        const data = await API.getAlerts();
        const badge = document.getElementById('alertsBadge');
        if (badge) {
          if (data.unreadCount > 0) {
            badge.style.display = 'flex';
            badge.textContent = data.unreadCount;
          } else {
            badge.style.display = 'none';
          }
        }
        const simPill = document.getElementById('activeSimDateDisplay');
        if (simPill) {
          simPill.textContent = data.activeSimulationDate || 'Today';
        }
      } catch (e) {}
    },

    startAlertsPolling() {
      this.checkAlertsBadge();
      setInterval(() => {
        if (this.user) this.checkAlertsBadge();
      }, 45000);
    },

    // -------------------------------------------------------------
    // METADATA & CAMPUS FILTERS (Section 12 - 3 Campuses)
    // -------------------------------------------------------------
    async loadInitialMetadata() {
      try {
        const [cData, tData, sData] = await Promise.all([
          API.getCampuses(),
          API.getTracks(),
          API.getSemesters()
        ]);

        this.campuses = cData.campuses || [];
        this.tracks = tData.tracks || [];
        this.semesters = sData.semesters || [];

        this.populateFilterDropdowns();
      } catch (err) {
        console.error('Metadata load error:', err);
      }
    },

    populateFilterDropdowns() {
      // Requirement 12: Strictly 3 campuses (HI-Tech, Jagannath, Rathinam)
      const activeCampusIds = ['camp_hitech', 'camp_juj', 'camp_ratnam'];
      const filteredCampuses = this.campuses.filter(c => activeCampusIds.includes(c.id));
      const displayCampuses = filteredCampuses.length > 0 ? filteredCampuses : this.campuses;

      const campSelect = document.getElementById('campusFilter');
      if (campSelect) {
        if (this.user && this.user.role === 'CAMPUS_MANAGER' && this.user.campus_id) {
          const userCamp = displayCampuses.find(c => c.id === this.user.campus_id) || { id: this.user.campus_id, name: this.user.campus_name || 'Assigned Campus' };
          campSelect.innerHTML = `<option value="${userCamp.id}" selected>${userCamp.name}</option>`;
          campSelect.disabled = true;
          this.activeFilters.campus_id = userCamp.id;
        } else {
          campSelect.disabled = false;
          campSelect.innerHTML = `<option value="">All Campuses (${displayCampuses.length})</option>` +
            displayCampuses.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
        }
      }

      const trackSelect = document.getElementById('trackFilter');
      if (trackSelect) {
        trackSelect.innerHTML = '<option value="">All Academic Tracks</option>' +
          this.tracks.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
      }

      const semSelect = document.getElementById('semesterFilter');
      if (semSelect) {
        semSelect.innerHTML = '<option value="">All Active Semesters</option>' +
          this.semesters.map(s => `<option value="${s.id}">${s.name} (${s.batch_name})</option>`).join('');
      }
    },

    // -------------------------------------------------------------
    // SECTION 11: ATTENDANCE MANAGEMENT CONTROLLER
    // -------------------------------------------------------------
    async loadAttendanceView() {
      if (!this.user) return;
      const role = this.user.role;

      // Render header actions based on role
      const headerActions = document.getElementById('attendanceHeaderActions');
      if (headerActions) {
        if (role === 'FACULTY' || role === 'ADMIN' || role === 'CAMPUS_MANAGER') {
          headerActions.innerHTML = `
            <button type="button" class="btn-primary" onclick="App.openStartAttendanceModal()">
              ⏱️ + Initiate Class Attendance Session
            </button>
          `;
        } else {
          headerActions.innerHTML = '';
        }
      }

      try {
        const res = await API.getAttendanceRecords();
        const records = res.records || [];
        const summary = res.summary || {};

        // Update KPI summary cards
        const totalEl = document.getElementById('attSummaryTotal');
        const presentEl = document.getElementById('attSummaryPresent');
        const absentEl = document.getElementById('attSummaryAbsent');
        const rateEl = document.getElementById('attSummaryRate');

        const totalVal = summary.totalSessions !== undefined ? summary.totalSessions : records.length;
        const presVal = summary.presentCount !== undefined ? summary.presentCount : records.filter(r => r.status === 'PRESENT').length;
        const absVal = summary.absentCount !== undefined ? summary.absentCount : (totalVal - presVal);
        const rateVal = totalVal > 0 ? Math.round((presVal / totalVal) * 100) : 100;

        if (totalEl) totalEl.textContent = totalVal;
        if (presentEl) presentEl.textContent = presVal;
        if (absentEl) absentEl.textContent = absVal;
        if (rateEl) rateEl.textContent = `${rateVal}%`;

        // Check active attendance session
        const activeRes = await API.getActiveAttendanceSessions();
        const activeSessions = activeRes.activeSessions || [];

        // Student active session card
        const studentCard = document.getElementById('studentActiveAttendanceCard');
        if (studentCard) {
          if (role === 'STUDENT' && activeSessions.length > 0) {
            const activeSess = activeSessions[0];
            this.currentActiveAttendanceSessionId = activeSess.id;
            const titleEl = document.getElementById('activeAttSubjectTitle');
            const descEl = document.getElementById('activeAttFacultyInfo');
            if (titleEl) titleEl.textContent = `🔴 Active Attendance: ${activeSess.subject_name} (${activeSess.subject_code})`;
            if (descEl) descEl.textContent = `Conducted by ${activeSess.faculty_name} for ${activeSess.batch_name}. Click below to verify your presence.`;

            const submitBtn = document.getElementById('btnSubmitStudentAttendance');
            if (submitBtn) {
              if (activeSess.hasSubmitted) {
                submitBtn.textContent = '✅ Present Recorded';
                submitBtn.disabled = true;
                submitBtn.className = 'btn-secondary';
              } else {
                submitBtn.textContent = '✅ Mark Present Now';
                submitBtn.disabled = false;
                submitBtn.className = 'btn-primary';
              }
            }
            studentCard.style.display = 'flex';
          } else {
            studentCard.style.display = 'none';
          }
        }

        // Faculty active session card
        const facCard = document.getElementById('facultyActiveSessionCard');
        if (facCard) {
          if ((role === 'FACULTY' || role === 'ADMIN' || role === 'CAMPUS_MANAGER') && activeSessions.length > 0) {
            const activeSess = activeSessions[0];
            this.currentActiveAttendanceSessionId = activeSess.id;
            const titleEl = document.getElementById('facActiveSessionTitle');
            const descEl = document.getElementById('facActiveSessionDesc');
            if (titleEl) titleEl.textContent = `Active Attendance: ${activeSess.subject_name} (${activeSess.batch_name})`;
            if (descEl) descEl.textContent = `Date: ${activeSess.session_date} • Submitted Students: ${activeSess.present_count || 0}`;
            facCard.style.display = 'block';
          } else {
            facCard.style.display = 'none';
          }
        }

        // Render attendance table
        this.renderAttendanceTable(records);
      } catch (err) {
        console.error('Failed to load attendance view:', err);
      }
    },

    renderAttendanceTable(records) {
      const tbody = document.getElementById('attendanceTableBody');
      if (!tbody) return;

      const attHeading = document.getElementById('attendanceTableHeading');
      if (attHeading && this.user) {
        attHeading.textContent = this.user.role === 'STUDENT' ? 'My Class Attendance Log' : 'Attendance Records Log';
      }

      if (!records || records.length === 0) {
        const isStudent = this.user && this.user.role === 'STUDENT';
        const msg = isStudent
          ? 'No attendance records logged yet for your profile. When your instructor initiates an attendance session, an active session card will appear at the top to record your presence.'
          : 'No attendance records found for the selected campus or filters.';
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2.5rem; color: var(--text-secondary); line-height: 1.5;">${msg}</td></tr>`;
        return;
      }

      const isPrivileged = this.user.role === 'ADMIN' || this.user.role === 'CAMPUS_MANAGER' || this.user.role === 'FACULTY';

      tbody.innerHTML = records.map(r => {
        const studentInfo = r.student_name ? `${r.student_name} (${r.batch_name || 'Class'})` : (r.batch_name || 'Class');
        const statusClass = r.status === 'PRESENT' ? 'ontrack' : (r.status === 'EXCUSED' ? 'tight' : 'danger');

        return `
          <tr>
            <td><strong>${r.session_date}</strong></td>
            <td>
              <div style="font-weight: 700; color: var(--heading-deep-blue);">${r.subject_code}</div>
              <div style="font-size: 0.78rem; color: var(--text-secondary);">${r.subject_name}</div>
            </td>
            <td>${studentInfo}</td>
            <td>
              <span class="status-pill ${statusClass}">${r.status}</span>
            </td>
            <td><span style="font-size: 0.8rem; color: var(--text-secondary);">${r.marked_by}</span></td>
            <td style="font-family: 'JetBrains Mono', monospace; font-size: 0.75rem; color: var(--text-muted);">
              ${r.created_at ? r.created_at.split(' ')[1] || r.created_at : '—'}
            </td>
            <td>
              ${isPrivileged ? `
                <button type="button" class="btn-secondary" style="font-size: 0.72rem; padding: 0.2rem 0.5rem;" onclick="App.openEditAttendanceModal('${r.id}', '${r.student_name || 'Student'}', '${r.status}', '${(r.notes || '').replace(/'/g, "\\'")}')">
                  ✏️ Correct
                </button>
              ` : `
                <span style="font-size: 0.75rem; color: var(--text-muted);">Verified</span>
              `}
            </td>
          </tr>
        `;
      }).join('');
    },

    async openStartAttendanceModal() {
      const modal = document.getElementById('startAttendanceModal');
      const subjSelect = document.getElementById('attModalSubject');
      if (subjSelect) {
        try {
          const data = await API.getSubjects();
          const subjects = data.subjects || [];
          subjSelect.innerHTML = subjects.map(s => `<option value="${s.id}">${s.code} - ${s.name} (${s.batch_name})</option>`).join('');
          if (subjects[0]) {
            const batchInput = document.getElementById('attModalBatch');
            if (batchInput) batchInput.value = subjects[0].batch_name || 'Batch-2026-Mirai-A';
          }
        } catch (e) {}
      }
      if (modal) modal.style.display = 'flex';
    },

    async submitStartAttendance() {
      const subjectId = document.getElementById('attModalSubject').value;
      const batchName = document.getElementById('attModalBatch').value;
      const campusId = document.getElementById('attModalCampus').value;

      try {
        await API.startAttendanceSession({
          subject_id: subjectId,
          batch_name: batchName,
          campus_id: campusId
        });
        this.closeModal('startAttendanceModal');
        this.showToast('Attendance session initiated! Students can now submit check-in.', 'success');
        await this.loadAttendanceView();
      } catch (err) {
        this.showToast(`Failed to initiate attendance: ${err.message}`, 'error');
      }
    },

    async submitCurrentAttendance() {
      if (!this.currentActiveAttendanceSessionId) return;
      const submitBtn = document.getElementById('btnSubmitStudentAttendance');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting...';
      }

      try {
        await API.submitAttendance(this.currentActiveAttendanceSessionId);
        this.showToast('✅ Attendance recorded successfully! You are marked PRESENT.', 'success');
        await this.loadAttendanceView();
      } catch (err) {
        this.showToast(`Error: ${err.message}`, 'error');
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = '✅ Mark Present Now';
        }
      }
    },

    async closeCurrentAttendanceSession() {
      if (!this.currentActiveAttendanceSessionId) return;
      try {
        await API.closeAttendanceSession(this.currentActiveAttendanceSessionId);
        this.showToast('Attendance session ended and closed.', 'info');
        this.currentActiveAttendanceSessionId = null;
        await this.loadAttendanceView();
      } catch (err) {
        this.showToast(`Failed to close session: ${err.message}`, 'error');
      }
    },

    openEditAttendanceModal(id, studentName, status, notes) {
      document.getElementById('editAttRecordId').value = id;
      document.getElementById('editAttStudentName').value = studentName;
      document.getElementById('editAttStatus').value = status;
      document.getElementById('editAttNotes').value = notes || '';
      const modal = document.getElementById('editAttendanceModal');
      if (modal) modal.style.display = 'flex';
    },

    async submitEditAttendance() {
      const id = document.getElementById('editAttRecordId').value;
      const status = document.getElementById('editAttStatus').value;
      const notes = document.getElementById('editAttNotes').value;

      try {
        await API.updateAttendanceRecord(id, { status, notes });
        this.closeModal('editAttendanceModal');
        this.showToast('Attendance record corrected and audited.', 'success');
        await this.loadAttendanceView();
      } catch (err) {
        this.showToast(`Error: ${err.message}`, 'error');
      }
    },

    // -------------------------------------------------------------
    // TAB 1: EXECUTIVE DASHBOARD (Section 5 Admin)
    // -------------------------------------------------------------
    async loadDashboard() {
      const container = document.getElementById('dashboardSubjectsTableBody');
      if (container) container.innerHTML = '<tr><td colspan="10" style="text-align:center; padding: 2rem;">Loading curriculum analytics...</td></tr>';

      try {
        const data = await API.getDashboard(this.activeFilters);
        this.dashboardData = data;
        this.renderDashboardBanner(data.summary);
        this.renderDashboardKPIs(data.summary);
        this.renderDashboardCharts(data.subjects, data.summary);
        this.renderDashboardTable(data.subjects);
      } catch (err) {
        if (container) container.innerHTML = `<tr><td colspan="10" style="text-align:center; color: var(--status-red-text); padding: 2rem;">Failed to load dashboard: ${err.message}</td></tr>`;
      }
    },

    renderDashboardBanner(summary) {
      const banner = document.getElementById('rolledUpBanner');
      if (!banner) return;

      banner.className = `track-status-banner ${summary.rolledUpTrackStatus.replace(' ', '_')}`;
      
      const badge = document.getElementById('bannerBadge');
      const title = document.getElementById('bannerTitle');
      const desc = document.getElementById('bannerDesc');

      if (badge) {
        badge.textContent = summary.rolledUpTrackStatus;
        badge.className = `banner-badge ${
          summary.rolledUpTrackStatus === 'DANGER' ? 'badge-danger' :
          summary.rolledUpTrackStatus === 'TIGHT' ? 'badge-tight' :
          summary.rolledUpTrackStatus === 'ON TRACK' ? 'badge-ontrack' : 'badge-complete'
        }`;
      }

      if (title && desc) {
        if (summary.rolledUpTrackStatus === 'DANGER') {
          title.textContent = 'Critical Alert: Track Status is in DANGER';
          desc.textContent = `At least one subject (${summary.worstSubject ? summary.worstSubject.name : 'Unknown'}) has Buffer Ratio < 1.00. Immediate intervention required.`;
        } else if (summary.rolledUpTrackStatus === 'TIGHT') {
          title.textContent = 'Advisory: Academic Pace is TIGHT';
          desc.textContent = 'One or more subjects have buffer ratios between 1.00 and 1.15. Keep watch on planned session delivery.';
        } else if (summary.rolledUpTrackStatus === 'ON TRACK') {
          title.textContent = 'Excellent: All Curriculum Delivery ON TRACK';
          desc.textContent = 'All subjects maintain safe buffers (ratio >= 1.15). Delivery is keeping pace with targets.';
        } else {
          title.textContent = 'Curriculum Complete';
          desc.textContent = 'All in-scope lesson topics delivered successfully across campuses.';
        }
      }
    },

    renderDashboardKPIs(summary) {
      const elTotal = document.getElementById('kpiTotalHours');
      const elCovered = document.getElementById('kpiCoveredHours');
      const elRemaining = document.getElementById('kpiRemainingHours');
      const elAvailable = document.getElementById('kpiAvailableHours');
      const elBuffer = document.getElementById('kpiBufferRatio');
      const elOverdue = document.getElementById('kpiOverdueTopics');

      if (elTotal) elTotal.textContent = formatDuration(summary.hours.inScope);
      if (elCovered) elCovered.textContent = formatDuration(summary.hours.covered);
      if (elRemaining) elRemaining.textContent = formatDuration(summary.hours.remaining);
      if (elAvailable) elAvailable.textContent = formatDuration(summary.hours.available);
      
      if (elBuffer) {
        elBuffer.textContent = summary.hours.bufferRatio !== null ? summary.hours.bufferRatio : 'N/A';
        elBuffer.style.color = summary.rolledUpTrackStatus === 'DANGER' ? '#EF4444' :
                               summary.rolledUpTrackStatus === 'TIGHT' ? '#F59E0B' : '#10B981';
      }

      if (elOverdue) {
        elOverdue.textContent = summary.hours.overdueTopics;
        elOverdue.style.color = summary.hours.overdueTopics > 0 ? '#EF4444' : 'var(--text-main)';
      }
    },

    renderDashboardCharts(subjects, summary) {
      if (typeof Chart === 'undefined') return;

      // 1. Planned vs Covered Hours Bar Chart
      const hoursCanvas = document.getElementById('chartHoursOverview');
      if (hoursCanvas) {
        if (this.charts.hours) this.charts.hours.destroy();

        const labels = subjects.map(s => s.code);
        const coveredData = subjects.map(s => s.coveredHours);
        const remainingData = subjects.map(s => s.remainingHours);
        const availableData = subjects.map(s => s.availableHours);

        this.charts.hours = new Chart(hoursCanvas, {
          type: 'bar',
          data: {
            labels,
            datasets: [
              {
                label: 'Covered Hours',
                data: coveredData,
                backgroundColor: 'rgba(16, 185, 129, 0.85)',
                borderRadius: 4
              },
              {
                label: 'Remaining Hours',
                data: remainingData,
                backgroundColor: 'rgba(245, 158, 11, 0.85)',
                borderRadius: 4
              },
              {
                label: 'Available Hours',
                data: availableData,
                backgroundColor: 'rgba(57, 120, 212, 0.85)',
                borderRadius: 4
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                labels: { color: '#244B80', font: { family: 'Plus Jakarta Sans', size: 12, weight: '600' } }
              },
              tooltip: {
                callbacks: {
                  label: (ctx) => `${ctx.dataset.label}: ${formatDuration(ctx.raw)} (${ctx.raw} hrs)`
                }
              }
            },
            scales: {
              x: {
                grid: { color: '#C3D8F2' },
                ticks: { color: '#647A96', font: { family: 'Plus Jakarta Sans', size: 11 } }
              },
              y: {
                grid: { color: '#C3D8F2' },
                ticks: { color: '#647A96', font: { family: 'Plus Jakarta Sans', size: 11 } },
                title: { display: true, text: 'Hours', color: '#244B80', font: { family: 'Plus Jakarta Sans', weight: '700' } }
              }
            }
          }
        });
      }

      // 2. Status Breakdown Doughnut Chart
      const statusCanvas = document.getElementById('chartStatusBreakdown');
      if (statusCanvas) {
        if (this.charts.status) this.charts.status.destroy();

        this.charts.status = new Chart(statusCanvas, {
          type: 'doughnut',
          data: {
            labels: ['On Track', 'Tight', 'Danger', 'Complete'],
            datasets: [{
              data: [
                summary.statusCounts.onTrack,
                summary.statusCounts.tight,
                summary.statusCounts.danger,
                summary.statusCounts.complete
              ],
              backgroundColor: [
                '#10B981',
                '#F59E0B',
                '#EF4444',
                '#3978D4'
              ],
              borderWidth: 0
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                position: 'bottom',
                labels: { color: '#244B80', font: { family: 'Plus Jakarta Sans', size: 12, weight: '600' } }
              }
            },
            cutout: '70%'
          }
        });
      }
    },

    renderDashboardTable(subjects) {
      const container = document.getElementById('dashboardSubjectsTableBody');
      if (!container) return;

      if (subjects.length === 0) {
        container.innerHTML = '<tr><td colspan="10" style="text-align:center; padding: 2rem;">No subjects match the selected filters.</td></tr>';
        return;
      }

      container.innerHTML = subjects.map(s => {
        const paceSign = s.paceVsPlan > 0 ? '+' : s.paceVsPlan < 0 ? '-' : '';
        const paceFormatted = `${paceSign}${formatDuration(Math.abs(s.paceVsPlan))}`;
        const statusClass = s.status === 'ON TRACK' ? 'ontrack' : s.status === 'TIGHT' ? 'tight' : s.status === 'DANGER' ? 'danger' : 'complete';

        return `
          <tr>
            <td>
              <div style="font-weight: 700; color: var(--heading-deep-blue);">${s.code}</div>
              <div style="font-size: 0.8rem; color: var(--text-secondary);">${s.name}</div>
            </td>
            <td>
              <div style="font-size: 0.85rem;">${s.batch_name}</div>
              <div style="font-size: 0.72rem; color: var(--text-muted);">${s.campus_name}</div>
            </td>
            <td style="font-family: 'JetBrains Mono', monospace;">${formatDuration(s.hoursInScope)}</td>
            <td style="font-family: 'JetBrains Mono', monospace; color: #10B981;">${formatDuration(s.coveredHours)}</td>
            <td style="font-family: 'JetBrains Mono', monospace; color: #F59E0B;">${formatDuration(s.remainingHours)}</td>
            <td style="font-family: 'JetBrains Mono', monospace; color: var(--primary-blue);">${formatDuration(s.availableHours)}</td>
            <td style="min-width: 120px;">
              <div style="display: flex; justify-content: space-between; font-size: 0.75rem; font-weight: 700; margin-bottom: 0.2rem;">
                <span>${s.progressPercentage}%</span>
              </div>
              <div class="progress-bar-track">
                <div class="progress-bar-fill" style="width: ${s.progressPercentage}%;"></div>
              </div>
            </td>
            <td style="font-family: 'JetBrains Mono', monospace; font-weight: 700;">
              ${s.bufferRatio !== null ? s.bufferRatio : '—'}
            </td>
            <td style="font-family: 'JetBrains Mono', monospace; font-weight: 700; color: ${s.paceVsPlan < 0 ? '#EF4444' : '#10B981'};">
              ${paceFormatted}
            </td>
            <td>
              <span class="status-pill ${statusClass}">${s.status}</span>
              <button type="button" class="btn-secondary" style="font-size: 0.68rem; padding: 0.15rem 0.4rem; margin-left: 0.35rem;" onclick="App.inspectTraceability('${s.id}')">
                Inspect
              </button>
            </td>
          </tr>
        `;
      }).join('');
    },

    async inspectTraceability(subjectId) {
      const modal = document.getElementById('traceabilityModal');
      const body = document.getElementById('traceabilityModalBody');
      if (!modal || !body) return;

      body.innerHTML = '<div style="padding: 2rem; text-align: center;">Calculating mathematical traceability...</div>';
      modal.style.display = 'flex';

      try {
        const data = await API.getSubjectTraceability(subjectId);
        const subj = data.subject;

        body.innerHTML = `
          <div style="margin-bottom: 1.25rem;">
            <h4 style="font-size: 1.15rem; color: var(--heading-deep-blue);">${subj.code}: ${subj.name}</h4>
            <div style="font-size: 0.82rem; color: var(--text-secondary);">${subj.campus_name} • ${subj.batch_name}</div>
          </div>

          <div style="background-color: var(--surface-soft); border: 1px solid var(--borders); border-radius: var(--radius-md); padding: 1rem; margin-bottom: 1rem;">
            <div style="font-weight: 700; color: var(--heading-deep-blue);">1. Buffer Ratio Formula:</div>
            <div style="font-size: 0.85rem; margin-top: 0.2rem;">bufferRatio = availableHours / remainingHours</div>
            <div style="margin-top: 0.35rem; font-family: 'JetBrains Mono', monospace; font-size: 0.88rem;">
              ${formatDuration(subj.availableHours)} available / ${formatDuration(subj.remainingHours)} remaining = <strong>${subj.bufferRatio}</strong>
            </div>
          </div>

          <div style="background-color: var(--surface-soft); border: 1px solid var(--borders); border-radius: var(--radius-md); padding: 1rem; margin-bottom: 1rem;">
            <div style="font-weight: 700; color: var(--heading-deep-blue);">2. Pace vs Plan Formula:</div>
            <div style="font-size: 0.85rem; margin-top: 0.2rem;">paceVsPlan = coveredHours - hoursExpectedByToday</div>
            <div style="margin-top: 0.35rem; font-family: 'JetBrains Mono', monospace; font-size: 0.88rem;">
              ${formatDuration(subj.coveredHours)} covered - ${formatDuration(subj.hoursExpectedByToday)} expected = <strong>${subj.paceVsPlan > 0 ? '+' : ''}${formatDuration(Math.abs(subj.paceVsPlan))}</strong>
            </div>
          </div>

          <div style="background-color: var(--surface-soft); border: 1px solid var(--borders); border-radius: var(--radius-md); padding: 1rem;">
            <div style="font-weight: 700; color: var(--heading-deep-blue);">3. Overdue Topics: ${subj.overdueTopicsCount}</div>
            ${subj.overdueTopics && subj.overdueTopics.length > 0 ? `
              <ul style="margin-top: 0.5rem; padding-left: 1.25rem; font-size: 0.8rem; color: #EF4444;">
                ${subj.overdueTopics.map(t => `<li><strong>${t.title}</strong> (Planned: ${t.planned_date}, ${formatDuration(t.planned_hours)})</li>`).join('')}
              </ul>
            ` : '<div style="color: #10B981; font-size: 0.85rem; margin-top: 0.25rem;">No overdue topics.</div>'}
          </div>
        `;
      } catch (err) {
        body.innerHTML = `<div style="color: #EF4444; padding: 1rem;">Error: ${err.message}</div>`;
      }
    },

    closeModal(modalId) {
      if (modalId === 'sessionLoggerModal') {
        this.stopStopwatch();
      }
      const modal = document.getElementById(modalId);
      if (modal) modal.style.display = 'none';
    },

    // -------------------------------------------------------------
    // TAB 2: CURRICULUM & LESSON PLANS (Section 5)
    // -------------------------------------------------------------
    async loadCurriculumView() {
      const container = document.getElementById('curriculumSubjectsContainer');
      if (!container) return;

      container.innerHTML = '<div style="text-align:center; padding: 2rem;">Loading curriculum subjects...</div>';

      try {
        const data = await API.getSubjects();
        const subjects = data.subjects || [];

        if (subjects.length === 0) {
          container.innerHTML = '<div class="content-card" style="padding: 2rem; text-align:center;">No subjects found.</div>';
          return;
        }

        container.innerHTML = subjects.map(s => `
          <div class="content-card">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.75rem; flex-wrap: wrap; gap: 0.5rem;">
              <div>
                <span class="status-pill complete" style="margin-bottom: 0.35rem;">${s.code}</span>
                <h3 style="font-size: 1.2rem; color: var(--heading-deep-blue); margin-top: 0.25rem;">${s.name}</h3>
                <p style="font-size: 0.82rem; color: var(--text-secondary);">${s.campus_name} • ${s.track_name || 'Academic Track'} (${s.batch_name})</p>
              </div>
              <div style="text-align: right;">
                <span style="font-weight: 700; color: var(--primary-blue); font-size: 0.95rem;">${formatDuration(s.total_hours)} Scope</span>
              </div>
            </div>

            <div style="border-top: 1px solid var(--borders-subtle); padding-top: 0.85rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
              <span style="font-size: 0.8rem; color: var(--text-muted);">${s.active_semester_name || 'Active Semester'}</span>
              <button type="button" class="btn-secondary" style="font-size: 0.8rem; padding: 0.4rem 0.85rem;" onclick="App.showStudentTopicBreakdown('${s.id}')">
                📖 View Lesson Plan & Syllabus
              </button>
            </div>
          </div>
        `).join('');
      } catch (err) {
        container.innerHTML = `<div style="color: #EF4444; padding: 1.5rem;">Error loading subjects: ${err.message}</div>`;
      }
    },

    async showStudentTopicBreakdown(subjectId) {
      const modal = document.getElementById('studentTopicsModal');
      const body = document.getElementById('studentTopicsModalBody');
      if (!modal || !body) return;

      body.innerHTML = '<div style="padding: 2rem; text-align: center;">Loading lesson syllabus...</div>';
      modal.style.display = 'flex';

      try {
        const data = await API.getSubjectTopics(subjectId);
        const topics = data.topics || [];

        body.innerHTML = `
          <div style="display: flex; flex-direction: column; gap: 0.75rem; max-height: 60vh; overflow-y: auto;">
            ${topics.map(t => `
              <div style="background-color: var(--surface-soft); padding: 0.85rem; border-radius: var(--radius-md); border: 1px solid var(--borders); display: flex; align-items: center; justify-content: space-between;">
                <div>
                  <div style="font-size: 0.88rem; font-weight: 700; color: var(--heading-deep-blue);">
                    ${t.status === 'COMPLETED' ? '✅' : t.status === 'IN_PROGRESS' ? '⏳' : '⚪'} 
                    Unit ${t.unit_number}: ${t.topic_title}
                  </div>
                  <div style="font-size: 0.78rem; color: var(--text-secondary); margin-top: 0.2rem;">
                    Planned Date: <strong>${t.planned_date || 'TBD'}</strong> • Scope: ${t.exam_scope}
                  </div>
                </div>
                <div style="text-align: right;">
                  <span class="status-pill ${t.status === 'COMPLETED' ? 'complete' : (t.status === 'IN_PROGRESS' ? 'ontrack' : 'tight')}" style="font-size: 0.72rem;">${t.status}</span>
                  <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem;">${formatDuration(t.planned_hours)}</div>
                </div>
              </div>
            `).join('')}
          </div>
        `;
      } catch (err) {
        body.innerHTML = `<div style="color: #EF4444;">Error: ${err.message}</div>`;
      }
    },

    // -------------------------------------------------------------
    // TAB 3: TIMETABLE & CALENDAR
    // -------------------------------------------------------------
    async loadCalendarAndTimetable() {
      const container = document.getElementById('timetableGridContainer') || document.getElementById('timetableContainer');
      if (!container) return;

      container.innerHTML = '<div style="text-align:center; padding: 2rem;">Loading academic timetable...</div>';

      try {
        const tData = await API.getTimetable(this.activeFilters);
        const slots = tData.slots || [];
        const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

        container.innerHTML = `
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.25rem; margin-top: 1rem;">
            ${weekdays.map((dayName, idx) => {
              const dow = idx + 1;
              const daySlots = slots.filter(s => s.weekday === dow);

              return `
                <div class="content-card" style="margin-bottom: 0; padding: 1.25rem;">
                  <div style="font-weight: 800; font-size: 1rem; margin-bottom: 0.85rem; color: var(--heading-deep-blue); display: flex; justify-content: space-between;">
                    <span>${dayName}</span>
                    <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: 600;">${daySlots.length} slot(s)</span>
                  </div>

                  ${daySlots.length === 0 ? `
                    <div style="font-size: 0.8rem; color: var(--text-muted); text-align: center; padding: 1.5rem 0;">No classes scheduled</div>
                  ` : `
                    <div style="display: flex; flex-direction: column; gap: 0.65rem;">
                      ${daySlots.map(s => `
                        <div style="background-color: var(--surface-soft); border: 1px solid var(--borders); border-radius: var(--radius-sm); padding: 0.75rem;">
                          <div style="display: flex; justify-content: space-between; font-weight: 700;">
                            <span style="color: var(--heading-deep-blue);">${s.subject_code}</span>
                            <span style="color: var(--primary-blue); font-family: 'JetBrains Mono', monospace;">${formatDuration(s.duration_hours)}</span>
                          </div>
                          <div style="font-size: 0.78rem; color: var(--text-secondary); margin-top: 0.2rem;">${s.start_time} - ${s.end_time} • ${s.faculty_name}</div>
                          <div style="font-size: 0.72rem; color: var(--text-muted);">${s.batch_name} (${s.room || 'Room 101'})</div>
                        </div>
                      `).join('')}
                    </div>
                  `}
                </div>
              `;
            }).join('')}
          </div>
        `;
      } catch (err) {
        container.innerHTML = `<div style="color: #EF4444; padding: 1.5rem;">Error: ${err.message}</div>`;
      }
    },

    openAddHolidayModal() {
      const modal = document.getElementById('addHolidayModal');
      if (modal) modal.style.display = 'flex';
    },

    async submitAddHoliday() {
      const semId = this.activeFilters.semester_id || (this.semesters[0] ? this.semesters[0].id : 'sem_hitech_mirai_a');
      const eventDate = document.getElementById('holidayDateInput').value;
      const title = document.getElementById('holidayTitleInput').value;
      const eventType = document.getElementById('holidayTypeSelect').value;

      if (!eventDate || !title) {
        this.showToast('Please enter both event date and title', 'warning');
        return;
      }

      try {
        await API.addCalendarEvent(semId, {
          event_date: eventDate,
          title,
          event_type: eventType,
          affects_schedule: 1
        });
        this.closeModal('addHolidayModal');
        this.showToast('Holiday added! Affected syllabus dates recalculated.', 'success');
        await this.loadCalendarAndTimetable();
      } catch (err) {
        this.showToast(`Error adding holiday: ${err.message}`, 'error');
      }
    },

    // -------------------------------------------------------------
    // TAB 4: USER ACCOUNTS (Admin)
    // -------------------------------------------------------------
    async loadUsersView() {
      const tbody = document.getElementById('usersTableBody');
      if (!tbody) return;

      tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 2rem;">Loading accounts...</td></tr>';

      try {
        const data = await API.getUsers();
        const users = data.users || [];

        if (users.length === 0) {
          tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 2rem;">No user accounts found.</td></tr>';
          return;
        }

        tbody.innerHTML = users.map(u => `
          <tr>
            <td>
              <div style="font-weight: 700; color: var(--heading-deep-blue);">${u.name}</div>
              <div style="font-size: 0.72rem; color: var(--text-muted); font-family: monospace;">ID: ${u.id}</div>
            </td>
            <td>${u.email}</td>
            <td>${u.phone || '—'}</td>
            <td>
              <span class="status-pill complete" style="font-size: 0.72rem;">${u.role.replace('_', ' ')}</span>
            </td>
            <td>${u.campus_name || 'All Campuses'}</td>
            <td>${u.batch_name || '—'}</td>
            <td><span class="status-pill ontrack">Active</span></td>
          </tr>
        `).join('');
      } catch (err) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: #EF4444; padding: 2rem;">Error: ${err.message}</td></tr>`;
      }
    },

    openAddUserModal() {
      const modal = document.getElementById('addUserModal');
      const err = document.getElementById('addUserError');
      if (err) err.style.display = 'none';
      if (modal) modal.style.display = 'flex';
    },

    handleNewUserRoleChange() {
      const role = document.getElementById('newUserRole').value;
      const batchGroup = document.getElementById('newUserBatchGroup');
      if (batchGroup) {
        batchGroup.style.display = role === 'STUDENT' ? 'block' : 'none';
      }
    },

    async submitCreateUser() {
      const name = document.getElementById('newUserName').value;
      const email = document.getElementById('newUserEmail').value;
      const phone = document.getElementById('newUserPhone').value;
      const role = document.getElementById('newUserRole').value;
      const campusId = document.getElementById('newUserCampus').value;
      const batchName = document.getElementById('newUserBatch').value;
      const password = document.getElementById('newUserPassword').value;

      const errBox = document.getElementById('addUserError');
      const errMsg = document.getElementById('addUserErrorMsg');

      try {
        await API.createUser({
          name,
          email,
          phone: phone || null,
          role,
          campus_id: campusId,
          batch_name: role === 'STUDENT' ? batchName : null,
          password
        });
        this.closeModal('addUserModal');
        this.showToast(`User account for ${name} created successfully!`, 'success');
        await this.loadUsersView();
      } catch (err) {
        if (errBox) {
          errBox.style.display = 'flex';
          if (errMsg) errMsg.textContent = err.message;
        }
      }
    },

    // -------------------------------------------------------------
    // TAB 7: FAST SESSION LOGGER (<60s Flow for Faculty)
    // -------------------------------------------------------------
    async loadTodayLogger(date = null) {
      const listContainer = document.getElementById('loggerTodaySlotsContainer') || document.getElementById('todaySessionsList');
      if (!listContainer) return;

      listContainer.innerHTML = '<div style="text-align:center; padding: 2rem;">Loading today\'s teaching schedule...</div>';

      try {
        const data = await API.getTodaySessions(date);
        this.todaySessionsData = data;

        if (!data.sessions || data.sessions.length === 0) {
          listContainer.innerHTML = `
            <div class="content-card" style="text-align:center; padding: 2.5rem;">
              <div style="font-size: 2.5rem; margin-bottom: 0.75rem;">📅</div>
              <h3 style="font-size: 1.25rem; color: var(--heading-deep-blue); margin-bottom: 0.35rem;">
                No Timetable Sessions Scheduled for ${data.dayName} (${data.activeDate})
              </h3>
              <p style="color: var(--text-secondary); font-size: 0.9rem; max-width: 520px; margin: 0 auto 1.25rem auto;">
                You do not have a scheduled class slot on this day. You can review your complete weekly schedule, inspect other days, or launch an instant logger session for any of your assigned subjects.
              </p>
              <div style="display: flex; justify-content: center; gap: 0.75rem; flex-wrap: wrap;">
                <button type="button" class="btn-primary" onclick="App.openInstantSubjectLogger()">
                  ⚡ Quick Log Assigned Subject
                </button>
                <button type="button" class="btn-secondary" onclick="App.switchTab('calendar')">
                  📅 View My Teaching Schedule
                </button>
              </div>
            </div>
          `;
          return;
        }

        listContainer.innerHTML = data.sessions.map((item, idx) => {
          const s = item.slot;
          const isLogged = item.isLogged;
          const nextTopic = item.suggestedTopic;

          return `
            <div class="content-card" style="margin-bottom: 1.25rem; border-left: 5px solid ${isLogged ? '#10B981' : '#F59E0B'};">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.75rem; flex-wrap: wrap; gap: 0.75rem;">
                <div>
                  <span style="font-size: 0.78rem; font-weight: 700; color: var(--primary-blue); text-transform: uppercase;">
                    ${s.start_time} - ${s.end_time} (${formatDuration(s.duration_hours)}) • ${s.room || 'Main Hall'}
                  </span>
                  <h4 style="font-size: 1.2rem; color: var(--heading-deep-blue); margin-top: 0.2rem;">
                    ${s.subject_code}: ${s.subject_name}
                  </h4>
                  <p style="font-size: 0.85rem; color: var(--text-secondary);">${s.campus_name} • ${s.batch_name}</p>
                </div>
                <div>
                  ${isLogged ? `
                    <span class="status-pill complete">Logged (${item.loggedSession.status})</span>
                  ` : `
                    <button type="button" class="btn-primary" onclick="App.openInstantLogger(${idx})">
                      ⚡ Quick Log (under 60s)
                    </button>
                  `}
                </div>
              </div>

              ${nextTopic ? `
                <div style="background-color: var(--surface-soft); padding: 0.75rem 1rem; border-radius: var(--radius-md); font-size: 0.85rem; margin-top: 0.75rem; display: flex; align-items: center; justify-content: space-between;">
                  <div>
                    <span style="color: var(--text-secondary); font-weight: 600;">Next Topic in Sequence:</span>
                    <strong style="color: var(--heading-deep-blue); margin-left: 0.35rem;">Unit ${nextTopic.unit_number}: ${nextTopic.topic_title}</strong>
                  </div>
                  <span style="color: var(--primary-blue); font-family: 'JetBrains Mono', monospace; font-weight: 700;">${formatDuration(nextTopic.planned_hours)}</span>
                </div>
              ` : ''}
            </div>
          `;
        }).join('');
      } catch (err) {
        listContainer.innerHTML = `<div style="color: #EF4444; padding: 1.5rem;">Error: ${err.message}</div>`;
      }
    },

    openInstantLogger(sessionIndex) {
      const item = this.todaySessionsData.sessions[sessionIndex];
      if (!item) return;

      const modal = document.getElementById('sessionLoggerModal');
      const s = item.slot;
      const topic = item.suggestedTopic;

      document.getElementById('logModalSlotId').value = s.id;
      document.getElementById('logModalSubjectId').value = s.subject_id;
      document.getElementById('logModalDate').value = this.todaySessionsData.activeDate;
      document.getElementById('logModalDuration').value = s.duration_hours;
      document.getElementById('logModalTopicId').value = topic ? topic.id : '';

      document.getElementById('logModalHeaderInfo').innerHTML = `
        <strong style="color: var(--heading-deep-blue); font-size: 1rem;">${s.subject_code} - ${s.subject_name}</strong><br>
        <span style="font-size: 0.82rem; color: var(--text-secondary);">${s.batch_name} • ${s.start_time} - ${s.end_time} (${formatDuration(s.duration_hours)})</span>
      `;

      if (topic) {
        document.getElementById('logModalTopicInput').value = topic.topic_title;
      } else {
        document.getElementById('logModalTopicInput').value = '';
      }

      this.startStopwatch();
      this.selectStatusChip('COMPLETED');
      this.selectPctPill(100);

      if (modal) modal.style.display = 'flex';
    },

    async openInstantSubjectLogger() {
      try {
        const data = await API.getSubjects();
        const subjects = data.subjects || [];
        if (subjects.length === 0) {
          this.showToast('No assigned subjects found for your profile.', 'warning');
          return;
        }

        const modal = document.getElementById('sessionLoggerModal');
        const s = subjects[0];

        // Fetch next upcoming topic for this subject
        const topicsData = await API.getSubjectTopics(s.id);
        const topics = topicsData.topics || [];
        const nextTopic = topics.find(t => t.status !== 'COMPLETED' && t.status !== 'SKIPPED') || topics[0];

        document.getElementById('logModalSlotId').value = '';
        document.getElementById('logModalSubjectId').value = s.id;
        document.getElementById('logModalDate').value = this.todaySessionsData ? this.todaySessionsData.activeDate : new Date().toISOString().split('T')[0];
        document.getElementById('logModalDuration').value = 1.0;
        document.getElementById('logModalTopicId').value = nextTopic ? nextTopic.id : '';

        document.getElementById('logModalHeaderInfo').innerHTML = `
          <strong style="color: var(--heading-deep-blue); font-size: 1rem;">${s.code} - ${s.name}</strong><br>
          <span style="font-size: 0.82rem; color: var(--text-secondary);">${s.batch_name || 'Assigned Class'} • Direct Session Log (1 hr)</span>
        `;

        if (nextTopic) {
          document.getElementById('logModalTopicInput').value = nextTopic.topic_title;
        } else {
          document.getElementById('logModalTopicInput').value = '';
        }

        this.startStopwatch();
        this.selectStatusChip('COMPLETED');
        this.selectPctPill(100);

        if (modal) modal.style.display = 'flex';
      } catch (err) {
        this.showToast('Error opening session logger: ' + err.message, 'error');
      }
    },

    startStopwatch() {
      if (this.stopwatchInterval) {
        clearInterval(this.stopwatchInterval);
        this.stopwatchInterval = null;
      }
      this.stopwatchSeconds = 0;
      const el = document.getElementById('loggerStopwatchTimer');
      if (el) el.textContent = '00:00';

      this.stopwatchInterval = setInterval(() => {
        this.stopwatchSeconds++;
        const mins = String(Math.floor(this.stopwatchSeconds / 60)).padStart(2, '0');
        const secs = String(this.stopwatchSeconds % 60).padStart(2, '0');
        if (el) el.textContent = `${mins}:${secs}`;
      }, 1000);
    },

    stopStopwatch() {
      if (this.stopwatchInterval) {
        clearInterval(this.stopwatchInterval);
        this.stopwatchInterval = null;
      }
      return this.stopwatchSeconds;
    },

    selectStatusChip(status) {
      document.querySelectorAll('.status-chip').forEach(c => {
        c.classList.toggle('selected', c.dataset.status === status);
      });
      document.getElementById('logModalStatusInput').value = status;

      const pctSection = document.getElementById('logModalPctSection');
      const carrySection = document.getElementById('logModalCarrySection');

      if (status === 'IN_PROGRESS') {
        if (pctSection) pctSection.style.display = 'block';
        if (carrySection) carrySection.style.display = 'block';
      } else if (status === 'COMPLETED') {
        if (pctSection) pctSection.style.display = 'none';
        if (carrySection) carrySection.style.display = 'none';
        this.selectPctPill(100);
      } else {
        if (pctSection) pctSection.style.display = 'none';
        if (carrySection) carrySection.style.display = 'none';
        this.selectPctPill(0);
      }
    },

    selectPctPill(pct) {
      document.querySelectorAll('.pct-pill').forEach(p => {
        p.classList.toggle('active', parseInt(p.dataset.pct, 10) === pct);
      });
      const input = document.getElementById('logModalPctInput');
      if (input) input.value = pct;
    },

    async submitSessionLog() {
      const slotId = document.getElementById('logModalSlotId').value;
      const subjectId = document.getElementById('logModalSubjectId').value;
      const sessionDate = document.getElementById('logModalDate').value;
      const status = document.getElementById('logModalStatusInput').value;
      const percentageComplete = parseFloat(document.getElementById('logModalPctInput').value) || 100;
      const topicId = document.getElementById('logModalTopicId').value;
      const topicsCovered = document.getElementById('logModalTopicInput').value;
      const carryForward = document.getElementById('logModalCarryForwardInput').value;
      const classwork = document.getElementById('logModalClassworkInput').value;
      const homework = document.getElementById('logModalHomeworkInput').value;
      const notes = document.getElementById('logModalNotesInput').value;
      const durationHours = parseFloat(document.getElementById('logModalDuration').value);

      const elapsed = this.stopStopwatch();

      try {
        const payload = {
          timetable_slot_id: slotId || null,
          subject_id: subjectId,
          session_date: sessionDate,
          status,
          percentage_complete: percentageComplete,
          topic_id: topicId || null,
          topics_covered: topicsCovered,
          carry_forward_topic: carryForward,
          classwork_status: classwork,
          homework_status: homework,
          notes,
          duration_hours: durationHours
        };

        await API.logSession(payload);
        this.closeModal('sessionLoggerModal');
        this.showToast(`Logged in ${elapsed} seconds! Progress updated.`, 'success');
        await this.loadTodayLogger();
      } catch (err) {
        this.showToast(`Error logging session: ${err.message}`, 'error');
      }
    },

    // -------------------------------------------------------------
    // TAB 8: SESSION HISTORY (Faculty)
    // -------------------------------------------------------------
    async loadSessionHistory() {
      const tbody = document.getElementById('sessionHistoryTableBody');
      if (!tbody) return;

      tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 2rem;">Loading teaching history...</td></tr>';

      try {
        const data = await API.getSessionHistory();
        const sessions = data.sessions || [];

        if (sessions.length === 0) {
          tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 2rem; color: var(--text-secondary);">No teaching sessions recorded yet.</td></tr>';
          return;
        }

        tbody.innerHTML = sessions.map(s => `
          <tr>
            <td><strong>${s.session_date}</strong></td>
            <td>
              <div style="font-weight: 700; color: var(--heading-deep-blue);">${s.subject_code}</div>
              <div style="font-size: 0.78rem; color: var(--text-secondary);">${s.subject_name}</div>
            </td>
            <td>${s.batch_name}</td>
            <td style="font-family: 'JetBrains Mono', monospace; color: var(--primary-blue);">${formatDuration(s.duration_hours)}</td>
            <td>
              <span class="status-pill complete">${s.percentage_complete}%</span>
            </td>
            <td>${s.topics_covered || '—'}</td>
            <td>
              <div style="font-size: 0.78rem;">${s.classwork_status || '—'}</div>
              <div style="font-size: 0.72rem; color: var(--text-muted);">${s.homework_status || ''}</div>
            </td>
          </tr>
        `).join('');
      } catch (err) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: #EF4444; padding: 2rem;">Error: ${err.message}</td></tr>`;
      }
    },

    // -------------------------------------------------------------
    // TAB 9: STUDENT PORTAL VIEW (Section 5 Student)
    // -------------------------------------------------------------
    async loadStudentView() {
      const container = document.getElementById('studentSubjectsContainer');
      if (!container) return;

      container.innerHTML = '<div style="text-align:center; padding: 2rem;">Loading your enrolled subjects...</div>';

      try {
        const data = await API.getStudentProgress();
        const subjects = data.subjects || [];

        if (subjects.length === 0) {
          container.innerHTML = `
            <div class="content-card" style="text-align:center; padding: 2.5rem;">
              <div style="font-size: 2.5rem; margin-bottom: 0.75rem;">🎓</div>
              <h3 style="font-size: 1.2rem; color: var(--heading-deep-blue); margin-bottom: 0.5rem;">No Enrolled Subjects Found</h3>
              <p style="color: var(--text-secondary); font-size: 0.9rem;">
                No academic subjects are currently enrolled for your batch. Contact your academic administrator if this is unexpected.
              </p>
            </div>
          `;
          return;
        }

        container.innerHTML = subjects.map(s => {
          const sId = s.id || s.subjectId;
          const sCode = s.code || '';
          const sName = s.name || '';
          const sFaculty = s.faculty_name || s.facultyName || 'Assigned Faculty';
          const sPct = s.progressPercentage !== undefined ? s.progressPercentage : (s.coveragePercent || 0);
          const sCovered = s.coveredHours || 0;
          const sTotal = s.total_hours !== undefined ? s.total_hours : (s.hoursInScope || 0);
          const sRemaining = s.remainingHours !== undefined ? s.remainingHours : Math.max(0, sTotal - sCovered);
          const sStatus = s.status || 'ON TRACK';
          const statusClass = sStatus === 'COMPLETE' ? 'complete' : (sStatus === 'ON TRACK' ? 'ontrack' : (sStatus === 'TIGHT' ? 'tight' : 'danger'));

          return `
            <div class="content-card">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.85rem; flex-wrap: wrap; gap: 0.5rem;">
                <div>
                  <span class="status-pill complete" style="margin-bottom: 0.25rem;">${sCode}</span>
                  <h3 style="font-size: 1.25rem; color: var(--heading-deep-blue); margin-top: 0.25rem;">${sName}</h3>
                  <p style="font-size: 0.82rem; color: var(--text-secondary);">Faculty: <strong>${sFaculty}</strong></p>
                </div>
                <div style="text-align: right;">
                  <span class="status-pill ${statusClass}">${sPct}% Completed (${sStatus})</span>
                  <div style="font-family: 'JetBrains Mono', monospace; font-size: 0.82rem; color: var(--text-muted); margin-top: 0.35rem;">
                    ${formatDuration(sCovered)} / ${formatDuration(sTotal)}
                  </div>
                </div>
              </div>

              <div class="progress-bar-track" style="margin-bottom: 1.25rem;">
                <div class="progress-bar-fill" style="width: ${sPct}%;"></div>
              </div>

              <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--borders-subtle); padding-top: 0.85rem; flex-wrap: wrap; gap: 0.5rem;">
                <span style="font-size: 0.8rem; color: var(--text-muted);">${formatDuration(sRemaining)} remaining to final target</span>
                <button type="button" class="btn-secondary" style="font-size: 0.8rem; padding: 0.4rem 0.85rem;" onclick="App.showStudentTopicBreakdown('${sId}')">
                  📖 View Lesson Topics & Status
                </button>
              </div>
            </div>
          `;
        }).join('');
      } catch (err) {
        container.innerHTML = `<div class="content-card" style="color: #EF4444; padding: 1.5rem;">Error loading subjects: ${err.message}</div>`;
      }
    },

    // -------------------------------------------------------------
    // TAB 10: EXAM READINESS HUB (Student)
    // -------------------------------------------------------------
    async loadExamReadiness() {
      const container = document.getElementById('examWindowsContainer') || document.getElementById('examCardsContainer');
      if (!container) return;

      container.innerHTML = '<div style="text-align:center; padding: 2rem;">Evaluating exam readiness models...</div>';

      try {
        const data = await API.getExamReadiness();
        const exams = data.exams || data.examWindows || [];

        if (exams.length === 0) {
          container.innerHTML = `
            <div class="content-card" style="text-align: center; padding: 2.5rem; grid-column: 1 / -1;">
              <div style="font-size: 2.5rem; margin-bottom: 0.75rem;">🎯</div>
              <h3 style="font-size: 1.2rem; color: var(--heading-deep-blue); margin-bottom: 0.5rem;">No Active Exam Windows Found</h3>
              <p style="color: var(--text-secondary); font-size: 0.9rem;">
                Examination schedules and syllabus scope windows have not been configured for this semester yet.
              </p>
            </div>
          `;
          return;
        }

        container.innerHTML = exams.map(e => {
          const rawType = e.exam_type || e.examType || 'EXAM';
          const typeLabel = rawType.replace(/_/g, ' ');
          const startDate = e.start_date || e.startDate || 'TBD';
          const endDate = e.end_date || e.endDate || 'TBD';
          const covPct = e.coveragePercent !== undefined ? e.coveragePercent : 0;
          const inScope = e.inScopeHours !== undefined ? e.inScopeHours : (e.in_scope_hours || 0);
          const covered = e.coveredHours !== undefined ? e.coveredHours : (e.covered_hours || 0);
          const remaining = e.remainingHours !== undefined ? e.remainingHours : (e.remaining_hours || 0);
          const available = e.availableHoursBeforeExam !== undefined ? e.availableHoursBeforeExam : (e.available_hours || 0);
          const riskStatus = e.riskStatus || (covPct >= 80 ? 'LOW_RISK' : 'HIGH_RISK');
          const riskClass = riskStatus === 'LOW_RISK' ? 'ontrack' : 'danger';

          return `
            <div class="content-card">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.75rem; flex-wrap: wrap; gap: 0.5rem;">
                <div>
                  <span class="status-pill tight">${typeLabel}</span>
                  <h3 style="font-size: 1.2rem; color: var(--heading-deep-blue); margin-top: 0.35rem;">${e.name}</h3>
                  <div style="font-size: 0.8rem; color: var(--text-muted);">${startDate} to ${endDate}</div>
                </div>
                <div style="text-align: right;">
                  <span class="status-pill ${riskClass}" style="margin-bottom: 0.25rem;">${riskStatus.replace(/_/g, ' ')}</span>
                  <div style="font-family: 'JetBrains Mono', monospace; font-size: 1.25rem; font-weight: 800; color: var(--primary-blue);">
                    ${covPct}%
                  </div>
                </div>
              </div>

              <div class="progress-bar-track" style="margin-bottom: 1rem;">
                <div class="progress-bar-fill" style="width: ${covPct}%;"></div>
              </div>

              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; background-color: var(--surface-soft); padding: 0.75rem; border-radius: var(--radius-md); font-size: 0.82rem;">
                <div>
                  <span style="color: var(--text-secondary);">In-Scope:</span>
                  <strong style="color: var(--heading-deep-blue); font-family: 'JetBrains Mono', monospace;">${formatDuration(inScope)}</strong>
                </div>
                <div>
                  <span style="color: var(--text-secondary);">Covered:</span>
                  <strong style="color: #10B981; font-family: 'JetBrains Mono', monospace;">${formatDuration(covered)}</strong>
                </div>
                <div>
                  <span style="color: var(--text-secondary);">Remaining:</span>
                  <strong style="color: #F59E0B; font-family: 'JetBrains Mono', monospace;">${formatDuration(remaining)}</strong>
                </div>
                <div>
                  <span style="color: var(--text-secondary);">Available:</span>
                  <strong style="color: var(--primary-blue); font-family: 'JetBrains Mono', monospace;">${formatDuration(available)}</strong>
                </div>
              </div>
            </div>
          `;
        }).join('');
      } catch (err) {
        container.innerHTML = `<div style="color: #EF4444; padding: 1.5rem;">Error: ${err.message}</div>`;
      }
    },

    // -------------------------------------------------------------
    // TAB 5: ALERTS & ESCALATIONS
    // -------------------------------------------------------------
    async loadAlertsView() {
      const container = document.getElementById('alertsContainer');
      if (!container) return;

      container.innerHTML = '<div style="text-align: center; padding: 2rem;">Loading alerts...</div>';

      try {
        const data = await API.getAlerts();
        const alerts = data.alerts || [];

        if (alerts.length === 0) {
          container.innerHTML = '<div class="content-card" style="text-align: center; padding: 2.5rem; color: #10B981; font-weight: 600;">✅ All clear! No missed-session reminders or escalations.</div>';
          return;
        }

        container.innerHTML = alerts.map(a => `
          <div class="content-card" style="border-left: 5px solid ${a.severity === 'DANGER' ? '#EF4444' : '#F59E0B'}; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
            <div>
              <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem;">
                <span class="status-pill ${a.severity === 'DANGER' ? 'danger' : 'tight'}">${a.alert_type.replace(/_/g, ' ')}</span>
                <span style="font-size: 0.78rem; color: var(--text-muted);">${a.created_at}</span>
              </div>
              <div style="font-weight: 700; color: var(--heading-deep-blue); font-size: 0.95rem;">${a.message}</div>
              <div style="font-size: 0.78rem; color: var(--text-secondary); margin-top: 0.2rem;">Session Date: ${a.session_date}</div>
            </div>
            <div>
              <button type="button" class="btn-secondary" style="font-size: 0.78rem;" onclick="App.markAlertRead('${a.id}')">
                ✓ Dismiss
              </button>
            </div>
          </div>
        `).join('');
      } catch (err) {
        container.innerHTML = `<div style="color: #EF4444; padding: 1.5rem;">Error: ${err.message}</div>`;
      }
    },

    async markAlertRead(alertId) {
      try {
        await API.markAlertRead(alertId);
        this.showToast('Alert dismissed', 'info');
        await this.loadAlertsView();
        this.checkAlertsBadge();
      } catch (err) {
        this.showToast(`Error: ${err.message}`, 'error');
      }
    },

    // -------------------------------------------------------------
    // TAB 6: CSV IMPORTS
    // -------------------------------------------------------------
    async handleCsvUpload(type) {
      const input = document.getElementById(type === 'syllabus' ? 'csvFileInputSyllabus' : 'csvFileInputTimetable');
      if (!input || !input.files || !input.files[0]) {
        this.showToast('Please select a CSV file first.', 'warning');
        return;
      }

      const file = input.files[0];
      const formData = new FormData();
      formData.append('file', file);

      try {
        const res = await API.importCSV(type, formData);
        this.showToast(res.message || 'CSV imported successfully!', 'success');
        input.value = '';
        await this.loadInitialMetadata();
      } catch (err) {
        this.showToast(`Import error: ${err.message}`, 'error');
      }
    },

    // -------------------------------------------------------------
    // UTILITY: TOASTS
    // -------------------------------------------------------------
    showToast(message, type = 'info') {
      const container = document.getElementById('toastContainer');
      if (!container) return;

      const toast = document.createElement('div');
      toast.className = 'toast';
      const icon = type === 'success' ? '✅' : type === 'warning' ? '⚠️' : type === 'error' ? '❌' : 'ℹ️';
      toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
      container.appendChild(toast);

      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(8px)';
        toast.style.transition = 'all 200ms ease';
        setTimeout(() => toast.remove(), 250);
      }, 3500);
    }
  };

  window.App = App;
  App.init();
});
