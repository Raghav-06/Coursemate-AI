import fs from "node:fs/promises";
import pg from "pg";
import { config } from "../config/index.js";

const { db } = config;

// DATE columns (exam dates, plan days, activity days) stay "YYYY-MM-DD"
// strings: parsing them as JS Dates would shift them by the server's timezone.
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

// DATABASE_URL wins; otherwise the individual PG* settings are used.
export const pool = new pg.Pool({
  ...(db.url
    ? { connectionString: db.url }
    : { host: db.host, port: db.port, user: db.user, password: db.password, database: db.database }),
  ssl: db.ssl ? { rejectUnauthorized: db.sslRejectUnauthorized } : undefined,
  max: db.poolMax,
});

pool.on("error", (err) => console.error("Postgres pool error:", err.message));

export function query(text, params) {
  return pool.query(text, params);
}

/** Runs `fn(client)` inside a transaction. */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Creates any missing tables/indexes. Safe to run on every start. */
export async function migrate() {
  const sql = await fs.readFile(new URL("./schema.sql", import.meta.url), "utf-8");
  await pool.query(sql);
}
