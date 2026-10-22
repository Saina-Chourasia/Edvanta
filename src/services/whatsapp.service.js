// WhatsApp Business Platform Service for EDVANTA
// Implements official Meta Cloud API integration, secure phone verification,
// user consent & notification preferences, webhook HMAC-SHA256 signature verification, and idempotency.

import crypto from 'node:crypto';
import { db } from '../database/db.js';

class WhatsAppService {
  // In-memory sliding-window rate limiters
  static requestRateLimits = new Map(); // userId -> timestamps[]
  static verifyRateLimits = new Map();  // userId -> timestamps[]

  // Deduplication cache for incoming webhook events (idempotency)
  static processedEventIds = new Set();
  static maxCachedEventIds = 5000;

  /**
   * Get WhatsApp configuration from server-side environment
   * Tokens and secrets are never exposed to clients or logs.
   */
  static getConfig() {
    const accessToken = (process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
    const phoneNumberId = (process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
    const businessAccountId = (process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '').trim();
    const verifyToken = (process.env.WHATSAPP_VERIFY_TOKEN || '').trim();
    const appSecret = (process.env.WHATSAPP_APP_SECRET || '').trim();

    return {
      accessToken,
      phoneNumberId,
      businessAccountId,
      verifyToken,
      appSecret,
      isConfigured: Boolean(accessToken && phoneNumberId)
    };
  }

  /**
   * Normalize and validate phone numbers into international E.164 format
   * @param {string} phone
   * @returns {string} E.164 formatted number (e.g. +919876543220)
   */
  static normalizePhoneNumber(phone) {
    if (!phone || typeof phone !== 'string') {
      throw new Error('A valid phone number string is required.');
    }

    // Remove whitespace, dashes, parens
    let cleaned = phone.replace(/[\s\-\(\)\.]/g, '');

    // If starts with 00, replace with +
    if (cleaned.startsWith('00')) {
      cleaned = '+' + cleaned.slice(2);
    }

    // If no leading +, prepend country code if 10-digit Indian standard
    if (!cleaned.startsWith('+')) {
      if (/^\d{10}$/.test(cleaned)) {
        cleaned = '+91' + cleaned;
      } else if (/^\d{11,15}$/.test(cleaned)) {
        cleaned = '+' + cleaned;
      } else {
        throw new Error('Invalid phone number format. Please provide a standard 10-digit or E.164 number.');
      }
    }

    // Validate overall digits
    const digitsOnly = cleaned.replace(/\D/g, '');
    if (digitsOnly.length < 10 || digitsOnly.length > 15) {
      throw new Error(`Invalid phone number length (${digitsOnly.length} digits). Must be between 10 and 15 digits.`);
    }

    return cleaned;
  }

  /**
   * Mask phone number for privacy in frontend display
   * E.g. "+919876543220" -> "+91 ••••• ••220"
   */
  static maskPhoneNumber(phone) {
    if (!phone) return '';
    const norm = this.normalizePhoneNumber(phone);
    if (norm.length <= 6) return norm;
    const prefix = norm.startsWith('+91') ? '+91' : norm.slice(0, 3);
    const suffix = norm.slice(-3);
    return `${prefix} ••••• ••${suffix}`;
  }

  /**
   * Check rate limit for verification code requests (Max 5 per 15 minutes per user)
   */
  static checkRequestRateLimit(userId) {
    if (!userId) return false;
    const now = Date.now();
    const windowMs = 15 * 60 * 1000;
    const maxAttempts = 5;

    let timestamps = this.requestRateLimits.get(userId) || [];
    timestamps = timestamps.filter(t => now - t < windowMs);

    if (timestamps.length >= maxAttempts) {
      return false;
    }

    timestamps.push(now);
    this.requestRateLimits.set(userId, timestamps);
    return true;
  }

  /**
   * Check rate limit for verification attempts (Max 5 per 15 minutes per user)
   */
  static checkVerifyRateLimit(userId) {
    if (!userId) return false;
    const now = Date.now();
    const windowMs = 15 * 60 * 1000;
    const maxAttempts = 5;

    let timestamps = this.verifyRateLimits.get(userId) || [];
    timestamps = timestamps.filter(t => now - t < windowMs);

    if (timestamps.length >= maxAttempts) {
      return false;
    }

    timestamps.push(now);
    this.verifyRateLimits.set(userId, timestamps);
    return true;
  }

  /**
   * Request a 6-digit WhatsApp verification code
   * Valid for 10 minutes.
   */
  static async requestVerificationCode(userId, inputPhone) {
    if (!userId) {
      throw new Error('User ID is required.');
    }

    const user = await db.get('SELECT id, name, role FROM users WHERE id = ?', [userId]);
    if (!user) {
      const err = new Error('User not found.');
      err.status = 404;
      throw err;
    }

    const phone = this.normalizePhoneNumber(inputPhone);

    // Prevent linking if phone is already linked to another user
    const existingPhoneLink = await db.get('SELECT user_id FROM whatsapp_links WHERE phone_number = ?', [phone]);
    if (existingPhoneLink && existingPhoneLink.user_id !== userId) {
      const err = new Error('This phone number is already linked to another EDVANTA account.');
      err.status = 409;
      throw err;
    }

    // Check rate limit
    if (!this.checkRequestRateLimit(userId)) {
      const err = new Error('Too many verification code requests. Please wait 15 minutes before requesting again.');
      err.status = 429;
      throw err;
    }

    // Generate 6-digit code
    const rawCode = crypto.randomInt(100000, 999999).toString();
    const codeHash = crypto.createHash('sha256').update(rawCode).digest('hex');
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    // Invalidate previous unused codes for this user
    await db.run('UPDATE whatsapp_link_codes SET used = 1 WHERE user_id = ? AND used = 0', [userId]);

    const codeId = `wa_code_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    await db.run(`
      INSERT INTO whatsapp_link_codes (id, user_id, phone_number, code_hash, expires_at, used)
      VALUES (?, ?, ?, ?, ?, 0)
    `, [codeId, userId, phone, codeHash, expiresAt]);

    const response = {
      success: true,
      phone_number: phone,
      expires_in_seconds: 600,
      expires_at: new Date(expiresAt).toISOString()
    };

    // In test or non-production mode, expose simulated code for automated validation
    if (process.env.NODE_ENV === 'test' || !this.getConfig().isConfigured) {
      response.dev_code = rawCode;
    }

    return response;
  }

  /**
   * Verify code and link WhatsApp phone number to user account
   */
  static async verifyAndLink(userId, inputPhone, inputCode) {
    if (!userId || !inputPhone || !inputCode) {
      const err = new Error('User ID, phone number, and verification code are required.');
      err.status = 400;
      throw err;
    }

    const phone = this.normalizePhoneNumber(inputPhone);
    const code = String(inputCode).trim();

    if (!/^\d{6}$/.test(code)) {
      const err = new Error('Verification code must be exactly 6 digits.');
      err.status = 400;
      throw err;
    }

    if (!this.checkVerifyRateLimit(userId)) {
      const err = new Error('Too many verification attempts. Please wait 15 minutes before trying again.');
      err.status = 429;
      throw err;
    }

    const codeHash = crypto.createHash('sha256').update(code).digest('hex');

    const record = await db.get(`
      SELECT * FROM whatsapp_link_codes
      WHERE user_id = ? AND phone_number = ? AND code_hash = ? AND used = 0
    `, [userId, phone, codeHash]);

    if (!record) {
      const err = new Error('Invalid or already used verification code.');
      err.status = 400;
      throw err;
    }

    if (Date.now() > record.expires_at) {
      await db.run('UPDATE whatsapp_link_codes SET used = 1 WHERE id = ?', [record.id]);
      const err = new Error('Verification code has expired. Please request a new code.');
      err.status = 400;
      throw err;
    }

    // Check if phone number is already linked to another account
    const existingPhone = await db.get('SELECT user_id FROM whatsapp_links WHERE phone_number = ?', [phone]);
    if (existingPhone && existingPhone.user_id !== userId) {
      const err = new Error('This phone number is already linked to another EDVANTA account.');
      err.status = 409;
      throw err;
    }

    // Check if user already has a linked WhatsApp number
    const existingUser = await db.get('SELECT phone_number FROM whatsapp_links WHERE user_id = ?', [userId]);
    if (existingUser && existingUser.phone_number !== phone) {
      const err = new Error('Your EDVANTA account is already linked to another phone number. Unlink it first.');
      err.status = 409;
      throw err;
    }

    const linkId = `wa_link_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

    await db.transaction(async (tx) => {
      await tx.run('UPDATE whatsapp_link_codes SET used = 1 WHERE id = ?', [record.id]);
      await tx.run(`
        INSERT INTO whatsapp_links (id, user_id, phone_number, verified_at, notifications_enabled, notify_attendance, notify_schedule, notify_progress)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP, 1, 1, 1, 1)
        ON CONFLICT(user_id) DO UPDATE SET
          phone_number = excluded.phone_number,
          verified_at = CURRENT_TIMESTAMP,
          notifications_enabled = 1
      `, [linkId, userId, phone]);
    });

    const link = await db.get('SELECT * FROM whatsapp_links WHERE user_id = ?', [userId]);
    return {
      success: true,
      link: {
        user_id: link.user_id,
        phone_number: link.phone_number,
        masked_phone: this.maskPhoneNumber(link.phone_number),
        verified_at: link.verified_at,
        notifications_enabled: Boolean(link.notifications_enabled)
      }
    };
  }

  /**
   * Get WhatsApp link status and notification preferences for a user
   */
  static async getLinkStatus(userId) {
    if (!userId) {
      return { is_linked: false, configured: false };
    }

    const link = await db.get('SELECT * FROM whatsapp_links WHERE user_id = ?', [userId]);
    const { isConfigured, businessAccountId, phoneNumberId } = this.getConfig();

    if (!link) {
      return {
        is_linked: false,
        configured: isConfigured,
        phone_number_id: phoneNumberId ? 'configured' : undefined
      };
    }

    return {
      is_linked: true,
      configured: isConfigured,
      phone_number: this.maskPhoneNumber(link.phone_number),
      verified_at: link.verified_at,
      preferences: {
        notifications_enabled: Boolean(link.notifications_enabled),
        notify_attendance: Boolean(link.notify_attendance),
        notify_schedule: Boolean(link.notify_schedule),
        notify_progress: Boolean(link.notify_progress)
      }
    };
  }

  /**
   * Update notification consent preferences
   */
  static async updatePreferences(userId, prefs = {}) {
    const link = await db.get('SELECT * FROM whatsapp_links WHERE user_id = ?', [userId]);
    if (!link) {
      const err = new Error('No WhatsApp account linked.');
      err.status = 404;
      throw err;
    }

    const notifications_enabled = prefs.notifications_enabled !== undefined ? (prefs.notifications_enabled ? 1 : 0) : link.notifications_enabled;
    const notify_attendance = prefs.notify_attendance !== undefined ? (prefs.notify_attendance ? 1 : 0) : link.notify_attendance;
    const notify_schedule = prefs.notify_schedule !== undefined ? (prefs.notify_schedule ? 1 : 0) : link.notify_schedule;
    const notify_progress = prefs.notify_progress !== undefined ? (prefs.notify_progress ? 1 : 0) : link.notify_progress;

    await db.run(`
      UPDATE whatsapp_links
      SET notifications_enabled = ?, notify_attendance = ?, notify_schedule = ?, notify_progress = ?
      WHERE user_id = ?
    `, [notifications_enabled, notify_attendance, notify_schedule, notify_progress, userId]);

    return await this.getLinkStatus(userId);
  }

  /**
   * Unlink WhatsApp account
   */
  static async unlink(userId) {
    const link = await db.get('SELECT * FROM whatsapp_links WHERE user_id = ?', [userId]);
    if (!link) {
      const err = new Error('No WhatsApp account currently linked.');
      err.status = 404;
      throw err;
    }

    await db.run('DELETE FROM whatsapp_links WHERE user_id = ?', [userId]);
    return { success: true, message: 'WhatsApp account unlinked successfully.' };
  }

  // -------------------------------------------------------------
  // Outbound Messaging & Meta Cloud API
  // -------------------------------------------------------------

  /**
   * Send WhatsApp Message via Meta Cloud API
   * In test mode or when unconfigured, logs safely and does NOT contact real users.
   */
  static async sendMessage({ to, text, templateName, templateParams = [], userId = null, messageType = 'NOTIFICATION' }) {
    if (!to) {
      return { sent: false, error: 'Recipient phone number is required.' };
    }

    const normalizedPhone = this.normalizePhoneNumber(to);
    const { accessToken, phoneNumberId, isConfigured } = this.getConfig();

    // SAFETY CHECK: During tests or when unconfigured, never make real external HTTP calls
    if (process.env.NODE_ENV === 'test' || !isConfigured) {
      const logId = `wa_log_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      await db.run(`
        INSERT INTO whatsapp_logs (id, user_id, phone_number, message_type, status, message_id, payload)
        VALUES (?, ?, ?, ?, 'SIMULATED', ?, ?)
      `, [logId, userId, normalizedPhone, messageType, `sim_msg_${Date.now()}`, text || templateName]);

      return {
        sent: false,
        simulated: true,
        reason: process.env.NODE_ENV === 'test'
          ? 'Automated test mode: external WhatsApp messaging is strictly blocked.'
          : 'Meta WhatsApp credentials are not configured in environment.'
      };
    }

    // Live Meta WhatsApp Business Cloud API Endpoint
    const url = `https://graph.facebook.com/v21.0/${encodeURIComponent(phoneNumberId)}/messages`;

    let payload;
    if (templateName) {
      payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: normalizedPhone.replace(/^\+/, ''),
        type: 'template',
        template: {
          name: templateName,
          language: { code: 'en_US' },
          components: templateParams.length ? [{
            type: 'body',
            parameters: templateParams.map(val => ({ type: 'text', text: String(val) }))
          }] : undefined
        }
      };
    } else {
      payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: normalizedPhone.replace(/^\+/, ''),
        type: 'text',
        text: { preview_url: false, body: text }
      };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      const data = await res.json().catch(() => ({}));

      const logId = `wa_log_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      if (!res.ok) {
        const errorDesc = data.error?.message || `HTTP ${res.status}`;
        await db.run(`
          INSERT INTO whatsapp_logs (id, user_id, phone_number, message_type, status, payload)
          VALUES (?, ?, ?, ?, 'FAILED', ?)
        `, [logId, userId, normalizedPhone, messageType, errorDesc]);
        return { sent: false, error: errorDesc };
      }

      const messageId = data.messages?.[0]?.id || `wamid_${Date.now()}`;
      await db.run(`
        INSERT INTO whatsapp_logs (id, user_id, phone_number, message_type, status, message_id, payload)
        VALUES (?, ?, ?, ?, 'SENT', ?, ?)
      `, [logId, userId, normalizedPhone, messageType, messageId, text || templateName]);

      return { sent: true, messageId };
    } catch (err) {
      clearTimeout(timeoutId);
      return { sent: false, error: err.name === 'AbortError' ? 'WhatsApp API request timed out.' : err.message };
    }
  }

  // -------------------------------------------------------------
  // Role-Aware Academic Notifications
  // -------------------------------------------------------------

  /**
   * Dispatch an authorized academic alert to a user via WhatsApp
   */
  static async sendAcademicAlert(userId, alertCategory, alertData = {}) {
    if (!userId) return { sent: false, reason: 'User ID is required.' };

    const user = await db.get('SELECT id, name, role, batch_name FROM users WHERE id = ?', [userId]);
    if (!user) return { sent: false, reason: 'User not found.' };

    const link = await db.get('SELECT * FROM whatsapp_links WHERE user_id = ?', [userId]);
    if (!link) return { sent: false, reason: 'User does not have a linked WhatsApp number.' };
    if (!link.notifications_enabled) return { sent: false, reason: 'User has disabled WhatsApp notifications.' };

    // Check category preferences
    if (alertCategory === 'ATTENDANCE' && !link.notify_attendance) {
      return { sent: false, reason: 'User opted out of attendance notifications.' };
    }
    if (alertCategory === 'SCHEDULE' && !link.notify_schedule) {
      return { sent: false, reason: 'User opted out of schedule notifications.' };
    }
    if (alertCategory === 'PROGRESS' && !link.notify_progress) {
      return { sent: false, reason: 'User opted out of progression notifications.' };
    }

    let messageText = '';

    if (alertCategory === 'ATTENDANCE') {
      messageText = `📢 *EDVANTA Attendance Notice*\n\nHello ${user.name},\n` +
        `Subject: ${alertData.subject_code || 'Class Session'}\n` +
        `Date: ${alertData.session_date || 'Today'}\n` +
        `Status: ${alertData.status || 'Recorded'}\n\n` +
        `Every Hour Counts, Every Goal Matters.`;
    } else if (alertCategory === 'SCHEDULE') {
      messageText = `🗓️ *EDVANTA Schedule Reminder*\n\nHello ${user.name},\n` +
        `You have upcoming classes scheduled today:\n` +
        `${alertData.summary || 'Check your portal for room assignments and times.'}\n\n` +
        `Maharishi School of Technology (MSOT)`;
    } else if (alertCategory === 'PROGRESS') {
      messageText = `📊 *EDVANTA Pacing Alert*\n\nHello ${user.name},\n` +
        `Subject: ${alertData.subject_name || alertData.subject_code}\n` +
        `Pacing Status: ${alertData.status || 'Updated'}\n` +
        `Covered: ${alertData.covered_hours || '0'} hrs\n\n` +
        `Log in to your EDVANTA portal for full curriculum metrics.`;
    } else {
      messageText = `🔔 *EDVANTA Academic Notice*\n\nHello ${user.name},\n${alertData.message || 'New academic announcement.'}`;
    }

    return this.sendMessage({
      to: link.phone_number,
      text: messageText,
      userId,
      messageType: alertCategory
    });
  }

  // -------------------------------------------------------------
  // Webhook Signature Verification & Idempotency
  // -------------------------------------------------------------

  /**
   * Verify webhook handshake challenge from Meta
   */
  static verifyWebhookHandshake(mode, token, challenge) {
    const { verifyToken } = this.getConfig();
    if (mode === 'subscribe' && token && token === verifyToken) {
      return challenge;
    }
    return null;
  }

  /**
   * Verify HMAC-SHA256 signature on incoming webhook payload
   */
  static verifyWebhookSignature(rawBody, signatureHeader) {
    const { appSecret } = this.getConfig();
    if (!appSecret) {
      // In dev mode when app secret is not set, allow
      return true;
    }
    if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
      return false;
    }

    const signature = signatureHeader.slice(7);
    const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');

    try {
      return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
    } catch (e) {
      return false;
    }
  }

  /**
   * Process incoming webhook event with deduplication
   */
  static processWebhookEvent(payload) {
    if (!payload || typeof payload !== 'object') {
      return { status: 'IGNORED' };
    }

    const entry = payload.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    // Check message statuses or incoming messages
    const messageId = value?.messages?.[0]?.id || value?.statuses?.[0]?.id;

    if (messageId) {
      if (this.processedEventIds.has(messageId)) {
        return { status: 'DUPLICATE_IGNORED', messageId };
      }

      this.processedEventIds.add(messageId);
      if (this.processedEventIds.size > this.maxCachedEventIds) {
        // Prune oldest
        const first = this.processedEventIds.values().next().value;
        this.processedEventIds.delete(first);
      }
    }

    return { status: 'PROCESSED', messageId };
  }
}

export default WhatsAppService;
