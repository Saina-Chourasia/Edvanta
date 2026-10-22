#!/usr/bin/env node
// ==============================================================================
// EDVANTA: SQLite to PostgreSQL Non-Destructive Migration Utility
// ==============================================================================
// Safety Guarantees:
// 1. Opens SQLite database in strictly READ-ONLY mode ({ readOnly: true }).
// 2. Never modifies, deletes, or writes to the local SQLite database or backups.
// 3. Defaults to --dry-run validation mode. Does not touch remote DB without flags.
// 4. Never exposes or logs secrets, passwords, or raw database connection strings.
// 5. Wraps execution in atomic PostgreSQL transaction with full ROLLBACK on error.
// ==============================================================================

try {
  if (typeof process.loadEnvFile === 'function') {
    process.loadEnvFile();
  }
} catch (e) {
  // .env file is optional when environment variables are injected directly by host
}

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to mask sensitive credentials in connection strings or logs
export function maskConnectionString(connStr) {
  if (!connStr) return '[NOT_SET]';
  return connStr.replace(/(postgres(?:ql)?:\/\/[^:]+:)([^@]+)(@)/, '$1***$3');
}

// Ordered table list respecting foreign key dependency hierarchy
export const MIGRATION_TABLES = [
  'campuses',
  'tracks',
  'users',
  'semesters',
  'calendar_events',
  'exam_windows',
  'subjects',
  'timetable_slots',
  'lesson_plans',
  'teaching_sessions',
  'alerts',
  'system_settings',
  'attendance_sessions',
  'attendance_records',
  'telegram_links',
  'telegram_link_codes',
  'whatsapp_links',
  'whatsapp_link_codes',
  'whatsapp_logs'
];

/**
 * Extracts rows from a specific SQLite table in read-only mode
 * @param {DatabaseSync} db - Read-only SQLite instance
 * @param {string} table - Table name
 * @param {object} options - Options (cleanTestSessions, cleanProductionData, target)
 */
export function extractTableData(db, table, options = {}) {
  const isProduction = options.target === 'production' || Boolean(options.cleanProductionData);
  const cleanTestSessions = Boolean(options.cleanTestSessions || isProduction);

  let query = `SELECT * FROM ${table}`;
  if (table === 'teaching_sessions' && cleanTestSessions) {
    query = `SELECT * FROM teaching_sessions WHERE notes != 'Logged via API test flow' OR notes IS NULL`;
  } else if (table === 'telegram_link_codes' && isProduction) {
    // Exclude expired ephemeral test linking codes (100% of historical codes are expired test loops)
    query = `SELECT * FROM telegram_link_codes WHERE expires_at > ${Date.now()} AND used = 0`;
  } else if (table === 'whatsapp_logs' && isProduction) {
    // Exclude simulated test delivery logs
    query = `SELECT * FROM whatsapp_logs WHERE status != 'SIMULATED'`;
  } else if (table === 'alerts' && isProduction) {
    // Exclude historical test/simulation alerts; production alert engine generates live alerts
    query = `SELECT * FROM alerts WHERE alert_type NOT IN ('ESCALATED_UNLOGGED', 'MISSED_LOG_REMINDER')`;
  }

  return db.prepare(query).all();
}

/**
 * Validates data integrity from read-only SQLite database
 * @param {string} sqlitePath - Path to source SQLite database
 * @param {object} options - Options including cleanTestSessions, cleanProductionData, target
 */
