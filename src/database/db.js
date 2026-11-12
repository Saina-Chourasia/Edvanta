// Database abstraction layer for ADVANTA
// Exclusively configured for PostgreSQL (Neon Serverless & Hosted PostgreSQL)
// Designed for high performance, connection pooling, and separate Vercel (frontend) + Render (backend) deployment.

try {
  if (typeof process.loadEnvFile === 'function') {
    process.loadEnvFile();
  }
} catch (e) {
  // .env file is optional when environment variables are injected directly by host
}

import pg from 'pg';

const { Pool } = pg;

// Parse 64-bit integers (BIGINT, OID 20) as JavaScript numbers
pg.types.setTypeParser(20, (val) => (val === null ? null : Number(val)));
// Parse PostgreSQL DATE (OID 1082) as exact ISO date strings (YYYY-MM-DD) to prevent timezone shifts
pg.types.setTypeParser(1082, (val) => val);
// Parse PostgreSQL NUMERIC/DECIMAL (OID 1700) as JavaScript floating-point numbers
pg.types.setTypeParser(1700, (val) => (val === null ? null : parseFloat(val)));

/**
 * Converts positional `?` placeholders to PostgreSQL `$1, $2, ...`
 * Safely handles `INSERT OR REPLACE` and `INSERT OR IGNORE` clauses for PostgreSQL compatibility.
 * Safely ignores `?` characters inside single-quoted strings or double-quoted identifiers.
 */
export function convertSqlPlaceholders(sql) {
  // Convert legacy INSERT OR REPLACE INTO ... to PostgreSQL ON CONFLICT ... DO UPDATE SET ...
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

  // Convert legacy INSERT OR IGNORE INTO ... to PostgreSQL ON CONFLICT DO NOTHING
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
      console.error(`PostgreSQL Tx Query Error: ${error.message}\nSQL: ${pgSql}\nParams:`, params);
      throw error;
    }
  }

  async get(sql, params = []) {
    const pgSql = convertSqlPlaceholders(sql);
    try {
      const res = await this.client.query(pgSql, params);
      return res.rows[0] || null;
    } catch (error) {
      console.error(`PostgreSQL Tx Get Error: ${error.message}\nSQL: ${pgSql}\nParams:`, params);
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
      console.error(`PostgreSQL Tx Run Error: ${error.message}\nSQL: ${pgSql}\nParams:`, params);
      throw error;
    }
  }

  async exec(sql) {
    return this.client.query(sql);
  }
}

export class DatabaseService {
  constructor(customUrl = null) {
    const connectionUrl = (customUrl || process.env.DATABASE_URL || process.env.PROD_DATABASE_URL || '').trim();

    if (!connectionUrl) {
      throw new Error(
        'DATABASE_URL environment variable is required. PostgreSQL is the only supported database for ADVANTA.'
      );
    }

    if (!connectionUrl.startsWith('postgres://') && !connectionUrl.startsWith('postgresql://')) {
      throw new Error(
        `Invalid DATABASE_URL scheme. Expected postgres:// or postgresql:// but received unrecognized connection string.`
      );
    }

    this.isPostgres = true;

    const isSslRequired =
      process.env.NODE_ENV === 'production' ||
      connectionUrl.includes('neon.tech') ||
      process.env.PGSSLMODE === 'require';

    const connectionString = connectionUrl.includes('sslmode=require')
      ? connectionUrl.replace('sslmode=require', 'sslmode=verify-full')
      : connectionUrl;

    const maxPool = process.env.PG_MAX_POOL ? parseInt(process.env.PG_MAX_POOL, 10) : 20;

    this.pool = new Pool({
      connectionString,
      ssl: isSslRequired ? { rejectUnauthorized: false } : false,
      max: maxPool,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 30000
    });

    this.pool.on('error', (err) => {
      console.error('Unexpected error on idle PostgreSQL pool client:', err.message);
    });

    this.db = null;
  }

  // Returns array of objects
  async query(sql, params = []) {
    const pgSql = convertSqlPlaceholders(sql);
    try {
      const res = await this.pool.query(pgSql, params);
      return res.rows;
    } catch (error) {
      console.error(`PostgreSQL Query Error: ${error.message}\nSQL: ${pgSql}\nParams:`, params);
      throw error;
    }
  }

  // Returns single row object or null
  async get(sql, params = []) {
    const pgSql = convertSqlPlaceholders(sql);
    try {
      const res = await this.pool.query(pgSql, params);
      return res.rows[0] || null;
    } catch (error) {
      console.error(`PostgreSQL Get Error: ${error.message}\nSQL: ${pgSql}\nParams:`, params);
      throw error;
    }
  }

  // Executes INSERT, UPDATE, DELETE
  async run(sql, params = []) {
    const pgSql = convertSqlPlaceholders(sql);
    try {
      const res = await this.pool.query(pgSql, params);
      return {
        changes: Number(res.rowCount || 0),
        lastInsertRowid: null
      };
    } catch (error) {
      console.error(`PostgreSQL Run Error: ${error.message}\nSQL: ${pgSql}\nParams:`, params);
      throw error;
    }
  }

  // Raw multi-statement execution
  async exec(sql) {
    return this.pool.query(sql);
  }

  // Executes a function within an atomic PostgreSQL transaction.
  async transaction(fn) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const tx = new PgTransactionWrapper(client);
      const result = await fn(tx);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('PostgreSQL Transaction rolled back due to error:', error.message);
      throw error;
    } finally {
      client.release();
    }
  }

  async checkHealth() {
    try {
      const res = await this.pool.query('SELECT 1 as healthy');
      return res.rows[0]?.healthy === 1;
    } catch (error) {
      console.error('PostgreSQL Health Check Error:', error.message);
      return false;
    }
  }

  async close() {
    if (this.pool) {
      return this.pool.end();
    }
  }
}

// Global singleton instance
export const db = new DatabaseService();
export default db;
