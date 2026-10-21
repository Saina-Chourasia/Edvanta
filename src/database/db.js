// Database abstraction layer for EDVANTA
// Uses Node's built-in SQLite engine (DatabaseSync) with WAL mode & transactions
// Designed with a clean interface for seamless future migration to PostgreSQL

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Data directory and database file
const dataDir = path.resolve(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = process.env.DATABASE_PATH || path.join(dataDir, 'edvanta.db');

export class DatabaseService {
  constructor(databasePath = dbPath) {
    this.db = new DatabaseSync(databasePath);
    this.initPragmas();
    this.initSchema();
  }

  initPragmas() {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
    `);
  }

  initSchema() {
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
    try {
      const stmt = this.db.prepare(sql);
      return stmt.all(...params);
    } catch (error) {
      console.error(`DB Query Error: ${error.message}\nSQL: ${sql}\nParams:`, params);
      throw error;
    }
  }

  // Returns single row object or null
  get(sql, params = []) {
    try {
      const stmt = this.db.prepare(sql);
      const row = stmt.get(...params);
      return row || null;
    } catch (error) {
      console.error(`DB Get Error: ${error.message}\nSQL: ${sql}\nParams:`, params);
      throw error;
    }
  }

  // Executes INSERT, UPDATE, DELETE
  run(sql, params = []) {
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

  // Raw multi-statement execution
  exec(sql) {
    return this.db.exec(sql);
  }

  // Executes a function within an atomic transaction.
  // Automatically rolls back if an error is thrown.
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      const result = fn(this);
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      console.error('Transaction rolled back due to error:', error.message);
      throw error;
    }
  }

  close() {
    this.db.close();
  }
}

// Global singleton instance
export const db = new DatabaseService();
export default db;
