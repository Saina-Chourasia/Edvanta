// EDVANTA Production Branch Read-Only Diagnostics
// Inspects target Neon branch in strict read-only mode (zero writes)
// Verifies branch identity, separation from dev branch, and public schema state.

import pg from 'pg';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

try {
  if (typeof process.loadEnvFile === 'function') {
    process.loadEnvFile();
  }
} catch (e) {}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function maskUrl(raw) {
  if (!raw) return '[NOT_SET]';
  return raw.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:***@');
}

export async function inspectProductionBranch(prodUrl) {
  const url = (prodUrl || process.env.PROD_DATABASE_URL || '').trim();
  console.log('================================================================');
  console.log('🔍 EDVANTA Neon Production Branch Read-Only Inspection');
  console.log('🔒 Mode: STRICT READ-ONLY (Zero Writes, Zero Schema Alterations)');
  console.log('================================================================\n');

  if (!url) {
    console.log('✖ No production database connection string detected.');
    console.log('💡 Please add PROD_DATABASE_URL to your .env file:');
    console.log('   PROD_DATABASE_URL="postgresql://neondb_owner:***@ep-prod-...neon.tech/neondb?sslmode=require"\n');
    return { success: false, reason: 'MISSING_PROD_DATABASE_URL' };
  }

  console.log(`• Target Endpoint       : ${maskUrl(url)}`);
  console.log('• Establishing TLS connection to Neon serverless compute...');

  const normalizedUrl = url.includes('sslmode=require')
    ? url.replace('sslmode=require', 'sslmode=verify-full')
    : url;

  const client = new pg.Client({
    connectionString: normalizedUrl,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('✔ Successfully connected to target branch!\n');

    // 1. Fetch Neon System Settings
    const neonSettingsRes = await client.query(`
      SELECT name, setting FROM pg_settings 
      WHERE name IN ('neon.branch_id', 'neon.endpoint_id', 'neon.project_id')
    `);
    const settings = Object.fromEntries(neonSettingsRes.rows.map(r => [r.name, r.setting]));

    const devBranchId = 'br-spring-sky-b53qp8cc';
    const isDistinctBranch = settings['neon.branch_id'] && settings['neon.branch_id'] !== devBranchId;

    console.log('--- 1. Branch Identity & Separation ---');
    console.log(`• Project ID            : ${settings['neon.project_id'] || '[Standard PG]'}`);
    console.log(`• Branch ID             : ${settings['neon.branch_id'] || '[Standard PG]'}`);
    console.log(`• Endpoint ID           : ${settings['neon.endpoint_id'] || '[Standard PG]'}`);
    console.log(`• Development Branch ID : ${devBranchId}`);
    console.log(`• Separate from Dev?    : ${isDistinctBranch ? '✔ YES (Confirmed Distinct Branch)' : '✖ NO (Points to Development Branch!)'}`);

    // 2. Database Version & Connection Metadata
    const metaRes = await client.query(`
      SELECT current_database() as db_name, current_user as db_user, version() as pg_version
    `);
    const meta = metaRes.rows[0];
    console.log('\n--- 2. Database Metadata ---');
    console.log(`• Database Name         : ${meta.db_name}`);
    console.log(`• Connected Role        : ${meta.db_user}`);
    console.log(`• Engine Version        : ${meta.pg_version.split(' ')[0]} ${meta.pg_version.split(' ')[1]}`);

    // 3. Public Schema Inspection
    const tablesRes = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name ASC
    `);
    const tableNames = tablesRes.rows.map(r => r.table_name);

    console.log('\n--- 3. Schema & Data State ---');
    if (tableNames.length === 0) {
      console.log('• Public Schema Status  : ✔ 100% EMPTY (0 tables found)');
      console.log('• Deployment Readiness  : ✔ Clean target ready for production migration.');
    } else {
      console.log(`• Public Schema Status  : ✖ NOT EMPTY (${tableNames.length} tables found)`);
      console.log(`• Tables Present        : [${tableNames.join(', ')}]`);

      // Inspect row counts
      let totalRows = 0;
      for (const tbl of tableNames) {
        const countRes = await client.query(`SELECT count(*)::int as c FROM "${tbl}"`);
        const c = countRes.rows[0].c;
        totalRows += c;
        console.log(`  - ${tbl.padEnd(25)}: ${c} rows`);
      }
      console.log(`• Total Records in Target : ${totalRows}`);
    }

    console.log('\n================================================================');
    console.log('🎉 Read-only inspection complete. Zero writes executed.');
    console.log('================================================================');

    return {
      success: true,
      branchId: settings['neon.branch_id'],
      endpointId: settings['neon.endpoint_id'],
      projectId: settings['neon.project_id'],
      isDistinctBranch,
      isPublicSchemaEmpty: tableNames.length === 0,
      tableCount: tableNames.length,
      tables: tableNames
    };
  } catch (err) {
    console.error('\n✖ Connection failed:', err.message);
    return { success: false, error: err.message };
  } finally {
    try {
      await client.end();
    } catch (e) {}
  }
}

// Direct CLI execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const targetArg = process.argv[2];
  inspectProductionBranch(targetArg).then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
