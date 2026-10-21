// Integration suites of the use case hub on the hub's own local test cluster
// (docs/use-case/PIANO-LAVORI.md §2.7 and §5.1). Clean environment, as in
// scripts/connettore-test/run-db-tests.mjs: only PATH, HOME and the loopback test
// database; no .env file, no API key, no remote host. One suite file at a time.
//
//   node scripts/use-case-test/db-clone.mjs <id>                                 # once: hub_<id> from the model
//   UC_TEST_PG_DB=hub_<id> node scripts/use-case-test/run-db-tests.mjs           # or: npm run test:use-cases:db
//   UC_TEST_PG_DB=hub_<id> node scripts/use-case-test/run-db-tests.mjs <file…>   # only these suites
//
// UC_TEST_PG_DB is required and must be a package copy hub_<id> (§2.7): never the model
// unbundle_hub_test, which db-clone.mjs copies with `createdb -T` (rows left by a failed
// suite would reach every later copy, and an open session makes the copy fail).
// Optional: UC_TEST_PG_PORT (default 55479).
//
// Hub suites turn themselves on with HUB_TEST_ISOLATED=true, which only this runner sets.
// They do NOT read CONN_TEST_ISOLATED (the flag of the connector's model suite,
// src/lib/portfolio/submission.integration.test.ts). Nothing may skip here: the runner
// fails when a suite runs no test or skips any, so a suite gated on the wrong flag is red.
//
// Modules are loaded with scripts/use-case-test/test-hooks.mjs (server-only and `@/`)
// and the local Neon transport scripts/uc-test/local-neon.cjs.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const port = process.env.UC_TEST_PG_PORT?.trim() || "55479";
const db = process.env.UC_TEST_PG_DB?.trim() ?? "";
// 55439 Learning, 55449 Casi d'uso, 55469 connector: never the hub's suites.
if (!/^\d+$/.test(port) || ["55439", "55449", "55469"].includes(port)) {
  throw new Error("Use the hub's own test cluster port (default 55479)");
}
// Same names as db-clone.mjs: hub_ plus a package id of lowercase letters, digits or _.
if (!/^hub_[a-z0-9][a-z0-9_]{0,39}$/.test(db)) {
  throw new Error(
    `UC_TEST_PG_DB must be the package's own database hub_<id>, not ${db ? `"${db}"` : "unset"}: ` +
      "create it with `node scripts/use-case-test/db-clone.mjs <id>` (PIANO-LAVORI §2.7)",
  );
}
const url = `postgresql://uc_test@127.0.0.1:${port}/${db}`;

/** The hub's integration suites (the same files `npm run test:use-cases` skips without a database). */
const DEFAULT_SUITES = [
  "src/lib/use-cases/**/*.integration.test.ts",
  "src/lib/db/use-case-hub*.integration.test.ts",
  "src/components/use-cases/**/*.integration.test.ts",
];
const SUITE = /^src\/(lib\/use-cases\/.+|lib\/db\/use-case-hub[^/]*|components\/use-cases\/.+)\.integration\.test\.ts$/;

const requested = process.argv.slice(2);
for (const file of requested) {
  if (!SUITE.test(file)) throw new Error(`Not a hub integration suite: ${file}`);
  if (!existsSync(resolve(repoRoot, file))) throw new Error(`Suite not found: ${file}`);
}
const files = requested.length ? requested : DEFAULT_SUITES;

// Human output on stdout, and a TAP copy in a temporary file for the counts below.
const reportDir = mkdtempSync(join(tmpdir(), "hub-db-tests-"));
const tapFile = join(reportDir, "report.tap");
let status;
let tap = "";
try {
  const result = spawnSync(
    process.execPath,
    [
      "--no-warnings",
      "--test",
      "--test-concurrency=1",
      "--test-reporter=spec",
      "--test-reporter-destination=stdout",
      "--test-reporter=tap",
      `--test-reporter-destination=${tapFile}`,
      ...files,
    ],
    {
      cwd: repoRoot,
      stdio: "inherit",
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        HOME: process.env.HOME ?? "/private/tmp",
        NODE_OPTIONS: "--import=./scripts/use-case-test/test-hooks.mjs --require=./scripts/uc-test/local-neon.cjs",
        // The app's db module reads DATABASE_URL: here it is always the loopback test database.
        DATABASE_URL: url,
        UC_TEST_DATABASE_URL: url,
        UC_TEST_PG_PORT: port,
        UC_TEST_PG_DB: db,
        HUB_TEST_ISOLATED: "true",
      },
    },
  );
  status = result.status ?? 1;
  if (existsSync(tapFile)) tap = readFileSync(tapFile, "utf8");
} finally {
  rmSync(reportDir, { recursive: true, force: true });
}

/** A count from the TAP summary (`# tests 3`, `# skipped 0`), or null when it is missing. */
function summaryCount(report, name) {
  const match = report.match(new RegExp(`^# ${name} (\\d+)$`, "m"));
  return match ? Number(match[1]) : null;
}

if (status !== 0) process.exit(status);
const tests = summaryCount(tap, "tests");
const skipped = summaryCount(tap, "skipped");
const todo = summaryCount(tap, "todo");
if (tests === null || skipped === null || todo === null) {
  console.error("Hub DB tests: no test summary in the TAP report, cannot tell whether anything ran");
  process.exit(1);
}
if (tests === 0) {
  console.error("Hub DB tests: no test ran (a glob or a file list that matches nothing)");
  process.exit(1);
}
if (skipped > 0 || todo > 0) {
  console.error(
    `Hub DB tests: ${skipped} skipped and ${todo} todo out of ${tests}. Nothing may skip under this runner: ` +
      "a hub suite turns on with HUB_TEST_ISOLATED=true (not CONN_TEST_ISOLATED) and a loopback DATABASE_URL.",
  );
  process.exit(1);
}
console.log(`Hub DB tests: ${tests} test(s) on ${db}, none skipped`);
