// Alerts & Escalation Management Routes for EDVANTA
// In-app notifications and time simulation for missed session detection

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/permissions.js';
import AlertsService from '../services/alerts.service.js';

const router = Router();

// Get in-app alerts for authenticated user
router.get('/', authenticate, (req, res) => {
  const alerts = AlertsService.getAlerts(req.user);
  const unreadCount = alerts.filter(a => !a.is_read).length;
  res.json({
    activeSimulationDate: AlertsService.getActiveDate(),
    unreadCount,
    alerts
  });
});

// Mark alert as read
router.post('/:id/read', authenticate, (req, res) => {
  AlertsService.markAsRead(req.params.id);
  res.json({ message: 'Alert marked as read.' });
});

// Advance or set simulation date (Admin or QA testing)
router.post('/simulate', authenticate, requireRole('ADMIN', 'CAMPUS_MANAGER'), (req, res) => {
  const { date } = req.body;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date is required in YYYY-MM-DD format.' });
  }

  const newAlerts = AlertsService.setSimulationDate(date);
  res.json({
    message: `Simulation date advanced to ${date}. Missed logs checked and notifications created.`,
    simulatedDate: date,
    newAlertsCreatedCount: newAlerts.length,
    newAlerts
  });
});

// Reset simulation date back to current local date
router.post('/reset-simulation', authenticate, (req, res) => {
  const currentDate = AlertsService.clearSimulationDate();
  res.json({
    message: 'Simulation date reset to system clock date.',
    currentDate
  });
});

export default router;
