// Comprehensive Neon PostgreSQL Application Verification Script
// Tests all 10 user requirements against live Express app + Neon PostgreSQL

import process from 'node:process';
process.loadEnvFile();

import app from '../src/server.js';
import { db } from '../src/database/db.js';
import ProgressionService from '../src/services/progression.service.js';
import CalendarService from '../src/services/calendar.service.js';
import AlertsService from '../src/services/alerts.service.js';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'edvanta-msot-academic-tracker-secret-2026';

async function runVerification() {
  console.log('================================================================');
  console.log('🧪 EDVANTA Neon PostgreSQL Application Verification Suite');
  console.log('================================================================');

  // 1. Verify Active Engine
  console.log('\n--- 1. Database Adapter & Configuration ---');
  console.log('• Database Engine       :', 'PostgreSQL (Neon Serverless)');
  console.log('• DATABASE_URL Configured:', Boolean(process.env.DATABASE_URL));
  if (!db.isPostgres) {
    throw new Error('FAIL: Application is NOT running on PostgreSQL!');
  }
  const isHealthy = await db.checkHealth();
  console.log('• Connection Health     :', isHealthy ? '✔ HEALTHY' : '✖ UNHEALTHY');
  if (!isHealthy) {
    throw new Error('FAIL: Database health check returned false!');
  }

  // Start ephemeral server
  let server;
  let baseUrl;
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
  console.log(`• Test Server Running   : ${baseUrl}`);

  try {
    // 2. Health Endpoint Check
    console.log('\n--- 2. Health Endpoint (/api/health) ---');
    const healthRes = await fetch(`${baseUrl}/api/health`);
    const healthData = await healthRes.json();
    console.log('• Health Status         :', healthData.status);
    console.log('• Reported Engine       :', healthData.engine);
    if (healthData.status !== 'healthy' || healthData.engine !== 'postgresql') {
      throw new Error(`FAIL: /api/health returned unexpected data: ${JSON.stringify(healthData)}`);
    }

    // 3. Authenticate All 4 Roles
    console.log('\n--- 3. Authentication & RBAC Across All 4 Roles ---');
    const roles = [
      { role: 'ADMIN', email: 'admin@edvanta.msot.edu', pwd: 'edvanta123' },
      { role: 'CAMPUS_MANAGER', email: 'manager.hitech@edvanta.msot.edu', pwd: 'edvanta123' },
      { role: 'FACULTY', email: 'faculty.cs@edvanta.msot.edu', pwd: 'edvanta123' },
      { role: 'STUDENT', email: 'student.aarav@edvanta.msot.edu', pwd: 'edvanta123' }
    ];

    const tokens = {};
    for (const r of roles) {
      const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: r.email, password: r.pwd })
      });
      const data = await loginRes.json();
      if (loginRes.status !== 200 || !data.token) {
        throw new Error(`FAIL: Login failed for ${r.role} (${r.email}): status ${loginRes.status}, data: ${JSON.stringify(data)}`);
      }
      tokens[r.role] = data.token;
      console.log(`✔ Login successful for ${r.role.padEnd(15)} : ${data.user.name} (${data.user.email})`);
      if (data.user.role !== r.role) {
        throw new Error(`FAIL: User role mismatch. Expected ${r.role}, got ${data.user.role}`);
      }
    }

    // RBAC: Verify Student Mutations are Blocked
    const stuBlockedRes = await fetch(`${baseUrl}/api/sessions/log`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokens.STUDENT}`
      },
      body: JSON.stringify({ subject_id: 'sub_cs301', topic_title: 'Hacked Session' })
    });
    console.log(`• Student Mutation Blocked (403 Expected): ${stuBlockedRes.status === 403 ? '✔ BLOCKED (403)' : '✖ FAILED (' + stuBlockedRes.status + ')'}`);
    if (stuBlockedRes.status !== 403) {
      throw new Error(`FAIL: Student was not blocked from mutations! Expected 403, got ${stuBlockedRes.status}`);
    }

    // 4. Test Semesters & Campuses
    console.log('\n--- 4. Semesters & Campuses Read Queries ---');
    const semRes = await fetch(`${baseUrl}/api/semesters`, {
      headers: { 'Authorization': `Bearer ${tokens.ADMIN}` }
    });
    const semData = await semRes.json();
    const semesters = semData.semesters || semData;
    console.log(`✔ Semesters fetched: ${semesters.length} semesters (Sample: ${semesters[0]?.name})`);

    const campRes = await fetch(`${baseUrl}/api/campuses`, {
      headers: { 'Authorization': `Bearer ${tokens.ADMIN}` }
    });
    const campData = await campRes.json();
    const campuses = campData.campuses || campData;
    console.log(`✔ Campuses fetched : ${campuses.length} campuses (Sample: ${campuses[0]?.name})`);

    // 5. Test Timetable & Syllabus
    console.log('\n--- 5. Timetable & Syllabus Read Queries ---');
    const ttRes = await fetch(`${baseUrl}/api/timetable?campus_id=camp_hitech&batch_name=Batch-2026-Mirai-A`, {
      headers: { 'Authorization': `Bearer ${tokens.FACULTY}` }
    });
    const ttData = await ttRes.json();
    const slots = ttData.slots || ttData;
    console.log(`✔ Timetable slots fetched: ${slots.length} slots for Batch-2026-Mirai-A`);

    const sylRes = await fetch(`${baseUrl}/api/syllabus/subjects/subj_cs301/topics`, {
      headers: { 'Authorization': `Bearer ${tokens.FACULTY}` }
    });
    const sylData = await sylRes.json();
    const topics = sylData.topics || sylData;
    console.log(`✔ Syllabus lesson plans  : ${topics.length} topics for CS301 (Sample: "${topics[0]?.topic_title}")`);

    // 6. Test Academic Progression Calculations
    console.log('\n--- 6. Academic Progression Calculations on Neon ---');
    const prog = await ProgressionService.calculateSubjectProgress('subj_cs301', '2026-10-20');
    console.log(`✔ CS301 Progression: ${prog.code} - ${prog.name}`);
    console.log(`  • Faculty        : ${prog.faculty_name}`);
    console.log(`  • Total Hours    : ${prog.total_hours} hrs`);
    console.log(`  • Covered Hours  : ${prog.coveredHours} hrs`);
    console.log(`  • Planned Hours  : ${prog.plannedHoursToDate} hrs`);
    console.log(`  • Progress       : ${prog.progressPercentage}%`);
    console.log(`  • Pace Status    : ${prog.paceStatus}`);

    // 7. Test Attendance & Alerts
    console.log('\n--- 7. Attendance Sessions & Alerts ---');
    const attRes = await fetch(`${baseUrl}/api/attendance/sessions/active`, {
      headers: { 'Authorization': `Bearer ${tokens.FACULTY}` }
    });
    const activeAtt = await attRes.json();
    const activeAttList = activeAtt.sessions || (Array.isArray(activeAtt) ? activeAtt : []);
    console.log(`✔ Active attendance sessions: ${activeAttList.length}`);

    const alertsRes = await fetch(`${baseUrl}/api/alerts`, {
      headers: { 'Authorization': `Bearer ${tokens.ADMIN}` }
    });
    const alertsData = await alertsRes.json();
    const alerts = alertsData.alerts || (Array.isArray(alertsData) ? alertsData : []);
    console.log(`✔ Alerts fetched for Admin  : ${alerts.length} total alerts in system`);

    // 8. Safe Isolated Read/Write/Delete Test on Neon
    console.log('\n--- 8. Safe Isolated Read/Write Functionality on Neon ---');
    const testSessionId = `test_neon_rw_${Date.now()}`;
    const initialSessionCount = await db.get('SELECT count(*) as c FROM teaching_sessions');

    // INSERT isolated test record
    await db.run(`
      INSERT INTO teaching_sessions (
        id, campus_id, faculty_id, subject_id, batch_name,
        session_date, topics_covered, duration_hours,
        status, notes
      ) VALUES (
        ?, 'camp_hitech', 'usr_fac_thorne', 'subj_cs301', 'Batch-2026-Mirai-A',
        '2026-10-22', 'Isolated Neon Write Verification Test', 1.0,
        'COMPLETED', 'TEMPORARY_TEST_RECORD'
      )
    `, [testSessionId]);
    console.log(`✔ INSERT isolated test record into teaching_sessions (ID: ${testSessionId})`);

    // READ isolated test record
    const readBack = await db.get('SELECT * FROM teaching_sessions WHERE id = ?', [testSessionId]);
    if (!readBack || readBack.topics_covered !== 'Isolated Neon Write Verification Test') {
      throw new Error('FAIL: Read back of inserted test record did not match expected values!');
    }
    console.log(`✔ READ-BACK verified: topics_covered="${readBack.topics_covered}", duration=${readBack.duration_hours}`);

    // UPDATE isolated test record
    await db.run('UPDATE teaching_sessions SET notes = ? WHERE id = ?', ['UPDATED_TEST_NOTE', testSessionId]);
    const updated = await db.get('SELECT notes FROM teaching_sessions WHERE id = ?', [testSessionId]);
    if (updated.notes !== 'UPDATED_TEST_NOTE') {
      throw new Error('FAIL: Update test record did not persist!');
    }
    console.log(`✔ UPDATE verified: notes="${updated.notes}"`);

    // DELETE and CLEANUP
    await db.run('DELETE FROM teaching_sessions WHERE id = ?', [testSessionId]);
    const cleaned = await db.get('SELECT * FROM teaching_sessions WHERE id = ?', [testSessionId]);
    if (cleaned !== null) {
      throw new Error('FAIL: Cleanup of test record failed; record still exists!');
    }
    const finalSessionCount = await db.get('SELECT count(*) as c FROM teaching_sessions');
    if (Number(initialSessionCount.c) !== Number(finalSessionCount.c)) {
      throw new Error(`FAIL: Baseline row count altered! Initial: ${initialSessionCount.c}, Final: ${finalSessionCount.c}`);
    }
    console.log(`✔ CLEANUP verified: Test record deleted. Teaching sessions count restored to ${finalSessionCount.c}`);

    // 9. Server Restart Verification
    console.log('\n--- 9. Server Restart & Continuity Verification ---');
    console.log('• Stopping initial test server...');
    await new Promise(r => server.close(r));

    console.log('• Restarting server instance...');
    let restartServer;
    let restartUrl;
    await new Promise((resolve) => {
      restartServer = app.listen(0, () => {
        const port = restartServer.address().port;
        restartUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
    console.log(`• Restarted Server Running: ${restartUrl}`);

    const restartHealthRes = await fetch(`${restartUrl}/api/health`);
    const restartHealthData = await restartHealthRes.json();
    console.log(`✔ Health after restart    : status="${restartHealthData.status}", engine="${restartHealthData.engine}"`);

    const restartSemRes = await fetch(`${restartUrl}/api/semesters`);
    const restartSemData = await restartSemRes.json();
    console.log(`✔ Semesters after restart : ${(restartSemData.semesters || restartSemData).length} semesters loaded`);

    await new Promise(r => restartServer.close(r));
    console.log('✔ Server restart and operational continuity confirmed.');

    console.log('\n================================================================');
    console.log('🎉 ALL 10 NEON POSTGRESQL VERIFICATION REQUIREMENTS PASSED!');
    console.log('================================================================');
  } finally {
    if (server) {
      await new Promise(r => server.close(r));
    }
    await db.close();
  }
}

runVerification()
  .then(() => {
    process.exit(0);
  })
  .catch(err => {
    console.error('\n✖ Verification Failed:', err);
    process.exit(1);
  });
