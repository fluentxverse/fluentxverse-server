import { SQL } from "bun";

const isProduction = process.env.NODE_ENV === 'production';

// SECURITY: Require DATABASE_URL in production
if (isProduction && !process.env.DATABASE_URL) {
  console.error('❌ SECURITY: DATABASE_URL required in production');
  process.exit(1);
}

// Create a single SQL instance using Bun's built-in postgres
const sql = new SQL({
  url: process.env.DATABASE_URL || 'postgresql://fluentxverse_user:fluentxverse_pass@localhost:5432/fluentxverse',
  max: 20,
  idleTimeout: 30,
  connectionTimeout: 2,
});


/**
 * Execute a raw query with parameters (legacy compatibility)
 * For new code, use the sql tagged template directly
 */
export const query = async (text: string, params?: any[]) => {
  // Convert $1, $2, etc. placeholders to Bun SQL format
  // Bun SQL uses tagged templates, so we need to use sql.unsafe for dynamic queries
  const result = await sql.unsafe(text, params || []);
  return {
    rows: result,
    rowCount: result.length,
  };
};

/**
 * Get the SQL instance for tagged template queries
 * Usage: const users = await db`SELECT * FROM users WHERE id = ${userId}`;
 */
export const db = sql;

/**
 * Close the SQL connection pool
 */
export const closePool = async () => {
  await sql.close();
};

// For backwards compatibility
export const getPool = () => {
  console.warn('getPool() is deprecated. Use db tagged template or query() instead.');
  return sql;
};

/**
 * Pool-like interface for backwards compatibility
 * Services can import { pool } and use pool.query()
 */
export const pool = {
  query: query,
};