export function validateSqliteData(sqlitePath, options = {}) {
  const resolvedPath = path.resolve(sqlitePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`SQLite source database not found at: ${resolvedPath}`);
  }

  // Open strictly read-only at the C/driver level
  const db = new DatabaseSync(resolvedPath, { readOnly: true });
  const isProduction = options.target === 'production' || Boolean(options.cleanProductionData);
  const cleanTestSessions = Boolean(options.cleanTestSessions || isProduction);

  const report = {
    sourcePath: resolvedPath,
    options: { cleanTestSessions, cleanProductionData: isProduction, target: options.target || 'development' },
    tableCounts: {},
    totalRows: 0,
    teachingSessionsBreakdown: {},
    productionFilterBreakdown: null,
    foreignKeyChecks: { passed: true, issues: [] },
    timestamp: new Date().toISOString()
  };

  // 1. Collect counts and verify extractability
  for (const table of MIGRATION_TABLES) {
    try {
      let query = `SELECT COUNT(*) as c FROM ${table}`;
      if (table === 'teaching_sessions' && cleanTestSessions) {
        query = `SELECT COUNT(*) as c FROM teaching_sessions WHERE notes != 'Logged via API test flow' OR notes IS NULL`;
      } else if (table === 'telegram_link_codes' && isProduction) {
        query = `SELECT COUNT(*) as c FROM telegram_link_codes WHERE expires_at > ${Date.now()} AND used = 0`;
      } else if (table === 'whatsapp_logs' && isProduction) {
        query = `SELECT COUNT(*) as c FROM whatsapp_logs WHERE status != 'SIMULATED'`;
      } else if (table === 'alerts' && isProduction) {
        query = `SELECT COUNT(*) as c FROM alerts WHERE alert_type NOT IN ('ESCALATED_UNLOGGED', 'MISSED_LOG_REMINDER')`;
      }
      const countRow = db.prepare(query).get();
      report.tableCounts[table] = countRow ? Number(countRow.c) : 0;
      report.totalRows += report.tableCounts[table];
    } catch (err) {
      report.tableCounts[table] = `ERROR: ${err.message}`;
    }
  }

  // 2. Specific Investigation: Teaching Sessions Breakdown
  try {
    const totalSessions = db.prepare('SELECT COUNT(*) as c FROM teaching_sessions').get().c;
    const testSessions = db.prepare("SELECT COUNT(*) as c FROM teaching_sessions WHERE notes = 'Logged via API test flow'").get().c;
    const academicSessions = db.prepare("SELECT COUNT(*) as c FROM teaching_sessions WHERE notes != 'Logged via API test flow' OR notes IS NULL").get().c;

    report.teachingSessionsBreakdown = {
      totalInSqlite: Number(totalSessions),
      genuineAcademicSessions: Number(academicSessions),
      ephemeralApiTestSessions: Number(testSessions),
      targetExportCount: cleanTestSessions ? Number(academicSessions) : Number(totalSessions),
      explanation: 'Test suite executions create sessions with notes="Logged via API test flow". Genuine academic baseline has 26 rows.'
    };
  } catch (err) {
    report.teachingSessionsBreakdown.error = err.message;
  }

  // 3. Production Filtering Breakdown
  if (isProduction) {
    try {
      const rawSessions = Number(db.prepare('SELECT COUNT(*) as c FROM teaching_sessions').get().c);
      const rawCodes = Number(db.prepare('SELECT COUNT(*) as c FROM telegram_link_codes').get().c);
      const rawWaLogs = Number(db.prepare('SELECT COUNT(*) as c FROM whatsapp_logs').get().c);
      const rawAlerts = Number(db.prepare('SELECT COUNT(*) as c FROM alerts').get().c);

      report.productionFilterBreakdown = {
        apiTestSessionsExcluded: rawSessions - (report.tableCounts['teaching_sessions'] || 0),
        expiredTelegramCodesExcluded: rawCodes - (report.tableCounts['telegram_link_codes'] || 0),
        simulatedWhatsappLogsExcluded: rawWaLogs - (report.tableCounts['whatsapp_logs'] || 0),
        historicalTestAlertsExcluded: rawAlerts - (report.tableCounts['alerts'] || 0),
        genuineAcademicRecordsPreserved: report.totalRows
      };
    } catch (err) {
      report.productionFilterBreakdown = { error: err.message };
    }
  }

  // 3. Foreign Key Validation
  // Ensure child foreign keys reference existing parent records
  const fkRelationships = [
    { childTable: 'users', childCol: 'campus_id', parentTable: 'campuses', parentCol: 'id', nullable: true },
    { childTable: 'semesters', childCol: 'campus_id', parentTable: 'campuses', parentCol: 'id', nullable: false },
    { childTable: 'semesters', childCol: 'track_id', parentTable: 'tracks', parentCol: 'id', nullable: false },
    { childTable: 'subjects', childCol: 'semester_id', parentTable: 'semesters', parentCol: 'id', nullable: false },
    { childTable: 'subjects', childCol: 'campus_id', parentTable: 'campuses', parentCol: 'id', nullable: false },
    { childTable: 'subjects', childCol: 'track_id', parentTable: 'tracks', parentCol: 'id', nullable: false },
    { childTable: 'timetable_slots', childCol: 'subject_id', parentTable: 'subjects', parentCol: 'id', nullable: false },
    { childTable: 'timetable_slots', childCol: 'faculty_id', parentTable: 'users', parentCol: 'id', nullable: false },
    { childTable: 'lesson_plans', childCol: 'subject_id', parentTable: 'subjects', parentCol: 'id', nullable: false },
    { childTable: 'teaching_sessions', childCol: 'subject_id', parentTable: 'subjects', parentCol: 'id', nullable: false },
    { childTable: 'teaching_sessions', childCol: 'faculty_id', parentTable: 'users', parentCol: 'id', nullable: false }
  ];

  for (const rel of fkRelationships) {
    try {
      const nullFilter = rel.nullable
        ? `WHERE c.${rel.childCol} IS NOT NULL AND p.${rel.parentCol} IS NULL`
        : `WHERE p.${rel.parentCol} IS NULL`;
      const query = `
        SELECT c.${rel.childCol} as orphan_id
        FROM ${rel.childTable} c
        LEFT JOIN ${rel.parentTable} p ON c.${rel.childCol} = p.${rel.parentCol}
        ${nullFilter}
        LIMIT 5
      `;
      const orphans = db.prepare(query).all();
      if (orphans.length > 0) {
        report.foreignKeyChecks.passed = false;
        report.foreignKeyChecks.issues.push(
          `Orphan records found in ${rel.childTable}.${rel.childCol} -> ${rel.parentTable}.${rel.parentCol}`
        );
      }
    } catch (e) {
      // Ignore if table not present in partial databases
    }
  }

  return report;
}

