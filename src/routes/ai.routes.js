// AI Academic Assistant Routes for EDVANTA
// Provides secure, role-conditioned academic chat endpoints with input validation

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import AIService from '../services/ai.service.js';

const router = Router();

/**
 * GET /api/ai/status
 * Check whether AI provider is configured without exposing secret keys
 */
router.get('/status', authenticate, (req, res) => {
  const config = AIService.getConfig();
  res.json({
    configured: config.isConfigured,
    provider: config.provider,
    model: config.model,
    role: req.user.role
  });
});

/**
 * POST /api/ai/chat
 * Send prompt to the AI Academic Assistant
 */
router.post('/chat', authenticate, async (req, res) => {
  const { prompt, history } = req.body;

  // 1. Validate Input
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: 'Validation Error: Prompt text is required.' });
  }

  const trimmed = prompt.trim();
  if (trimmed.length > 2500) {
    return res.status(400).json({
      error: `Validation Error: Prompt exceeds the maximum permitted length of 2500 characters (got ${trimmed.length}).`
    });
  }

  // 2. Validate History if provided
  if (history !== undefined && !Array.isArray(history)) {
    return res.status(400).json({ error: 'Validation Error: History must be an array of messages.' });
  }

  // 3. User Rate Limiting
  const isAllowed = AIService.checkRateLimit(req.user.id);
  if (!isAllowed) {
    return res.status(429).json({
      error: 'Too Many Requests: You have reached the AI Assistant request limit (15 prompts/min). Please wait a moment.'
    });
  }

  try {
    const result = await AIService.generateAcademicResponse({
      prompt: trimmed,
      history: history || [],
      user: req.user
    });

    res.json({
      response: result.response,
      role: req.user.role,
      provider: result.provider,
      model: result.model,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({
      error: err.message || 'Internal error processing AI query.',
      configured: err.configured !== undefined ? err.configured : undefined
    });
  }
});

export default router;
