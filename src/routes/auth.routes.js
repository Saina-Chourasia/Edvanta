// Authentication Routes for EDVANTA
// Production-ready authentication supporting Email or Phone login, password management, and RBAC

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { db } from '../database/db.js';
import { authenticate, generateToken } from '../middleware/auth.js';
import { requireRole } from '../middleware/permissions.js';

const router = Router();

// In-memory OTP store for phone authentication (expires after 10 mins)
const phoneOtpStore = new Map();

// 1. Standard Login (Accepts email OR phone number + password)
router.post('/login', async (req, res) => {
  try {
    const { identifier, email, phone, password } = req.body;
    const inputId = (identifier || email || phone || '').trim();

    if (!inputId || !password) {
      return res.status(400).json({ error: 'Email/Phone and password are required.' });
    }

    // Support phone input with country code or spacing: e.g. +91 9876543210 -> 9876543210
    const digitsOnly = inputId.replace(/\D/g, '');
    const normalizedPhone = (digitsOnly.length === 12 && digitsOnly.startsWith('91'))
      ? digitsOnly.slice(2)
      : (digitsOnly.length === 10 ? digitsOnly : inputId);

    const user = await db.get(`
      SELECT u.*, c.name as campus_name
      FROM users u
      LEFT JOIN campuses c ON u.campus_id = c.id
      WHERE LOWER(u.email) = LOWER(?) OR u.phone = ? OR u.phone = ?
    `, [inputId, inputId, normalizedPhone]);

    if (!user) {
      return res.status(401).json({ error: 'Invalid email/phone or password.' });
    }

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid email/phone or password.' });
    }

    const token = generateToken(user);
    const isProd = process.env.NODE_ENV === 'production';
    const secureFlag = isProd ? '; Secure' : '';
    res.setHeader('Set-Cookie', `edvanta_token=${token}; Path=/; SameSite=Lax${secureFlag}; Max-Age=604800`);
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone || null,
        name: user.name,
        role: user.role,
        campus_id: user.campus_id,
        campus_name: user.campus_name || null,
        batch_name: user.batch_name
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error during authentication.' });
  }
});

// 1b. Phone OTP Authentication (Send & Verify)
router.post('/otp/send', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ error: 'Phone number is required.' });
    }
    const digitsOnly = String(phone).replace(/\D/g, '');
    const normalizedPhone = (digitsOnly.length === 12 && digitsOnly.startsWith('91'))
      ? digitsOnly.slice(2)
      : (digitsOnly.length === 10 ? digitsOnly : digitsOnly);

    if (!normalizedPhone || normalizedPhone.length < 7) {
      return res.status(400).json({ error: 'Please enter a valid mobile number (at least 7 digits).' });
    }

    // Look up user with normalized phone or exact phone
    const user = await db.get(`
      SELECT id, name, phone, role
      FROM users
      WHERE phone = ? OR phone = ?
    `, [normalizedPhone, phone]);

    if (!user) {
      return res.status(404).json({
        error: `No registered MSOT account found for phone "${phone}". Please check your registered number.`
      });
    }

    // Generate 6-digit OTP code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    phoneOtpStore.set(normalizedPhone, {
      code,
      userId: user.id,
      expiresAt: Date.now() + 10 * 60 * 1000 // 10 minutes
    });

    res.json({
      message: `Verification code generated for ${user.name} (${user.role}).`,
      phone: normalizedPhone,
      dev_code: code
    });
  } catch (err) {
    console.error('OTP send error:', err);
    res.status(500).json({ error: 'Failed to generate verification code.' });
  }
});

