/**
 * Database Module
 *
 * Configures connection pooling to PostgreSQL (Neon) using 'pg'.
 * Connection string is securely loaded from process.env.DATABASE_URL.
 */

import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn(
    "[db] Warning: DATABASE_URL is not set in environment variables. Database features will be unavailable."
  );
}

// Configure PostgreSQL Pool for Neon
export const pool = new Pool({
  connectionString,
  ssl: {
    rejectUnauthorized: false,
  },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on("error", (err) => {
  console.error("[db] Unexpected error on idle PostgreSQL client:", err.message);
});

/**
 * Execute a SQL query with parameter binding.
 *
 * @param {string} text - SQL query text
 * @param {Array} [params] - Query parameters
 * @returns {Promise<pg.QueryResult>}
 */
export async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  // Never log sensitive data or full queries with parameters
  if (process.env.NODE_ENV === "development" && duration > 500) {
    console.warn(`[db] Slow query executed in ${duration}ms`);
  }
  return res;
}

/**
 * Check whether database is reachable and configured.
 * @returns {Promise<boolean>}
 */
export async function isDbConnected() {
  if (!process.env.DATABASE_URL) return false;
  try {
    const res = await pool.query("SELECT 1 AS connected");
    return res.rows[0]?.connected === 1;
  } catch {
    return false;
  }
}

export default {
  pool,
  query,
  isDbConnected,
};
