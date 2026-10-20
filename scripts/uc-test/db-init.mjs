// Isolated local PostgreSQL for the Casi d'uso harness (PIANO §9.2).
//
// Creates and drives a NEW disposable cluster: user uc_test, trust auth, port 55449,
// listening only on 127.0.0.1, database unbundle_uc_test. It never reads .env files and
// never connects anywhere else: every psql call is pinned to 127.0.0.1:55449.
//
//   UC_TEST_ROOT=/private/tmp/<dir> node scripts/uc-test/db-init.mjs init     # initdb, start, createdb, 0000–0017, then 0018 and every later migration twice
//   UC_TEST_ROOT=/private/tmp/<dir> node scripts/uc-test/db-init.mjs start|stop|status
//   UC_TEST_ROOT=/private/tmp/<dir> node scripts/uc-test/db-init.mjs migrate  # re-apply 0018 and later migrations (idempotent)
//
// Optional: UC_TEST_PG_BIN (default /opt/homebrew/opt/postgresql@16/bin),
//           UC_TEST_PG_SOCKET_DIR (default /private/tmp/ucpg; keep it short),
//           UC_TEST_PG_PORT / UC_TEST_PG_DB (default 55449 / unbundle_uc_test, see config.mjs).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, appendFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { UC_TEST_DATABASE_URL, UC_TEST_DB, UC_TEST_HOST, UC_TEST_PORT, UC_TEST_USER, ucTestRoot } from "./config.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const command = process.argv[2];
const allowed = ["init", "start", "stop", "status", "migrate"];
if (!allowed.includes(command)) {
  console.error(`Usage: node scripts/uc-test/db-init.mjs <${allowed.join("|")}>`);
  process.exit(2);
}

const root = ucTestRoot();
const pgBin = process.env.UC_TEST_PG_BIN || "/opt/homebrew/opt/postgresql@16/bin";
const socketDir = process.env.UC_TEST_PG_SOCKET_DIR || "/private/tmp/ucpg";
if (socketDir.length > 60) throw new Error("UC_TEST_PG_SOCKET_DIR is too long for a Unix socket path");
const dataDir = join(root, "uc-pg");
const logFile = join(root, "uc-pg.log");

// Never inherit PG*/DATABASE_URL variables: the cluster is reached only through explicit flags.
const env = {
  PATH: `${pgBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
  HOME: process.env.HOME ?? "/private/tmp",
  LC_ALL: "C",
  LANG: "C",
};

function bin(name) {
  const path = join(pgBin, name);
  return existsSync(path) ? path : name;
}

function run(name, args, { input, quiet = false } = {}) {
  const result = spawnSync(bin(name), args, { env, input, encoding: "utf8", stdio: input === undefined ? ["ignore", "pipe", "pipe"] : ["pipe", "pipe", "pipe"] });
  if (!quiet && result.stdout?.trim()) console.log(result.stdout.trim());
  if (result.status !== 0) {
    if (result.stderr?.trim()) console.error(result.stderr.trim());
    throw new Error(`${name} failed (exit ${result.status})`);
  }
  return result;
}

const pinned = ["-h", UC_TEST_HOST, "-p", String(UC_TEST_PORT), "-U", UC_TEST_USER];

function isRunning() {
  if (!existsSync(join(dataDir, "PG_VERSION"))) return false;
  return spawnSync(bin("pg_ctl"), ["-D", dataDir, "status"], { env, encoding: "utf8" }).status === 0;
}

function start() {
  if (isRunning()) return console.log(`PostgreSQL already running on ${UC_TEST_HOST}:${UC_TEST_PORT}`);
  mkdirSync(socketDir, { recursive: true });
  run("pg_ctl", ["-D", dataDir, "-l", logFile, "-w", "-t", "60", "start"]);
}

function stop() {
  if (!isRunning()) return console.log("PostgreSQL is not running");
  run("pg_ctl", ["-D", dataDir, "-m", "fast", "-w", "stop"]);
}

function applySql(file) {
  run("psql", [...pinned, "-d", UC_TEST_DB, "--no-psqlrc", "--single-transaction", "--set=ON_ERROR_STOP=1", "-q", "-f", file], { quiet: true });
}

function migrations() {
  return readdirSync(join(repoRoot, "drizzle"))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
}

function migrateUc() {
  const file = join(repoRoot, "drizzle", "0018_uc_casi_duso.sql");
  if (!existsSync(file)) throw new Error("drizzle/0018_uc_casi_duso.sql is missing: run scripts/uc-write-migration.ts");
  applySql(file);
  console.log("Applied 0018_uc_casi_duso.sql");
}

/** Hand-written idempotent migrations after 0018 (e.g. 0019_connettore_mcp.sql). */
function migrateLater() {
  for (const name of migrations()) {
    if (name < "0019") continue;
    applySql(join(repoRoot, "drizzle", name));
    console.log(`Applied ${name}`);
  }
}

if (command === "init") {
  if (existsSync(dataDir)) throw new Error(`${dataDir} already exists: reuse it with "start", or choose a new UC_TEST_ROOT`);
  mkdirSync(root, { recursive: true });
  run("initdb", ["-D", dataDir, "-U", UC_TEST_USER, "--auth=trust", "--encoding=UTF8", "--locale=C"], { quiet: true });
  appendFileSync(
    join(dataDir, "postgresql.conf"),
    `\n# Casi d'uso isolated harness\nlisten_addresses = '${UC_TEST_HOST}'\nport = ${UC_TEST_PORT}\nunix_socket_directories = '${socketDir}'\n`,
  );
  start();
  run("createdb", [...pinned, UC_TEST_DB]);
  for (const name of migrations()) {
    if (name >= "0018") continue;
    applySql(join(repoRoot, "drizzle", name));
    console.log(`Applied ${name}`);
  }
  // Twice on purpose: the uc migration and the later ones must be idempotent.
  migrateUc();
  migrateUc();
  migrateLater();
  migrateLater();
  console.log(`Ready: ${UC_TEST_DATABASE_URL}`);
} else if (command === "start") {
  start();
} else if (command === "stop") {
  stop();
} else if (command === "migrate") {
  migrateUc();
  migrateLater();
} else if (command === "status") {
  console.log(isRunning() ? `running on ${UC_TEST_HOST}:${UC_TEST_PORT} (data ${dataDir})` : `stopped (data ${dataDir})`);
}