router.post('/otp/verify', async (req, res) => {
  try {
    const { phone, code } = req.body;
    if (!phone || !code) {
      return res.status(400).json({ error: 'Phone number and verification code are required.' });
    }
    const digitsOnly = String(phone).replace(/\D/g, '');
    const normalizedPhone = (digitsOnly.length === 12 && digitsOnly.startsWith('91'))
      ? digitsOnly.slice(2)
      : (digitsOnly.length === 10 ? digitsOnly : digitsOnly);

    const entry = phoneOtpStore.get(normalizedPhone);
    if (!entry) {
      return res.status(401).json({ error: 'No active verification code found for this number. Please request a new code.' });
    }

    if (Date.now() > entry.expiresAt) {
      phoneOtpStore.delete(normalizedPhone);
      return res.status(401).json({ error: 'Verification code has expired. Please request a new code.' });
    }

    if (entry.code !== String(code).trim()) {
      return res.status(401).json({ error: 'Invalid verification code. Please check the code and try again.' });
    }

    // Code verified
    phoneOtpStore.delete(normalizedPhone);

    const user = await db.get(`
      SELECT u.*, c.name as campus_name
      FROM users u
      LEFT JOIN campuses c ON u.campus_id = c.id
      WHERE u.id = ?
    `, [entry.userId]);

    if (!user) {
      return res.status(404).json({ error: 'User account not found.' });
    }

    const token = generateToken(user);
    const isProd = process.env.NODE_ENV === 'production';
    const secureFlag = isProd ? '; Secure' : '';
    res.setHeader('Set-Cookie', `edvanta_token=${token}; Path=/; SameSite=Lax${secureFlag}; Max-Age=604800`);
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone || null,
        name: user.name,
        role: user.role,
        campus_id: user.campus_id,
        campus_name: user.campus_name || null,
        batch_name: user.batch_name
      }
    });
  } catch (err) {
    console.error('OTP verify error:', err);
    res.status(500).json({ error: 'Failed to verify OTP code.' });
  }
});

// 2. Change Password Flow (Authenticated)
router.post('/change-password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required.' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters long.' });
    }

    const user = await db.get(`SELECT * FROM users WHERE id = ?`, [req.user.id]);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const isValid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await db.run(`UPDATE users SET password_hash = ? WHERE id = ?`, [newHash, user.id]);

    res.json({ message: 'Password changed successfully.' });
  } catch (err) {
    console.error('Password change error:', err);
    res.status(500).json({ error: 'Failed to update password.' });
  }
});

// 3. Admin Account Creation Flow (Controlled user provisioning)
router.post('/users', authenticate, requireRole('ADMIN'), async (req, res) => {
  try {
    const { email, phone, name, role, campus_id, batch_name, password } = req.body;

    if (!email || !name || !role || !password) {
      return res.status(400).json({ error: 'Email, name, role, and password are required.' });
    }

    const allowedRoles = ['CAMPUS_MANAGER', 'FACULTY', 'STUDENT'];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ error: `Invalid role. Allowed roles: ${allowedRoles.join(', ')}` });
    }

    // Check unique email
    const existingEmail = await db.get(`SELECT id FROM users WHERE LOWER(email) = LOWER(?)`, [email.trim()]);
    if (existingEmail) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    // Check unique phone if provided
    if (phone) {
      const existingPhone = await db.get(`SELECT id FROM users WHERE phone = ?`, [phone.trim()]);
      if (existingPhone) {
        return res.status(409).json({ error: 'An account with this phone number already exists.' });
      }
    }

    const hash = await bcrypt.hash(password, 10);
    const userId = `usr_${role.toLowerCase().slice(0, 3)}_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;

    await db.run(`
      INSERT INTO users (id, email, phone, password_hash, name, role, campus_id, batch_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      userId,
      email.trim().toLowerCase(),
      phone ? phone.trim() : null,
      hash,
      name.trim(),
      role,
      campus_id || null,
      batch_name || null
    ]);

    res.status(201).json({
      message: 'Account created successfully.',
      user: {
        id: userId,
        email: email.trim().toLowerCase(),
        phone: phone ? phone.trim() : null,
        name: name.trim(),
        role,
        campus_id: campus_id || null,
        batch_name: batch_name || null
      }
    });
  } catch (err) {
    console.error('Account creation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 4. Logout Endpoint
router.post('/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'edvanta_token=; Path=/; SameSite=Lax; Max-Age=0');
  res.json({ message: 'Logged out successfully.' });
});

// 5. Get Current Authenticated User Profile
router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await db.get(`
      SELECT u.id, u.email, u.phone, u.name, u.role, u.campus_id, u.batch_name, c.name as campus_name
      FROM users u
      LEFT JOIN campuses c ON u.campus_id = c.id
      WHERE u.id = ?
    `, [req.user.id]);

    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Test Suite & Developer Token Generator (Preserved for automated tests)
router.post('/quick-login', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Quick-login is disabled in production environments.' });
  }
  try {
    const { role, userId } = req.body;

    let user = null;
    if (userId) {
      user = await db.get(`
        SELECT u.*, c.name as campus_name
        FROM users u
        LEFT JOIN campuses c ON u.campus_id = c.id
        WHERE u.id = ?
      `, [userId]);
    } else if (role) {
      user = await db.get(`
        SELECT u.*, c.name as campus_name
        FROM users u
        LEFT JOIN campuses c ON u.campus_id = c.id
        WHERE u.role = ?
        LIMIT 1
      `, [role.toUpperCase()]);
    }

    if (!user) {
      return res.status(404).json({ error: 'User not found for requested role.' });
    }

    const token = generateToken(user);
    res.setHeader('Set-Cookie', `edvanta_token=${token}; Path=/; SameSite=Lax; Max-Age=604800`);
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone || null,
        name: user.name,
        role: user.role,
        campus_id: user.campus_id,
        campus_name: user.campus_name || null,
        batch_name: user.batch_name
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error during quick login.' });
  }
});

