// Telegram Academic Bot Service for EDVANTA
// Provides secure account linking, role-aware academic queries, and alert notification dispatch.
// Uses Node.js native fetch() without external library dependencies.

import crypto from 'node:crypto';
import { db } from '../database/db.js';
import ProgressionService from './progression.service.js';

class TelegramService {
  // In-memory rate limiters for code generation and verification attempts
  static codeGenRateLimits = new Map(); // userId -> timestamps[]
  static verifyRateLimits = new Map();  // chatId -> timestamps[]

  // Polling state controls
  static isPollingActive = false;
  static pollingAbortController = null;
  static lastUpdateId = 0;

  /**
   * Get Telegram bot configuration
   */
  static getConfig() {
    const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
    const username = (process.env.TELEGRAM_BOT_USERNAME || 'EdvantaBot').trim().replace(/^@/, '');
    const pollingEnabled = (process.env.TELEGRAM_POLLING || 'false').toLowerCase().trim() === 'true';

    return {
      token,
      username,
      pollingEnabled,
      isConfigured: token.length > 0
    };
  }

  /**
   * Helper to hash linking code with SHA-256
   */
  static hashCode(code) {
    return crypto.createHash('sha256').update(String(code).trim().toUpperCase()).digest('hex');
  }

  /**
   * Check rate limit for code generation (Max 5 codes per 15 minutes per user)
   */
  static checkCodeGenRateLimit(userId) {
    if (!userId) return false;
    const now = Date.now();
    const windowMs = 15 * 60 * 1000;
    const maxAttempts = 5;

    let timestamps = this.codeGenRateLimits.get(userId) || [];
    timestamps = timestamps.filter(t => now - t < windowMs);

    if (timestamps.length >= maxAttempts) {
      return false;
    }

    timestamps.push(now);
    this.codeGenRateLimits.set(userId, timestamps);
    return true;
  }

  /**
   * Check rate limit for code verification attempts (Max 10 attempts per 15 minutes per chat)
   */
  static checkVerifyRateLimit(chatId) {
    if (!chatId) return false;
    const now = Date.now();
    const windowMs = 15 * 60 * 1000;
    const maxAttempts = 10;

    const key = String(chatId);
    let timestamps = this.verifyRateLimits.get(key) || [];
    timestamps = timestamps.filter(t => now - t < windowMs);

    if (timestamps.length >= maxAttempts) {
      return false;
    }

    timestamps.push(now);
    this.verifyRateLimits.set(key, timestamps);
    return true;
  }

