// Database abstraction layer for EDVANTA
// Dual-engine support: Native SQLite (DatabaseSync) by default, or Neon PostgreSQL when DATABASE_URL is provided.
// Designed for seamless transition, safe local testing, and production deployment.

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

const { Pool } = pg;

// Parse 64-bit integers (BIGINT, OID 20) as JavaScript numbers
pg.types.setTypeParser(20, (val) => (val === null ? null : Number(val)));
// Parse PostgreSQL DATE (OID 1082) as exact ISO date strings (YYYY-MM-DD) to prevent timezone shifts
pg.types.setTypeParser(1082, (val) => val);
// Parse PostgreSQL NUMERIC/DECIMAL (OID 1700) as JavaScript floating-point numbers
pg.types.setTypeParser(1700, (val) => (val === null ? null : parseFloat(val)));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Data directory and SQLite database file path
const dataDir = path.resolve(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = process.env.DATABASE_PATH || path.join(dataDir, 'edvanta.db');

/**
 * Converts SQLite-style positional `?` placeholders to PostgreSQL `$1, $2, ...`
 * Safely ignores `?` characters inside single-quoted strings or double-quoted identifiers.
 */
export function convertSqlPlaceholders(sql) {
  // Convert SQLite-specific INSERT OR REPLACE INTO ... to PostgreSQL ON CONFLICT ... DO UPDATE SET ...
  const replaceMatch = sql.match(/INSERT\s+OR\s+REPLACE\s+INTO\s+([a-zA-Z0-9_]+)\s*\(([^)]+)\)/i);
  if (replaceMatch) {
    const table = replaceMatch[1];
    const cols = replaceMatch[2].split(',').map(c => c.trim());
    const idCol = cols.find(c => c.toLowerCase() === 'id');
    const updateCols = cols.filter(c => c.toLowerCase() !== 'id');
    let converted = sql.replace(/INSERT\s+OR\s+REPLACE\s+INTO/i, 'INSERT INTO');
    if (idCol && updateCols.length > 0) {
      const updateSet = updateCols.map(c => `${c} = EXCLUDED.${c}`).join(', ');
      sql = converted.trimEnd() + ` ON CONFLICT (${idCol}) DO UPDATE SET ${updateSet}`;
    } else if (idCol) {
      sql = converted.trimEnd() + ` ON CONFLICT (${idCol}) DO NOTHING`;
    }
  }

  // Convert SQLite-specific INSERT OR IGNORE INTO ... to PostgreSQL ON CONFLICT DO NOTHING
  if (/INSERT\s+OR\s+IGNORE\s+INTO/i.test(sql)) {
    sql = sql.replace(/INSERT\s+OR\s+IGNORE\s+INTO/i, 'INSERT INTO').trimEnd() + ' ON CONFLICT DO NOTHING';
  }

  let paramIndex = 1;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let result = '';

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    if (char === "'" && !inDoubleQuote) {
      if (inSingleQuote) {
        if (sql[i + 1] === "'") {
          result += "''";
          i++;
          continue;
        }
        inSingleQuote = false;
        result += char;
      } else {
        inSingleQuote = true;
        result += char;
      }
    } else if (char === '"' && !inSingleQuote) {
      if (inDoubleQuote) {
        if (sql[i + 1] === '"') {
          result += '""';
          i++;
          continue;
        }
        inDoubleQuote = false;
        result += char;
      } else {
        inDoubleQuote = true;
        result += char;
      }
    } else if (char === '?' && !inSingleQuote && !inDoubleQuote) {
      result += `$${paramIndex++}`;
    } else {
      result += char;
    }
  }
  return result;
}

/**
 * Transaction wrapper around a PostgreSQL client from the pool
 */
class PgTransactionWrapper {
  constructor(client) {
    this.client = client;
    this.isPostgres = true;
  }

  async query(sql, params = []) {
    const pgSql = convertSqlPlaceholders(sql);
    try {
      const res = await this.client.query(pgSql, params);
      return res.rows;
    } catch (error) {
      console.error(`PG Tx Query Error: ${error.message}\nSQL: ${pgSql}\nParams:`, params);
      throw error;
    }
  }

  async get(sql, params = []) {
    const pgSql = convertSqlPlaceholders(sql);
    try {
      const res = await this.client.query(pgSql, params);
      return res.rows[0] || null;
    } catch (error) {
      console.error(`PG Tx Get Error: ${error.message}\nSQL: ${pgSql}\nParams:`, params);
      throw error;
    }
  }

  async run(sql, params = []) {
    const pgSql = convertSqlPlaceholders(sql);
    try {
      const res = await this.client.query(pgSql, params);
      return {
        changes: Number(res.rowCount || 0),
        lastInsertRowid: null
      };
    } catch (error) {
      console.error(`PG Tx Run Error: ${error.message}\nSQL: ${pgSql}\nParams:`, params);
      throw error;
    }
  }

