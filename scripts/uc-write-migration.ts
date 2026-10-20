/**
 * Writes drizzle/0018_uc_casi_duso.sql from src/lib/uc/ddl.ts (PIANO §2.5).
 * The file is generated: never edit it by hand.
 *
 *   node --no-warnings scripts/uc-write-migration.ts          # write
 *   node --no-warnings scripts/uc-write-migration.ts --check  # exit 1 if the file is stale
 *
 * No database access.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderUcMigration, UC_DDL_MARKER, UC_MIGRATION_FILE } from "../src/lib/uc/ddl.ts";

const target = resolve(dirname(fileURLToPath(import.meta.url)), "..", UC_MIGRATION_FILE);
const expected = renderUcMigration();
let current = "";
try {
  current = readFileSync(target, "utf8");
} catch {
  current = "";
}

if (process.argv.includes("--check")) {
  if (current !== expected) {
    console.error(`${UC_MIGRATION_FILE} is stale: run node --no-warnings scripts/uc-write-migration.ts`);
    process.exit(1);
  }
  console.log(`${UC_MIGRATION_FILE} is up to date (${UC_DDL_MARKER})`);
} else if (current === expected) {
  console.log(`${UC_MIGRATION_FILE} already up to date (${UC_DDL_MARKER})`);
} else {
  writeFileSync(target, expected);
  console.log(`Wrote ${UC_MIGRATION_FILE} (${UC_DDL_MARKER})`);
}