  /**
   * Generate a one-time 8-character linking code for an authenticated user.
   * Code expires after 10 minutes.
   */
  static generateLinkCode(userId) {
    if (!userId) {
      throw new Error('User ID is required to generate a linking code.');
    }

    // Verify user exists in database
    const user = db.get('SELECT id, name, email, role FROM users WHERE id = ?', [userId]);
    if (!user) {
      const err = new Error('User not found.');
      err.status = 404;
      throw err;
    }

    if (!this.checkCodeGenRateLimit(userId)) {
      const err = new Error('Rate limit exceeded: You can only request up to 5 linking codes per 15 minutes.');
      err.status = 429;
      throw err;
    }

    // Generate random 8-character uppercase alphanumeric code
    const rawCode = `EDV${crypto.randomBytes(3).toString('hex').toUpperCase()}`; // e.g. EDVA1B2C3
    const codeHash = this.hashCode(rawCode);
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    // Invalidate any previous unused codes for this user
    db.run('UPDATE telegram_link_codes SET used = 1 WHERE user_id = ? AND used = 0', [userId]);

    const codeId = `tg_code_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    db.run(`
      INSERT INTO telegram_link_codes (id, user_id, code_hash, expires_at, used)
      VALUES (?, ?, ?, ?, 0)
    `, [codeId, userId, codeHash, expiresAt]);

    const { username } = this.getConfig();

    return {
      code: rawCode,
      expires_in_seconds: 600,
      expires_at: new Date(expiresAt).toISOString(),
      bot_username: username
    };
  }

  /**
   * Link a Telegram chat ID to an EDVANTA user using a valid one-time code
   */
  static linkAccount(chatId, code, telegramUser = {}) {
    if (!chatId) {
      return { success: false, error: 'Telegram chat ID is required.' };
    }
    if (!code || typeof code !== 'string') {
      return { success: false, error: 'A linking code is required. Usage: /link <code>' };
    }

    const cleanChatId = String(chatId);
    if (!this.checkVerifyRateLimit(cleanChatId)) {
      return { success: false, error: 'Too many failed linking attempts. Please wait 15 minutes before trying again.' };
    }

    const codeHash = this.hashCode(code);

    // Find the code record
    const record = db.get(`
      SELECT * FROM telegram_link_codes
      WHERE code_hash = ? AND used = 0
    `, [codeHash]);

    if (!record) {
      return { success: false, error: 'Invalid or already used linking code. Please generate a fresh code in EDVANTA.' };
    }

    if (Date.now() > record.expires_at) {
      // Mark as used so it cannot be retried
      db.run('UPDATE telegram_link_codes SET used = 1 WHERE id = ?', [record.id]);
      return { success: false, error: 'This linking code has expired (valid for 10 minutes). Please generate a new code.' };
    }

    // Check if this Telegram chat is already linked to another user
    const existingChatLink = db.get('SELECT * FROM telegram_links WHERE telegram_chat_id = ?', [cleanChatId]);
    if (existingChatLink) {
      return {
        success: false,
        error: 'This Telegram account is already linked to an EDVANTA profile. Send /unlink first if you wish to re-link.'
      };
    }

    // Check if this EDVANTA user is already linked to another Telegram account
    const existingUserLink = db.get('SELECT * FROM telegram_links WHERE user_id = ?', [record.user_id]);
    if (existingUserLink) {
      return {
        success: false,
        error: 'Your EDVANTA account is already linked to another Telegram account. Unlink it from the web portal first.'
      };
    }

    // Atomically link account and invalidate code
    const linkId = `tg_link_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    try {
      db.transaction(() => {
        db.run('UPDATE telegram_link_codes SET used = 1 WHERE id = ?', [record.id]);
        db.run(`
          INSERT INTO telegram_links (id, user_id, telegram_chat_id, telegram_username, first_name)
          VALUES (?, ?, ?, ?, ?)
        `, [
          linkId,
          record.user_id,
          cleanChatId,
          telegramUser.username || null,
          telegramUser.first_name || null
        ]);
      });
    } catch (err) {
      return { success: false, error: `Linking failed due to a database constraint: ${err.message}` };
    }

    const user = db.get('SELECT id, name, email, role, batch_name, campus_id FROM users WHERE id = ?', [record.user_id]);
    return { success: true, user };
  }

  /**
   * Unlink account by Telegram chat ID
   */
  static unlinkByChatId(chatId) {
    const cleanChatId = String(chatId);
    const existing = db.get('SELECT * FROM telegram_links WHERE telegram_chat_id = ?', [cleanChatId]);
    if (!existing) {
      return { success: false, error: 'This Telegram account is not currently linked.' };
    }
    db.run('DELETE FROM telegram_links WHERE telegram_chat_id = ?', [cleanChatId]);
    return { success: true };
  }

  /**
   * Unlink account by EDVANTA user ID (invoked from web portal)
   */
  static unlinkByUserId(userId) {
    const existing = db.get('SELECT * FROM telegram_links WHERE user_id = ?', [userId]);
    if (!existing) {
      return { success: false, error: 'No Telegram account linked.' };
    }
    db.run('DELETE FROM telegram_links WHERE user_id = ?', [userId]);
    return { success: true };
  }

