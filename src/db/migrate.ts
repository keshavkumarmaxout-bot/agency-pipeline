import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool, closePool } from "./index.ts";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * schema.sql is written to be idempotent (IF NOT EXISTS / duplicate_object
 * guards), so applying it repeatedly is safe and doubles as the migration path
 * until the schema is big enough to need versioned migration files.
 */
async function main(): Promise<void> {
  const sql = readFileSync(join(here, "schema.sql"), "utf8");
  await pool.query(sql);
  const { rows } = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM information_schema.tables WHERE table_schema = 'public'",
  );
  console.log(`Schema applied. Tables in public schema: ${rows[0]?.count ?? "?"}`);
}

main()
  .catch((error: unknown) => {
    console.error("Migration failed:", error);
    process.exitCode = 1;
  })
  .finally(closePool);
