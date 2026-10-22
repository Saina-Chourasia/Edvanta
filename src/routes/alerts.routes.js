// Alerts & Escalation Management Routes for EDVANTA
// In-app notifications and time simulation for missed session detection

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/permissions.js';
import AlertsService from '../services/alerts.service.js';

const router = Router();

// Get in-app alerts for authenticated user
router.get('/', authenticate, async (req, res) => {
  const alerts = await AlertsService.getAlerts(req.user);
  const unreadCount = alerts.filter(a => !a.is_read).length;
  res.json({
    activeSimulationDate: await AlertsService.getActiveDate(),
    unreadCount,
    alerts
  });
});

// Mark alert as read
router.post('/:id/read', authenticate, async (req, res) => {
  await AlertsService.markAsRead(req.params.id);
  res.json({ message: 'Alert marked as read.' });
});

// Advance or set simulation date (Admin or QA testing)
router.post('/simulate', authenticate, requireRole('ADMIN', 'CAMPUS_MANAGER'), async (req, res) => {
  const { date } = req.body;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date is required in YYYY-MM-DD format.' });
  }

  const newAlerts = await AlertsService.setSimulationDate(date);
  res.json({
    message: `Simulation date advanced to ${date}. Missed logs checked and notifications created.`,
    simulatedDate: date,
    newAlertsCreatedCount: newAlerts.length,
    newAlerts
  });
});

// Reset simulation date back to current local date
router.post('/reset-simulation', authenticate, async (req, res) => {
  const currentDate = await AlertsService.clearSimulationDate();
  res.json({
    message: 'Simulation date reset to system clock date.',
    currentDate
  });
});

// Scheduled alert scan for Serverless Cron jobs (e.g., Vercel Cron)
router.get('/cron', async (req, res) => {
  try {
    const cronSecret = (process.env.CRON_SECRET || '').trim();
    const isProduction = process.env.NODE_ENV === 'production';
    const authHeader = req.headers.authorization || '';

    // Enforce strict authorization in production or whenever CRON_SECRET is set
    if (isProduction || cronSecret) {
      if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
        return res.status(401).json({ error: 'Unauthorized: Missing or invalid CRON_SECRET authorization header.' });
      }
    }
    const newAlerts = await AlertsService.checkMissedLogs();
    res.json({
      status: 'ok',
      message: 'Serverless scheduled missed-session alert scan completed.',
      newAlertsCreatedCount: newAlerts.length,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: `Cron execution failed: ${err.message}` });
  }
});

export default router;