  /**
   * Get link status for a user
   */
  static getLinkStatus(userId) {
    const link = db.get(`
      SELECT tl.*, u.name as user_name, u.role as user_role
      FROM telegram_links tl
      JOIN users u ON tl.user_id = u.id
      WHERE tl.user_id = ?
    `, [userId]);

    const { username, isConfigured } = this.getConfig();

    return {
      configured: isConfigured,
      bot_username: username,
      is_linked: Boolean(link),
      linked_at: link ? link.linked_at : null,
      telegram_username: link ? link.telegram_username : null
    };
  }

  /**
   * Retrieve linked EDVANTA user from Telegram chat ID
   */
  static getLinkedUser(chatId) {
    const cleanChatId = String(chatId);
    return db.get(`
      SELECT u.id, u.name, u.email, u.phone, u.role, u.batch_name, u.campus_id, c.name as campus_name
      FROM telegram_links tl
      JOIN users u ON tl.user_id = u.id
      LEFT JOIN campuses c ON u.campus_id = c.id
      WHERE tl.telegram_chat_id = ?
    `, [cleanChatId]);
  }

  // -------------------------------------------------------------
  // Command Handling
  // -------------------------------------------------------------

  /**
   * Process incoming text message from Telegram
   */
  static async handleIncomingMessage({ chat, text, from }) {
    if (!chat || !chat.id || typeof text !== 'string') return null;

    const chatId = chat.id;
    const trimmed = text.trim();
    if (!trimmed) return null;

    const parts = trimmed.split(/\s+/);
    const rawCommand = parts[0].toLowerCase();
    const command = rawCommand.split('@')[0]; // strip bot username e.g. /help@edvantabot -> /help
    const args = parts.slice(1);

    const user = this.getLinkedUser(chatId);

    // 1. /start
    if (command === '/start') {
      if (user) {
        return this.sendMessage(chatId,
          `👋 Welcome back, *${this.escapeMarkdown(user.name)}*!\n` +
          `You are connected as *${user.role}* (${this.escapeMarkdown(user.campus_name || 'MSOT')}).\n\n` +
          `Use /help to see your available commands.`
        );
      }
      return this.sendMessage(chatId,
        `🎓 *Welcome to EDVANTA — MSOT Academic Bot!*\n` +
        `_Every Hour Counts, Every Goal Matters._\n\n` +
        `This bot gives you secure, authorized access to your academic schedule, syllabus progression, and attendance.\n\n` +
        `🔗 *How to link your account:*\n` +
        `1. Sign in to your EDVANTA web portal.\n` +
        `2. Go to your Profile and request a *Telegram Link Code*.\n` +
        `3. Send \`/link <code>\` here within 10 minutes.\n\n` +
        `Type /help for command documentation.`
      );
    }

    // 2. /link <code>
    if (command === '/link') {
      const code = args[0];
      if (!code) {
        return this.sendMessage(chatId,
          `⚠️ *Missing Linking Code*\n` +
          `Usage: \`/link <YOUR_CODE>\`\n\n` +
          `Generate your one-time code in the EDVANTA web portal under your user profile.`
        );
      }

      const result = this.linkAccount(chatId, code, from || {});
      if (!result.success) {
        return this.sendMessage(chatId, `❌ *Linking Failed:*\n${result.error}`);
      }

      return this.sendMessage(chatId,
        `✅ *Account Successfully Linked!*\n\n` +
        `👤 *Name:* ${this.escapeMarkdown(result.user.name)}\n` +
        `🎖️ *Role:* ${result.user.role}\n` +
        (result.user.batch_name ? `👥 *Batch:* ${this.escapeMarkdown(result.user.batch_name)}\n` : '') +
        `\nYou now have authorized access to academic commands:\n` +
        `• /progress — Academic progression metrics\n` +
        `• /schedule — Your timetable slots\n` +
        `• /attendance — Your attendance status\n` +
        `• /help — Full command list`
      );
    }

    // 3. /help
    if (command === '/help') {
      if (!user) {
        return this.sendMessage(chatId,
          `📖 *EDVANTA Academic Bot — Commands*\n\n` +
          `• /start — Introduction and setup guide\n` +
          `• /link \`<code>\` — Link your EDVANTA account\n` +
          `• /help — Show this help message\n\n` +
          `🔒 *Notice:* You must link your account to view progress, schedule, or attendance.`
        );
      }

      let roleSpecific = '';
      if (user.role === 'STUDENT') {
        roleSpecific =
          `• /progress — View syllabus completion for your batch subjects\n` +
          `• /schedule — View your weekly class timetable\n` +
          `• /attendance — View your verified attendance record`;
      } else if (user.role === 'FACULTY') {
        roleSpecific =
          `• /progress — View teaching progress for your assigned subjects\n` +
          `• /schedule — View your teaching schedule & slots\n` +
          `• /attendance — View your active/recent attendance sessions`;
      } else {
        // ADMIN / CAMPUS_MANAGER
        roleSpecific =
          `• /progress — View institutional curriculum & track health summaries\n` +
          `• /schedule — View campus timetable summary\n` +
          `• /attendance — View campus attendance overview`;
      }

      return this.sendMessage(chatId,
        `📖 *EDVANTA Commands (${user.role})*\n\n` +
        roleSpecific + `\n` +
        `• /unlink — Disconnect your Telegram account\n` +
        `• /help — Show this help message`
      );
    }

    // 4. Require authentication for remaining commands
    if (!user) {
      return this.sendMessage(chatId,
        `🔒 *Access Restricted*\n` +
        `Your Telegram account is not linked to an EDVANTA profile.\n\n` +
        `Please log in to the EDVANTA web portal, generate a linking code, and send \`/link <code>\` here.`
      );
    }

    // 5. /progress
    if (command === '/progress') {
      return this.handleProgressCommand(chatId, user);
    }

    // 6. /schedule
    if (command === '/schedule') {
      return this.handleScheduleCommand(chatId, user);
    }

    // 7. /attendance
    if (command === '/attendance') {
      return this.handleAttendanceCommand(chatId, user);
    }

    // 8. /unlink
    if (command === '/unlink') {
      const res = this.unlinkByChatId(chatId);
      if (res.success) {
        return this.sendMessage(chatId,
          `🔓 *Account Unlinked*\n` +
          `Your Telegram account has been disconnected from EDVANTA. You will no longer receive notifications or access academic records.\n\n` +
          `To reconnect anytime, generate a new code in the web portal and send \`/link <code>\`.`
        );
      }
      return this.sendMessage(chatId, `⚠️ ${res.error}`);
    }

    // Unknown command
    return this.sendMessage(chatId,
      `❓ *Unrecognized Command:* \`${this.escapeMarkdown(command)}\`\n` +
      `Send /help to view your available commands.`
    );
  }

