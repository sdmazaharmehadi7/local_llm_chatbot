/**
 * Database Connection Test Script
 *
 * Verifies network reachability and query execution against Neon PostgreSQL.
 * Run via: npm run db:test
 */

import { pool } from "./index.js";

async function testConnection() {
  console.log("=================================================");
  console.log("       Neon PostgreSQL Connection Test           ");
  console.log("=================================================");

  if (!process.env.DATABASE_URL) {
    console.error("❌ Error: DATABASE_URL is not defined in .env file.");
    process.exit(1);
  }

  const startTime = Date.now();

  try {
    console.log("Connecting to Neon PostgreSQL...");
    const client = await pool.connect();

    try {
      const pingRes = await client.query("SELECT NOW() AS server_time, version() AS pg_version;");
      const latencyMs = Date.now() - startTime;

      console.log("✓ Successfully connected to Neon PostgreSQL!");
      console.log(`✓ Latency: ${latencyMs}ms`);
      console.log(`✓ Server Timestamp: ${pingRes.rows[0].server_time}`);
      console.log(`✓ PostgreSQL Version: ${pingRes.rows[0].pg_version.split(" on ")[0]}`);

      // Check existing tables
      const tablesRes = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
        ORDER BY table_name;
      `);

      const tables = tablesRes.rows.map((r) => r.table_name);
      console.log(`✓ Tables in database (${tables.length}): ${tables.join(", ") || "(none yet - run npm run db:migrate)"}`);

      console.log("=================================================");
      console.log("       DATABASE CONNECTION TEST PASSED!          ");
      console.log("=================================================");
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("❌ Connection failed:", err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

testConnection().catch((err) => {
  console.error("Fatal error testing database connection:", err);
  process.exit(1);
});
