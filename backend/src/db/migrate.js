/**
 * Database Migration Script
 *
 * Reads schema.sql and executes the DDL statements on Neon PostgreSQL.
 * Run via: npm run db:migrate
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "./index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration() {
  console.log("=================================================");
  console.log("       Neon PostgreSQL Schema Migration          ");
  console.log("=================================================");

  if (!process.env.DATABASE_URL) {
    console.error("❌ Error: DATABASE_URL environment variable is missing.");
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    console.log("Connecting to Neon PostgreSQL database...");
    const schemaPath = path.join(__dirname, "schema.sql");
    const sql = await fs.readFile(schemaPath, "utf-8");

    console.log("Applying schema migrations...");
    await client.query(sql);

    // Verify created tables
    const tableRes = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `);

    const tableNames = tableRes.rows.map((r) => r.table_name);
    console.log("✓ Migration successful! Existing tables in database:");
    tableNames.forEach((t) => console.log(`   - ${t}`));

    console.log("=================================================");
    console.log("       DATABASE SCHEMA SETUP COMPLETE!           ");
    console.log("=================================================");
  } catch (err) {
    console.error("❌ Migration failed:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration().catch((err) => {
  console.error("Fatal error during migration:", err);
  process.exit(1);
});
