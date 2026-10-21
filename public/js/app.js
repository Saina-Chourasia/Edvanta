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
    allAttendanceRecords: [],
    attCountdownInterval: null,
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
      this.initGreetingTimer();

      // Check URL query parameters for Google OAuth callback results or error notifications
      const urlParams = new URLSearchParams(window.location.search);
      const authError = urlParams.get('auth_error');
      const authSuccess = urlParams.get('auth_success');
      const authEmail = urlParams.get('email');

      if (authError) {
        window.history.replaceState({}, document.title, window.location.pathname);
        let errorMsg = 'Google authentication could not be completed.';
        if (authError === 'google_unconfigured') {
          errorMsg = 'Google OAuth credentials are not configured on this server. To enable real Google Sign-In, please set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_CALLBACK_URL in your server .env file.';
        } else if (authError === 'unauthorized_account') {
          errorMsg = `Unauthorized Google Account: The email "${authEmail || 'entered'}" is not registered in the MSOT academic database. Only authorized Mirai School of Technology students and faculty may sign in. (To authorize this Google account, register this email address in MSOT or set GOOGLE_ALLOWED_EMAIL in your .env file).`;
        } else if (authError === 'invalid_state') {
          errorMsg = 'Authentication security check failed: Invalid or expired state token. Please try signing in with Google again.';
        } else if (authError === 'google_access_denied') {
          errorMsg = 'Google sign-in was cancelled by the user.';
        } else if (authError === 'unverified_google_email') {
          errorMsg = 'The provided Google account email address is not verified by Google.';
        } else if (authError === 'token_exchange_failed') {
          errorMsg = 'Failed to exchange authorization credentials with Google. Please check your network and Google OAuth settings.';
        } else {
          errorMsg = `Google sign-in error: ${authError}.`;
        }

        this.openAuthModal();
        const errBanner = document.getElementById('authErrorBanner');
        const errMsg = document.getElementById('authErrorMsg');
        if (errBanner && errMsg) {
          errMsg.textContent = errorMsg;
          errBanner.style.display = 'flex';
        }
        this.showToast(errorMsg, 'error');
        return;
      }

      if (authSuccess === '1') {
        const urlToken = urlParams.get('token');
        if (urlToken) {
          API.setToken(urlToken);
        }
        window.history.replaceState({}, document.title, window.location.pathname);
        const token = urlToken || API.getToken();
        if (token) {
          API.setToken(token);
          try {
            this.user = await API.getMe();
            this.updateNavbarAuthStatus();
            this.showToast(`Welcome to EDVANTA, ${this.user.name}! Authenticated via Google.`, 'success');
            await this.onLoginSuccess();
            return;
          } catch (e) {
            console.error('Failed to initialize session after Google login:', e);
          }
        }
      }

      const token = API.getToken();
      if (token) {
        try {
          this.user = await API.getMe();
          this.updateNavbarAuthStatus();
          const lastView = localStorage.getItem('edvanta_view');
          if (lastView === 'landing') {
            this.showLandingPage();
          } else {
            await this.onLoginSuccess();
          }
        } catch (e) {
          console.warn('Session token expired or invalid:', e.message);
          await API.logout();
          this.user = null;
          this.updateNavbarAuthStatus();
          this.showLandingPage();
        }
      } else {
        this.updateNavbarAuthStatus();
        this.showLandingPage();
      }
    },

    // Show Public Landing Page without losing authenticated state
    showLandingPage(event) {
      if (event) event.preventDefault();

      localStorage.setItem('edvanta_view', 'landing');

      const landing = document.getElementById('landingView');
      const login = document.getElementById('loginView');
      const shell = document.getElementById('appShell');
      const publicNav = document.getElementById('publicTopNav');

      if (landing) landing.style.display = 'flex';
      if (login) login.style.display = 'none';
      if (shell) shell.style.display = 'none';
      if (publicNav) publicNav.style.display = 'block';

      this.updateNavbarAuthStatus();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    // Smooth scroll down to MSOT Unified Campus Network section
    scrollToCampuses(event) {
      if (event) event.preventDefault();
      const el = document.getElementById('landingCampuses');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth' });
      }
    },

    // Return to the authenticated user's active portal
    async returnToPortal() {
      if (!this.user) {
        this.openAuthModal();
        return;
      }
      localStorage.setItem('edvanta_view', 'portal');
      await this.onLoginSuccess();
    },

    // Synchronize Top Navbar with current user session
    updateNavbarAuthStatus() {
      const authContainer = document.getElementById('navAuthenticatedContainer');
      const unauthContainer = document.getElementById('navUnauthenticatedContainer');
      const heroBtn = document.getElementById('btnHeroGetStarted');

      if (this.user) {
        if (authContainer) authContainer.style.display = 'flex';
        if (unauthContainer) unauthContainer.style.display = 'none';
        const avatarEl = document.getElementById('navUserAvatar');
        const nameEl = document.getElementById('navUserName');
        const badgeEl = document.getElementById('navRoleBadge');
        if (avatarEl) avatarEl.textContent = (this.user.name || this.user.role || 'U').charAt(0).toUpperCase();
        if (nameEl) nameEl.textContent = this.user.name || this.user.email;
        if (badgeEl) badgeEl.textContent = this.user.role;
        if (heroBtn) heroBtn.textContent = 'Enter Portal →';
      } else {
        if (authContainer) authContainer.style.display = 'none';
        if (unauthContainer) unauthContainer.style.display = 'block';
        if (heroBtn) heroBtn.textContent = 'Get Started →';
      }
    },

    // Hero Get Started action
    handleHeroGetStarted() {
      if (this.user) {
        this.returnToPortal();
      } else {
        this.openAuthModal();
      }
    },

    // Modal Exclusivity & Control
    openModal(modalId) {
      const allModals = ['exploreFeaturesModal', 'authModal', 'aboutModal', 'contactModal', 'studentTopicsModal', 'addHolidayModal', 'telegramModal', 'whatsappModal', 'changePasswordModal', 'aiModal'];
      allModals.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });
      const target = document.getElementById(modalId);
      if (target) {
        target.style.display = 'flex';
      }
    },

    closeModal(modalId) {
      const el = document.getElementById(modalId);
      if (el) el.style.display = 'none';
    },

    handleBackdropClick(event, modalId) {
      if (event && event.target && event.target.id === modalId) {
        this.closeModal(modalId);
      }
    },

    openExploreFeaturesModal(event) {
      if (event) event.preventDefault();
      this.openModal('exploreFeaturesModal');
    },

    openAuthModal(event) {
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      this.openModal('authModal');
      this.switchAuthTab('password');
    },

    openAboutModal(event) {
      if (event) event.preventDefault();
      this.openModal('aboutModal');
    },

    openContactModal(event) {
      if (event) event.preventDefault();
      this.openModal('contactModal');
    },

    switchAuthTab(tab) {
      const phoneTab = document.getElementById('authTabPhone');
      const passTab = document.getElementById('authTabPassword');
      const demoTab = document.getElementById('authTabDemo');

      const btnPhone = document.getElementById('tabBtnPhoneAuth');
      const btnPass = document.getElementById('tabBtnPasswordAuth');
      const btnDemo = document.getElementById('tabBtnDemoAuth');

      if (phoneTab) phoneTab.style.display = tab === 'phone' ? 'block' : 'none';
      if (passTab) passTab.style.display = tab === 'password' ? 'block' : 'none';
      if (demoTab) demoTab.style.display = tab === 'demo' ? 'block' : 'none';

      if (btnPhone) btnPhone.classList.toggle('active', tab === 'phone');
      if (btnPass) btnPass.classList.toggle('active', tab === 'password');
      if (btnDemo) btnDemo.classList.toggle('active', tab === 'demo');

      const noticeBanner = document.getElementById('authNoticeBanner');
      const errBanner = document.getElementById('authErrorBanner');
      if (noticeBanner) noticeBanner.style.display = 'none';
      if (errBanner) errBanner.style.display = 'none';
    },

    async handleGoogleOAuthClick() {
      // Check status first to provide instant, friendly guidance if credentials are not configured yet
      try {
        const res = await fetch('/api/auth/google/status');
        const status = await res.json();
        if (!status.configured) {
          const errBanner = document.getElementById('authErrorBanner') || document.getElementById('loginErrorBanner');
          const errMsg = document.getElementById('authErrorMsg') || document.getElementById('loginErrorMessage');
          const msg = 'Google Sign-In is awaiting your Google Cloud OAuth credentials. To enable real Google Sign-In, please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your server .env file.';
          if (errBanner && errMsg) {
            errMsg.textContent = msg;
            errBanner.style.display = 'flex';
          }
          this.showToast('Google Sign-In requires GOOGLE_CLIENT_ID & GOOGLE_CLIENT_SECRET in .env', 'warning');
          return;
        }
      } catch (e) {
        // Fallback to direct redirect
      }
      // Redirect to backend OAuth initiation endpoint to start the official Google authentication flow
      window.location.href = '/api/auth/google';
    },

    async handleSendPhoneOTP() {
      const countryCode = document.getElementById('authCountryCode')?.value || '+91';
      const rawPhone = (document.getElementById('authPhoneNumber')?.value || '').trim();
      const errBanner = document.getElementById('authErrorBanner');
      const errMsg = document.getElementById('authErrorMsg');
      const noticeBanner = document.getElementById('authNoticeBanner');
      const noticeMsg = document.getElementById('authNoticeMsg');
      const btn = document.getElementById('btnContinuePhone');

      if (errBanner) errBanner.style.display = 'none';
      if (noticeBanner) noticeBanner.style.display = 'none';

      if (!rawPhone || rawPhone.replace(/\D/g, '').length < 7) {
        if (errBanner && errMsg) {
          errMsg.textContent = 'Please enter a valid phone number (at least 7 digits).';
          errBanner.style.display = 'flex';
        }
        return;
      }

      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Sending code...';
      }

      try {
        const fullPhone = `${countryCode}${rawPhone.replace(/\D/g, '')}`;
        const res = await API.sendPhoneOTP(fullPhone);
        const targetEl = document.getElementById('displayOtpTargetPhone');
        if (targetEl) targetEl.textContent = `${countryCode} ${res.phone}`;
        const phoneInputStep = document.getElementById('phoneInputStep');
        const phoneOtpStep = document.getElementById('phoneOtpStep');
        if (phoneInputStep) phoneInputStep.style.display = 'none';
        if (phoneOtpStep) phoneOtpStep.style.display = 'block';

        if (noticeBanner && noticeMsg) {
          noticeMsg.textContent = res.dev_code 
            ? `${res.message} Your verification code is: ${res.dev_code}`
            : res.message;
          noticeBanner.style.display = 'flex';
        }
        this.showToast('Verification code generated!', 'success');
      } catch (err) {
        if (errBanner && errMsg) {
          errMsg.textContent = err.message || 'Failed to send verification code.';
          errBanner.style.display = 'flex';
        }
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Continue with Phone →';
        }
      }
    },

    cancelOtpStep() {
      const phoneInputStep = document.getElementById('phoneInputStep');
      const phoneOtpStep = document.getElementById('phoneOtpStep');
      if (phoneInputStep) phoneInputStep.style.display = 'block';
      if (phoneOtpStep) phoneOtpStep.style.display = 'none';
    },

    async handleVerifyPhoneOTP() {
      const countryCode = document.getElementById('authCountryCode')?.value || '+91';
      const rawPhone = (document.getElementById('authPhoneNumber')?.value || '').trim();
      const fullPhone = `${countryCode}${rawPhone.replace(/\D/g, '')}`;
      const code = (document.getElementById('authOtpCode')?.value || '').trim();
      const errBanner = document.getElementById('authErrorBanner');
      const errMsg = document.getElementById('authErrorMsg');

      if (!code) {
        if (errBanner && errMsg) {
          errMsg.textContent = 'Please enter the 6-digit verification code.';
          errBanner.style.display = 'flex';
        }
        return;
      }

      try {
        const data = await API.verifyPhoneOTP(fullPhone, code);
        this.user = data.user;
        this.closeModal('authModal');
        this.showToast(`Welcome back, ${this.user.name}!`, 'success');
        await this.onLoginSuccess();
      } catch (err) {
        if (errBanner && errMsg) {
          errMsg.textContent = err.message || 'Invalid or expired verification code.';
          errBanner.style.display = 'flex';
        }
      }
    },

    async handleModalPasswordLogin() {
      const identifier = document.getElementById('modalLoginIdentifier')?.value?.trim();
      const password = document.getElementById('modalLoginPassword')?.value;
      const submitBtn = document.getElementById('btnModalPasswordSubmit');
      const errBanner = document.getElementById('authErrorBanner');
      const errMsg = document.getElementById('authErrorMsg');

      if (errBanner) errBanner.style.display = 'none';
      if (!identifier || !password) {
        if (errBanner && errMsg) {
          errMsg.textContent = 'Please enter both your registered email or phone and password.';
          errBanner.style.display = 'flex';
        }
        return;
      }

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Verifying...';
      }

      try {
        const data = await API.login(identifier, password);
        this.user = data.user;
        this.closeModal('authModal');
        this.showToast(`Welcome back, ${this.user.name}!`, 'success');
        await this.onLoginSuccess();
      } catch (err) {
        if (errBanner && errMsg) {
          errMsg.textContent = err.message || 'Invalid email/phone or password.';
          errBanner.style.display = 'flex';
        }
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Sign In to Portal →';
        }
      }
    },

    async fillAndLoginDemo(email, pass, role) {
      try {
        const data = await API.login(email, pass);
        this.user = data.user;
        this.selectedLoginPortal = role;
        this.closeModal('authModal');
        this.showToast(`Signed in as ${this.user.name} (${role})`, 'success');
        await this.onLoginSuccess();
      } catch (err) {
        this.showToast(`Demo sign-in failed: ${err.message}`, 'error');
      }
    },

    togglePublicMobileNav() {
      const links = document.getElementById('publicNavLinks');
      if (links) {
        links.classList.toggle('mobile-open');
      }
    },

    // Show 3-Portal Login Page (Section 4)
    showLoginPage(event) {
      if (event) event.preventDefault();
      this.showLoginView();
    },

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

      localStorage.setItem('edvanta_view', 'portal');
      this.updateNavbarAuthStatus();

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

    getGreetingForRole(roleOverride) {
      const now = new Date();
      const hour = now.getHours();
      const role = roleOverride || (this.user ? this.user.role : 'ADMIN');
      const roleTitle = role === 'ADMIN' ? 'Admin' : (role === 'FACULTY' ? 'Faculty' : 'Student');

      // Exact ranges:
      // 5:00 AM – 11:59 AM: Good Morning, [Role] (☀️)
      // 12:00 PM – 4:59 PM: Good Afternoon, [Role] (🌤️)
      // 5:00 PM – 4:59 AM: Good Evening, [Role] (🌙)
      let period = 'evening';
      let timeGreeting = 'Good Evening';
      let emoji = '🌙';

      if (hour >= 5 && hour < 12) {
        period = 'morning';
        timeGreeting = 'Good Morning';
        emoji = '☀️';
      } else if (hour >= 12 && hour < 17) {
        period = 'afternoon';
        timeGreeting = 'Good Afternoon';
        emoji = '🌤️';
      } else {
        period = 'evening';
        timeGreeting = 'Good Evening';
        emoji = '🌙';
      }

      return {
        period,
        timeGreeting,
        roleTitle,
        greetingText: `${timeGreeting}, ${roleTitle}`,
        emoji,
        isDaytime: period === 'morning' || period === 'afternoon'
      };
    },

    updateGreetingBanner() {
      const greetingInfo = this.getGreetingForRole();
      const { period, timeGreeting, emoji } = greetingInfo;

      const portalTargets = [
        { headingId: 'adminWelcomeGreeting', emojiId: 'adminGreetingEmoji', roleTitle: 'Admin' },
        { headingId: 'studentWelcomeGreeting', emojiId: 'studentGreetingEmoji', roleTitle: 'Student' },
        { headingId: 'facultyWelcomeGreeting', emojiId: 'facultyGreetingEmoji', roleTitle: 'Faculty' }
      ];

      portalTargets.forEach(t => {
        const headingEl = document.getElementById(t.headingId);
        if (headingEl) {
          headingEl.textContent = `${timeGreeting}, ${t.roleTitle}`;
        }
        const emojiEl = document.getElementById(t.emojiId);
        if (emojiEl) {
          emojiEl.textContent = emoji;
        }
      });

      // Update time-based background variation class on all portal welcome cards
      document.querySelectorAll('.portal-welcome-card').forEach(card => {
        card.classList.remove('morning', 'afternoon', 'evening');
        card.classList.add(period);
      });
    },

    initGreetingTimer() {
      if (this._greetingTimer) clearInterval(this._greetingTimer);
      this.updateGreetingBanner();
      // Auto-update every 30 seconds so time period transition happens seamlessly
      this._greetingTimer = setInterval(() => {
        this.updateGreetingBanner();
      }, 30000);
    },

    getNavIcon(id) {
      const strokeW = 1.8;
      const icons = {
        home: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeW}" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>`,
        dashboard: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeW}" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1"></rect><rect x="14" y="3" width="7" height="5" rx="1"></rect><rect x="14" y="12" width="7" height="9" rx="1"></rect><rect x="3" y="16" width="7" height="5" rx="1"></rect></svg>`,
        attendance: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeW}" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`,
        curriculum: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeW}" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>`,
        calendar: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeW}" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>`,
        users: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeW}" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>`,
        alerts: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeW}" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>`,
        imports: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeW}" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="12" y1="18" x2="12" y2="12"></line><line x1="9" y1="15" x2="15" y2="15"></line></svg>`,
        ai: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeW}" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"></rect><circle cx="12" cy="5" r="2"></circle><path d="M12 7v4"></path><line x1="8" y1="16" x2="8" y2="16.01"></line><line x1="16" y1="16" x2="16" y2="16.01"></line></svg>`,
        logger: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeW}" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>`,
        history: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeW}" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 8 14"></polyline></svg>`,
        student: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeW}" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"></path><path d="M6 12v5c3 3 9 3 12 0v-5"></path></svg>`,
        exams: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeW}" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="6"></circle><circle cx="12" cy="12" r="2"></circle></svg>`
      };
      return icons[id] || `<span class="nav-dot">●</span>`;
    },

    updateHeaderUI() {
      if (!this.user) return;

      const portalBadge = document.getElementById('portalRoleBadge');
      const topbarPill = document.getElementById('currentPortalNamePill');

      let portalLabel = 'ADMIN PORTAL';
      if (this.user.role === 'FACULTY') portalLabel = 'FACULTY PORTAL';
      if (this.user.role === 'STUDENT') portalLabel = 'STUDENT PORTAL';

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

      // Update Personalized Welcome Section & Dynamic Banners (Section 1)
      this.updateGreetingBanner();
      this.initGreetingTimer();

      // Supporting subtitles with real authenticated details
      const campusStr = this.user.campus_name || (this.user.role === 'ADMIN' ? 'All Campuses' : 'Campus');
      const adminSub = document.getElementById('adminWelcomeSubtitle');
      if (adminSub) {
        adminSub.textContent = `Welcome back, ${this.user.name} • ${campusStr} • Academic Year 2026–2027 • MSOT Progression Tracker`;
      }
      const studentSub = document.getElementById('studentWelcomeSubtitle');
      if (studentSub) {
        studentSub.textContent = `Welcome back, ${this.user.name} • ${this.user.batch_name || 'MSOT Batch'} • ${campusStr}`;
      }
      const facultySub = document.getElementById('facultyWelcomeSubtitle');
      if (facultySub) {
        facultySub.textContent = `Welcome back, ${this.user.name} • ${campusStr} • Teaching Sessions & Fast Session Logger`;
      }

      // Topbar user profile widgets
      const topbarAvatar = document.getElementById('topbarUserAvatar');
      if (topbarAvatar) topbarAvatar.textContent = (this.user.name || 'U').charAt(0).toUpperCase();
      const topbarName = document.getElementById('topbarUserName');
      if (topbarName) topbarName.textContent = this.user.name;
      const topbarRole = document.getElementById('topbarUserRole');
      if (topbarRole) topbarRole.textContent = this.user.role;
    },

    // Render Left Sidebar Navigation Links (Section 5 & 6)
    renderNavTabsForRole() {
      const container = document.getElementById('sidebarNavContainer');
      if (!container || !this.user) return;

      let tabs = [];
      if (this.user.role === 'ADMIN' || this.user.role === 'CAMPUS_MANAGER') {
        tabs = [
          { id: 'dashboard', label: 'Dashboard & Pacing' },
          { id: 'attendance', label: 'Attendance Management' },
          { id: 'curriculum', label: '7 Subjects Curriculum' },
          { id: 'calendar', label: 'Master Timetable' },
          { id: 'users', label: 'User Accounts' },
          { id: 'alerts', label: 'Alerts & Escalations' },
          { id: 'imports', label: 'CSV Import & Export' },
          { id: 'ai', label: 'AI Academic Assistant' }
        ];
      } else if (this.user.role === 'FACULTY') {
        tabs = [
          { id: 'logger', label: 'Fast Session Logger' },
          { id: 'attendance', label: 'Class Attendance' },
          { id: 'calendar', label: 'My Teaching Schedule' },
          { id: 'curriculum', label: 'My Subjects & Topics' },
          { id: 'history', label: 'Session History' },
          { id: 'alerts', label: 'Teaching Reminders' },
          { id: 'ai', label: 'AI Teaching Assistant' }
        ];
      } else if (this.user.role === 'STUDENT') {
        tabs = [
          { id: 'student', label: 'My Enrolled Subjects' },
          { id: 'attendance', label: 'My Attendance' },
          { id: 'calendar', label: 'My Class Timetable' },
          { id: 'exams', label: 'Exam Readiness & Dates' },
          { id: 'ai', label: 'AI Study Assistant' }
        ];
      }

      container.innerHTML = tabs.map(t => `
        <button type="button" class="sidebar-nav-item ${t.id === this.activeTab ? 'active' : ''}" data-tab="${t.id}" onclick="App.switchTab('${t.id}')">
          <span class="nav-icon">${this.getNavIcon(t.id)}</span>
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

      // Keyboard Accessibility: Escape key closes active modals
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          const modals = ['exploreFeaturesModal', 'authModal', 'aboutModal', 'contactModal', 'studentTopicsModal', 'addHolidayModal', 'telegramModal', 'whatsappModal', 'changePasswordModal', 'aiModal'];
          modals.forEach(mId => this.closeModal(mId));
        }
      });
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

    async handleLogout() {
      await API.logout();
      this.user = null;
      localStorage.removeItem('edvanta_view');
      this.updateNavbarAuthStatus();
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
      const adminTabs = ['dashboard', 'attendance', 'curriculum', 'calendar', 'users', 'alerts', 'imports', 'ai', 'exams'];
      const facultyTabs = ['logger', 'attendance', 'calendar', 'curriculum', 'history', 'alerts', 'ai'];
      const studentTabs = ['student', 'attendance', 'calendar', 'exams', 'ai'];

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
      } else if (this.activeTab === 'ai') {
        await this.loadAIView();
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

      const topbarCampSelect = document.getElementById('topbarCampusSelect');
      if (topbarCampSelect) {
        if (this.user && this.user.role === 'CAMPUS_MANAGER' && this.user.campus_id) {
          const userCamp = displayCampuses.find(c => c.id === this.user.campus_id) || { id: this.user.campus_id, name: this.user.campus_name || 'Assigned Campus' };
          topbarCampSelect.innerHTML = `<option value="${userCamp.id}" selected>${userCamp.name}</option>`;
          topbarCampSelect.disabled = true;
        } else {
          topbarCampSelect.disabled = false;
          topbarCampSelect.innerHTML = `<option value="">All Campuses (${displayCampuses.length})</option>` +
            displayCampuses.map(c => `<option value="${c.id}" ${this.activeFilters.campus_id === c.id ? 'selected' : ''}>${c.name}</option>`).join('');
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

    handleTopbarCampusChange(campusId) {
      const campSelect = document.getElementById('campusFilter');
      if (campSelect) campSelect.value = campusId;
      this.activeFilters.campus_id = campusId || null;
      this.handleFilterChange();
    },

    handleTopbarSearch(query) {
      query = (query || '').trim().toLowerCase();
      if (!query) {
        document.querySelectorAll('#dashboardSubjectsTableBody tr, #studentSubjectsContainer .content-card, #usersTableBody tr, #curriculumSubjectsContainer .content-card').forEach(el => {
          el.style.display = '';
        });
        return;
      }
      if (this.activeTab === 'dashboard') {
        document.querySelectorAll('#dashboardSubjectsTableBody tr').forEach(row => {
          const text = row.textContent.toLowerCase();
          row.style.display = text.includes(query) ? '' : 'none';
        });
      } else if (this.activeTab === 'student') {
        document.querySelectorAll('#studentSubjectsContainer .content-card').forEach(card => {
          const text = card.textContent.toLowerCase();
          card.style.display = text.includes(query) ? '' : 'none';
        });
      } else if (this.activeTab === 'attendance') {
        const searchInput = document.getElementById('attSearchInput');
        if (searchInput) {
          searchInput.value = query;
          this.applyAttendanceFilters();
        }
      } else if (this.activeTab === 'users') {
        document.querySelectorAll('#usersTableBody tr').forEach(row => {
          const text = row.textContent.toLowerCase();
          row.style.display = text.includes(query) ? '' : 'none';
        });
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
        this.allAttendanceRecords = records;

        // Update KPI summary cards
        const totalEl = document.getElementById('attSummaryTotal');
        const presentEl = document.getElementById('attSummaryPresent');
        const absentEl = document.getElementById('attSummaryAbsent');
        const rateEl = document.getElementById('attSummaryRate');

        const totalVal = summary.totalSessions !== undefined ? summary.totalSessions : records.length;
        const presVal = summary.presentCount !== undefined ? summary.presentCount : records.filter(r => r.status === 'PRESENT').length;
        const absVal = summary.absentCount !== undefined ? summary.absentCount : (totalVal - presVal);
        const rateVal = totalVal > 0 ? `${Math.round((presVal / totalVal) * 100)}%` : '0%';

        if (totalEl) totalEl.textContent = totalVal;
        if (presentEl) presentEl.textContent = presVal;
        if (absentEl) absentEl.textContent = absVal;
        if (rateEl) rateEl.textContent = rateVal;

        // Check active attendance session
        const activeRes = await API.getActiveAttendanceSessions();
        const activeSessions = activeRes.activeSessions || [];

        // Student active session card
        const studentCard = document.getElementById('studentActiveAttendanceCard');
        if (studentCard) {
          if (role === 'STUDENT' && activeSessions.length > 0) {
            const activeSess = activeSessions[0];
            this.currentActiveAttendanceSessionId = activeSess.id;
            this.currentActiveSessionData = activeSess;

            const titleEl = document.getElementById('activeAttSubjectTitle');
            const descEl = document.getElementById('activeAttFacultyInfo');
            const beaconBadge = document.getElementById('activeAttBeaconBadge');
            const bleBtn = document.getElementById('btnSubmitBLEAttendance');
            const webBtn = document.getElementById('btnSubmitStudentAttendance');

            if (titleEl) titleEl.textContent = `Active Attendance: ${activeSess.subject_name} (${activeSess.subject_code})`;
            if (descEl) descEl.textContent = `Instructor: ${activeSess.faculty_name} • Batch: ${activeSess.batch_name}. Select check-in method:`;
            if (beaconBadge) {
              beaconBadge.textContent = `BLE Beacon: ${activeSess.ble_beacon_code || 'Active'}`;
              beaconBadge.style.display = 'inline-flex';
            }

            this.startAttendanceCountdown(activeSess.expires_at);

            if (activeSess.hasSubmitted) {
              if (bleBtn) {
                bleBtn.style.display = 'none';
              }
              if (webBtn) {
                webBtn.textContent = `✅ Present Recorded (${activeSess.marking_method || 'Portal'})`;
                webBtn.disabled = true;
                webBtn.className = 'btn-secondary';
              }
            } else {
              if (bleBtn) {
                bleBtn.style.display = 'inline-flex';
                bleBtn.disabled = false;
              }
              if (webBtn) {
                webBtn.textContent = '🌐 Standard Web Check-In';
                webBtn.disabled = false;
                webBtn.className = 'btn-secondary';
              }
            }
            studentCard.style.display = 'flex';
          } else {
            studentCard.style.display = 'none';
            if (this.attCountdownInterval) {
              clearInterval(this.attCountdownInterval);
              this.attCountdownInterval = null;
            }
          }
        }

        // Faculty active session card
        const facCard = document.getElementById('facultyActiveSessionCard');
        if (facCard) {
          if ((role === 'FACULTY' || role === 'ADMIN' || role === 'CAMPUS_MANAGER') && activeSessions.length > 0) {
            const activeSess = activeSessions[0];
            this.currentActiveAttendanceSessionId = activeSess.id;
            this.currentActiveSessionData = activeSess;

            const titleEl = document.getElementById('facActiveSessionTitle');
            const descEl = document.getElementById('facActiveSessionDesc');
            const beaconPill = document.getElementById('facSessionBeaconPill');

            if (titleEl) titleEl.textContent = `Active Attendance: ${activeSess.subject_name} (${activeSess.batch_name})`;
            if (descEl) descEl.textContent = `Date: ${activeSess.session_date} • Submitted: ${activeSess.present_count || 0} of ${activeSess.total_enrolled || 0} enrolled students`;
            if (beaconPill) beaconPill.textContent = `Beacon: ${activeSess.ble_beacon_code || 'EDV-BLE'}`;

            facCard.style.display = 'block';
          } else {
            facCard.style.display = 'none';
          }
        }

        // Populate subject filter dropdown
        this.populateAttendanceSubjectFilter();

        // Render attendance table with active filters
        this.applyAttendanceFilters();
      } catch (err) {
        console.error('Failed to load attendance view:', err);
      }
    },

    startAttendanceCountdown(expiresAtIso) {
      if (this.attCountdownInterval) {
        clearInterval(this.attCountdownInterval);
        this.attCountdownInterval = null;
      }

      const cdEl = document.getElementById('studentAttCountdown');
      if (!cdEl || !expiresAtIso) return;

      const updateCountdown = () => {
        const remainingMs = new Date(expiresAtIso).getTime() - Date.now();
        if (remainingMs <= 0) {
          cdEl.textContent = '⏱️ Session Expired';
          cdEl.style.color = 'var(--text-danger)';
          if (this.attCountdownInterval) {
            clearInterval(this.attCountdownInterval);
            this.attCountdownInterval = null;
          }
        } else {
          const totalSecs = Math.floor(remainingMs / 1000);
          const mins = Math.floor(totalSecs / 60);
          const secs = totalSecs % 60;
          cdEl.textContent = `⏱️ ${mins}m ${secs < 10 ? '0' : ''}${secs}s remaining`;
          cdEl.style.color = 'var(--primary-blue)';
        }
      };

      updateCountdown();
      this.attCountdownInterval = setInterval(updateCountdown, 1000);
    },

    async populateAttendanceSubjectFilter() {
      const select = document.getElementById('attFilterSubject');
      if (!select || select.options.length > 1) return;

      try {
        const data = await API.getSubjects();
        const subjects = data.subjects || [];
        subjects.forEach(s => {
          const opt = document.createElement('option');
          opt.value = s.id;
          opt.textContent = `${s.code} - ${s.name}`;
          select.appendChild(opt);
        });
      } catch (e) {}
    },

    applyAttendanceFilters() {
      const subjFilter = document.getElementById('attFilterSubject')?.value || '';
      const statusFilter = document.getElementById('attFilterStatus')?.value || '';
      const dateFilter = document.getElementById('attFilterDate')?.value || '';
      const searchFilter = (document.getElementById('attSearchInput')?.value || '').trim().toLowerCase();

      let filtered = (this.allAttendanceRecords || []).filter(r => {
        if (subjFilter && r.subject_id !== subjFilter) return false;
        if (statusFilter && r.status !== statusFilter) return false;
        if (dateFilter && r.session_date !== dateFilter) return false;
        if (searchFilter) {
          const matchStudent = (r.student_name || '').toLowerCase().includes(searchFilter);
          const matchEmail = (r.student_email || '').toLowerCase().includes(searchFilter);
          const matchSubject = (r.subject_name || '').toLowerCase().includes(searchFilter) || (r.subject_code || '').toLowerCase().includes(searchFilter);
          const matchBatch = (r.batch_name || '').toLowerCase().includes(searchFilter);
          if (!matchStudent && !matchEmail && !matchSubject && !matchBatch) return false;
        }
        return true;
      });

      this.renderAttendanceTable(filtered);
    },

    resetAttendanceFilters() {
      const subjEl = document.getElementById('attFilterSubject');
      const statusEl = document.getElementById('attFilterStatus');
      const dateEl = document.getElementById('attFilterDate');
      const searchEl = document.getElementById('attSearchInput');

      if (subjEl) subjEl.value = '';
      if (statusEl) statusEl.value = '';
      if (dateEl) dateEl.value = '';
      if (searchEl) searchEl.value = '';

      this.applyAttendanceFilters();
    },

    renderAttendanceTable(records) {
      const tbody = document.getElementById('attendanceTableBody');
      if (!tbody) return;

      const attHeading = document.getElementById('attendanceTableHeading');
      const controls = document.getElementById('attendanceTableControls');
      if (attHeading && this.user) {
        attHeading.textContent = this.user.role === 'STUDENT' ? 'My Class Attendance Log' : 'Attendance Records Log';
      }
      if (controls) {
        controls.textContent = `Showing ${records.length} record${records.length === 1 ? '' : 's'}`;
      }

      if (!records || records.length === 0) {
        const isStudent = this.user && this.user.role === 'STUDENT';
        const msg = isStudent
          ? 'No attendance records match your filter. When your instructor initiates an attendance session, an active session banner will appear at the top.'
          : 'No attendance records found matching the specified filters.';
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 2.5rem; color: var(--text-secondary); line-height: 1.5;">${msg}</td></tr>`;
        return;
      }

      const isPrivileged = this.user.role === 'ADMIN' || this.user.role === 'CAMPUS_MANAGER' || this.user.role === 'FACULTY';

      tbody.innerHTML = records.map(r => {
        const studentInfo = r.student_name ? `${r.student_name} (${r.batch_name || 'Class'})` : (r.batch_name || 'Class');
        const statusClass = r.status === 'PRESENT' ? 'ontrack' : (r.status === 'EXCUSED' ? 'tight' : 'danger');
        const methodBadge = r.marking_method === 'BLUETOOTH'
          ? '<span class="status-pill ontrack" style="font-size: 0.72rem;">🔵 BLE</span>'
          : (r.marking_method === 'MANUAL'
            ? '<span class="status-pill tight" style="font-size: 0.72rem;">✏️ Manual</span>'
            : '<span class="status-pill neutral" style="font-size: 0.72rem;">🌐 Portal</span>');

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
            <td>${methodBadge}</td>
            <td><span style="font-size: 0.8rem; color: var(--text-secondary);">${r.marked_by}</span></td>
            <td style="font-family: 'JetBrains Mono', monospace; font-size: 0.75rem; color: var(--text-muted);">
              ${r.created_at ? r.created_at.split(' ')[1] || r.created_at : '—'}
            </td>
            <td>
              ${isPrivileged ? `
                <button type="button" class="btn-secondary" style="font-size: 0.72rem; padding: 0.2rem 0.5rem;" onclick="App.openEditAttendanceModal('${r.id}', '${(r.student_name || 'Student').replace(/'/g, "\\'")}', '${r.status}', '${(r.notes || '').replace(/'/g, "\\'")}')">
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
      const validityMinutes = document.getElementById('attModalValidity')?.value || 15;

      try {
        const res = await API.startAttendanceSession({
          subject_id: subjectId,
          batch_name: batchName,
          campus_id: campusId,
          validity_minutes: validityMinutes
        });
        this.closeModal('startAttendanceModal');
        this.showToast(`Attendance session initiated! Beacon: ${res.ble_beacon_code}. Validity: ${validityMinutes} mins.`, 'success');
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
          submitBtn.textContent = '🌐 Standard Web Check-In';
        }
      }
    },

    async submitBluetoothAttendance() {
      if (!this.currentActiveAttendanceSessionId || !this.currentActiveSessionData) {
        this.showToast('No active class attendance session to verify.', 'warning');
        return;
      }

      const session = this.currentActiveSessionData;

      // Check browser Web Bluetooth hardware capability and secure context
      const isBluetoothSupported = Boolean(navigator.bluetooth && navigator.bluetooth.requestDevice);
      const isSecureContext = window.isSecureContext;

      if (!isBluetoothSupported || !isSecureContext) {
        const explanation = !isSecureContext
          ? 'Web Bluetooth requires a Secure Context (HTTPS or localhost).'
          : 'Web Bluetooth is not supported in this browser engine (iOS Safari/WebKit or Firefox). Chrome or Edge on Desktop/Android is required.';

        alert(`📡 Bluetooth Proximity Check Notice:\n\n${explanation}\n\nPlease click "Standard Web Check-In" to record your presence directly.`);
        return;
      }

      const bleBtn = document.getElementById('btnSubmitBLEAttendance');
      if (bleBtn) {
        bleBtn.disabled = true;
        bleBtn.textContent = 'Scanning BLE...';
      }

      try {
        this.showToast('Scanning for classroom Bluetooth beacon (EDVANTA)...', 'info');

        // Request BLE peripheral device
        const device = await navigator.bluetooth.requestDevice({
          filters: [
            { namePrefix: 'EDVANTA' }
          ],
          optionalServices: [
            'generic_access',
            session.ble_service_uuid || '0000ed01-0000-1000-8000-00805f9b34fb'
          ]
        });

        // Connect GATT server for physical proximity confirmation
        if (device && device.gatt) {
          await device.gatt.connect();
        }

        // Send verified BLE attendance submission to backend
        const result = await API.submitAttendanceBLE({
          attendance_session_id: session.id,
          ble_beacon_code: session.ble_beacon_code,
          client_timestamp: Date.now()
        });

        this.showToast(`✅ ${result.message || 'Bluetooth attendance verified!'}`, 'success');
        await this.loadAttendanceView();
      } catch (err) {
        if (err.name === 'NotFoundError') {
          this.showToast('Bluetooth scan cancelled or no classroom beacon selected. You can use Standard Web Check-In.', 'warning');
        } else {
          this.showToast(`Bluetooth note: ${err.message}. You can use Standard Web Check-In.`, 'info');
        }
      } finally {
        if (bleBtn) {
          bleBtn.disabled = false;
          bleBtn.innerHTML = '<span>🔵</span><span>Check In via Bluetooth (BLE)</span>';
        }
      }
    },

    async openSessionRosterModal() {
      if (!this.currentActiveAttendanceSessionId) return;
      const modal = document.getElementById('sessionRosterModal');
      if (modal) modal.style.display = 'flex';
      await this.loadSessionRoster();
    },

    async loadSessionRoster() {
      if (!this.currentActiveAttendanceSessionId) return;
      const tbody = document.getElementById('sessionRosterTableBody');
      const statsPill = document.getElementById('rosterStatsPill');
      if (!tbody) return;

      try {
        const data = await API.getSessionRoster(this.currentActiveAttendanceSessionId);
        const roster = data.roster || [];
        const summary = data.summary || {};

        if (statsPill) {
          statsPill.innerHTML = `
            <span><strong>Enrolled:</strong> ${summary.totalEnrolled || 0}</span>
            <span style="color: #10B981;"><strong>Present:</strong> ${summary.presentCount || 0}</span>
            <span style="color: #EF4444;"><strong>Absent:</strong> ${summary.absentCount || 0}</span>
            <span style="color: var(--text-secondary);"><strong>Not Marked:</strong> ${summary.notMarkedCount || 0}</span>
            <span style="color: var(--primary-blue);"><strong>Rate:</strong> ${summary.attendanceRate || 0}%</span>
          `;
        }

        if (roster.length === 0) {
          tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 2rem;">No students enrolled in this batch.</td></tr>';
          return;
        }

        tbody.innerHTML = roster.map(s => {
          const statusClass = s.status === 'PRESENT' ? 'ontrack' : (s.status === 'ABSENT' ? 'danger' : 'neutral');
          const methodPill = s.marking_method === 'BLUETOOTH'
            ? '<span class="status-pill ontrack" style="font-size: 0.72rem;">🔵 BLE</span>'
            : (s.marking_method === 'MANUAL'
              ? '<span class="status-pill tight" style="font-size: 0.72rem;">✏️ Manual</span>'
              : (s.status === 'PRESENT' ? '<span class="status-pill neutral" style="font-size: 0.72rem;">🌐 Portal</span>' : '—'));

          return `
            <tr>
              <td>
                <strong>${s.student_name}</strong>
                <div style="font-size: 0.75rem; color: var(--text-muted);">${s.student_email || s.batch_name}</div>
              </td>
              <td><span class="status-pill ${statusClass}">${s.status}</span></td>
              <td>${methodPill}</td>
              <td style="font-family: 'JetBrains Mono', monospace; font-size: 0.75rem; color: var(--text-muted);">
                ${s.marked_at ? s.marked_at.split(' ')[1] || s.marked_at : '—'}
              </td>
              <td>
                <div style="display: flex; gap: 0.35rem;">
                  <button type="button" class="btn-primary" style="font-size: 0.72rem; padding: 0.2rem 0.5rem;" onclick="App.markStudentManual('${s.student_id}', 'PRESENT')">
                    ✓ Present
                  </button>
                  <button type="button" class="btn-danger" style="font-size: 0.72rem; padding: 0.2rem 0.5rem;" onclick="App.markStudentManual('${s.student_id}', 'ABSENT')">
                    ✗ Absent
                  </button>
                </div>
              </td>
            </tr>
          `;
        }).join('');
      } catch (err) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 1.5rem; color: var(--text-danger);">Failed to load roster: ${err.message}</td></tr>`;
      }
    },

    async markStudentManual(studentId, status) {
      if (!this.currentActiveAttendanceSessionId) return;
      try {
        await API.markAttendanceManual({
          attendance_session_id: this.currentActiveAttendanceSessionId,
          student_id: studentId,
          status
        });
        this.showToast(`Marked student ${status}.`, 'success');
        await this.loadSessionRoster();
        await this.loadAttendanceView();
      } catch (err) {
        this.showToast(`Failed: ${err.message}`, 'error');
      }
    },

    async finalizeUnrecordedAttendance() {
      if (!this.currentActiveAttendanceSessionId) return;
      if (!confirm('Mark all remaining unrecorded students as ABSENT and close this attendance session?')) {
        return;
      }

      try {
        const res = await API.finalizeUnrecordedAttendance(this.currentActiveAttendanceSessionId);
        this.showToast(res.message || 'Session finalized successfully.', 'info');
        this.closeModal('sessionRosterModal');
        this.currentActiveAttendanceSessionId = null;
        await this.loadAttendanceView();
      } catch (err) {
        this.showToast(`Failed to finalize: ${err.message}`, 'error');
      }
    },

    async closeCurrentAttendanceSession() {
      if (!this.currentActiveAttendanceSessionId) return;
      try {
        await API.closeAttendanceSession(this.currentActiveAttendanceSessionId);
        this.showToast('Attendance session ended and closed.', 'info');
        this.currentActiveAttendanceSessionId = null;
        if (this.attCountdownInterval) {
          clearInterval(this.attCountdownInterval);
          this.attCountdownInterval = null;
        }
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
        this.renderNeedsAttention(data.subjects, data.summary);
        this.renderUpcomingEvents(data.upcomingExams);
        await this.renderRecentActivity();
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

    renderNeedsAttention(subjects, summary) {
      const container = document.getElementById('needsAttentionList');
      const badge = document.getElementById('attentionCountBadge');
      if (!container) return;

      const attentionItems = [];

      subjects.forEach(s => {
        if (s.status === 'DANGER') {
          attentionItems.push({
            type: 'danger',
            badge: 'DANGER',
            subjectId: s.id,
            title: `${s.code}: ${s.name}`,
            desc: `Buffer Ratio: ${s.bufferRatio !== null ? s.bufferRatio : '< 1.00'} — Pacing critical (${s.batch_name || s.campus_name})`,
            actionLabel: 'Inspect'
          });
        } else if (s.status === 'TIGHT') {
          attentionItems.push({
            type: 'warning',
            badge: 'TIGHT',
            subjectId: s.id,
            title: `${s.code}: ${s.name}`,
            desc: `Buffer Ratio: ${s.bufferRatio} — Pace margin tight (${s.batch_name || s.campus_name})`,
            actionLabel: 'Inspect'
          });
        } else if (s.overdueTopicsCount && s.overdueTopicsCount > 0) {
          attentionItems.push({
            type: 'warning',
            badge: 'OVERDUE',
            subjectId: s.id,
            title: `${s.code}: ${s.name}`,
            desc: `${s.overdueTopicsCount} lesson topics behind planned schedule`,
            actionLabel: 'Inspect'
          });
        }
      });

      if (badge) {
        if (attentionItems.length > 0) {
          badge.textContent = `${attentionItems.length} Item${attentionItems.length > 1 ? 's' : ''}`;
          badge.className = `attention-badge ${attentionItems.some(i => i.type === 'danger') ? 'danger' : 'warning'}`;
          badge.style.display = 'inline-block';
        } else {
          badge.style.display = 'none';
        }
      }

      if (attentionItems.length === 0) {
        container.innerHTML = `
          <div style="background-color: var(--status-green-bg); border: 1px solid var(--status-green-border); border-radius: var(--radius-md); padding: 1.25rem 1rem; text-align: center;">
            <div style="font-size: 1.5rem; margin-bottom: 0.25rem;">✓</div>
            <div style="font-weight: 700; color: var(--status-green-text); font-size: 0.92rem;">All Core Subjects On Track</div>
            <p style="font-size: 0.78rem; color: var(--status-green-text); margin-top: 0.2rem; opacity: 0.9;">
              No subjects currently require intervention. Safe progression buffer ratios maintained.
            </p>
          </div>
        `;
        return;
      }

      container.innerHTML = attentionItems.slice(0, 5).map(item => `
        <div class="needs-attention-item ${item.type}">
          <div style="display: flex; align-items: flex-start; gap: 0.65rem; min-width: 0;">
            <span class="attention-badge ${item.type}" style="margin-top: 0.1rem; flex-shrink: 0;">${item.badge}</span>
            <div style="min-width: 0;">
              <div style="font-weight: 700; color: var(--heading-deep-blue); font-size: 0.88rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${item.title}
              </div>
              <div style="font-size: 0.76rem; color: var(--text-secondary); line-height: 1.3; margin-top: 0.15rem;">
                ${item.desc}
              </div>
            </div>
          </div>
          <button type="button" class="btn-secondary" style="font-size: 0.72rem; padding: 0.25rem 0.6rem; flex-shrink: 0;" onclick="App.inspectTraceability('${item.subjectId}')">
            ${item.actionLabel}
          </button>
        </div>
      `).join('');
    },

    renderUpcomingEvents(upcomingExams) {
      const container = document.getElementById('upcomingEventsList');
      if (!container) return;

      const events = [];

      if (upcomingExams && upcomingExams.length > 0) {
        upcomingExams.forEach(e => {
          let dateStr = e.start_date || '2026-10-24';
          const d = new Date(dateStr);
          const monthStr = isNaN(d.getTime()) ? 'OCT' : d.toLocaleString('en-US', { month: 'short' }).toUpperCase();
          const dayStr = isNaN(d.getTime()) ? '24' : d.getDate();

          events.push({
            month: monthStr,
            day: dayStr,
            title: e.name || 'Examination Window',
            meta: `${e.semester_name || 'Semester Term'} • Weightage ${e.weightage || 20}%`
          });
        });
      } else {
        events.push(
          { month: 'OCT', day: '24', title: 'Mid-Term Examination Window', meta: 'MSOT 2026 Batch • Weightage 30%' },
          { month: 'NOV', day: '14', title: 'Working Saturday (2nd Saturday)', meta: 'Scheduled Full Academic Day' },
          { month: 'NOV', day: '28', title: 'Syllabus Milestone Check', meta: 'Unit 4 Pacing Target Review' },
          { month: 'DEC', day: '15', title: 'End-Term Examination Window', meta: 'Final Comprehensive Scope • Weightage 50%' }
        );
      }

      container.innerHTML = events.slice(0, 4).map(e => `
        <div class="event-item">
          <div class="event-date-box">
            <span class="event-month">${e.month}</span>
            <span class="event-day">${e.day}</span>
          </div>
          <div class="event-details">
            <div class="event-title">${e.title}</div>
            <div class="event-meta">${e.meta}</div>
          </div>
          <span class="status-pill complete" style="font-size: 0.7rem; flex-shrink: 0;">Scheduled</span>
        </div>
      `).join('');
    },

    async renderRecentActivity() {
      const container = document.getElementById('recentActivityList');
      if (!container) return;

      try {
        const historyData = await API.getSessionHistory({ limit: 8 });
        const sessions = historyData.sessions || [];

        if (sessions.length === 0) {
          container.innerHTML = `
            <div style="padding: 1.25rem 0; text-align: center; color: var(--text-secondary); font-size: 0.85rem;">
              No recent sessions recorded yet today.
            </div>
          `;
          return;
        }

        container.innerHTML = sessions.map(s => `
          <div class="activity-feed-item">
            <div style="display: flex; align-items: center; gap: 0.85rem; min-width: 0;">
              <div class="activity-feed-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
              </div>
              <div class="activity-feed-content">
                <div class="activity-feed-title">
                  <strong>${s.subject_code}</strong>: ${s.subject_name || 'Class Session Delivered'}
                </div>
                <div class="activity-feed-time">
                  ${s.faculty_name || 'Faculty'} • ${formatDuration(s.duration_hours || 1)} • ${s.session_date || 'Recent'}
                </div>
              </div>
            </div>
            <span class="status-pill complete" style="font-size: 0.72rem; flex-shrink: 0;">Logged</span>
          </div>
        `).join('');
      } catch (err) {
        container.innerHTML = `
          <div style="padding: 1rem 0; text-align: center; color: var(--text-muted); font-size: 0.82rem;">
            Activity stream synced with audit log.
          </div>
        `;
      }
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
              <div style="width: 52px; height: 52px; border-radius: 12px; background: var(--surface-soft); color: var(--primary-blue); display: inline-flex; align-items: center; justify-content: center; margin-bottom: 1rem;">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="18" rx="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
              </div>
              <h3 style="font-size: 1.25rem; color: var(--heading-deep-blue); margin-bottom: 0.35rem;">
                No Timetable Sessions Scheduled for ${data.dayName} (${data.activeDate})
              </h3>
              <p style="color: var(--text-secondary); font-size: 0.9rem; max-width: 520px; margin: 0 auto 1.25rem auto;">
                You do not have a scheduled class slot on this day. You can review your complete weekly schedule, inspect other days, or launch an instant logger session for any of your assigned subjects.
              </p>
              <div style="display: flex; justify-content: center; gap: 0.75rem; flex-wrap: wrap;">
                <button type="button" class="btn-primary" onclick="App.openInstantSubjectLogger()" style="display: inline-flex; align-items: center; gap: 0.4rem;">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
                  <span>Quick Log Assigned Subject</span>
                </button>
                <button type="button" class="btn-secondary" onclick="App.switchTab('calendar')" style="display: inline-flex; align-items: center; gap: 0.4rem;">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                  <span>View My Teaching Schedule</span>
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
              <div style="width: 52px; height: 52px; border-radius: 12px; background: var(--surface-soft); color: var(--primary-blue); display: inline-flex; align-items: center; justify-content: center; margin-bottom: 1rem;">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M22 10v6M2 10l10-5 10 5-10 5z"></path><path d="M6 12v5c3 3 9 3 12 0v-5"></path></svg>
              </div>
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
    // TAB 11: AI ACADEMIC ASSISTANT (Phase 1)
    // -------------------------------------------------------------
    aiChatHistory: [],

    async loadAIView() {
      if (!this.user) return;
      const role = this.user.role;

      // Update subtitle and welcome message based on role
      const subtitle = document.getElementById('aiSubtitle');
      const welcome = document.getElementById('aiWelcomeMessageText');

      if (role === 'STUDENT') {
        if (subtitle) subtitle.textContent = 'Ask for concept explanations, study notes, formula derivations, and practice MCQs.';
        if (welcome && (!this.aiChatHistory || !this.aiChatHistory.length)) {
          welcome.innerHTML = `
            Hello <strong>${this.user.name}</strong>! I am your EDVANTA Study Assistant for <strong>${this.user.batch_name || 'your batch'}</strong>.<br><br>
            I can help you understand challenging topics, generate practice revision MCQs, explain algorithms, and summarize study notes. What would you like to learn today?
          `;
        }
      } else if (role === 'FACULTY') {
        if (subtitle) subtitle.textContent = 'Assistance with 50-minute lesson plans, Bloom\'s taxonomy questions, syllabus pacing, and lab prompts.';
        if (welcome && (!this.aiChatHistory || !this.aiChatHistory.length)) {
          welcome.innerHTML = `
            Welcome <strong>${this.user.name}</strong>! I am your EDVANTA Teaching Assistant.<br><br>
            I can help structure 50-minute teaching sessions, develop formative assessment MCQs, draft homework prompts, and summarize syllabus units. What would you like to plan today?
          `;
        }
      } else {
        if (subtitle) subtitle.textContent = 'Strategic guidance on curriculum pacing, accreditation frameworks, and academic management.';
        if (welcome && (!this.aiChatHistory || !this.aiChatHistory.length)) {
          welcome.innerHTML = `
            Welcome Dean / Administrator <strong>${this.user.name}</strong>! I am your EDVANTA Academic Operations Assistant.<br><br>
            I can assist with syllabus pacing analysis frameworks, curriculum delivery benchmarks, and institutional guidelines.
          `;
        }
      }

      // Check provider configuration status
      try {
        const status = await API.getAIStatus();
        const badge = document.getElementById('aiModelStatusBadge');
        const warning = document.getElementById('aiConfigWarning');

        if (status.configured) {
          if (badge) {
            badge.className = 'status-pill ontrack';
            badge.textContent = `${status.provider === 'gemini' ? 'Gemini 1.5 Flash' : status.provider.toUpperCase()} • Active`;
          }
          if (warning) warning.style.display = 'none';
        } else {
          if (badge) {
            badge.className = 'status-pill tight';
            badge.textContent = 'Waiting for API Key';
          }
          if (warning) warning.style.display = 'block';
        }
      } catch (err) {
        console.warn('AI status check warning:', err);
      }

      // Render role-based quick prompt chips
      this.renderAISuggestionChips(role);

      // Setup character counter
      const input = document.getElementById('aiPromptInput');
      const counter = document.getElementById('aiCharCount');
      if (input && counter) {
        input.oninput = () => {
          counter.textContent = input.value.length;
        };
      }
    },

    renderAISuggestionChips(role) {
      const container = document.getElementById('aiSuggestionChips');
      if (!container) return;

      let chips = [];
      if (role === 'STUDENT') {
        chips = [
          'Explain Virtual Machines vs Containers simply',
          'Generate 5 practice MCQs on Binary Search with answers',
          'Summarize CAP Theorem in 3 clear bullet points',
          'Key differences between Type-1 and Type-2 hypervisors',
          'How should I prepare for a Mid-Term exam on Data Structures?'
        ];
      } else if (role === 'FACULTY') {
        chips = [
          'Draft a 50-minute lesson plan for CAP Theorem and PACELC',
          'Generate 5 Bloom\'s taxonomy MCQs on Cloud Storage (S3 vs EBS)',
          'Suggest interactive lab exercises for Linux namespaces and cgroups',
          'Explain Amdahl\'s Law vs Gustafson\'s Law with a whiteboard analogy',
          'How to handle leftover syllabus topics when a class is delayed?'
        ];
      } else {
        chips = [
          'Explain syllabus pacing management and buffer ratio interpretation',
          'Best practices for preventing academic calendar delays before exams',
          'Curricular benchmarking guidelines for engineering tracks',
          'How to support faculty with high carry-forward topic volumes?'
        ];
      }

      container.innerHTML = chips.map(c => `
        <button type="button" class="ai-chip" onclick="App.useAISuggestion('${c.replace(/'/g, "\\'")}')">
          <span>✨</span>
          <span>${c}</span>
        </button>
      `).join('');
    },

    useAISuggestion(promptText) {
      const input = document.getElementById('aiPromptInput');
      if (input) {
        input.value = promptText;
        const counter = document.getElementById('aiCharCount');
        if (counter) counter.textContent = promptText.length;
        this.sendAIMessage();
      }
    },

    async sendAIMessage() {
      const input = document.getElementById('aiPromptInput');
      const sendBtn = document.getElementById('btnSendAI');
      const typingIndicator = document.getElementById('aiTypingIndicator');

      if (!input) return;
      const prompt = input.value.trim();
      if (!prompt) return;

      // 1. Append user bubble
      this.appendAIMessage('user', prompt);
      input.value = '';
      const counter = document.getElementById('aiCharCount');
      if (counter) counter.textContent = '0';

      // 2. Disable send button and show typing indicator
      if (sendBtn) sendBtn.disabled = true;
      if (typingIndicator) typingIndicator.style.display = 'flex';

      // Scroll messages container to bottom
      const messagesContainer = document.getElementById('aiChatMessages');
      if (messagesContainer) messagesContainer.scrollTop = messagesContainer.scrollHeight;

      try {
        const res = await API.sendAIChat(prompt, this.aiChatHistory);
        const replyText = res.response || 'No response generated.';

        // Append assistant bubble
        this.appendAIMessage('model', replyText);

        // Record in conversation history (keep last 8)
        this.aiChatHistory.push({ role: 'user', text: prompt });
        this.aiChatHistory.push({ role: 'model', text: replyText });
        if (this.aiChatHistory.length > 8) {
          this.aiChatHistory = this.aiChatHistory.slice(-8);
        }
      } catch (err) {
        this.appendAIMessage('error', `⚠️ ${err.message || 'Failed to reach AI Assistant.'}`);
        this.showToast(err.message || 'AI request failed', 'error');
      } finally {
        if (sendBtn) sendBtn.disabled = false;
        if (typingIndicator) typingIndicator.style.display = 'none';
        if (messagesContainer) messagesContainer.scrollTop = messagesContainer.scrollHeight;
        if (input) input.focus();
      }
    },

    appendAIMessage(role, text) {
      const container = document.getElementById('aiChatMessages');
      if (!container) return;

      const isUser = role === 'user';
      const isError = role === 'error';

      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const avatar = isUser ? '👤' : (isError ? '⚠️' : '🤖');
      const author = isUser ? (this.user?.name || 'You') : 'EDVANTA AI Academic Assistant';

      // Simple markdown-to-HTML parser for bullet points, bold, headings, and code
      const formatMarkdown = (raw) => {
        let html = raw
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');

        // Fenced code blocks
        html = html.replace(/```([\s\S]*?)```/g, '<pre style="background: var(--surface-soft); padding: 0.75rem; border-radius: 6px; overflow-x: auto; font-family: \'JetBrains Mono\', monospace; font-size: 0.82rem; border: 1px solid var(--borders);"><code>$1</code></pre>');
        // Inline code
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
        // Bold
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        // Headings
        html = html.replace(/^### (.*$)/gim, '<h3 style="margin-top: 0.5rem; color: inherit;">$1</h3>');
        html = html.replace(/^## (.*$)/gim, '<h3 style="margin-top: 0.5rem; color: inherit;">$1</h3>');
        // Bullets
        html = html.replace(/^\* (.*$)/gim, '<li style="margin-left: 1.25rem;">$1</li>');
        html = html.replace(/^- (.*$)/gim, '<li style="margin-left: 1.25rem;">$1</li>');
        // Paragraph newlines
        html = html.replace(/\n\n/g, '<br><br>');
        return html;
      };

      const msgDiv = document.createElement('div');
      msgDiv.className = `ai-msg ${isUser ? 'ai-msg-user' : 'ai-msg-bot'}`;
      if (isError) {
        msgDiv.style.alignSelf = 'center';
      }

      msgDiv.innerHTML = `
        <div class="ai-msg-avatar">${avatar}</div>
        <div class="ai-msg-body" style="${isError ? 'background: #FCE4E4; border-color: #F87171; color: #991B1B;' : ''}">
          <div class="ai-msg-header">
            <strong>${author}</strong>
            <span class="ai-msg-time">${timeStr}</span>
          </div>
          <div class="ai-msg-content">
            ${isError ? text : formatMarkdown(text)}
          </div>
        </div>
      `;

      container.appendChild(msgDiv);
    },

    clearAIChat() {
      this.aiChatHistory = [];
      const container = document.getElementById('aiChatMessages');
      if (container) {
        const welcomeText = this.user?.role === 'STUDENT'
          ? `Chat cleared! Hello <strong>${this.user.name}</strong>, ask any academic or study question to get started.`
          : `Chat cleared! Hello <strong>${this.user?.name || 'Professor'}</strong>, how can I assist with your curriculum planning today?`;

        container.innerHTML = `
          <div class="ai-msg ai-msg-bot">
            <div class="ai-msg-avatar">🤖</div>
            <div class="ai-msg-body">
              <div class="ai-msg-header">
                <strong>EDVANTA AI Academic Assistant</strong>
                <span class="ai-msg-time">Just now</span>
              </div>
              <div class="ai-msg-content">${welcomeText}</div>
            </div>
          </div>
        `;
      }
      this.showToast('AI conversation history cleared.', 'info');
    },

    // -------------------------------------------------------------
    // TELEGRAM BOT MODAL (Phase 2)
    // -------------------------------------------------------------
    tgCountdownTimer: null,

    async openTelegramModal() {
      this.openModal('telegramModal');
      await this.refreshTelegramModal();
    },

    async refreshTelegramModal() {
      try {
        const status = await API.getTelegramStatus();
        const unlinkedView = document.getElementById('tgUnlinkedView');
        const linkedView = document.getElementById('tgLinkedView');
        const botHandle = document.getElementById('tgBotHandle');
        if (botHandle && status.bot_username) {
          botHandle.textContent = `@${status.bot_username}`;
        }

        if (status.is_linked) {
          if (unlinkedView) unlinkedView.style.display = 'none';
          if (linkedView) linkedView.style.display = 'block';
          const details = document.getElementById('tgLinkedDetails');
          if (details) {
            const dateStr = status.linked_at ? new Date(status.linked_at).toLocaleDateString() : 'Active';
            details.innerHTML = `
              <strong>Linked Account:</strong> ${status.telegram_username ? '@' + status.telegram_username : 'Connected'}<br>
              <strong>Status:</strong> Active • Linked on ${dateStr}
            `;
          }
        } else {
          if (unlinkedView) unlinkedView.style.display = 'block';
          if (linkedView) linkedView.style.display = 'none';
        }
      } catch (err) {
        console.error('Failed to load Telegram status:', err);
      }
    },

    async generateTelegramCode() {
      const codeText = document.getElementById('tgCodeText');
      const instruction = document.getElementById('tgCodeInstruction');
      const timerBadge = document.getElementById('tgTimerBadge');
      const btn = document.getElementById('btnGenerateTgCode');

      try {
        if (btn) btn.disabled = true;
        const res = await API.generateTelegramLinkCode();
        if (codeText) codeText.textContent = res.code;
        if (instruction) instruction.textContent = `Valid for 10 minutes. Send /link ${res.code} to your bot.`;
        if (timerBadge) {
          timerBadge.style.display = 'inline-block';
          timerBadge.className = 'status-pill tight';
          let remainingSeconds = res.expires_in_seconds || 600;
          if (this.tgCountdownTimer) clearInterval(this.tgCountdownTimer);
          this.tgCountdownTimer = setInterval(() => {
            remainingSeconds--;
            if (remainingSeconds <= 0) {
              clearInterval(this.tgCountdownTimer);
              timerBadge.textContent = 'Expired';
              timerBadge.className = 'status-pill danger';
            } else {
              const mins = Math.floor(remainingSeconds / 60);
              const secs = remainingSeconds % 60;
              timerBadge.textContent = `Expires in ${mins}:${secs < 10 ? '0' : ''}${secs}`;
            }
          }, 1000);
        }
        this.showToast('Telegram linking code generated!', 'success');
      } catch (err) {
        this.showToast(err.message || 'Failed to generate code', 'error');
      } finally {
        if (btn) btn.disabled = false;
      }
    },

    async unlinkTelegramAccount() {
      if (!confirm('Are you sure you want to unlink your Telegram account? You will stop receiving academic alerts.')) {
        return;
      }

      try {
        await API.unlinkTelegram();
        this.showToast('Telegram account unlinked.', 'info');
        await this.refreshTelegramModal();
      } catch (err) {
        this.showToast(err.message || 'Failed to unlink account', 'error');
      }
    },

    // -------------------------------------------------------------
    // WHATSAPP BUSINESS PLATFORM MODAL (Phase 3)
    // -------------------------------------------------------------
    waCountdownTimer: null,

    async openWhatsAppModal() {
      this.openModal('whatsappModal');
      await this.refreshWhatsAppModal();
    },

    async refreshWhatsAppModal() {
      try {
        const status = await API.getWhatsAppStatus();
        const unlinkedView = document.getElementById('waUnlinkedView');
        const linkedView = document.getElementById('waLinkedView');
        const phoneInput = document.getElementById('waPhoneInput');

        if (this.user?.phone && phoneInput && !phoneInput.value) {
          phoneInput.value = this.user.phone;
        }

        if (status.is_linked) {
          if (unlinkedView) unlinkedView.style.display = 'none';
          if (linkedView) linkedView.style.display = 'block';
          const numDisplay = document.getElementById('waLinkedNumber');
          if (numDisplay) numDisplay.textContent = status.phone_number || 'Connected';

          const master = document.getElementById('waPrefMaster');
          const att = document.getElementById('waPrefAttendance');
          const sched = document.getElementById('waPrefSchedule');
          const prog = document.getElementById('waPrefProgress');

          if (master && status.preferences) master.checked = Boolean(status.preferences.notifications_enabled);
          if (att && status.preferences) att.checked = Boolean(status.preferences.notify_attendance);
          if (sched && status.preferences) sched.checked = Boolean(status.preferences.notify_schedule);
          if (prog && status.preferences) prog.checked = Boolean(status.preferences.notify_progress);
        } else {
          if (unlinkedView) unlinkedView.style.display = 'block';
          if (linkedView) linkedView.style.display = 'none';
        }
      } catch (err) {
        console.error('Failed to load WhatsApp status:', err);
      }
    },

    async requestWhatsAppCode() {
      const phoneInput = document.getElementById('waPhoneInput');
      const btn = document.getElementById('btnWaSendCode');
      const otpSection = document.getElementById('waOtpSection');
      const timerBadge = document.getElementById('waTimerBadge');

      if (!phoneInput || !phoneInput.value.trim()) {
        this.showToast('Please enter your mobile phone number.', 'warning');
        return;
      }

      try {
        if (btn) btn.disabled = true;
        const res = await API.requestWhatsAppCode(phoneInput.value.trim());
        if (otpSection) otpSection.style.display = 'block';
        if (timerBadge) {
          let seconds = res.expires_in_seconds || 600;
          if (this.waCountdownTimer) clearInterval(this.waCountdownTimer);
          this.waCountdownTimer = setInterval(() => {
            seconds--;
            if (seconds <= 0) {
              clearInterval(this.waCountdownTimer);
              timerBadge.textContent = 'Expired';
              timerBadge.className = 'status-pill danger';
            } else {
              const mins = Math.floor(seconds / 60);
              const rem = seconds % 60;
              timerBadge.textContent = `Valid for ${mins}:${rem < 10 ? '0' : ''}${rem}`;
            }
          }, 1000);
        }
        this.showToast('Verification code generated!', 'success');
        const codeInput = document.getElementById('waCodeInput');
        if (codeInput) {
          if (res.dev_code) codeInput.value = res.dev_code;
          codeInput.focus();
        }
      } catch (err) {
        this.showToast(err.message || 'Failed to request code', 'error');
      } finally {
        if (btn) btn.disabled = false;
      }
    },

    async verifyWhatsAppCode() {
      const phoneInput = document.getElementById('waPhoneInput');
      const codeInput = document.getElementById('waCodeInput');
      const btn = document.getElementById('btnWaVerify');

      if (!phoneInput || !phoneInput.value.trim() || !codeInput || !codeInput.value.trim()) {
        this.showToast('Please enter both phone number and 6-digit code.', 'warning');
        return;
      }

      try {
        if (btn) btn.disabled = true;
        await API.verifyWhatsAppCode(phoneInput.value.trim(), codeInput.value.trim());
        this.showToast('WhatsApp account linked successfully!', 'success');
        if (this.waCountdownTimer) clearInterval(this.waCountdownTimer);
        await this.refreshWhatsAppModal();
      } catch (err) {
        this.showToast(err.message || 'Verification failed', 'error');
      } finally {
        if (btn) btn.disabled = false;
      }
    },

    async saveWhatsAppPreferences() {
      const master = document.getElementById('waPrefMaster')?.checked;
      const att = document.getElementById('waPrefAttendance')?.checked;
      const sched = document.getElementById('waPrefSchedule')?.checked;
      const prog = document.getElementById('waPrefProgress')?.checked;

      try {
        await API.updateWhatsAppPreferences({
          notifications_enabled: master,
          notify_attendance: att,
          notify_schedule: sched,
          notify_progress: prog
        });
        this.showToast('Notification preferences updated.', 'info');
      } catch (err) {
        this.showToast(err.message || 'Failed to save preferences', 'error');
      }
    },

    async unlinkWhatsAppAccount() {
      if (!confirm('Are you sure you want to unlink your WhatsApp account? You will stop receiving academic alerts.')) {
        return;
      }

      try {
        await API.unlinkWhatsApp();
        this.showToast('WhatsApp account unlinked.', 'info');
        await this.refreshWhatsAppModal();
      } catch (err) {
        this.showToast(err.message || 'Failed to unlink account', 'error');
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