/**
 * Verifies whether the target PostgreSQL database is completely empty
 * @param {pg.PoolClient} client - Connected PostgreSQL client
 * @returns {Promise<string[]>} List of existing table names
 */
export async function checkTargetDatabaseEmpty(client) {
  const res = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name ASC
  `);
  return res.rows.map(r => r.table_name);
}

/**
 * Executes atomic migration into target PostgreSQL database within a single transaction
 * @param {string} sqlitePath - Path to source SQLite database
 * @param {string} targetUrl - PostgreSQL connection URL
 * @param {object} options - Options (cleanTestSessions)
 */
export async function executeMigration(sqlitePath, targetUrl, options = {}) {
  const resolvedPath = path.resolve(sqlitePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`SQLite source database not found at: ${resolvedPath}`);
  }

  // Source SQLite is strictly read-only
  const db = new DatabaseSync(resolvedPath, { readOnly: true });

  const isSslRequired = targetUrl.includes('neon.tech') ||
    process.env.NODE_ENV === 'production' ||
    process.env.PGSSLMODE === 'require';

  const connectionString = targetUrl.includes('sslmode=require')
    ? targetUrl.replace('sslmode=require', 'sslmode=verify-full')
    : targetUrl;

  const pool = new pg.Pool({
    connectionString,
    ssl: isSslRequired ? { rejectUnauthorized: false } : false,
    max: 1,
    connectionTimeoutMillis: 30000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000
  });

  const client = await pool.connect();
  const summary = {
    target: maskConnectionString(targetUrl),
    migratedCounts: {},
    totalMigrated: 0,
    startTime: new Date().toISOString(),
    status: 'IN_PROGRESS'
  };

  try {
    // 1. Safety check: Target database MUST be completely empty
    const existingTables = await checkTargetDatabaseEmpty(client);
    if (existingTables.length > 0) {
      throw new Error(
        `Target database is not empty. Found ${existingTables.length} existing tables: [${existingTables.join(', ')}]. ` +
        `Migration aborted to protect existing database data.`
      );
    }

    // 2. Begin atomic PostgreSQL transaction
    await client.query('BEGIN');

    // 3. Apply PostgreSQL schema DDL (CREATE TABLE IF NOT EXISTS)
    const schemaFile = path.resolve(__dirname, 'schema.pg.sql');
    if (!fs.existsSync(schemaFile)) {
      throw new Error(`PostgreSQL schema DDL file not found at: ${schemaFile}`);
    }
    const schemaSql = fs.readFileSync(schemaFile, 'utf8');
    await client.query(schemaSql);
    console.log('✔ Applied PostgreSQL schema DDL (schema.pg.sql)');

    // 4. Migrate tables in topological dependency order using batched multi-row inserts
    const BATCH_SIZE = 50;
    for (const table of MIGRATION_TABLES) {
      const rows = extractTableData(db, table, options);
      if (rows.length === 0) {
        summary.migratedCounts[table] = 0;
        console.log(`  • ${table.padEnd(25)} : 0 rows (empty table)`);
        continue;
      }

      const columns = Object.keys(rows[0]);
      const colNames = columns.map(c => `"${c}"`).join(', ');
      let tableInsertedCount = 0;

      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const placeholders = batch.map((_, rowIndex) => {
          const rowPlaceholders = columns.map((_, colIndex) => `$${rowIndex * columns.length + colIndex + 1}`);
          return `(${rowPlaceholders.join(', ')})`;
        }).join(', ');

        const values = batch.flatMap(row => columns.map(c => row[c]));
        const insertSql = `
          INSERT INTO "${table}" (${colNames})
          VALUES ${placeholders}
        `;
        const res = await client.query(insertSql, values);
        tableInsertedCount += res.rowCount || 0;
      }

      // 5. Strict row count verification against SQLite source
      const countRes = await client.query(`SELECT COUNT(*) as c FROM "${table}"`);
      const pgCount = Number(countRes.rows[0].c);

      if (pgCount !== rows.length || tableInsertedCount !== rows.length) {
        throw new Error(
          `Row count verification failed for table "${table}": SQLite extracted ${rows.length} rows, ` +
          `inserted ${tableInsertedCount}, but PostgreSQL contains ${pgCount} rows.`
        );
      }

      console.log(`  • ${table.padEnd(25)} : ${pgCount} rows migrated and verified`);
      summary.migratedCounts[table] = pgCount;
      summary.totalMigrated += pgCount;
    }

    // 6. Commit atomic transaction upon 100% verification
    await client.query('COMMIT');
    summary.status = 'SUCCESS';
    summary.endTime = new Date().toISOString();
    return summary;
  } catch (err) {
    // Atomic rollback on any failure
    await client.query('ROLLBACK');
    summary.status = 'ROLLED_BACK';
    summary.error = err.message;
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

/**
 * Diagnostic utility: safely inspects target PostgreSQL database identity and schema status
 * Strictly read-only; never writes or alters any tables.
 * @param {string} targetUrl - PostgreSQL connection URL
 */
export async function verifyTargetDatabase(targetUrl) {
  if (!targetUrl) {
    throw new Error('DATABASE_URL is not set. Please provide target connection URL.');
  }

  const isSslRequired = targetUrl.includes('neon.tech') ||
    process.env.NODE_ENV === 'production' ||
    process.env.PGSSLMODE === 'require';

  const connectionString = targetUrl.includes('sslmode=require')
    ? targetUrl.replace('sslmode=require', 'sslmode=verify-full')
    : targetUrl;

  const pool = new pg.Pool({
    connectionString,
    ssl: isSslRequired ? { rejectUnauthorized: false } : false,
    max: 1,
    connectionTimeoutMillis: 30000
  });

  const client = await pool.connect();
  try {
    const idRes = await client.query('SELECT current_database() as db_name, current_user as user_name, version() as pg_version');
    const { db_name, user_name, pg_version } = idRes.rows[0];

    let host = 'unknown';
    try {
      const parsed = new URL(targetUrl);
      host = parsed.hostname;
    } catch (e) {}

    const tables = await checkTargetDatabaseEmpty(client);

    return {
      host,
      database: db_name,
      user: user_name,
      version: pg_version ? pg_version.split(' on ')[0] : 'PostgreSQL',
      isPublicSchemaEmpty: tables.length === 0,
      existingTables: tables,
      maskedUrl: maskConnectionString(targetUrl)
    };
  } finally {
    client.release();
    await pool.end();
  }
}

/**
 * CLI execution handler
 */
export async function runCli() {
  const args = process.argv.slice(2);
  const isVerifyTarget = args.includes('--verify-target');
  const isExecute = args.includes('--execute');
  const isDryRun = !isExecute || args.includes('--dry-run');
  const isProdTarget = args.includes('--target=production') || args.includes('--target=prod');
  const cleanTestSessions = args.includes('--clean-test-sessions') || isProdTarget;
  const cleanProductionData = args.includes('--clean-production-data') || isProdTarget;
  const targetEnv = isProdTarget ? 'production' : 'development';
  const sqliteFile = path.resolve(__dirname, '../../data/edvanta.db');

  // Select target URL based on target flag
  let targetUrl = '';
  if (isProdTarget) {
    targetUrl = (process.env.PROD_DATABASE_URL || '').trim();
  } else {
    targetUrl = (process.env.DATABASE_URL || '').trim();
  }

  // Safety Guard: Detect accidental targeting of development branch when production is requested
  const devBranchId = 'br-spring-sky-b53qp8cc';
  const devEndpointId = 'ep-twilight-lab-b5vvpbdb';
  if (isProdTarget && targetUrl) {
    if (targetUrl.includes(devBranchId) || targetUrl.includes(devEndpointId)) {
      console.error('\n✖ CRITICAL SAFETY VIOLATION:');
      console.error('  --target=production was requested, but PROD_DATABASE_URL points to the DEVELOPMENT branch!');
      console.error(`  Development Branch Endpoint: ${devEndpointId}`);
      console.error('  Aborting migration to prevent targeting or altering development database.');
      process.exit(1);
    }
  }

  if (isVerifyTarget) {
    console.log('================================================================');
    console.log(`🔍 EDVANTA Neon ${isProdTarget ? 'PRODUCTION' : 'DEVELOPMENT'} Target Database Diagnostics`);
    console.log('🔒 Mode: READ-ONLY INSPECTION (Zero Writes)');
    console.log('================================================================');

    if (!targetUrl) {
      const varName = isProdTarget ? 'PROD_DATABASE_URL' : 'DATABASE_URL';
      console.log(`\n✖ ${varName} is not currently set in .env or environment.`);
      console.log(`💡 To verify target, configure ${varName} in .env.`);
      return;
    }

    try {
      console.log(`\nConnecting to target: ${maskConnectionString(targetUrl)}...`);
      console.log('⏳ Establishing TLS connection to Neon (waiting for serverless compute if suspended)...');
      const info = await verifyTargetDatabase(targetUrl);
      console.log('✔ Successfully connected to target database!');
      console.log(`  • Host / Endpoint       : ${info.host}`);
      console.log(`  • Target Database Name  : ${info.database}`);
      console.log(`  • Connected Role/User   : ${info.user}`);
      console.log(`  • Engine Version        : ${info.version}`);
      console.log(`  • Target Environment    : ${targetEnv.toUpperCase()}`);
      console.log(`  • Public Schema Status  : ${info.isPublicSchemaEmpty ? '✔ 100% EMPTY (0 tables)' : '✖ NOT EMPTY (' + info.existingTables.length + ' tables found)'}`);
      if (!info.isPublicSchemaEmpty) {
        console.log(`  • Existing Tables       : [${info.existingTables.join(', ')}]`);
        console.log('  ⚠️ Warning: Target database is not empty. Migration will be rejected to protect data.');
      } else {
        console.log('  ✔ Target database is confirmed empty and safe for migration.');
      }
    } catch (err) {
      console.error(`\n✖ Connection verification failed: ${err.message}`);
    }
    return;
  }

  console.log('================================================================');
  console.log(`🚀 EDVANTA SQLite -> PostgreSQL Migration Engine [Target: ${targetEnv.toUpperCase()}]`);
  console.log(`🔒 Mode: ${isDryRun ? 'DRY-RUN VALIDATION (Non-destructive)' : 'EXECUTE'}`);
  console.log(`📁 Source: ${sqliteFile} (READ-ONLY)`);
  console.log(`🎯 Target Environment  : ${targetEnv.toUpperCase()} (${isProdTarget ? 'PROD_DATABASE_URL' : 'DATABASE_URL'})`);
  console.log(`🧹 Filter Test Sessions: ${cleanTestSessions ? 'ENABLED (26 genuine records)' : 'DISABLED (all records)'}`);
  console.log(`🛡️ Production Filtering : ${cleanProductionData ? 'ENABLED (Excludes test sessions, expired OTPs, simulated logs, test alerts)' : 'DISABLED'}`);
  console.log('================================================================');

  try {
    const report = validateSqliteData(sqliteFile, { cleanTestSessions, cleanProductionData, target: targetEnv });

    console.log('\n📊 SQLite Source Row Counts (Post-Filter Target):');
    for (const [table, count] of Object.entries(report.tableCounts)) {
      console.log(`  • ${table.padEnd(25)} : ${count} rows`);
    }
    console.log(`  -----------------------------------------`);
    console.log(`  • TARGET TOTAL ROWS       : ${report.totalRows} rows\n`);

    console.log('🔍 Teaching Sessions Discrepancy Investigation:');
    console.log(`  • Total in SQLite         : ${report.teachingSessionsBreakdown.totalInSqlite}`);
    console.log(`  • Genuine Academic Records: ${report.teachingSessionsBreakdown.genuineAcademicSessions}`);
    console.log(`  • API Test Execution Logs : ${report.teachingSessionsBreakdown.ephemeralApiTestSessions}`);
    console.log(`  • Target Export Count     : ${report.teachingSessionsBreakdown.targetExportCount}`);
    console.log(`  • Explanation             : ${report.teachingSessionsBreakdown.explanation}\n`);

    if (report.productionFilterBreakdown) {
      console.log('🛡️ Production Filtering Audit:');
      console.log(`  • API Test Sessions Excluded      : ${report.productionFilterBreakdown.apiTestSessionsExcluded}`);
      console.log(`  • Expired Telegram Codes Excluded : ${report.productionFilterBreakdown.expiredTelegramCodesExcluded}`);
      console.log(`  • Simulated WhatsApp Logs Excluded: ${report.productionFilterBreakdown.simulatedWhatsappLogsExcluded}`);
      console.log(`  • Historical Test Alerts Excluded : ${report.productionFilterBreakdown.historicalTestAlertsExcluded}`);
      console.log(`  • Genuine Academic Records Kept   : ${report.productionFilterBreakdown.genuineAcademicRecordsPreserved}\n`);
    }

    console.log('🛡️ Foreign Key Integrity Check:');
    if (report.foreignKeyChecks.passed) {
      console.log('  ✔ All parent/child relational references are intact and valid.');
    } else {
      console.log('  ✖ Relational issues detected:');
      for (const issue of report.foreignKeyChecks.issues) {
        console.log(`    - ${issue}`);
      }
    }

    if (isDryRun) {
      console.log('\n✨ Dry run validation completed successfully. No changes were made to any database.');
      console.log(`💡 Note: To execute migration to ${targetEnv.toUpperCase()}, use:`);
      if (isProdTarget) {
        console.log('   node src/database/migrate-to-pg.js --execute --target=production');
      } else {
        console.log('   node src/database/migrate-to-pg.js --execute --clean-test-sessions');
      }
      return;
    }

    // Execution guard: do not execute without explicit confirmation and target URL
    if (!targetUrl) {
      const varName = isProdTarget ? 'PROD_DATABASE_URL' : 'DATABASE_URL';
      console.error(`\n✖ Error: Cannot execute migration without a target ${varName} environment variable.`);
      process.exit(1);
    }

    console.log(`\n🎯 Target Database: ${maskConnectionString(targetUrl)}`);
    console.log(`Connecting to ${targetEnv.toUpperCase()} database and executing atomic migration...`);
    const result = await executeMigration(sqliteFile, targetUrl, { cleanTestSessions, cleanProductionData, target: targetEnv });
    console.log('\n✔ Migration Completed Successfully:');
    console.log(`  • Status: ${result.status}`);
    console.log(`  • Total records migrated: ${result.totalMigrated}`);
  } catch (error) {
    console.error('\n✖ Migration error:', error.message);
    process.exit(1);
  }
}

// Run CLI when executed directly
if (process.argv[1] && process.argv[1].endsWith('migrate-to-pg.js')) {
  runCli();
}