// 7. Get users list (for Admin management)
router.get('/users', authenticate, requireRole('ADMIN'), async (req, res) => {
  try {
    const users = await db.query(`
      SELECT u.id, u.email, u.phone, u.name, u.role, u.campus_id, u.batch_name, c.name as campus_name, u.created_at
      FROM users u
      LEFT JOIN campuses c ON u.campus_id = c.id
      ORDER BY CASE u.role
        WHEN 'ADMIN' THEN 1
        WHEN 'CAMPUS_MANAGER' THEN 2
        WHEN 'FACULTY' THEN 3
        WHEN 'STUDENT' THEN 4
        ELSE 5 END, u.name ASC
    `);
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 8. Google OAuth 2.0 / OpenID Connect Authentication
// -------------------------------------------------------------

/**
 * Helper to extract specific cookie value from request
 */
function getRequestCookie(req, name) {
  if (!req.headers.cookie) return null;
  const match = req.headers.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * GET /api/auth/google/status
 * Check if Google OAuth credentials are configured
 */
router.get('/google/status', (req, res) => {
  const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
  res.json({
    configured: Boolean(clientId && clientSecret),
    provider: 'google',
    callback_url: process.env.GOOGLE_CALLBACK_URL || `${req.protocol}://${req.get('host')}/api/auth/google/callback`
  });
});

/**
 * GET /api/auth/google
 * Initiates the Google OAuth 2.0 authorization code flow
 */
router.get('/google', (req, res) => {
  const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').trim();

  // If credentials missing, redirect to frontend with clear notification
  if (!clientId || !clientSecret) {
    return res.redirect('/?auth_error=google_unconfigured');
  }

  // Generate cryptographically secure random state token for CSRF protection
  const state = crypto.randomBytes(24).toString('hex');
  const callbackUrl = process.env.GOOGLE_CALLBACK_URL || `${req.protocol}://${req.get('host')}/api/auth/google/callback`;

  // Store state in an HTTP-only secure cookie (expires in 10 minutes)
  res.setHeader('Set-Cookie', `oauth_state=${encodeURIComponent(state)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`);

  // Build standard Google OAuth 2.0 authorization URL
  const googleAuthUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  googleAuthUrl.searchParams.set('client_id', clientId);
  googleAuthUrl.searchParams.set('redirect_uri', callbackUrl);
  googleAuthUrl.searchParams.set('response_type', 'code');
  googleAuthUrl.searchParams.set('scope', 'openid email profile');
  googleAuthUrl.searchParams.set('state', state);
  googleAuthUrl.searchParams.set('access_type', 'online');
  googleAuthUrl.searchParams.set('prompt', 'select_account');

  res.redirect(googleAuthUrl.toString());
});

/**
 * GET /api/auth/google/callback
 * Handles the OAuth 2.0 authorization callback from Google
 */
router.get('/google/callback', async (req, res) => {
  const { code, state, error } = req.query;

  // Handle user cancellation or Google errors
  if (error) {
    return res.redirect(`/?auth_error=google_${encodeURIComponent(error)}`);
  }

  if (!code) {
    return res.redirect('/?auth_error=missing_code');
  }

  // Validate CSRF state parameter
  const savedState = getRequestCookie(req, 'oauth_state');
  if (!savedState || savedState !== state) {
    return res.redirect('/?auth_error=invalid_state');
  }

  const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
  const callbackUrl = process.env.GOOGLE_CALLBACK_URL || `${req.protocol}://${req.get('host')}/api/auth/google/callback`;

  if (!clientId || !clientSecret) {
    return res.redirect('/?auth_error=google_unconfigured');
  }

  try {
    // 1. Exchange authorization code for tokens securely on the backend
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: callbackUrl,
        grant_type: 'authorization_code'
      })
    });

    if (!tokenResponse.ok) {
      const errDetails = await tokenResponse.text().catch(() => '');
      console.error('Google token exchange error:', errDetails);
      return res.redirect('/?auth_error=token_exchange_failed');
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // 2. Fetch verified identity claims from Google OpenID Connect UserInfo endpoint
    const userinfoResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!userinfoResponse.ok) {
      console.error('Google userinfo fetch failed:', userinfoResponse.status);
      return res.redirect('/?auth_error=userinfo_fetch_failed');
    }

    const googleProfile = await userinfoResponse.json();

    // Helper to normalize email addresses consistently
    const normalizeEmail = (e) => (typeof e === 'string' ? e.trim().toLowerCase() : '');

    const verifiedEmail = normalizeEmail(googleProfile.email);

    if (!verifiedEmail) {
      return res.redirect('/?auth_error=no_email_provided');
    }

    if (googleProfile.email_verified === false) {
      return res.redirect('/?auth_error=unverified_google_email');
    }

    // 3. Match against authorized MSOT users in the existing database
    let user = await db.get(`
      SELECT u.*, c.name as campus_name
      FROM users u
      LEFT JOIN campuses c ON u.campus_id = c.id
      WHERE LOWER(u.email) = ?
    `, [verifiedEmail]);

    // Check environment-variable allowlisted emails (GOOGLE_ALLOWED_EMAIL_1, GOOGLE_ALLOWED_EMAIL_2, GOOGLE_ALLOWED_EMAIL_3, GOOGLE_ALLOWED_EMAIL)
    if (!user) {
      const allowlistEntries = [
        {
          email: normalizeEmail(process.env.GOOGLE_ALLOWED_EMAIL_1),
          role: (process.env.GOOGLE_ALLOWED_ROLE_1 || 'STUDENT').toUpperCase(),
          campus_id: process.env.GOOGLE_ALLOWED_CAMPUS_1 || 'camp_hitech',
          batch_name: process.env.GOOGLE_ALLOWED_BATCH_1 || 'Batch-2026-Mirai-A'
        },
        {
          email: normalizeEmail(process.env.GOOGLE_ALLOWED_EMAIL_2),
          role: (process.env.GOOGLE_ALLOWED_ROLE_2 || 'STUDENT').toUpperCase(),
          campus_id: process.env.GOOGLE_ALLOWED_CAMPUS_2 || 'camp_hitech',
          batch_name: process.env.GOOGLE_ALLOWED_BATCH_2 || 'Batch-2026-Mirai-A'
        },
        {
          email: normalizeEmail(process.env.GOOGLE_ALLOWED_EMAIL_3),
          role: (process.env.GOOGLE_ALLOWED_ROLE_3 || 'STUDENT').toUpperCase(),
          campus_id: process.env.GOOGLE_ALLOWED_CAMPUS_3 || 'camp_hitech',
          batch_name: process.env.GOOGLE_ALLOWED_BATCH_3 || 'Batch-2026-Mirai-A'
        },
        {
          email: normalizeEmail(process.env.GOOGLE_ALLOWED_EMAIL),
          role: (process.env.GOOGLE_ALLOWED_ROLE || 'STUDENT').toUpperCase(),
          campus_id: process.env.GOOGLE_ALLOWED_CAMPUS || 'camp_hitech',
          batch_name: process.env.GOOGLE_ALLOWED_BATCH || 'Batch-2026-Mirai-A'
        }
      ].filter(item => item.email.length > 0);

      const matched = allowlistEntries.find(item => item.email === verifiedEmail);

      if (matched) {
        // Enforce valid MSOT roles: STUDENT, FACULTY, CAMPUS_MANAGER, ADMIN
        // Do NOT automatically grant ADMIN unless explicitly configured in role env
        const validRoles = ['STUDENT', 'FACULTY', 'CAMPUS_MANAGER', 'ADMIN'];
        const assignedRole = validRoles.includes(matched.role) ? matched.role : 'STUDENT';
        const assignedCampus = matched.campus_id || 'camp_hitech';
        const assignedBatch = assignedRole === 'STUDENT' ? (matched.batch_name || 'Batch-2026-Mirai-A') : null;

        // Ensure record exists in SQLite for session & RBAC integrity
        const existingRecord = await db.get(`SELECT id FROM users WHERE LOWER(email) = ?`, [verifiedEmail]);
        if (existingRecord) {
          user = await db.get(`
            SELECT u.*, c.name as campus_name
            FROM users u
            LEFT JOIN campuses c ON u.campus_id = c.id
            WHERE u.id = ?
          `, [existingRecord.id]);
        } else {
          const newUserId = `usr_g_${assignedRole.toLowerCase().slice(0, 3)}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
          const randomSecret = crypto.randomBytes(24).toString('hex');
          const passwordHash = bcrypt.hashSync(randomSecret, 10);
          const userName = (googleProfile.name || verifiedEmail.split('@')[0] || 'MSOT User').trim();

          await db.run(`
            INSERT INTO users (id, email, phone, password_hash, name, role, campus_id, batch_name)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            newUserId,
            verifiedEmail,
            null,
            passwordHash,
            userName,
            assignedRole,
            assignedCampus,
            assignedBatch
          ]);

          user = await db.get(`
            SELECT u.*, c.name as campus_name
            FROM users u
            LEFT JOIN campuses c ON u.campus_id = c.id
            WHERE u.id = ?
          `, [newUserId]);
        }
      }
    }

    if (!user) {
      // Reject unknown Google accounts with clean error explaining authorization policy
      return res.redirect(`/?auth_error=unauthorized_account&email=${encodeURIComponent(verifiedEmail)}`);
    }

    // 4. Establish genuine authenticated session
    const token = generateToken(user);

    // Set edvanta_token session cookie and clear oauth_state
    const isProd = process.env.NODE_ENV === 'production';
    const secureFlag = isProd ? '; Secure' : '';
    res.setHeader('Set-Cookie', [
      `edvanta_token=${encodeURIComponent(token)}; Path=/; SameSite=Lax${secureFlag}; Max-Age=604800`,
      `oauth_state=; Path=/; HttpOnly; SameSite=Lax${secureFlag}; Max-Age=0`
    ]);

    // Redirect to authenticated app with token parameter for robust browser compatibility
    res.redirect(`/?auth_success=1&token=${encodeURIComponent(token)}`);
  } catch (err) {
    console.error('Google OAuth callback unexpected error:', err);
    res.redirect('/?auth_error=oauth_internal_error');
  }
});

export default router;

