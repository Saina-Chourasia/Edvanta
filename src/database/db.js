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