  // -------------------------------------------------------------
  // Role-Aware Academic Data Handlers
  // -------------------------------------------------------------

  /**
   * /progress Handler
   */
  static async handleProgressCommand(chatId, user) {
    if (user.role === 'STUDENT') {
      if (!user.batch_name) {
        return this.sendMessage(chatId, '⚠️ You are not assigned to a student batch. Please contact your campus manager.');
      }

      // Fetch subjects for student's batch
      const subjects = db.query(`
        SELECT s.id, s.code, s.name, s.planned_total_hours
        FROM subjects s
        JOIN semesters sem ON s.semester_id = sem.id
        WHERE sem.batch_name = ?
        ORDER BY s.code ASC
      `, [user.batch_name]);

      if (!subjects || subjects.length === 0) {
        return this.sendMessage(chatId, `ℹ️ No enrolled subjects found for batch *${this.escapeMarkdown(user.batch_name)}*.`);
      }

      let response = `📊 *Curriculum Progress — ${this.escapeMarkdown(user.name)}*\n`;
      response += `👥 *Batch:* ${this.escapeMarkdown(user.batch_name)}\n\n`;

      for (const subj of subjects) {
        try {
          const prog = ProgressionService.calculateSubjectProgress(subj.id);
          const statusIcon = prog.status === 'ON_TRACK' ? '🟢' : (prog.status === 'TIGHT' ? '🟡' : '🔴');
          response += `${statusIcon} *${this.escapeMarkdown(subj.code)}* (${this.escapeMarkdown(subj.name)})\n`;
          response += `   • Covered: ${prog.coveredHours.toFixed(1)} / ${prog.hoursInScope.toFixed(1)} hrs (${prog.completionPercentage}%)\n`;
          response += `   • Status: ${prog.status.replace('_', ' ')} • Pace: ${prog.paceVsPlanHours >= 0 ? '+' : ''}${prog.paceVsPlanHours.toFixed(1)} hrs\n\n`;
        } catch (e) {
          response += `• *${this.escapeMarkdown(subj.code)}*: Pacing data calculating...\n\n`;
        }
      }

      response += `_Data verified against official MSOT academic records._`;
      return this.sendMessage(chatId, response);
    }

    if (user.role === 'FACULTY') {
      const subjects = db.query(`
        SELECT s.id, s.code, s.name, s.planned_total_hours, sem.batch_name
        FROM subjects s
        JOIN semesters sem ON s.semester_id = sem.id
        WHERE s.faculty_id = ?
        ORDER BY s.code ASC
      `, [user.id]);

      if (!subjects || subjects.length === 0) {
        return this.sendMessage(chatId, `ℹ️ No teaching subjects currently assigned to your faculty profile.`);
      }

      let response = `👨‍🏫 *Teaching Progress — ${this.escapeMarkdown(user.name)}*\n\n`;
      for (const subj of subjects) {
        try {
          const prog = ProgressionService.calculateSubjectProgress(subj.id);
          const statusIcon = prog.status === 'ON_TRACK' ? '🟢' : (prog.status === 'TIGHT' ? '🟡' : '🔴');
          response += `${statusIcon} *${this.escapeMarkdown(subj.code)}* (${this.escapeMarkdown(subj.name)})\n`;
          response += `   • Batch: ${this.escapeMarkdown(subj.batch_name)}\n`;
          response += `   • Covered: ${prog.coveredHours.toFixed(1)} / ${prog.hoursInScope.toFixed(1)} hrs (${prog.completionPercentage}%)\n`;
          response += `   • Health: ${prog.status.replace('_', ' ')}\n\n`;
        } catch (e) {
          response += `• *${this.escapeMarkdown(subj.code)}*: Pacing calculating...\n\n`;
        }
      }
      return this.sendMessage(chatId, response);
    }

    // ADMIN or CAMPUS_MANAGER
    const filterCampus = user.role === 'CAMPUS_MANAGER' ? user.campus_id : null;
    let sql = `
      SELECT s.id, s.code, s.name, c.name as campus_name, sem.batch_name
      FROM subjects s
      JOIN campuses c ON s.campus_id = c.id
      JOIN semesters sem ON s.semester_id = sem.id
      WHERE sem.is_active = 1
    `;
    const params = [];
    if (filterCampus) {
      sql += ' AND s.campus_id = ?';
      params.push(filterCampus);
    }
    sql += ' ORDER BY c.name, s.code';

    const subjects = db.query(sql, params);
    if (!subjects.length) {
      return this.sendMessage(chatId, `ℹ️ No active curriculum subjects found.`);
    }

    let onTrackCount = 0;
    let tightCount = 0;
    let dangerCount = 0;

    for (const subj of subjects) {
      try {
        const p = ProgressionService.calculateSubjectProgress(subj.id);
        if (p.status === 'ON_TRACK') onTrackCount++;
        else if (p.status === 'TIGHT') tightCount++;
        else if (p.status === 'DANGER') dangerCount++;
      } catch (e) {
        // Skip uncalculated
      }
    }

    let response = `🏛️ *Institutional Curriculum Overview*\n`;
    if (user.campus_name) response += `📍 *Campus:* ${this.escapeMarkdown(user.campus_name)}\n`;
    response += `\n• Total Active Subjects: ${subjects.length}\n`;
    response += `• 🟢 On Track: ${onTrackCount}\n`;
    response += `• 🟡 Tight: ${tightCount}\n`;
    response += `• 🔴 In Danger: ${dangerCount}\n\n`;
    response += `_View comprehensive campus pacing matrices in the EDVANTA Web Dashboard._`;
    return this.sendMessage(chatId, response);
  }