  async exec(sql) {
    return this.client.query(sql);
  }
}

export class DatabaseService {
  constructor(databasePath = dbPath) {
    const connectionUrl = (process.env.DATABASE_URL || '').trim();
    if (connectionUrl && !connectionUrl.startsWith('postgres://') && !connectionUrl.startsWith('postgresql://')) {
      throw new Error(`Invalid DATABASE_URL scheme. Expected postgres:// or postgresql:// but received unrecognized connection string.`);
    }
    this.isPostgres = connectionUrl.startsWith('postgres://') || connectionUrl.startsWith('postgresql://');

    if (this.isPostgres) {
      const isSslRequired = process.env.NODE_ENV === 'production' ||
        connectionUrl.includes('neon.tech') ||
        process.env.PGSSLMODE === 'require';

      const connectionString = connectionUrl.includes('sslmode=require')
        ? connectionUrl.replace('sslmode=require', 'sslmode=verify-full')
        : connectionUrl;

      this.pool = new Pool({
        connectionString,
        ssl: isSslRequired ? { rejectUnauthorized: false } : false,
        max: 10,
        idleTimeoutMillis: 1000,
        connectionTimeoutMillis: 30000
      });
      this.db = null;
    } else {
      // Default: SQLite DatabaseSync
      this.pool = null;
      this.db = new DatabaseSync(databasePath);
      this.initPragmas();
      this.initSchema();
    }
  }

