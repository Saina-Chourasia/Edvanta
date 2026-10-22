// Stage 2: Database Schema & Migration Utility Unit Tests
// Verifies:
// 1. PostgreSQL DDL schema completeness and validity
// 2. Secret masking in connection strings
// 3. Non-destructive SQLite validation in read-only mode
// 4. Teaching sessions breakdown and data integrity

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { maskConnectionString, validateSqliteData, extractTableData, checkTargetDatabaseEmpty, MIGRATION_TABLES } from '../src/database/migrate-to-pg.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Stage 2: PostgreSQL Schema (schema.pg.sql) Verification', () => {
  const schemaPath = path.resolve(__dirname, '../src/database/schema.pg.sql');

  test('schema.pg.sql exists and is non-empty', () => {
    assert.ok(fs.existsSync(schemaPath), 'schema.pg.sql must exist');
    const content = fs.readFileSync(schemaPath, 'utf8');
    assert.ok(content.length > 1000, 'schema.pg.sql must have complete content');
  });

  test('schema.pg.sql defines all 19 EDVANTA tables with PostgreSQL syntax', () => {
    const content = fs.readFileSync(schemaPath, 'utf8');

    for (const table of MIGRATION_TABLES) {
      const tableRegex = new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?${table}\\s*\\(`, 'i');
      assert.match(content, tableRegex, `schema.pg.sql must define table: ${table}`);
    }
  });

  test('schema.pg.sql uses proper PostgreSQL types (TIMESTAMPTZ, DOUBLE PRECISION, DATE, SMALLINT)', () => {
    const content = fs.readFileSync(schemaPath, 'utf8');

    assert.ok(content.includes('TIMESTAMPTZ'), 'Schema must use TIMESTAMPTZ for timestamps');
    assert.ok(content.includes('DOUBLE PRECISION'), 'Schema must use DOUBLE PRECISION for floating-point values');
    assert.ok(content.includes('DATE NOT NULL'), 'Schema must use DATE for calendar/session dates');
    assert.ok(content.includes('SMALLINT NOT NULL DEFAULT 1'), 'Schema must use SMALLINT for 0/1 boolean flags');
    assert.ok(content.includes('BIGINT NOT NULL'), 'Schema must use BIGINT for expiration epoch timestamps');
  });

  test('schema.pg.sql contains key indexes for query performance', () => {
    const content = fs.readFileSync(schemaPath, 'utf8');

    const expectedIndexes = [
      'idx_users_campus',
      'idx_subjects_semester',
      'idx_timetable_batch',
      'idx_lesson_subject',
      'idx_sessions_subject',
      'idx_alerts_user',
      'idx_att_sess_campus_batch',
      'idx_tg_links_user',
      'idx_wa_links_user'
    ];

    for (const idx of expectedIndexes) {
      assert.ok(content.includes(idx), `Index ${idx} must be defined in schema.pg.sql`);
    }
  });
});

describe('Stage 2: Security & Credential Masking', () => {
  test('maskConnectionString masks password in PostgreSQL URLs', () => {
    const raw = 'postgres://edvanta_admin:P@ssw0rd123!@ep-cool-fog-12345.us-east-2.aws.neon.tech/edvantadb?sslmode=require';
    const masked = maskConnectionString(raw);

    assert.ok(!masked.includes('P@ssw0rd123!'), 'Password must never be exposed');
    assert.ok(masked.includes('***'), 'Password must be masked with ***');
    assert.ok(masked.includes('edvanta_admin'), 'Username may remain visible');
    assert.ok(masked.includes('neon.tech'), 'Host may remain visible');
  });

  test('maskConnectionString safely handles empty or non-connection strings', () => {
    assert.strictEqual(maskConnectionString(''), '[NOT_SET]');
    assert.strictEqual(maskConnectionString(null), '[NOT_SET]');
    assert.strictEqual(maskConnectionString(undefined), '[NOT_SET]');
  });
});

describe('Stage 2: Non-Destructive Data Validation Engine', () => {
  const sqlitePath = path.resolve(__dirname, '../data/edvanta.db');

  test('validateSqliteData runs in read-only mode and reports accurate row counts', () => {
    const report = validateSqliteData(sqlitePath);

    assert.ok(report.totalRows > 0, 'Total rows must be greater than 0');
    assert.strictEqual(report.tableCounts.campuses, 4, 'Must report exactly 4 campuses');
    assert.strictEqual(report.tableCounts.tracks, 2, 'Must report exactly 2 tracks');
    assert.strictEqual(report.tableCounts.users, 20, 'Must report exactly 20 users');
    assert.strictEqual(report.tableCounts.semesters, 5, 'Must report exactly 5 semesters');
    assert.strictEqual(report.tableCounts.subjects, 11, 'Must report exactly 11 subjects');
    assert.strictEqual(report.tableCounts.timetable_slots, 17, 'Must report exactly 17 timetable slots');
    assert.strictEqual(report.tableCounts.lesson_plans, 107, 'Must report exactly 107 lesson plans');
  });

  test('validateSqliteData accurately audits teaching sessions discrepancy', () => {
    const report = validateSqliteData(sqlitePath);
    const breakdown = report.teachingSessionsBreakdown;

    assert.strictEqual(breakdown.genuineAcademicSessions, 26, 'Must identify 26 genuine academic sessions');
    assert.strictEqual(breakdown.ephemeralApiTestSessions, 80, 'Must identify 80 test-generated sessions');
    assert.strictEqual(breakdown.totalInSqlite, 106, 'Total in SQLite must be 106');

    // With cleanTestSessions: true
    const cleanReport = validateSqliteData(sqlitePath, { cleanTestSessions: true });
    assert.strictEqual(cleanReport.tableCounts.teaching_sessions, 26, 'Clean report must report 26 target sessions');
  });

  test('validateSqliteData verifies foreign key integrity without violations', () => {
    const report = validateSqliteData(sqlitePath);
    assert.strictEqual(report.foreignKeyChecks.passed, true, 'All foreign key relationships must pass');
    assert.strictEqual(report.foreignKeyChecks.issues.length, 0, 'Must have zero orphan issues');
  });

  test('extractTableData filters test sessions when cleanTestSessions is enabled without modifying SQLite', () => {
    const db = new DatabaseSync(sqlitePath, { readOnly: true });

    const allSessions = extractTableData(db, 'teaching_sessions', { cleanTestSessions: false });
    assert.strictEqual(allSessions.length, 106, 'All sessions extraction must return 106');

    const cleanSessions = extractTableData(db, 'teaching_sessions', { cleanTestSessions: true });
    assert.strictEqual(cleanSessions.length, 26, 'Clean sessions extraction must return 26');

    // Verify all 26 are genuine
    for (const sess of cleanSessions) {
      assert.notStrictEqual(sess.notes, 'Logged via API test flow', 'Filtered records must not contain test logs');
    }
  });

  test('extractTableData implements production-only exclusions for OTPs, WhatsApp logs, and alerts', () => {
    const db = new DatabaseSync(sqlitePath, { readOnly: true });

    // In production mode:
    const prodSessions = extractTableData(db, 'teaching_sessions', { cleanProductionData: true });
    assert.strictEqual(prodSessions.length, 26, 'Must extract exactly 26 genuine teaching sessions');

    const prodTgCodes = extractTableData(db, 'telegram_link_codes', { cleanProductionData: true });
    assert.strictEqual(prodTgCodes.length, 0, 'Must exclude all expired test Telegram link codes');

    const prodWaLogs = extractTableData(db, 'whatsapp_logs', { cleanProductionData: true });
    assert.strictEqual(prodWaLogs.length, 0, 'Must exclude all simulated WhatsApp delivery logs');

    const prodAlerts = extractTableData(db, 'alerts', { cleanProductionData: true });
    assert.strictEqual(prodAlerts.length, 0, 'Must exclude historical test/simulation alerts');
  });

  test('validateSqliteData with cleanProductionData reports 208 clean baseline records and passes foreign keys', () => {
    const report = validateSqliteData(sqlitePath, { cleanProductionData: true });

    assert.strictEqual(report.totalRows, 208, 'Production target row count must be exactly 208 genuine records');
    assert.strictEqual(report.tableCounts.campuses, 4);
    assert.strictEqual(report.tableCounts.tracks, 2);
    assert.strictEqual(report.tableCounts.users, 20);
    assert.strictEqual(report.tableCounts.semesters, 5);
    assert.strictEqual(report.tableCounts.subjects, 11);
    assert.strictEqual(report.tableCounts.timetable_slots, 17);
    assert.strictEqual(report.tableCounts.lesson_plans, 107);
    assert.strictEqual(report.tableCounts.teaching_sessions, 26);
    assert.strictEqual(report.tableCounts.alerts, 0);
    assert.strictEqual(report.tableCounts.telegram_link_codes, 0);
    assert.strictEqual(report.tableCounts.whatsapp_logs, 0);

    assert.strictEqual(report.foreignKeyChecks.passed, true, 'Filtered dataset must pass all foreign key checks');
    assert.strictEqual(report.foreignKeyChecks.issues.length, 0, 'Filtered dataset must have zero orphan records');

    assert.ok(report.productionFilterBreakdown, 'Report must contain productionFilterBreakdown');
    assert.strictEqual(report.productionFilterBreakdown.apiTestSessionsExcluded, 80);
    assert.strictEqual(report.productionFilterBreakdown.expiredTelegramCodesExcluded, 582);
    assert.strictEqual(report.productionFilterBreakdown.simulatedWhatsappLogsExcluded, 52);
    assert.strictEqual(report.productionFilterBreakdown.historicalTestAlertsExcluded, 178);
    assert.strictEqual(report.productionFilterBreakdown.genuineAcademicRecordsPreserved, 208);
  });

  test('checkTargetDatabaseEmpty detects tables via mock query client', async () => {
    // Mock client returning tables
    const mockNonEmptyClient = {
      async query(sql) {
        return { rows: [{ table_name: 'existing_users' }, { table_name: 'existing_orders' }] };
      }
    };
    const tables = await checkTargetDatabaseEmpty(mockNonEmptyClient);
    assert.deepStrictEqual(tables, ['existing_users', 'existing_orders']);

    // Mock client returning empty
    const mockEmptyClient = {
      async query(sql) {
        return { rows: [] };
      }
    };
    const emptyTables = await checkTargetDatabaseEmpty(mockEmptyClient);
    assert.deepStrictEqual(emptyTables, []);
  });
});

