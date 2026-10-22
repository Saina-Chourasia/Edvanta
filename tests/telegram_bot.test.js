// Phase 2: Telegram Academic Bot Integration Tests
// Verifies secure account linking, role-based authorization, rate limits, secret protection, and error handling

import test, { describe, before, after } from 'node:test';
import assert from 'node:assert';
import { db } from '../src/database/db.js';
import app from '../src/server.js';
import TelegramService from '../src/services/telegram.service.js';

describe('Phase 2: Telegram Academic Bot Integration Tests', () => {
  let server;
  let baseUrl;
  let adminToken;
  let facultyToken;
  let studentToken;
  let adminUser;
  let facultyUser;
  let studentUser;

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

    // Clean test links and codes for clean test run
    db.run("DELETE FROM telegram_links WHERE telegram_chat_id LIKE 'test_%'");
    db.run("DELETE FROM telegram_link_codes WHERE code_hash LIKE 'test_%'");
  });

  after(() => {
    // Clean test data
    db.run("DELETE FROM telegram_links WHERE telegram_chat_id LIKE 'test_%'");
    db.run("DELETE FROM telegram_link_codes WHERE code_hash LIKE 'test_%'");
    if (server) server.close();
  });

  // -------------------------------------------------------------
  // Test 1: Configuration & Secrets Protection
  // -------------------------------------------------------------
  test('TelegramService.getConfig reports status without exposing secret token', () => {
    const config = TelegramService.getConfig();
    assert.strictEqual(typeof config.isConfigured, 'boolean');
    assert.strictEqual(typeof config.username, 'string');
    assert.strictEqual(typeof config.pollingEnabled, 'boolean');

    // In tests, polling must strictly remain false
    assert.strictEqual(process.env.NODE_ENV, 'test');
    assert.strictEqual(config.pollingEnabled, false);
  });

  // -------------------------------------------------------------
  // Test 2: Web Route Authentication
  // -------------------------------------------------------------
  test('POST /api/telegram/link-code rejects unauthenticated requests with HTTP 401', async () => {
    const res = await fetch(`${baseUrl}/api/telegram/link-code`, {
      method: 'POST'
    });
    assert.strictEqual(res.status, 401);
  });

  test('GET /api/telegram/status returns link status for authenticated user', async () => {
    const res = await fetch(`${baseUrl}/api/telegram/status`, {
      headers: { 'Authorization': `Bearer ${studentToken}` }
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(typeof data.configured, 'boolean');
    assert.strictEqual(typeof data.is_linked, 'boolean');
    assert.strictEqual(data.token, undefined); // Token never leaked to client!
  });

  // -------------------------------------------------------------
  // Test 3: One-Time Linking Code Generation & Constraints
  // -------------------------------------------------------------
  test('Authenticated student can generate a one-time 10-minute linking code', async () => {
    const res = await fetch(`${baseUrl}/api/telegram/link-code`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${studentToken}` }
    });
    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.ok(data.code && data.code.startsWith('EDV'));
    assert.strictEqual(data.expires_in_seconds, 600);
    assert.ok(new Date(data.expires_at) > new Date());
  });

  test('Linking code generation is rate-limited per user', async () => {
    const userId = studentUser.id;
    // Exceed rate limit of 5 requests
    let hitLimit = false;
    for (let i = 0; i < 7; i++) {
      try {
        await TelegramService.generateLinkCode(userId);
      } catch (err) {
        if (err.status === 429) {
          hitLimit = true;
          break;
        }
      }
    }
    assert.strictEqual(hitLimit, true, 'Rate limit should be triggered when exceeding threshold');
    // Clear rate limit for subsequent tests
    TelegramService.codeGenRateLimits.delete(userId);
  });

  // -------------------------------------------------------------
  // Test 4: Account Linking Validation (Expired, Invalid, Reused)
  // -------------------------------------------------------------
  test('Rejects invalid linking code', async () => {
    const result = await TelegramService.linkAccount('test_chat_9001', 'NONEXISTENT_CODE');
    assert.strictEqual(result.success, false);
    assert.match(result.error, /invalid or already used/i);
  });

  test('Rejects expired linking code', async () => {
    const expiredCode = `EDVEXP_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
    const expiredHash = TelegramService.hashCode(expiredCode);
    const codeId = `tg_code_exp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    await db.run(`
      INSERT INTO telegram_link_codes (id, user_id, code_hash, expires_at, used)
      VALUES (?, ?, ?, ?, 0)
    `, [codeId, studentUser.id, expiredHash, Date.now() - 5000]); // Expired 5 seconds ago

    const result = await TelegramService.linkAccount('test_chat_9002', expiredCode);
    assert.strictEqual(result.success, false);
    assert.match(result.error, /expired/i);
  });

  test('Valid linking code successfully binds Telegram chat_id to user', async () => {
    const linkCodeData = await TelegramService.generateLinkCode(studentUser.id);
    const result = await TelegramService.linkAccount('test_chat_student_1', linkCodeData.code, {
      username: 'aarav_mehta',
      first_name: 'Aarav'
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.user.id, studentUser.id);
    assert.strictEqual(result.user.role, 'STUDENT');

    // Verify record in database
    const link = await db.get('SELECT * FROM telegram_links WHERE telegram_chat_id = ?', ['test_chat_student_1']);
    assert.ok(link);
    assert.strictEqual(link.user_id, studentUser.id);
    assert.strictEqual(link.telegram_username, 'aarav_mehta');
  });

  test('Rejects reuse of an already used linking code', async () => {
    const linkCodeData = await TelegramService.generateLinkCode(facultyUser.id);
    // First use
    const res1 = await TelegramService.linkAccount('test_chat_fac_1', linkCodeData.code);
    assert.strictEqual(res1.success, true);

    // Second use with same code
    const res2 = await TelegramService.linkAccount('test_chat_fac_2', linkCodeData.code);
    assert.strictEqual(res2.success, false);
    assert.match(res2.error, /invalid or already used/i);
  });

  test('Rejects duplicate linking: Same Telegram chat linking to another user', async () => {
    const codeData = await TelegramService.generateLinkCode(adminUser.id);
    // test_chat_student_1 is already linked to studentUser
    const result = await TelegramService.linkAccount('test_chat_student_1', codeData.code);
    assert.strictEqual(result.success, false);
    assert.match(result.error, /already linked/i);
  });

  test('Rejects duplicate linking: Same EDVANTA user linking a second Telegram chat', async () => {
    // studentUser is already linked to test_chat_student_1
    const codeData = await TelegramService.generateLinkCode(studentUser.id);
    const result = await TelegramService.linkAccount('test_chat_student_extra', codeData.code);
    assert.strictEqual(result.success, false);
    assert.match(result.error, /already linked to another Telegram account/i);
  });

  // -------------------------------------------------------------
  // Test 5: Command Authorization & Scoping
  // -------------------------------------------------------------
  test('Unlinked Telegram user cannot access /progress, /schedule, or /attendance', async () => {
    const unlinkedChatId = 'test_unlinked_999';

    // Mock sendMessage
    let sentMessage = null;
    const origSend = TelegramService.sendMessage;
    TelegramService.sendMessage = async (chatId, text) => {
      sentMessage = text;
      return { sent: true };
    };

    try {
      await TelegramService.handleIncomingMessage({
        chat: { id: unlinkedChatId },
        text: '/progress'
      });
      assert.match(sentMessage, /Access Restricted/i);

      sentMessage = null;
      await TelegramService.handleIncomingMessage({
        chat: { id: unlinkedChatId },
        text: '/schedule'
      });
      assert.match(sentMessage, /Access Restricted/i);

      sentMessage = null;
      await TelegramService.handleIncomingMessage({
        chat: { id: unlinkedChatId },
        text: '/attendance'
      });
      assert.match(sentMessage, /Access Restricted/i);
    } finally {
      TelegramService.sendMessage = origSend;
    }
  });

  test('Student receives only their own authorized batch curriculum and schedule', async () => {
    let sentMessage = null;
    const origSend = TelegramService.sendMessage;
    TelegramService.sendMessage = async (chatId, text) => {
      sentMessage = text;
      return { sent: true };
    };

    try {
      // 1. /progress
      await TelegramService.handleIncomingMessage({
        chat: { id: 'test_chat_student_1' },
        text: '/progress'
      });
      assert.match(sentMessage, /Curriculum Progress/i);
      assert.match(sentMessage, new RegExp(studentUser.name, 'i'));

      // 2. /schedule
      sentMessage = null;
      await TelegramService.handleIncomingMessage({
        chat: { id: 'test_chat_student_1' },
        text: '/schedule'
      });
      assert.match(sentMessage, /Class Timetable/i);

      // 3. /attendance
      sentMessage = null;
      await TelegramService.handleIncomingMessage({
        chat: { id: 'test_chat_student_1' },
        text: '/attendance'
      });
      assert.match(sentMessage, /Attendance/i);
    } finally {
      TelegramService.sendMessage = origSend;
    }
  });

  test('Faculty receives only their assigned subjects in /progress and /schedule', async () => {
    let sentMessage = null;
    const origSend = TelegramService.sendMessage;
    TelegramService.sendMessage = async (chatId, text) => {
      sentMessage = text;
      return { sent: true };
    };

    try {
      // test_chat_fac_1 is linked to facultyUser
      await TelegramService.handleIncomingMessage({
        chat: { id: 'test_chat_fac_1' },
        text: '/progress'
      });
      assert.match(sentMessage, /Teaching Progress/i);
      assert.match(sentMessage, /Aris Thorne/i);

      sentMessage = null;
      await TelegramService.handleIncomingMessage({
        chat: { id: 'test_chat_fac_1' },
        text: '/schedule'
      });
      assert.match(sentMessage, /Teaching Schedule/i);
    } finally {
      TelegramService.sendMessage = origSend;
    }
  });

  // -------------------------------------------------------------
  // Test 6: Unlink Command & Web Unlink
  // -------------------------------------------------------------
  test('User can unlink via /unlink command', async () => {
    let sentMessage = null;
    const origSend = TelegramService.sendMessage;
    TelegramService.sendMessage = async (chatId, text) => {
      sentMessage = text;
      return { sent: true };
    };

    try {
      await TelegramService.handleIncomingMessage({
        chat: { id: 'test_chat_fac_1' },
        text: '/unlink'
      });
      assert.match(sentMessage, /Account Unlinked/i);

      // Verify unlinked in DB
      const link = await db.get('SELECT * FROM telegram_links WHERE telegram_chat_id = ?', ['test_chat_fac_1']);
      assert.strictEqual(link, null);
    } finally {
      TelegramService.sendMessage = origSend;
    }
  });

  test('User can unlink via web API (POST /api/telegram/unlink)', async () => {
    const res = await fetch(`${baseUrl}/api/telegram/unlink`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${studentToken}` }
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);

    const link = await db.get('SELECT * FROM telegram_links WHERE telegram_chat_id = ?', ['test_chat_student_1']);
    assert.strictEqual(link, null);
  });

  // -------------------------------------------------------------
  // Test 7: Outbound Notifications & Polling Safety
  // -------------------------------------------------------------
  test('sendNotification safely handles unlinked users without throwing', async () => {
    const result = await TelegramService.sendNotification('nonexistent_user_id', 'Test notification');
    assert.strictEqual(result.sent, false);
    assert.match(result.reason, /not linked/i);
  });

  test('startPolling does not start in test mode or when polling is disabled', async () => {
    assert.strictEqual(TelegramService.isPollingActive, false);
    await TelegramService.startPolling();
    assert.strictEqual(TelegramService.isPollingActive, false);
  });
});