  /**
   * /schedule Handler
   */
  static async handleScheduleCommand(chatId, user) {
    const weekdayNames = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    if (user.role === 'STUDENT') {
      if (!user.batch_name) {
        return this.sendMessage(chatId, '⚠️ You are not assigned to a batch. Timetable cannot be loaded.');
      }

      const slots = db.query(`
        SELECT ts.*, s.code as subject_code, s.name as subject_name, u.name as faculty_name
        FROM timetable_slots ts
        JOIN subjects s ON ts.subject_id = s.id
        LEFT JOIN users u ON ts.faculty_id = u.id
        WHERE ts.batch_name = ?
        ORDER BY ts.weekday ASC, ts.start_time ASC
      `, [user.batch_name]);

      if (!slots || slots.length === 0) {
        return this.sendMessage(chatId, `ℹ️ No timetable slots scheduled for batch *${this.escapeMarkdown(user.batch_name)}*.`);
      }

      let response = `📅 *Class Timetable — ${this.escapeMarkdown(user.batch_name)}*\n\n`;
      let currentDay = null;

      for (const slot of slots) {
        if (slot.weekday !== currentDay) {
          currentDay = slot.weekday;
          response += `\n🗓️ *${weekdayNames[currentDay] || 'Day ' + currentDay}*\n`;
        }
        response += `  • \`${slot.start_time} - ${slot.end_time}\` | *${this.escapeMarkdown(slot.subject_code)}* (${this.escapeMarkdown(slot.subject_name)})\n`;
        response += `    Room: ${this.escapeMarkdown(slot.room || 'TBD')} • Faculty: ${this.escapeMarkdown(slot.faculty_name || 'Assigned Staff')}\n`;
      }

      return this.sendMessage(chatId, response);
    }

    if (user.role === 'FACULTY') {
      const slots = db.query(`
        SELECT ts.*, s.code as subject_code, s.name as subject_name, c.name as campus_name
        FROM timetable_slots ts
        JOIN subjects s ON ts.subject_id = s.id
        JOIN campuses c ON ts.campus_id = c.id
        WHERE ts.faculty_id = ?
        ORDER BY ts.weekday ASC, ts.start_time ASC
      `, [user.id]);

      if (!slots || slots.length === 0) {
        return this.sendMessage(chatId, `ℹ️ No teaching slots scheduled for your faculty profile.`);
      }

      let response = `📅 *Teaching Schedule — ${this.escapeMarkdown(user.name)}*\n\n`;
      let currentDay = null;

      for (const slot of slots) {
        if (slot.weekday !== currentDay) {
          currentDay = slot.weekday;
          response += `\n🗓️ *${weekdayNames[currentDay] || 'Day ' + currentDay}*\n`;
        }
        response += `  • \`${slot.start_time} - ${slot.end_time}\` | *${this.escapeMarkdown(slot.subject_code)}* (Batch: ${this.escapeMarkdown(slot.batch_name)})\n`;
        response += `    Campus: ${this.escapeMarkdown(slot.campus_name)} • Room: ${this.escapeMarkdown(slot.room || 'TBD')}\n`;
      }

      return this.sendMessage(chatId, response);
    }

    // ADMIN
    const totalSlots = db.get('SELECT COUNT(*) as count FROM timetable_slots');
    return this.sendMessage(chatId,
      `📅 *Institutional Master Schedule*\n\n` +
      `• Total Scheduled Slots: ${totalSlots?.count || 0}\n` +
      `Log in to the EDVANTA Admin portal to inspect or edit detailed timetable matrices.`
    );
  }

