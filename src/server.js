// EDVANTA Server Entrypoint
// Express application serving REST APIs and the mobile-first frontend

try {
  if (typeof process.loadEnvFile === 'function') {
    process.loadEnvFile();
  }
} catch (e) {
  // .env file is optional when environment variables are injected directly by host
}

import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Routes
import authRoutes from './routes/auth.routes.js';
import campusesRoutes from './routes/campuses.routes.js';
import semestersRoutes from './routes/semesters.routes.js';
import timetableRoutes from './routes/timetable.routes.js';
import syllabusRoutes from './routes/syllabus.routes.js';
import sessionsRoutes from './routes/sessions.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import examsRoutes from './routes/exams.routes.js';
import alertsRoutes from './routes/alerts.routes.js';
import importsRoutes from './routes/imports.routes.js';
import attendanceRoutes from './routes/attendance.routes.js';
import aiRoutes from './routes/ai.routes.js';
import telegramRoutes from './routes/telegram.routes.js';
import TelegramService from './services/telegram.service.js';
import whatsappRoutes from './routes/whatsapp.routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static frontend assets
app.use(express.static(path.join(__dirname, '../public')));

// Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    system: 'EDVANTA Course Progression Tracker',
    tagline: 'Every Hour Counts, Every Goal Matters',
    timestamp: new Date().toISOString()
  });
});

// REST API Routes
app.use('/api/auth', authRoutes);
app.use('/api', campusesRoutes);
app.use('/api/semesters', semestersRoutes);
app.use('/api/timetable', timetableRoutes);
app.use('/api/syllabus', syllabusRoutes);
app.use('/api/sessions', sessionsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/exams', examsRoutes);
app.use('/api/alerts', alertsRoutes);
app.use('/api/imports', importsRoutes);
app.use('/api/exports', importsRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/telegram', telegramRoutes);
app.use('/api/whatsapp', whatsappRoutes);

// Fallback to index.html for SPA client navigation
app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: `API route not found: ${req.method} ${req.path}` });
  }
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Global error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled Application Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error'
  });
});

// Start server
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`🚀 EDVANTA Course Progression Tracker is Live!`);
    console.log(`🎯 Tagline: Every Hour Counts, Every Goal Matters.`);
    console.log(`🌐 URL: http://localhost:${PORT}`);
    console.log(`📡 REST API Health: http://localhost:${PORT}/api/health`);
    console.log(`====================================================`);
    // Initialize Telegram Bot polling if explicitly enabled in environment
    TelegramService.startPolling();
  });
}

export default app;
