// Telegram Integration Routes for EDVANTA
// Handles one-time linking code generation, link status queries, unlinking, and optional webhook handling.

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import TelegramService from '../services/telegram.service.js';

const router = Router();

/**
 * GET /api/telegram/status
 * Check user's Telegram link status and bot configuration without exposing secrets
 */
router.get('/status', authenticate, (req, res) => {
  try {
    const status = TelegramService.getLinkStatus(req.user.id);
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: `Failed to retrieve Telegram status: ${err.message}` });
  }
});

/**
 * POST /api/telegram/link-code
 * Generate a 10-minute one-time linking code for the authenticated user
 */
router.post('/link-code', authenticate, (req, res) => {
  try {
    const linkCodeData = TelegramService.generateLinkCode(req.user.id);
    res.status(201).json(linkCodeData);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message });
  }
});

/**
 * POST /api/telegram/unlink
 * Unlink the authenticated user's Telegram account
 */
router.post('/unlink', authenticate, (req, res) => {
  try {
    const result = TelegramService.unlinkByUserId(req.user.id);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    res.json({ success: true, message: 'Telegram account unlinked successfully.' });
  } catch (err) {
    res.status(500).json({ error: `Failed to unlink Telegram: ${err.message}` });
  }
});

/**
 * POST /api/telegram/webhook
 * Optional webhook receiver for processing incoming updates from Telegram
 */
router.post('/webhook', async (req, res) => {
  try {
    const update = req.body;
    if (update && typeof update === 'object') {
      // Process update asynchronously without blocking response
      TelegramService.processUpdate(update).catch(err => {
        console.error('Error processing Telegram webhook update:', err);
      });
    }
    // Telegram requires 200 OK fast response
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Webhook processing error.' });
  }
});

export default router;
