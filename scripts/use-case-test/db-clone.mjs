// One database per hub package, copied from the hub's model database
// (docs/use-case/PIANO-LAVORI.md §2.7 and §5.1), so packages tested in parallel never
// share rows. The copy is `CREATE DATABASE hub_<id> TEMPLATE <model>` on the hub's local
// cluster: same schema and data as the model, nothing else.
//
//   export UC_TEST_PG_PORT=55479 UC_TEST_PG_DB=unbundle_hub_test
//   node scripts/use-case-test/db-clone.mjs h2a              # creates hub_h2a
//   node scripts/use-case-test/db-clone.mjs h2a --replace    # drops hub_h2a and copies it again
//
// The model is UC_TEST_PG_DB (see scripts/uc-test/config.mjs). It never reads .env
// files, never uses DATABASE_URL or PG* variables, and every psql call is pinned to
// 127.0.0.1 and the hub's port. Only databases named hub_<id> are ever dropped.
// Optional: UC_TEST_PG_BIN (default /opt/homebrew/opt/postgresql@16/bin).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { UC_TEST_DB, UC_TEST_HOST, UC_TEST_PORT, UC_TEST_USER } from "../uc-test/config.mjs";

const args = process.argv.slice(2);
const replace = args.includes("--replace");
const unknown = args.filter((arg) => arg.startsWith("--") && arg !== "--replace");
const positional = args.filter((arg) => !arg.startsWith("--"));
if (unknown.length || positional.length !== 1) {
  console.error("Usage: node scripts/use-case-test/db-clone.mjs <package id, e.g. h2a> [--replace]");
  process.exit(2);
}

const id = positional[0];
if (!/^[a-z0-9][a-z0-9_]{0,39}$/.test(id)) throw new Error("The package id must be lowercase letters, digits or _ (e.g. h2a, conn)");
const target = `hub_${id}`;

// 55439 Learning, 55449 Casi d'uso, 55469 connector: their clusters are not the hub's.
if ([55439, 55449, 55469].includes(UC_TEST_PORT)) {
  throw new Error(`Port ${UC_TEST_PORT} is not the hub's cluster: set UC_TEST_PG_PORT (default for the hub: 55479)`);
}
if (UC_TEST_DB === target) throw new Error("The model and the copy must be different databases");
if (UC_TEST_DB.startsWith("hub_")) throw new Error(`Copy from the model database (e.g. unbundle_hub_test), not from ${UC_TEST_DB}`);

const pgBin = process.env.UC_TEST_PG_BIN || "/opt/homebrew/opt/postgresql@16/bin";
// Never inherit PG*/DATABASE_URL variables: the cluster is reached only through explicit flags.
const env = {
  PATH: `${pgBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
  HOME: process.env.HOME ?? "/private/tmp",
  LC_ALL: "C",
  LANG: "C",
};
const pinned = ["-h", UC_TEST_HOST, "-p", String(UC_TEST_PORT), "-U", UC_TEST_USER];

function bin(name) {
  const path = join(pgBin, name);
  return existsSync(path) ? path : name;
}

function run(name, argv) {
  const result = spawnSync(bin(name), argv, { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) {
    if (result.stderr?.trim()) console.error(result.stderr.trim());
    throw new Error(`${name} failed (exit ${result.status})`);
  }
  return result.stdout.trim();
}

// Both names are checked above and in config.mjs (lowercase letters, digits, _): safe as literals.
const exists = (name) =>
  run("psql", [...pinned, "-d", "postgres", "--no-psqlrc", "-tA", "-c", `SELECT 1 FROM pg_database WHERE datname = '${name}'`]) === "1";

if (!exists(UC_TEST_DB)) throw new Error(`Model database ${UC_TEST_DB} not found on ${UC_TEST_HOST}:${UC_TEST_PORT}: run scripts/uc-test/db-init.mjs init first`);
if (exists(target)) {
  if (!replace) throw new Error(`${target} already exists: reuse it, or pass --replace to copy it again from ${UC_TEST_DB}`);
  run("dropdb", [...pinned, "--force", target]);
  console.log(`Dropped ${target}`);
}
// Fails if someone is connected to the model: stop the app or the suites that use it.
run("createdb", [...pinned, "-T", UC_TEST_DB, target]);
console.log(`Ready: postgresql://${UC_TEST_USER}@${UC_TEST_HOST}:${UC_TEST_PORT}/${target} (copy of ${UC_TEST_DB})`);
console.log(`Suites: UC_TEST_PG_DB=${target} npm run test:use-cases:db`);
