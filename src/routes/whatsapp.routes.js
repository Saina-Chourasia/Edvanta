// WhatsApp Platform Routes for EDVANTA
// Handles phone number verification, account linking, notification preferences,
// and Meta Cloud API webhooks.

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import WhatsAppService from '../services/whatsapp.service.js';

const router = Router();

/**
 * GET /api/whatsapp/status
 * Check user's WhatsApp link status and notification preferences without exposing secrets
 */
router.get('/status', authenticate, (req, res) => {
  try {
    const status = WhatsAppService.getLinkStatus(req.user.id);
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: `Failed to retrieve WhatsApp status: ${err.message}` });
  }
});

/**
 * POST /api/whatsapp/request-code
 * Request a 10-minute one-time verification code for a phone number
 */
router.post('/request-code', authenticate, (req, res) => {
  const { phone_number } = req.body;
  if (!phone_number || typeof phone_number !== 'string') {
    return res.status(400).json({ error: 'A valid phone number is required.' });
  }

  try {
    const result = WhatsAppService.requestVerificationCode(req.user.id, phone_number);
    res.status(200).json(result);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message });
  }
});

/**
 * POST /api/whatsapp/verify
 * Submit verification code to link WhatsApp account
 */
router.post('/verify', authenticate, (req, res) => {
  const { phone_number, code } = req.body;
  if (!phone_number || !code) {
    return res.status(400).json({ error: 'Both phone_number and 6-digit verification code are required.' });
  }

  try {
    const result = WhatsAppService.verifyAndLink(req.user.id, phone_number, code);
    res.status(200).json(result);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message });
  }
});

/**
 * POST /api/whatsapp/unlink
 * Unlink WhatsApp account
 */
router.post('/unlink', authenticate, (req, res) => {
  try {
    const result = WhatsAppService.unlink(req.user.id);
    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message });
  }
});

/**
 * PATCH /api/whatsapp/preferences
 * Update notification consent preferences
 */
router.patch('/preferences', authenticate, (req, res) => {
  try {
    const updated = WhatsAppService.updatePreferences(req.user.id, req.body);
    res.json(updated);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message });
  }
});

/**
 * GET /api/whatsapp/webhook
 * Meta Webhook verification handshake
 */
router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const verifiedChallenge = WhatsAppService.verifyWebhookHandshake(mode, token, challenge);
  if (verifiedChallenge) {
    return res.status(200).send(verifiedChallenge);
  }

  res.status(403).send('Forbidden: Invalid webhook verify token.');
});

/**
 * POST /api/whatsapp/webhook
 * Ingest WhatsApp incoming events & status updates
 */
router.post('/webhook', (req, res) => {
  const signature = req.headers['x-hub-signature-256'];
  const rawBody = JSON.stringify(req.body);

  if (signature && !WhatsAppService.verifyWebhookSignature(rawBody, signature)) {
    return res.status(401).json({ error: 'Invalid webhook signature.' });
  }

  const result = WhatsAppService.processWebhookEvent(req.body);
  res.status(200).json({ status: 'EVENT_RECEIVED', result });
});

export default router;
