// EDVANTA Client Application Controller
// Orchestrates state management, UI rendering, Chart.js visualizations, and role switching

document.addEventListener('DOMContentLoaded', async () => {
  const App = {
    user: null,
    campuses: [],
    tracks: [],
    semesters: [],
    activeTab: 'dashboard',
    activeFilters: {
      campus_id: '',
      track_id: '',
      semester_id: '',
      as_of_date: ''
    },
    dashboardData: null,
    todaySessionsData: null,
    stopwatchInterval: null,
    stopwatchSeconds: 0,
    charts: {
      hours: null,
      status: null
    },

    async init() {
      console.log('🚀 Initializing EDVANTA Client App...');
      this.bindEvents();

      // Check current session or default to quick login as Admin
      const token = API.getToken();
      if (token) {
        try {
          this.user = await API.getMe();
        } catch (e) {
          console.warn('Existing token invalid, logging in as demo admin...');
          await this.quickLogin('ADMIN');
        }
      } else {
        await this.quickLogin('ADMIN');
      }

      await this.loadInitialMetadata();
      await this.updateUserRoleUI();
      await this.refreshActiveTab();
      this.startAlertsPolling();
    },

    bindEvents() {
      // Role Switcher
      const roleSelect = document.getElementById('roleSwitcherSelect');
      if (roleSelect) {
        roleSelect.addEventListener('change', async (e) => {
          const val = e.target.value;
          if (val.startsWith('usr_')) {
            await this.quickLogin(null, val);
          } else {
            await this.quickLogin(val);
          }
        });
      }

      // Nav Tabs
      document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          const target = tab.dataset.tab;
          this.switchTab(target);
        });
      });

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
          this.showToast('Simulation date reset to system local time', 'success');
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

          const res = await API.simulateDate(nextDate);
          this.showToast(`Simulation advanced to ${nextDate}. Checked missed logs!`, 'info');
          await this.refreshActiveTab();
        });
      }
    },

    async quickLogin(role, userId = null) {
      try {
        const data = await API.quickLogin(role, userId);
        this.user = data.user;
        this.showToast(`Logged in as: ${this.user.name} (${this.user.role})`, 'success');
        await this.updateUserRoleUI();
        await this.refreshActiveTab();
      } catch (err) {
        this.showToast(`Login failed: ${err.message}`, 'error');
      }
    },

    async updateUserRoleUI() {
      if (!this.user) return;
      
      const roleSelect = document.getElementById('roleSwitcherSelect');
      if (roleSelect) {
        // Find option that matches
        for (const opt of roleSelect.options) {
          if (opt.value === this.user.id || opt.value === this.user.role) {
            opt.selected = true;
            break;
          }
        }
      }

      const roleBadge = document.getElementById('currentUserBadge');
      if (roleBadge) {
        roleBadge.textContent = `${this.user.name} • ${this.user.role.replace('_', ' ')}`;
      }

      // If Student, automatically force Student view or disable administrative tabs
      const studentTab = document.querySelector('[data-tab="student"]');
      const loggerTab = document.querySelector('[data-tab="logger"]');
      const calendarTab = document.querySelector('[data-tab="calendar"]');
      const importsTab = document.querySelector('[data-tab="imports"]');

      if (this.user.role === 'STUDENT') {
        if (studentTab) studentTab.style.display = 'inline-flex';
        if (loggerTab) loggerTab.style.display = 'none';
        if (calendarTab) calendarTab.style.display = 'none';
        if (importsTab) importsTab.style.display = 'none';
        if (this.activeTab === 'logger' || this.activeTab === 'imports') {
          this.switchTab('student');
        }
      } else {
        if (studentTab) studentTab.style.display = 'inline-flex';
        if (loggerTab) loggerTab.style.display = 'inline-flex';
        if (calendarTab) calendarTab.style.display = 'inline-flex';
        if (importsTab) importsTab.style.display = 'inline-flex';
      }
    },

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
      const campSelect = document.getElementById('campusFilter');
      if (campSelect) {
        campSelect.innerHTML = '<option value="">All Campuses (4)</option>' +
          this.campuses.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
      }

      const trackSelect = document.getElementById('trackFilter');
      if (trackSelect) {
        trackSelect.innerHTML = '<option value="">All Academic Tracks</option>' +
          this.tracks.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
      }

      const semSelect = document.getElementById('semesterFilter');
      if (semSelect) {
        semSelect.innerHTML = '<option value="">All Semesters</option>' +
          this.semesters.map(s => `<option value="${s.id}">${s.name} (${s.batch_name})</option>`).join('');
      }
    },

    switchTab(tabId) {
      this.activeTab = tabId;
      document.querySelectorAll('.nav-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === tabId);
      });

      document.querySelectorAll('.tab-view-content').forEach(view => {
        view.style.display = view.id === `view-${tabId}` ? 'block' : 'none';
      });

      this.refreshActiveTab();
    },

    async refreshActiveTab() {
      if (this.activeTab === 'dashboard') {
        await this.loadDashboard();
      } else if (this.activeTab === 'logger') {
        await this.loadTodayLogger();
      } else if (this.activeTab === 'exams') {
        await this.loadExamReadiness();
      } else if (this.activeTab === 'student') {
        await this.loadStudentView();
      } else if (this.activeTab === 'calendar') {
        await this.loadCalendarAndTimetable();
      } else if (this.activeTab === 'alerts') {
        await this.loadAlertsView();
      } else if (this.activeTab === 'imports') {
        await this.loadImportsView();
      }

      // Refresh alert badge
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
      setInterval(() => this.checkAlertsBadge(), 20000);
    },

    // -------------------------------------------------------------
    // TAB 1: EXECUTIVE DASHBOARD
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
        if (container) container.innerHTML = `<tr><td colspan="10" style="text-align:center; color: var(--accent-rose); padding: 2rem;">Failed to load dashboard: ${err.message}</td></tr>`;
      }
    },

    renderDashboardBanner(summary) {
      const banner = document.getElementById('rolledUpBanner');
      if (!banner) return;

      banner.className = `track-status-banner ${summary.rolledUpTrackStatus.replace(' ', '_')}`;
      
      const badge = document.getElementById('bannerBadge');
      const title = document.getElementById('bannerTitle');
      const desc = document.getElementById('bannerDesc');

      badge.textContent = summary.rolledUpTrackStatus;
      badge.className = `banner-badge ${
        summary.rolledUpTrackStatus === 'DANGER' ? 'badge-danger' :
        summary.rolledUpTrackStatus === 'TIGHT' ? 'badge-tight' :
        summary.rolledUpTrackStatus === 'ON TRACK' ? 'badge-ontrack' : 'badge-complete'
      }`;

      if (summary.rolledUpTrackStatus === 'DANGER') {
        title.textContent = 'Critical Alert: Track Status is in DANGER';
        desc.textContent = 'Executive Warning: One or more subjects have a Buffer Ratio < 1.00. Track overall health is determined by the worst-performing subject, not an average.';
      } else if (summary.rolledUpTrackStatus === 'TIGHT') {
        title.textContent = 'Advisory: Track Status is TIGHT (1.00 <= Buffer < 1.15)';
        desc.textContent = 'Attention Required: Syllabus progression has minimal buffer before target completion date. Schedule makeup sessions if needed.';
      } else if (summary.rolledUpTrackStatus === 'ON TRACK') {
        title.textContent = 'Optimal Progression: Track is ON TRACK (Buffer >= 1.15)';
        desc.textContent = 'All enrolled subjects are scheduled comfortably with sufficient teaching hours remaining before examinations.';
      } else {
        title.textContent = 'Track Complete: All In-Scope Syllabus Delivered';
        desc.textContent = '100% of curriculum topics have been completed for this semester.';
      }
    },

    renderDashboardKPIs(summary) {
      const elTotal = document.getElementById('kpiTotalSubjects');
      const elOnTrack = document.getElementById('kpiOnTrack');
      const elTight = document.getElementById('kpiTight');
      const elDanger = document.getElementById('kpiDanger');
      const elCoverage = document.getElementById('kpiCoveragePercent');
      const elBuffer = document.getElementById('kpiBufferRatio');
      const elPace = document.getElementById('kpiPaceVsPlan');
      const elOverdue = document.getElementById('kpiOverdueTopics');

      if (elTotal) elTotal.textContent = summary.totalSubjects;
      if (elOnTrack) elOnTrack.textContent = summary.statusCounts.onTrack;
      if (elTight) elTight.textContent = summary.statusCounts.tight;
      if (elDanger) elDanger.textContent = summary.statusCounts.danger;
      if (elCoverage) elCoverage.textContent = `${summary.hours.coveragePercent}%`;
      if (elBuffer) elBuffer.textContent = summary.hours.bufferRatio >= 90 ? 'Complete' : summary.hours.bufferRatio;
      
      if (elPace) {
        const paceVal = summary.hours.paceVsPlan;
        elPace.textContent = `${paceVal > 0 ? '+' : ''}${paceVal} hrs`;
        elPace.style.color = paceVal < 0 ? 'var(--accent-rose)' : 'var(--accent-emerald)';
      }

      if (elOverdue) {
        elOverdue.textContent = summary.hours.overdueTopics;
        elOverdue.style.color = summary.hours.overdueTopics > 0 ? 'var(--accent-rose)' : 'var(--text-main)';
      }
    },

    renderDashboardCharts(subjects, summary) {
      if (typeof Chart === 'undefined') return;

      // 1. Planned vs Covered Hours Bar Chart
      const hoursCanvas = document.getElementById('chartHoursOverview');
      if (hoursCanvas) {
        if (this.charts.hours) this.charts.hours.destroy();

        const labels = subjects.map(s => s.code);
        const plannedData = subjects.map(s => s.hoursInScope);
        const coveredData = subjects.map(s => s.coveredHours);
        const availableData = subjects.map(s => s.availableHours);

        this.charts.hours = new Chart(hoursCanvas, {
          type: 'bar',
          data: {
            labels,
            datasets: [
              {
                label: 'Covered Hours',
                data: coveredData,
                backgroundColor: 'rgba(16, 185, 129, 0.8)',
                borderRadius: 4
              },
              {
                label: 'Remaining Hours',
                data: subjects.map(s => s.remainingHours),
                backgroundColor: 'rgba(239, 68, 68, 0.75)',
                borderRadius: 4
              },
              {
                label: 'Available Scheduled Hours',
                data: availableData,
                backgroundColor: 'rgba(6, 182, 212, 0.75)',
                borderRadius: 4
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                labels: { color: '#94a3b8', font: { family: 'Plus Jakarta Sans', size: 11 } }
              }
            },
            scales: {
              x: {
                grid: { color: 'rgba(255, 255, 255, 0.05)' },
                ticks: { color: '#94a3b8' }
              },
              y: {
                grid: { color: 'rgba(255, 255, 255, 0.05)' },
                ticks: { color: '#94a3b8' },
                title: { display: true, text: 'Teaching Hours', color: '#64748b' }
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
                '#10b981',
                '#f59e0b',
                '#ef4444',
                '#06b6d4'
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
                labels: { color: '#94a3b8', font: { family: 'Plus Jakarta Sans', size: 11 } }
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
        const paceClass = s.paceVsPlan < 0 ? 'color: var(--accent-rose); font-weight: 700;' : 'color: var(--accent-emerald); font-weight: 700;';
        const bufferDisplay = s.status === 'COMPLETE' ? 'Complete' : s.bufferRatio;

        return `
          <tr>
            <td>
              <div style="font-weight: 700; font-size: 0.95rem;">${s.code}</div>
              <div style="font-size: 0.75rem; color: var(--text-dim);">${s.name}</div>
            </td>
            <td>
              <div style="font-size: 0.8rem;">${s.campusName}</div>
              <div style="font-size: 0.7rem; color: var(--text-dim);">${s.batchName}</div>
            </td>
            <td style="font-family: 'JetBrains Mono';">${s.hoursInScope}</td>
            <td style="font-family: 'JetBrains Mono'; color: var(--accent-emerald);">${s.coveredHours}</td>
            <td style="font-family: 'JetBrains Mono'; color: ${s.remainingHours > 0 ? 'var(--accent-amber)' : 'var(--text-muted)'};">${s.remainingHours}</td>
            <td style="font-family: 'JetBrains Mono'; color: var(--accent-cyan);">${s.availableHours}</td>
            <td style="font-family: 'JetBrains Mono'; font-weight: 700;">${bufferDisplay}</td>
            <td>
              <div style="font-size: 0.8rem; font-weight: 700;">${s.coveragePercent}%</div>
              <div class="progress-bar-container" style="width: 80px;">
                <div class="progress-bar-fill" style="width: ${s.coveragePercent}%; background: ${s.status === 'DANGER' ? 'var(--accent-rose)' : 'var(--accent-emerald)'};"></div>
              </div>
            </td>
            <td style="${paceClass}">
              ${s.paceVsPlan > 0 ? '+' : ''}${s.paceVsPlan} hrs
            </td>
            <td>
              <span class="badge-status ${s.status.replace(' ', '_')}">${s.status}</span>
              <button class="btn-secondary" style="padding: 0.2rem 0.5rem; font-size: 0.7rem; margin-left: 0.4rem;" onclick="App.showTraceabilityModal('${s.subjectId}')">
                Trace 🔍
              </button>
            </td>
          </tr>
        `;
      }).join('');
    },

    showTraceabilityModal(subjectId) {
      if (!this.dashboardData) return;
      const subj = this.dashboardData.subjects.find(s => s.subjectId === subjectId);
      if (!subj) return;

      const modal = document.getElementById('traceabilityModal');
      const body = document.getElementById('traceabilityModalBody');
      if (!modal || !body) return;

      body.innerHTML = `
        <div style="margin-bottom: 1rem;">
          <h3 style="font-size: 1.1rem; font-weight: 800; color: #fff;">${subj.code}: ${subj.name}</h3>
          <p style="font-size: 0.8rem; color: var(--text-muted);">${subj.campusName} • ${subj.trackName} (${subj.batchName})</p>
        </div>

        <div class="trace-formula-box">
          <div style="color: #fff; font-weight: 700; margin-bottom: 0.25rem;">1. Buffer Ratio Formula:</div>
          <div>bufferRatio = availableHours / remainingHours</div>
          <div style="color: var(--text-main); margin-top: 0.25rem;">
            ${subj.availableHours} available hrs / ${subj.remainingHours} remaining hrs = <strong>${subj.bufferRatio}</strong>
          </div>
          <div style="margin-top: 0.35rem; color: ${subj.status === 'DANGER' ? 'var(--accent-rose)' : subj.status === 'TIGHT' ? 'var(--accent-amber)' : 'var(--accent-emerald)'};">
            → Threshold Classification: <strong>${subj.status}</strong> (${subj.bufferRatio >= 1.15 ? 'Ratio >= 1.15 (ON TRACK)' : subj.bufferRatio >= 1.00 ? '1.00 <= Ratio < 1.15 (TIGHT)' : 'Ratio < 1.00 (DANGER)'})
          </div>
        </div>

        <div class="trace-formula-box">
          <div style="color: #fff; font-weight: 700; margin-bottom: 0.25rem;">2. Pace vs Plan Formula:</div>
          <div>paceVsPlan = coveredHours - hoursExpectedByToday</div>
          <div style="color: var(--text-main); margin-top: 0.25rem;">
            ${subj.coveredHours} covered hrs - ${subj.hoursExpectedByToday} expected hrs = <strong>${subj.paceVsPlan} hrs</strong>
          </div>
          <div style="margin-top: 0.35rem; color: ${subj.paceVsPlan < 0 ? 'var(--accent-rose)' : 'var(--accent-emerald)'};">
            ${subj.paceVsPlan < 0 ? '⚠️ Behind Schedule: Academic delay of ' + Math.abs(subj.paceVsPlan) + ' teaching hours' : '✅ Ahead / On Schedule'}
          </div>
        </div>

        <div class="trace-formula-box">
          <div style="color: #fff; font-weight: 700; margin-bottom: 0.25rem;">3. Overdue Topics Count:</div>
          <div>Total Overdue: <strong>${subj.overdueTopicsCount}</strong> topic(s) whose planned date has passed but are not completed.</div>
          ${subj.overdueTopics.length > 0 ? `
            <ul style="margin-top: 0.5rem; padding-left: 1.25rem; font-size: 0.75rem; color: #fca5a5;">
              ${subj.overdueTopics.map(t => `<li><strong>${t.title}</strong> (Planned: ${t.planned_date}, Status: ${t.status}, ${t.completion_percentage}%)</li>`).join('')}
            </ul>
          ` : '<div style="color: var(--accent-emerald); margin-top: 0.25rem;">No overdue topics.</div>'}
        </div>

        <div style="font-size: 0.75rem; color: var(--text-dim); margin-top: 1rem;">
          Calculated as of <strong>${subj.asOfDate}</strong> against Target Finish Date <strong>${subj.targetFinishDate}</strong> (Working Saturdays Rule: SECOND_AND_FOURTH).
        </div>
      `;

      modal.classList.add('active');
    },

    closeModal(modalId) {
      const modal = document.getElementById(modalId);
      if (modal) modal.classList.remove('active');
    },

    // -------------------------------------------------------------
    // TAB 2: DAILY FACULTY SESSION LOGGER (<60s Flow)
    // -------------------------------------------------------------
    async loadTodayLogger() {
      const listContainer = document.getElementById('todaySessionsList');
      if (!listContainer) return;

      listContainer.innerHTML = '<div style="text-align:center; padding: 2rem;">Loading today\'s teaching schedule...</div>';

      try {
        const data = await API.getTodaySessions();
        this.todaySessionsData = data;

        const datePill = document.getElementById('loggerDateDisplay');
        if (datePill) datePill.textContent = `${data.dayName}, ${data.activeDate}`;

        if (!data.sessions || data.sessions.length === 0) {
          listContainer.innerHTML = `
            <div class="glass-card" style="text-align:center; padding: 2rem;">
              <p style="color: var(--text-muted); font-size: 0.95rem;">No timetable sessions scheduled for ${data.dayName} (${data.activeDate}) for this profile.</p>
              <p style="font-size: 0.8rem; color: var(--text-dim); margin-top: 0.5rem;">Switch role to <strong>Dr. Aris Thorne (Faculty)</strong> or change weekday in timetable.</p>
            </div>
          `;
          return;
        }

        listContainer.innerHTML = data.sessions.map((item, idx) => {
          const s = item.slot;
          const isLogged = item.isLogged;
          const nextTopic = item.suggestedTopic;

          return `
            <div class="glass-card" style="margin-bottom: 1rem; border-left: 4px solid ${isLogged ? 'var(--accent-emerald)' : 'var(--accent-amber)'};">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
                <div>
                  <span style="font-size: 0.75rem; font-weight: 700; color: var(--accent-cyan); text-transform: uppercase;">
                    ${s.start_time} - ${s.end_time} (${s.duration_hours} hrs) • ${s.room || 'Main Hall'}
                  </span>
                  <h4 style="font-size: 1.1rem; font-weight: 800; color: #fff; margin-top: 0.15rem;">
                    ${s.subject_code}: ${s.subject_name}
                  </h4>
                  <p style="font-size: 0.8rem; color: var(--text-muted);">${s.campus_name} • ${s.batch_name}</p>
                </div>
                <div>
                  ${isLogged ? `
                    <span class="badge-status COMPLETE">Logged (${item.loggedSession.status})</span>
                  ` : `
                    <button class="btn-primary" style="padding: 0.45rem 0.9rem; font-size: 0.8rem;" onclick="App.openInstantLogger(${idx})">
                      ⚡ Quick Log (under 60s)
                    </button>
                  `}
                </div>
              </div>

              ${nextTopic ? `
                <div style="background: rgba(15, 23, 42, 0.6); padding: 0.6rem 0.85rem; border-radius: var(--radius-sm); font-size: 0.8rem; margin-top: 0.5rem; display: flex; align-items: center; justify-content: space-between;">
                  <div>
                    <span style="color: var(--text-dim); font-weight: 600;">Next In Sequence:</span>
                    <strong style="color: #fff; margin-left: 0.25rem;">Unit ${nextTopic.unit_number}: ${nextTopic.topic_title}</strong>
                  </div>
                  <span style="color: var(--accent-indigo); font-family: 'JetBrains Mono'; font-weight: 700;">${nextTopic.planned_hours} hrs</span>
                </div>
              ` : ''}
            </div>
          `;
        }).join('');
      } catch (err) {
        listContainer.innerHTML = `<div style="color: var(--accent-rose); padding: 1.5rem;">Error loading schedule: ${err.message}</div>`;
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
        <strong>${s.subject_code} - ${s.subject_name}</strong><br>
        <span style="font-size: 0.8rem; color: var(--text-muted);">${s.batch_name} • ${s.start_time} - ${s.end_time} (${s.duration_hours} hrs)</span>
      `;

      if (topic) {
        document.getElementById('logModalTopicInput').value = topic.topic_title;
      } else {
        document.getElementById('logModalTopicInput').value = '';
      }

      // Reset stopwatch
      this.startStopwatch();

      // Reset status chips to COMPLETED
      this.selectStatusChip('COMPLETED');
      this.selectPctPill(100);

      modal.classList.add('active');
    },

    startStopwatch() {
      clearInterval(this.stopwatchInterval);
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
      clearInterval(this.stopwatchInterval);
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

        const res = await API.logSession(payload);
        this.closeModal('sessionLoggerModal');
        this.showToast(`Logged in ${elapsed} seconds! Progress updated.`, 'success');
        await this.loadTodayLogger();
      } catch (err) {
        this.showToast(`Error logging session: ${err.message}`, 'error');
      }
    },

    // -------------------------------------------------------------
    // TAB 3: EXAM READINESS HUB
    // -------------------------------------------------------------
    async loadExamReadiness() {
      const container = document.getElementById('examCardsContainer');
      if (!container) return;

      container.innerHTML = '<div style="text-align:center; padding: 2rem;">Evaluating examination readiness models...</div>';

      try {
        const data = await API.getExamReadiness(this.activeFilters.semester_id);
        const exams = data.exams || [];

        if (exams.length === 0) {
          container.innerHTML = '<div class="glass-card" style="padding: 2rem; text-align: center;">No upcoming examinations configured for this semester.</div>';
          return;
        }

        container.innerHTML = exams.map(exam => {
          const riskBadgeClass = exam.riskStatus === 'READY' ? 'badge-ontrack' :
                                exam.riskStatus === 'LOW_RISK' ? 'badge-ontrack' :
                                exam.riskStatus === 'MEDIUM_RISK' ? 'badge-tight' : 'badge-danger';

          return `
            <div class="glass-card exam-card">
              <div>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                  <span class="banner-badge ${riskBadgeClass}">
                    ${exam.riskStatus.replace('_', ' ')}
                  </span>
                  <span style="font-size: 0.75rem; color: var(--accent-cyan); font-weight: 700;">
                    ${exam.weightage}% Semester Weight
                  </span>
                </div>

                <h3 style="font-size: 1.15rem; font-weight: 800; color: #fff; margin-bottom: 0.25rem;">
                  ${exam.name}
                </h3>
                <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 1rem;">
                  📅 Exam Window: <strong>${exam.startDate}</strong> to <strong>${exam.endDate}</strong>
                </p>

                <div style="margin-bottom: 1rem;">
                  <div style="display: flex; justify-content: space-between; font-size: 0.8rem; font-weight: 700; margin-bottom: 0.25rem;">
                    <span>Syllabus Scope Covered</span>
                    <span>${exam.coveragePercent}% (${exam.coveredHours} / ${exam.inScopeHours} hrs)</span>
                  </div>
                  <div class="progress-bar-container">
                    <div class="progress-bar-fill" style="width: ${exam.coveragePercent}%; background: ${exam.riskStatus === 'HIGH_RISK' ? 'var(--accent-rose)' : 'var(--accent-emerald)'};"></div>
                  </div>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; font-size: 0.75rem; background: rgba(15, 23, 42, 0.5); padding: 0.75rem; border-radius: var(--radius-sm); margin-bottom: 1rem;">
                  <div>
                    <div style="color: var(--text-dim);">Remaining Scope:</div>
                    <strong style="color: #fff; font-family: 'JetBrains Mono';">${exam.remainingHours} hrs</strong>
                  </div>
                  <div>
                    <div style="color: var(--text-dim);">Teaching Hours Before Exam:</div>
                    <strong style="color: var(--accent-cyan); font-family: 'JetBrains Mono';">${exam.availableHoursBeforeExam} hrs</strong>
                  </div>
                </div>

                <div>
                  <h5 style="font-size: 0.75rem; font-weight: 700; color: var(--text-dim); text-transform: uppercase; margin-bottom: 0.35rem;">Subject Readiness Breakdown:</h5>
                  ${exam.subjects.map(s => `
                    <div style="display: flex; justify-content: space-between; font-size: 0.75rem; padding: 0.3rem 0; border-bottom: 1px solid var(--border-glass);">
                      <span><strong>${s.code}</strong> (${s.coveredHours}/${s.inScopeHours} hrs)</span>
                      <span class="badge-status ${s.riskStatus.replace('_', ' ')}" style="font-size: 0.65rem; padding: 0.15rem 0.4rem;">${s.riskStatus.replace('_', ' ')}</span>
                    </div>
                  `).join('')}
                </div>
              </div>
            </div>
          `;
        }).join('');
      } catch (err) {
        container.innerHTML = `<div style="color: var(--accent-rose); padding: 1.5rem;">Error: ${err.message}</div>`;
      }
    },

    // -------------------------------------------------------------
    // TAB 4: STUDENT PORTAL (Read-Only)
    // -------------------------------------------------------------
    async loadStudentView() {
      const container = document.getElementById('studentPortalContent');
      if (!container) return;

      container.innerHTML = '<div style="text-align:center; padding: 2rem;">Loading student syllabus and exam milestones...</div>';

      try {
        const batchName = (this.user && this.user.batch_name) ? this.user.batch_name : 'Batch-2026-Mirai-A';
        const data = await API.getDashboard({ batch_name: batchName });

        container.innerHTML = `
          <div class="glass-card" style="margin-bottom: 1.5rem; border-left: 4px solid var(--accent-cyan);">
            <h3 style="font-size: 1.2rem; font-weight: 800; color: #fff;">🎓 Student Academic Hub</h3>
            <p style="font-size: 0.85rem; color: var(--text-muted); margin-top: 0.25rem;">
              Enrolled Batch: <strong>${batchName}</strong> • Real-time curriculum completion tracking and upcoming examinations
            </p>
          </div>

          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1.25rem;">
            ${data.subjects.map(subj => `
              <div class="glass-card">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.75rem;">
                  <div>
                    <h4 style="font-size: 1.1rem; font-weight: 800; color: #fff;">${subj.code}</h4>
                    <p style="font-size: 0.8rem; color: var(--text-muted);">${subj.name}</p>
                  </div>
                  <span class="badge-status ${subj.status.replace(' ', '_')}">${subj.status}</span>
                </div>

                <div style="margin-bottom: 0.75rem;">
                  <div style="display: flex; justify-content: space-between; font-size: 0.8rem; font-weight: 700; margin-bottom: 0.25rem;">
                    <span>Course Progression</span>
                    <span>${subj.coveragePercent}%</span>
                  </div>
                  <div class="progress-bar-container">
                    <div class="progress-bar-fill" style="width: ${subj.coveragePercent}%; background: var(--accent-emerald);"></div>
                  </div>
                  <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--text-dim); margin-top: 0.25rem;">
                    <span>${subj.coveredHours} hrs covered</span>
                    <span>${subj.remainingHours} hrs remaining</span>
                  </div>
                </div>

                <div style="border-top: 1px solid var(--border-glass); padding-top: 0.75rem;">
                  <button class="btn-secondary" style="width: 100%; justify-content: center;" onclick="App.showStudentTopicBreakdown('${subj.subjectId}')">
                    📖 View Syllabus & Topics
                  </button>
                </div>
              </div>
            `).join('')}
          </div>
        `;
      } catch (err) {
        container.innerHTML = `<div style="color: var(--accent-rose); padding: 1.5rem;">Error loading student view: ${err.message}</div>`;
      }
    },

    async showStudentTopicBreakdown(subjectId) {
      const modal = document.getElementById('studentTopicsModal');
      const body = document.getElementById('studentTopicsModalBody');
      if (!modal || !body) return;

      body.innerHTML = '<div>Loading syllabus topics...</div>';
      modal.classList.add('active');

      try {
        const data = await API.getSubjectTopics(subjectId);
        const topics = data.topics || [];

        body.innerHTML = `
          <div style="margin-bottom: 1rem;">
            <h3 style="font-size: 1.1rem; font-weight: 800; color: #fff;">Syllabus Topic Breakdown</h3>
            <p style="font-size: 0.8rem; color: var(--text-muted);">Verified topics and planned teaching schedule</p>
          </div>
          <div style="display: flex; flex-direction: column; gap: 0.5rem; max-height: 60vh; overflow-y: auto;">
            ${topics.map(t => `
              <div style="background: rgba(15, 23, 42, 0.6); padding: 0.75rem; border-radius: var(--radius-sm); border: 1px solid var(--border-glass); display: flex; align-items: center; justify-content: space-between;">
                <div>
                  <div style="font-size: 0.85rem; font-weight: 700; color: #fff;">
                    ${t.status === 'COMPLETED' ? '✅' : t.status === 'IN_PROGRESS' ? '⏳' : '⚪'} 
                    Unit ${t.unit_number}: ${t.topic_title}
                  </div>
                  <div style="font-size: 0.75rem; color: var(--text-dim); margin-top: 0.15rem;">
                    Planned Date: <strong>${t.planned_date || 'TBD'}</strong> • Scope: ${t.exam_scope}
                  </div>
                </div>
                <div style="text-align: right;">
                  <span class="badge-status ${t.status.replace(' ', '_')}" style="font-size: 0.7rem;">${t.status}</span>
                  <div style="font-size: 0.7rem; color: var(--text-dim); margin-top: 0.2rem;">${t.planned_hours} hrs</div>
                </div>
              </div>
            `).join('')}
          </div>
        `;
      } catch (err) {
        body.innerHTML = `<div style="color: var(--accent-rose);">Error: ${err.message}</div>`;
      }
    },

    // -------------------------------------------------------------
    // TAB 5: CALENDAR & TIMETABLE
    // -------------------------------------------------------------
    async loadCalendarAndTimetable() {
      const container = document.getElementById('timetableContainer');
      if (!container) return;

      container.innerHTML = '<div style="text-align:center; padding: 2rem;">Loading timetable and academic calendar rules...</div>';

      try {
        const tData = await API.getTimetable(this.activeFilters);
        const slots = tData.slots || [];

        const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

        container.innerHTML = `
          <div class="glass-card" style="margin-bottom: 1.5rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
            <div>
              <h3 style="font-size: 1.15rem; font-weight: 800; color: #fff;">Weekly Master Timetable</h3>
              <p style="font-size: 0.8rem; color: var(--text-muted);">Configured working Saturday rule: <strong>SECOND_AND_FOURTH</strong> (2nd & 4th Sat working, others off)</p>
            </div>
            <div>
              <button class="btn-primary" style="font-size: 0.8rem; padding: 0.5rem 1rem;" onclick="App.openAddHolidayModal()">
                ➕ Add Campus Holiday / Event
              </button>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem;">
            ${weekdays.map((dayName, idx) => {
              const dow = idx + 1;
              const daySlots = slots.filter(s => s.weekday === dow);

              return `
                <div class="glass-card" style="padding: 1rem;">
                  <div style="font-weight: 800; font-size: 0.95rem; margin-bottom: 0.75rem; color: var(--accent-cyan); display: flex; justify-content: space-between;">
                    <span>${dayName}</span>
                    <span style="font-size: 0.75rem; color: var(--text-dim);">${daySlots.length} slot(s)</span>
                  </div>

                  ${daySlots.length === 0 ? `
                    <div style="font-size: 0.75rem; color: var(--text-dim); text-align: center; padding: 1rem;">No slots scheduled</div>
                  ` : `
                    <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                      ${daySlots.map(s => `
                        <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid var(--border-glass); border-radius: var(--radius-sm); padding: 0.6rem; font-size: 0.8rem;">
                          <div style="display: flex; justify-content: space-between; font-weight: 700;">
                            <span style="color: #fff;">${s.subject_code}</span>
                            <span style="color: var(--accent-indigo); font-family: 'JetBrains Mono';">${s.duration_hours} hrs</span>
                          </div>
                          <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.15rem;">${s.start_time} - ${s.end_time} • ${s.faculty_name}</div>
                          <div style="font-size: 0.7rem; color: var(--text-dim);">${s.batch_name}</div>
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
        container.innerHTML = `<div style="color: var(--accent-rose); padding: 1.5rem;">Error: ${err.message}</div>`;
      }
    },

    openAddHolidayModal() {
      const modal = document.getElementById('addHolidayModal');
      if (modal) modal.classList.add('active');
    },

    async submitAddHoliday() {
      const semId = this.activeFilters.semester_id || 'sem_hitech_mirai_a';
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
    // TAB 6: MISSED-SESSION ALERTS
    // -------------------------------------------------------------
    async loadAlertsView() {
      const container = document.getElementById('alertsListContainer');
      if (!container) return;

      container.innerHTML = '<div style="text-align:center; padding: 2rem;">Scanning academic reminders and escalations...</div>';

      try {
        const data = await API.getAlerts();
        const alerts = data.alerts || [];

        const simDateDisplay = document.getElementById('simDateControllerDisplay');
        if (simDateDisplay) simDateDisplay.textContent = data.activeSimulationDate;

        if (alerts.length === 0) {
          container.innerHTML = `
            <div class="glass-card" style="text-align: center; padding: 2.5rem;">
              <div style="font-size: 2rem; margin-bottom: 0.5rem;">🎉</div>
              <h4 style="font-size: 1.1rem; font-weight: 800; color: #fff;">All Sessions Logged Up to Date</h4>
              <p style="font-size: 0.85rem; color: var(--text-muted); margin-top: 0.25rem;">
                No unlogged teaching sessions detected as of <strong>${data.activeSimulationDate}</strong>.
              </p>
              <p style="font-size: 0.8rem; color: var(--accent-cyan); margin-top: 0.5rem;">
                Tip: Click "Advance 2 Days" above to simulate time progression and test escalation alerts!
              </p>
            </div>
          `;
          return;
        }

        container.innerHTML = alerts.map(a => {
          const isDanger = a.severity === 'DANGER';
          return `
            <div class="glass-card" style="margin-bottom: 0.75rem; border-left: 4px solid ${isDanger ? 'var(--accent-rose)' : 'var(--accent-amber)'}; opacity: ${a.is_read ? '0.6' : '1'};">
              <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                <div>
                  <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem;">
                    <span class="banner-badge ${isDanger ? 'badge-danger' : 'badge-tight'}" style="font-size: 0.65rem; padding: 0.2rem 0.5rem;">
                      ${a.alert_type}
                    </span>
                    <span style="font-size: 0.75rem; color: var(--text-dim);">${a.created_at}</span>
                  </div>
                  <div style="font-size: 0.9rem; color: #fff; font-weight: 600; margin-top: 0.25rem;">
                    ${a.message}
                  </div>
                  <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem;">
                    Recipient Role: <strong>${a.recipient_role}</strong> • Campus: ${a.campus_name || 'All'}
                  </div>
                </div>
                ${!a.is_read ? `
                  <button class="btn-secondary" style="font-size: 0.75rem; padding: 0.3rem 0.6rem;" onclick="App.markAlertRead('${a.id}')">
                    Mark Read
                  </button>
                ` : '<span style="font-size: 0.75rem; color: var(--text-dim);">Read</span>'}
              </div>
            </div>
          `;
        }).join('');
      } catch (err) {
        container.innerHTML = `<div style="color: var(--accent-rose); padding: 1.5rem;">Error: ${err.message}</div>`;
      }
    },

    async markAlertRead(alertId) {
      await API.markAlertRead(alertId);
      await this.loadAlertsView();
      await this.checkAlertsBadge();
    },

    // -------------------------------------------------------------
    // TAB 7: CSV IMPORT / EXPORT
    // -------------------------------------------------------------
    async loadImportsView() {
      // Setup default view
    },

    async handleCSVUpload(type, inputElement) {
      const file = inputElement.files[0];
      if (!file) return;

      const formData = new FormData();
      formData.append('file', file);

      try {
        const res = await API.importCSV(type, formData);
        this.showToast(res.message, 'success');
        inputElement.value = '';
      } catch (err) {
        this.showToast(`Import Error: ${err.message}`, 'error');
      }
    },

    // Utilities
    showToast(message, type = 'info') {
      const container = document.getElementById('toastContainer');
      if (!container) return;

      const toast = document.createElement('div');
      toast.className = `toast ${type}`;
      toast.innerHTML = `<span>${type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}</span><span>${message}</span>`;
      container.appendChild(toast);

      setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
      }, 4000);
    }
  };

  window.App = App;
  await App.init();
});
