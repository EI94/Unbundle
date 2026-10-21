// Integration tests of the Claude connector work (WP1, WP2, WP4…) on the connector's own
// local test cluster (docs/connettore/README.md). Clean environment: only PATH, HOME
// and the loopback test database; no .env file, no API key, no remote host.
//
//   node scripts/connettore-test/run-db-tests.mjs          # or: npm run test:connector:db
//
// Optional: UC_TEST_PG_PORT (default 55469), UC_TEST_PG_DB (default unbundle_conn_test).
// Start the cluster first: see docs/connettore/README.md («Database locale»).
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const port = process.env.UC_TEST_PG_PORT?.trim() || "55469";
const db = process.env.UC_TEST_PG_DB?.trim() || "unbundle_conn_test";
if (!/^\d+$/.test(port) || ["55439", "55449"].includes(port)) throw new Error("Use the connector's own test cluster port (default 55469)");
if (!/^[a-z_][a-z0-9_]{2,62}$/.test(db)) throw new Error("UC_TEST_PG_DB must be a plain lowercase database name");
const url = `postgresql://uc_test@127.0.0.1:${port}/${db}`;
// Globs read by the Node test runner itself: later packages add their suites under
// src/lib/portfolio/ or src/lib/connector/ without touching this list (the portfolio ones
// are the shared submission service and «Partecipazione per area»).
const files = ["src/lib/portfolio/*.integration.test.ts", "src/lib/connector/**/*.integration.test.ts"];

const result = spawnSync(process.execPath, ["--no-warnings", "--test", "--test-concurrency=1", ...files], {
  cwd: repoRoot,
  stdio: "inherit",
  env: {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: process.env.HOME ?? "/private/tmp",
    NODE_OPTIONS: "--import=./scripts/connettore-test/app-resolve.mjs --require=./scripts/uc-test/local-neon.cjs",
    DATABASE_URL: url,
    UC_TEST_DATABASE_URL: url,
    UC_TEST_PG_PORT: port,
    UC_TEST_PG_DB: db,
    CONN_TEST_ISOLATED: "true",
  },
});
process.exit(result.status ?? 1);
