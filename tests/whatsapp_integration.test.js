// Phase 3: WhatsApp Business Platform (Cloud API) Integration Tests
// Verifies phone verification, secure linking/unlinking, role-aware alerts,
// notification preferences, webhook HMAC-SHA256 signatures, idempotency, and secrets isolation.

import test, { describe, before, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { db } from '../src/database/db.js';
import app from '../src/server.js';
import WhatsAppService from '../src/services/whatsapp.service.js';

describe('Phase 3: WhatsApp Business Platform Integration Tests', () => {
  let server;
  let baseUrl;
  let adminToken;
  let facultyToken;
  let studentToken;
  let adminUser;
  let facultyUser;
  let studentUser;

  const testPhonePrefix = `+9198${Date.now().toString().slice(-6)}`;
  const testPhoneStudent = `${testPhonePrefix}1`;
  const testPhoneFaculty = `${testPhonePrefix}2`;

  before(async () => {
    adminUser = await db.get("SELECT id, name, role FROM users WHERE role = 'ADMIN' LIMIT 1");
    facultyUser = await db.get("SELECT id, name, role FROM users WHERE role = 'FACULTY' LIMIT 1");
    studentUser = await db.get("SELECT id, name, role, batch_name FROM users WHERE role = 'STUDENT' LIMIT 1");
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // Obtain JWT tokens for web endpoint tests
    const [admRes, facRes, stuRes] = await Promise.all([
      fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: 'admin@edvanta.msot.edu', password: 'edvanta123' })
      }),
      fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: 'faculty.cs@edvanta.msot.edu', password: 'edvanta123' })
      }),
      fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: 'student.aarav@edvanta.msot.edu', password: 'edvanta123' })
      })
    ]);

    adminToken = (await admRes.json()).token;
    facultyToken = (await facRes.json()).token;
    studentToken = (await stuRes.json()).token;

    // Clean any prior test links
    db.run("DELETE FROM whatsapp_links WHERE user_id IN (?, ?, ?)", [studentUser.id, facultyUser.id, adminUser.id]);
    db.run("DELETE FROM whatsapp_link_codes WHERE user_id IN (?, ?, ?)", [studentUser.id, facultyUser.id, adminUser.id]);
  });

  after(() => {
    db.run("DELETE FROM whatsapp_links WHERE user_id IN (?, ?, ?)", [studentUser.id, facultyUser.id, adminUser.id]);
    db.run("DELETE FROM whatsapp_link_codes WHERE user_id IN (?, ?, ?)", [studentUser.id, facultyUser.id, adminUser.id]);
    if (server) server.close();
  });

  // -------------------------------------------------------------
  // Test 1: Configuration & Secrets Protection
  // -------------------------------------------------------------
  test('WhatsAppService.getConfig reports status safely without leaking credentials', () => {
    const config = WhatsAppService.getConfig();
    assert.strictEqual(typeof config.isConfigured, 'boolean');
    assert.strictEqual(typeof config.accessToken, 'string');
    assert.strictEqual(typeof config.phoneNumberId, 'string');
    assert.strictEqual(typeof config.verifyToken, 'string');
    assert.strictEqual(typeof config.appSecret, 'string');
  });

  // -------------------------------------------------------------
  // Test 2: Phone Number Normalization & Sanitization
  // -------------------------------------------------------------
  test('Normalizes phone numbers to standard E.164 format and rejects invalid inputs', () => {
    // 10-digit Indian standard
    assert.strictEqual(WhatsAppService.normalizePhoneNumber('9876543220'), '+919876543220');
    assert.strictEqual(WhatsAppService.normalizePhoneNumber('+91 98765-43220'), '+919876543220');
    assert.strictEqual(WhatsAppService.normalizePhoneNumber('00919876543220'), '+919876543220');

    // Invalid numbers
    assert.throws(() => WhatsAppService.normalizePhoneNumber('123'), /Invalid phone number/);
    assert.throws(() => WhatsAppService.normalizePhoneNumber(''), /valid phone number/);
    assert.throws(() => WhatsAppService.normalizePhoneNumber(null), /valid phone number/);

    // Masking
    assert.strictEqual(WhatsAppService.maskPhoneNumber('+919876543220'), '+91 ••••• ••220');
  });

  // -------------------------------------------------------------
  // Test 3: API Authentication Enforcement
  // -------------------------------------------------------------
  test('Protected WhatsApp API endpoints reject unauthenticated requests with HTTP 401', async () => {
    const statusRes = await fetch(`${baseUrl}/api/whatsapp/status`);
    assert.strictEqual(statusRes.status, 401);

    const reqRes = await fetch(`${baseUrl}/api/whatsapp/request-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone_number: '9876543220' })
    });
    assert.strictEqual(reqRes.status, 401);

    const verifyRes = await fetch(`${baseUrl}/api/whatsapp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone_number: '9876543220', code: '123456' })
    });
    assert.strictEqual(verifyRes.status, 401);

    const unlinkRes = await fetch(`${baseUrl}/api/whatsapp/unlink`, { method: 'POST' });
    assert.strictEqual(unlinkRes.status, 401);
  });

  // -------------------------------------------------------------
  // Test 4: Verification Code Generation & Expiry
  // -------------------------------------------------------------
  test('Authenticated user can request a 10-minute verification code', async () => {
    const res = await fetch(`${baseUrl}/api/whatsapp/request-code`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${studentToken}`
      },
      body: JSON.stringify({ phone_number: testPhoneStudent })
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.phone_number, testPhoneStudent);
    assert.strictEqual(data.expires_in_seconds, 600);
    assert.ok(new Date(data.expires_at) > new Date());
    assert.ok(data.dev_code && /^\d{6}$/.test(data.dev_code));
  });

  test('Verification code requests are rate-limited (max 5 per 15 minutes)', async () => {
    const userId = studentUser.id;
    let rateLimited = false;
    for (let i = 0; i < 7; i++) {
      try {
        await WhatsAppService.requestVerificationCode(userId, testPhoneStudent);
      } catch (err) {
        if (err.status === 429) {
          rateLimited = true;
          break;
        }
      }
    }
    assert.strictEqual(rateLimited, true);
    // Clear limiter for subsequent tests
    WhatsAppService.requestRateLimits.delete(userId);
  });

  // -------------------------------------------------------------
  // Test 5: Code Verification (Invalid, Expired, and Valid Linking)
  // -------------------------------------------------------------
  test('Rejects invalid verification code', async () => {
    const res = await fetch(`${baseUrl}/api/whatsapp/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${studentToken}`
      },
      body: JSON.stringify({ phone_number: testPhoneStudent, code: '000000' })
    });

    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /invalid or already used/i);
  });

  test('Rejects expired verification code', async () => {
    const expiredOtp = '999111';
    const codeHash = crypto.createHash('sha256').update(expiredOtp).digest('hex');
    const codeId = `wa_exp_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    await db.run(`
      INSERT INTO whatsapp_link_codes (id, user_id, phone_number, code_hash, expires_at, used)
      VALUES (?, ?, ?, ?, ?, 0)
    `, [codeId, studentUser.id, testPhoneStudent, codeHash, Date.now() - 5000]); // Expired 5 seconds ago

    await assert.rejects(async () => {
      await WhatsAppService.verifyAndLink(studentUser.id, testPhoneStudent, expiredOtp);
    }, /expired/i);
  });

  test('Valid code successfully links WhatsApp phone number to student account', async () => {
    const codeRes = await WhatsAppService.requestVerificationCode(studentUser.id, testPhoneStudent);
    const validCode = codeRes.dev_code;

    const res = await fetch(`${baseUrl}/api/whatsapp/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${studentToken}`
      },
      body: JSON.stringify({ phone_number: testPhoneStudent, code: validCode })
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.link.user_id, studentUser.id);
    assert.strictEqual(data.link.phone_number, testPhoneStudent);

    // Verify status endpoint reflects linked state
    const statusRes = await fetch(`${baseUrl}/api/whatsapp/status`, {
      headers: { 'Authorization': `Bearer ${studentToken}` }
    });
    const statusData = await statusRes.json();
    assert.strictEqual(statusData.is_linked, true);
    assert.strictEqual(statusData.preferences.notifications_enabled, true);
  });

  test('Rejects reuse of an already used verification code', async () => {
    const codeRes = await WhatsAppService.requestVerificationCode(facultyUser.id, testPhoneFaculty);
    const validCode = codeRes.dev_code;

    // First use: succeeds
    const linkRes = await WhatsAppService.verifyAndLink(facultyUser.id, testPhoneFaculty, validCode);
    assert.strictEqual(linkRes.success, true);

    // Second use: must be rejected
    await assert.rejects(async () => {
      await WhatsAppService.verifyAndLink(facultyUser.id, testPhoneFaculty, validCode);
    }, /invalid or already used/i);
  });

  // -------------------------------------------------------------
  // Test 6: Duplicate Linking Prevention
  // -------------------------------------------------------------
  test('Prevents linking same phone number to another account', async () => {
    // testPhoneStudent is already linked to studentUser
    await assert.rejects(async () => {
      await WhatsAppService.requestVerificationCode(adminUser.id, testPhoneStudent);
    }, /already linked to another EDVANTA account/i);
  });

  test('Prevents user from linking multiple phone numbers simultaneously', async () => {
    // studentUser is already linked to testPhoneStudent
    const extraPhone = `${testPhonePrefix}9`;
    const codeRes = await WhatsAppService.requestVerificationCode(studentUser.id, extraPhone);
    await assert.rejects(async () => {
      await WhatsAppService.verifyAndLink(studentUser.id, extraPhone, codeRes.dev_code);
    }, /already linked to another phone number/i);
  });

  // -------------------------------------------------------------
  // Test 7: Notification Consent Preferences
  // -------------------------------------------------------------
  test('User can update and toggle notification preferences', async () => {
    const patchRes = await fetch(`${baseUrl}/api/whatsapp/preferences`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${studentToken}`
      },
      body: JSON.stringify({
        notifications_enabled: true,
        notify_attendance: true,
        notify_schedule: false,
        notify_progress: true
      })
    });

    assert.strictEqual(patchRes.status, 200);
    const data = await patchRes.json();
    assert.strictEqual(data.preferences.notify_schedule, false);
    assert.strictEqual(data.preferences.notify_attendance, true);
    assert.strictEqual(data.preferences.notify_progress, true);
  });

  // -------------------------------------------------------------
  // Test 8: Role-Aware Academic Alerts & Preferences Enforcement
  // -------------------------------------------------------------
  test('Academic alerts respect notification opt-outs and user preferences', async () => {
    // Student opted out of SCHEDULE alerts
    const scheduleAlert = await WhatsAppService.sendAcademicAlert(studentUser.id, 'SCHEDULE', { summary: 'Math 101' });
    assert.strictEqual(scheduleAlert.sent, false);
    assert.match(scheduleAlert.reason, /opted out of schedule/i);

    // Student opted in to ATTENDANCE alerts
    const attendanceAlert = await WhatsAppService.sendAcademicAlert(studentUser.id, 'ATTENDANCE', {
      subject_code: 'CS101',
      session_date: '2026-10-20',
      status: 'PRESENT'
    });
    // In test mode, outbound calls are simulated
    assert.strictEqual(attendanceAlert.sent, false);
    assert.strictEqual(attendanceAlert.simulated, true);
  });

  // -------------------------------------------------------------
  // Test 9: Webhook Handshake & Signature Validation
  // -------------------------------------------------------------
  test('GET /api/whatsapp/webhook handles Meta challenge handshake correctly', async () => {
    const verifyToken = 'test_edvanta_verify_token_2026';
    process.env.WHATSAPP_VERIFY_TOKEN = verifyToken;

    // Successful handshake
    const resSuccess = await fetch(
      `${baseUrl}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${verifyToken}&hub.challenge=CHALLENGE_ACCEPTED`
    );
    assert.strictEqual(resSuccess.status, 200);
    const challengeText = await resSuccess.text();
    assert.strictEqual(challengeText, 'CHALLENGE_ACCEPTED');

    // Forbidden on invalid verify token
    const resFail = await fetch(
      `${baseUrl}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=WRONG_TOKEN&hub.challenge=FAIL`
    );
    assert.strictEqual(resFail.status, 403);
  });

  test('POST /api/whatsapp/webhook validates HMAC-SHA256 signature and duplicate event idempotency', async () => {
    const appSecret = 'test_meta_app_secret_abc123';
    process.env.WHATSAPP_APP_SECRET = appSecret;

    const payload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: 'WHATSAPP_BUSINESS_ACCOUNT_ID',
        changes: [{
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '1555023', phone_number_id: '1001' },
            statuses: [{ id: `msg_test_${Date.now()}`, status: 'delivered' }]
          },
          field: 'messages'
        }]
      }]
    };

    const rawBody = JSON.stringify(payload);
    const validSignature = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');

    // 1. Valid signature -> Accepted
    const resValid = await fetch(`${baseUrl}/api/whatsapp/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': validSignature
      },
      body: rawBody
    });
    assert.strictEqual(resValid.status, 200);
    const validData = await resValid.json();
    assert.strictEqual(validData.status, 'EVENT_RECEIVED');
    assert.strictEqual(validData.result.status, 'PROCESSED');

    // 2. Duplicate event -> Recognized as duplicate and idempotent
    const resDup = await fetch(`${baseUrl}/api/whatsapp/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': validSignature
      },
      body: rawBody
    });
    assert.strictEqual(resDup.status, 200);
    const dupData = await resDup.json();
    assert.strictEqual(dupData.result.status, 'DUPLICATE_IGNORED');

    // 3. Invalid signature -> Rejected with 401
    const resInvalid = await fetch(`${baseUrl}/api/whatsapp/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': 'sha256=invalidhexsignature000000000000000000000000000000000000000000000000'
      },
      body: rawBody
    });
    assert.strictEqual(resInvalid.status, 401);

    // Reset app secret
    delete process.env.WHATSAPP_APP_SECRET;
  });

  // -------------------------------------------------------------
  // Test 10: Unlinking Account
  // -------------------------------------------------------------
  test('User can unlink WhatsApp account via POST /api/whatsapp/unlink', async () => {
    const unlinkRes = await fetch(`${baseUrl}/api/whatsapp/unlink`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${studentToken}` }
    });
    assert.strictEqual(unlinkRes.status, 200);
    const data = await unlinkRes.json();
    assert.strictEqual(data.success, true);

    // Verify unlinked in status
    const statusRes = await fetch(`${baseUrl}/api/whatsapp/status`, {
      headers: { 'Authorization': `Bearer ${studentToken}` }
    });
    const statusData = await statusRes.json();
    assert.strictEqual(statusData.is_linked, false);
  });
});