  initPragmas() {
    if (this.isPostgres) return;
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
    `);
  }

  initSchema() {
    if (this.isPostgres) return;
    const schemaPath = path.join(__dirname, 'schema.sql');
    if (fs.existsSync(schemaPath)) {
      const schemaSql = fs.readFileSync(schemaPath, 'utf8');
      this.db.exec(schemaSql);
    }
    // Safe column migrations for existing SQLite databases
    try {
      const userColumns = this.db.prepare("PRAGMA table_info(users)").all();
      const hasPhone = userColumns.some(col => col.name === 'phone');
      if (!hasPhone) {
        this.db.exec("ALTER TABLE users ADD COLUMN phone TEXT;");
        this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON users(phone);");
      }
    } catch (e) {
      // Table may not exist yet if fresh
    }

    try {
      const sessColumns = this.db.prepare("PRAGMA table_info(attendance_sessions)").all();
      if (!sessColumns.some(col => col.name === 'validity_minutes')) {
        this.db.exec("ALTER TABLE attendance_sessions ADD COLUMN validity_minutes INTEGER NOT NULL DEFAULT 15;");
      }
      if (!sessColumns.some(col => col.name === 'expires_at')) {
        this.db.exec("ALTER TABLE attendance_sessions ADD COLUMN expires_at DATETIME;");
      }
      if (!sessColumns.some(col => col.name === 'ble_service_uuid')) {
        this.db.exec("ALTER TABLE attendance_sessions ADD COLUMN ble_service_uuid TEXT DEFAULT '0000ed01-0000-1000-8000-00805f9b34fb';");
      }
      if (!sessColumns.some(col => col.name === 'ble_beacon_code')) {
        this.db.exec("ALTER TABLE attendance_sessions ADD COLUMN ble_beacon_code TEXT;");
      }

      const recColumns = this.db.prepare("PRAGMA table_info(attendance_records)").all();
      if (!recColumns.some(col => col.name === 'marking_method')) {
        this.db.exec("ALTER TABLE attendance_records ADD COLUMN marking_method TEXT NOT NULL DEFAULT 'PORTAL';");
      }
    } catch (e) {
      // Table may not exist yet if fresh
    }

    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS telegram_links (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
          telegram_chat_id TEXT NOT NULL UNIQUE,
          telegram_username TEXT,
          first_name TEXT,
          linked_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS telegram_link_codes (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          code_hash TEXT NOT NULL UNIQUE,
          expires_at INTEGER NOT NULL,
          used INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_tg_links_chat_id ON telegram_links(telegram_chat_id);
        CREATE INDEX IF NOT EXISTS idx_tg_links_user ON telegram_links(user_id);
        CREATE INDEX IF NOT EXISTS idx_tg_link_codes_user ON telegram_link_codes(user_id);
        CREATE INDEX IF NOT EXISTS idx_tg_link_codes_hash ON telegram_link_codes(code_hash);

        -- Requirement: WhatsApp Business Platform Integration (Phase 3)
        CREATE TABLE IF NOT EXISTS whatsapp_links (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
          phone_number TEXT NOT NULL UNIQUE,
          verified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          notifications_enabled INTEGER NOT NULL DEFAULT 1,
          notify_attendance INTEGER NOT NULL DEFAULT 1,
          notify_schedule INTEGER NOT NULL DEFAULT 1,
          notify_progress INTEGER NOT NULL DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS whatsapp_link_codes (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          phone_number TEXT NOT NULL,
          code_hash TEXT NOT NULL UNIQUE,
          expires_at INTEGER NOT NULL,
          used INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS whatsapp_logs (
          id TEXT PRIMARY KEY,
          user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          phone_number TEXT NOT NULL,
          message_type TEXT NOT NULL,
          status TEXT NOT NULL,
          message_id TEXT,
          payload TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_wa_links_user ON whatsapp_links(user_id);
        CREATE INDEX IF NOT EXISTS idx_wa_links_phone ON whatsapp_links(phone_number);
        CREATE INDEX IF NOT EXISTS idx_wa_link_codes_user ON whatsapp_link_codes(user_id);
        CREATE INDEX IF NOT EXISTS idx_wa_link_codes_hash ON whatsapp_link_codes(code_hash);
        CREATE INDEX IF NOT EXISTS idx_wa_logs_user ON whatsapp_logs(user_id);
      `);
    } catch (e) {
      // Ignore if schema already created
    }
  }

  // Returns array of objects
  query(sql, params = []) {
    if (this.isPostgres) {
      return this._pgQuery(sql, params);
    }
    try {
      const stmt = this.db.prepare(sql);
      return stmt.all(...params);
    } catch (error) {
      console.error(`DB Query Error: ${error.message}\nSQL: ${sql}\nParams:`, params);
      throw error;
    }
  }

  async _pgQuery(sql, params = []) {
    const pgSql = convertSqlPlaceholders(sql);
    try {
      const res = await this.pool.query(pgSql, params);
      return res.rows;
    } catch (error) {
      console.error(`DB Query Error: ${error.message}\nSQL: ${pgSql}\nParams:`, params);
      throw error;
    }
  }

  // Returns single row object or null
  get(sql, params = []) {
    if (this.isPostgres) {
      return this._pgGet(sql, params);
    }
    try {
      const stmt = this.db.prepare(sql);
      const row = stmt.get(...params);
      return row || null;
    } catch (error) {
      console.error(`DB Get Error: ${error.message}\nSQL: ${sql}\nParams:`, params);
      throw error;
    }
  }

  async _pgGet(sql, params = []) {
    const pgSql = convertSqlPlaceholders(sql);
    try {
      const res = await this.pool.query(pgSql, params);
      return res.rows[0] || null;
    } catch (error) {
      console.error(`DB Get Error: ${error.message}\nSQL: ${pgSql}\nParams:`, params);
      throw error;
    }
  }

  // Executes INSERT, UPDATE, DELETE
  run(sql, params = []) {
    if (this.isPostgres) {
      return this._pgRun(sql, params);
    }
    try {
      const stmt = this.db.prepare(sql);
      const result = stmt.run(...params);
      return {
        changes: Number(result.changes),
        lastInsertRowid: result.lastInsertRowid ? Number(result.lastInsertRowid) : null
      };
    } catch (error) {
      console.error(`DB Run Error: ${error.message}\nSQL: ${sql}\nParams:`, params);
      throw error;
    }
  }

  async _pgRun(sql, params = []) {
    const pgSql = convertSqlPlaceholders(sql);
    try {
      const res = await this.pool.query(pgSql, params);
      return {
        changes: Number(res.rowCount || 0),
        lastInsertRowid: null
      };
    } catch (error) {
      console.error(`DB Run Error: ${error.message}\nSQL: ${pgSql}\nParams:`, params);
      throw error;
    }
  }

  // Raw multi-statement execution
  exec(sql) {
    if (this.isPostgres) {
      return this.pool.query(sql);
    }
    return this.db.exec(sql);
  }

  // Executes a function within an atomic transaction.
  // Supports both synchronous and asynchronous callbacks.
  // Automatically rolls back if an error is thrown.
  transaction(fn) {
    if (this.isPostgres) {
      return this._pgTransaction(fn);
    }

    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      const result = fn(this);
      if (result && typeof result.then === 'function') {
        return result
          .then((val) => {
            this.db.exec('COMMIT');
            return val;
          })
          .catch((err) => {
            this.db.exec('ROLLBACK');
            console.error('Transaction rolled back due to error:', err.message);
            throw err;
          });
      }
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      console.error('Transaction rolled back due to error:', error.message);
      throw error;
    }
  }

  async _pgTransaction(fn) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const tx = new PgTransactionWrapper(client);
      const result = await fn(tx);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('PG Transaction rolled back due to error:', error.message);
      throw error;
    } finally {
      client.release();
    }
  }

  async checkHealth() {
    if (this.isPostgres) {
      const res = await this.pool.query('SELECT 1 as healthy');
      return res.rows[0]?.healthy === 1;
    }
    const res = this.db.prepare('SELECT 1 as healthy').get();
    return res?.healthy === 1;
  }

  close() {
    if (this.isPostgres) {
      return this.pool.end();
    }
    this.db.close();
  }
}

// Global singleton instance
export const db = new DatabaseService();
export default db;