  /**
   * /attendance Handler
   */
  static async handleAttendanceCommand(chatId, user) {
    if (user.role === 'STUDENT') {
      const records = db.query(`
        SELECT r.status, s.session_date, subj.code as subject_code
        FROM attendance_records r
        JOIN attendance_sessions s ON r.attendance_session_id = s.id
        JOIN subjects subj ON s.subject_id = subj.id
        WHERE r.student_id = ?
        ORDER BY s.session_date DESC
      `, [user.id]);

      const total = records.length;
      if (total === 0) {
        return this.sendMessage(chatId,
          `⏱️ *Attendance Status — ${this.escapeMarkdown(user.name)}*\n\n` +
          `No class attendance sessions have been recorded for your account yet.`
        );
      }

      const present = records.filter(r => r.status === 'PRESENT').length;
      const absent = total - present;
      const percentage = Math.round((present / total) * 100);

      const statusIcon = percentage >= 75 ? '🟢' : (percentage >= 65 ? '🟡' : '🔴');

      let response = `⏱️ *Attendance Summary — ${this.escapeMarkdown(user.name)}*\n\n`;
      response += `${statusIcon} *Overall Attendance:* ${percentage}%\n`;
      response += `• Total Sessions: ${total}\n`;
      response += `• Present: ${present}\n`;
      response += `• Absent: ${absent}\n\n`;

      response += `*Recent Sessions:*\n`;
      records.slice(0, 5).forEach(r => {
        const icon = r.status === 'PRESENT' ? '✅' : '❌';
        response += `• ${r.session_date} — *${this.escapeMarkdown(r.subject_code)}*: ${icon} ${r.status}\n`;
      });

      return this.sendMessage(chatId, response);
    }

    if (user.role === 'FACULTY') {
      const sessions = db.query(`
        SELECT s.id, s.session_date, s.batch_name, subj.code as subject_code,
               (SELECT COUNT(*) FROM attendance_records WHERE attendance_session_id = s.id) as attendee_count
        FROM attendance_sessions s
        JOIN subjects subj ON s.subject_id = subj.id
        WHERE s.faculty_id = ?
        ORDER BY s.session_date DESC, s.created_at DESC
        LIMIT 5
      `, [user.id]);

      if (!sessions || sessions.length === 0) {
        return this.sendMessage(chatId, `⏱️ No attendance sessions initiated under your faculty profile.`);
      }

      let response = `⏱️ *Recent Class Attendance Sessions*\n\n`;
      sessions.forEach(s => {
        response += `• *${s.session_date}* | *${this.escapeMarkdown(s.subject_code)}* (${this.escapeMarkdown(s.batch_name)})\n`;
        response += `  Submissions: ${s.attendee_count} students checked in\n`;
      });

      return this.sendMessage(chatId, response);
    }

    // ADMIN
    const stats = db.get(`
      SELECT
        (SELECT COUNT(*) FROM attendance_sessions) as total_sessions,
        (SELECT COUNT(*) FROM attendance_records) as total_records
    `);

    return this.sendMessage(chatId,
      `⏱️ *Institutional Attendance Overview*\n\n` +
      `• Total Attendance Sessions: ${stats?.total_sessions || 0}\n` +
      `• Total Check-In Records: ${stats?.total_records || 0}\n` +
      `_Detailed class rosters and corrections are available in the Attendance Management tab._`
    );
  }

