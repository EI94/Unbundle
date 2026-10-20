// Starts Next for the Claude connector smoke on 127.0.0.1:53130 (docs/connettore/README.md),
// against the connector's local test cluster. The ports 53110 (Casi d'uso) and 53120
// (hub) belong to other harnesses and are never used here.
//
//   node scripts/connettore-test/start-app.mjs --build        # next build
//   node scripts/connettore-test/start-app.mjs --production   # next start on 127.0.0.1:53130
//   node scripts/connettore-test/start-app.mjs --production --auth-emulator   # sign-in through the local emulator
//
// Run it from a checkout WITHOUT .env* files: Next loads them on its own.
//
// Database: postgresql://uc_test@127.0.0.1:<UC_TEST_PG_PORT>/<UC_TEST_PG_DB> (defaults
// 55469 and unbundle_conn_test), reached through the scripts/uc-test/local-neon.cjs
// preload, which refuses any other database. Same environment allowlist as
// scripts/uc-test/start-app.mjs: no provider keys (no model call, no email, no Slack),
// secrets generated in memory for this process only.
//
// Connector switch: MCP_CONNECTOR_ENABLED=true. The client profile and the template of the
// server instructions are per workspace, in workspace_connector_configs (decision 1 of stop
// B, package K8): load them into the workspace row (scripts/connector-admin.ts profile, or
// scripts/connettore-test/smoke-run.mjs for the smoke). A workspace without them gets 500.
//
// --auth-emulator points Firebase Admin to the connector's Auth emulator
// (scripts/connettore-test/start-auth.mjs, 127.0.0.1:59129, project demo-unbundle-connector),
// so that synthetic accounts can sign in and the dashboard pages can be captured
// (scripts/connettore-test/screens.mjs). Without it no session can be created.
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { CONNECTOR_APP_HOST, CONNECTOR_APP_PORT, CONNECTOR_AUTH_HOST, CONNECTOR_AUTH_PORT, CONNECTOR_AUTH_PROJECT } from "./auth-config.mjs";

if (readdirSync(process.cwd()).some((name) => /^\.env($|\.)/.test(name))) {
  throw new Error("Run the connector app in a checkout without .env files; Next loads them independently");
}

const args = process.argv.slice(2);
const MODES = ["--build", "--production"];
let mode = null;
let authEmulator = false;
for (let i = 0; i < args.length; i++) {
  if (MODES.includes(args[i])) {
    if (mode) throw new Error("Only one mode at a time");
    mode = args[i];
  } else if (args[i] === "--auth-emulator") {
    authEmulator = true;
  } else {
    throw new Error(`Unknown option ${args[i]}. Use ${MODES.join(" or ")}, optionally --auth-emulator`);
  }
}
if (!mode) throw new Error(`Choose ${MODES.join(" or ")}`);

const port = process.env.UC_TEST_PG_PORT?.trim() || "55469";
const db = process.env.UC_TEST_PG_DB?.trim() || "unbundle_conn_test";
if (!/^\d+$/.test(port) || ["55439", "55449", "55479"].includes(port)) throw new Error("Use the connector's own test cluster port (default 55469)");
if (!/^[a-z_][a-z0-9_]{2,62}$/.test(db)) throw new Error("UC_TEST_PG_DB must be a plain lowercase database name");
const databaseUrl = `postgresql://uc_test@127.0.0.1:${port}/${db}`;

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const secret = () => randomBytes(32).toString("base64");

// Do not inherit provider keys or URLs from the caller's environment.
const env = Object.fromEntries(
  ["PATH", "TMPDIR", "LANG", "LC_ALL", "SHELL", "USER", "HOME"].filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]])
);
Object.assign(env, {
  DATABASE_URL: databaseUrl,
  UC_TEST_DATABASE_URL: databaseUrl,
  UC_TEST_PG_PORT: port,
  UC_TEST_PG_DB: db,
  UC_TEST_ISOLATED: "true",
  NEXT_PUBLIC_FIREBASE_API_KEY: "AIzaSyLocalConnectorTestOnlyNotARealKey",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: CONNECTOR_AUTH_PROJECT,
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "localhost",
  FIREBASE_ADMIN_CLIENT_EMAIL: "local-test@demo-unbundle-connector.iam.gserviceaccount.com",
  FIREBASE_ADMIN_PRIVATE_KEY: privateKey,
  NEXT_PUBLIC_APP_URL: `http://${CONNECTOR_APP_HOST}:${CONNECTOR_APP_PORT}`,
  NEXT_TELEMETRY_DISABLED: "1",
  UC_SECRET: secret(),
  UC_PERSONAL_ZONE_KEY: secret(),
  CRON_SECRET: secret(),
  NODE_OPTIONS: `--require=${resolve("scripts/uc-test/local-neon.cjs")}`,
  MCP_CONNECTOR_ENABLED: "true",
});
if (authEmulator) env.FIREBASE_AUTH_EMULATOR_HOST = `${CONNECTOR_AUTH_HOST}:${CONNECTOR_AUTH_PORT}`;

console.log(
  `Connector app: ${mode.slice(2)} on ${CONNECTOR_APP_HOST}:${CONNECTOR_APP_PORT}; database: ${databaseUrl}; MCP_CONNECTOR_ENABLED=true; profile: per workspace, in the database; sign-in: ${authEmulator ? `Auth emulator ${CONNECTOR_AUTH_HOST}:${CONNECTOR_AUTH_PORT}` : "none"}`
);

const command = mode === "--build" ? ["build"] : ["start", "--hostname", CONNECTOR_APP_HOST, "--port", String(CONNECTOR_APP_PORT)];
const child = spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), ...command], { cwd: process.cwd(), env, stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 1));