  // -------------------------------------------------------------
  // Telegram Bot API Communication (Node.js fetch)
  // -------------------------------------------------------------

  /**
   * Escape markdown special characters
   */
  static escapeMarkdown(text) {
    if (!text) return '';
    return String(text).replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
  }

  /**
   * Send message to a Telegram chat using Telegram Bot API
   */
  static async sendMessage(chatId, text, options = {}) {
    const { token, isConfigured } = this.getConfig();
    if (!isConfigured) {
      return { sent: false, reason: 'TELEGRAM_BOT_TOKEN not configured in server environment.' };
    }

    const url = `https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`;

    const body = {
      chat_id: chatId,
      text,
      parse_mode: options.parse_mode || 'Markdown',
      disable_web_page_preview: true
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        // If Markdown parsing fails upstream, retry as plain text
        if (errorData.description && errorData.description.includes('can\'t parse entities')) {
          return this.sendMessage(chatId, text.replace(/[*_`\\[\]]/g, ''), { parse_mode: undefined });
        }
        return { sent: false, error: errorData.description || `HTTP ${res.status}` };
      }

      const data = await res.json();
      return { sent: true, messageId: data.result?.message_id };
    } catch (err) {
      clearTimeout(timeoutId);
      return { sent: false, error: err.name === 'AbortError' ? 'Telegram API request timed out.' : err.message };
    }
  }

  /**
   * Dispatch an academic alert notification to a linked user
   */
  static async sendNotification(userId, message) {
    if (!userId || !message) return { sent: false, reason: 'Missing user ID or message.' };

    const link = db.get('SELECT telegram_chat_id FROM telegram_links WHERE user_id = ?', [userId]);
    if (!link || !link.telegram_chat_id) {
      return { sent: false, reason: 'User has not linked their Telegram account.' };
    }

    return this.sendMessage(link.telegram_chat_id, message);
  }

  // -------------------------------------------------------------
  // Polling Engine (Local Development & Standalone Operation)
  // -------------------------------------------------------------

  /**
   * Start polling loop for Telegram updates (Safe local development)
   */
  static async startPolling() {
    const { token, pollingEnabled, isConfigured } = this.getConfig();

    if (!isConfigured || !pollingEnabled || process.env.NODE_ENV === 'test') {
      // Polling is disabled or in test mode
      return;
    }

    if (this.isPollingActive) {
      console.log('Telegram Bot: Polling is already active.');
      return;
    }

    this.isPollingActive = true;
    console.log('🤖 Telegram Bot: Starting update polling loop...');

    while (this.isPollingActive) {
      try {
        const url = `https://api.telegram.org/bot${encodeURIComponent(token)}/getUpdates?offset=${this.lastUpdateId + 1}&timeout=20`;
        this.pollingAbortController = new AbortController();

        const res = await fetch(url, { signal: this.pollingAbortController.signal });
        if (res.ok) {
          const data = await res.json();
          if (data.ok && Array.isArray(data.result)) {
            for (const update of data.result) {
              this.lastUpdateId = update.update_id;
              if (update.message) {
                await this.handleIncomingMessage(update.message);
              }
            }
          }
        } else if (res.status === 401) {
          console.error('Telegram Bot Error: Invalid bot token (HTTP 401). Stopping polling.');
          this.isPollingActive = false;
          break;
        } else {
          // Wait before retry
          await new Promise(r => setTimeout(r, 5000));
        }
      } catch (err) {
        if (!this.isPollingActive) break;
        // Wait 5 seconds on network failure before retrying
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }

  /**
   * Stop polling loop cleanly
   */
  static stopPolling() {
    this.isPollingActive = false;
    if (this.pollingAbortController) {
      try {
        this.pollingAbortController.abort();
      } catch (e) {
        // Ignore
      }
      this.pollingAbortController = null;
    }
  }

  /**
   * Process a single update (e.g. from a webhook)
   */
  static async processUpdate(update) {
    if (update && update.message) {
      return this.handleIncomingMessage(update.message);
    }
    return null;
  }
}

export default TelegramService;
