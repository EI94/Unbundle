// Starts Next for the Casi d'uso harness on 127.0.0.1:53110 (PIANO §9.2).
// Run it from a checkout WITHOUT .env* files: Next loads them on its own.
//
//   UC_TEST_ROOT=/private/tmp/<dir> node scripts/uc-test/start-app.mjs                # next dev --webpack
//   UC_TEST_ROOT=/private/tmp/<dir> node scripts/uc-test/start-app.mjs --build        # next build
//   UC_TEST_ROOT=/private/tmp/<dir> node scripts/uc-test/start-app.mjs --production   # next start
//   UC_TEST_ROOT=/private/tmp/<dir> node scripts/uc-test/start-app.mjs --uc-disabled  # next start, UC_ENABLED off
//
// Switches for the app, from a closed list (docs/use-case/PIANO-LAVORI.md §3.4), repeatable
// and combinable with one mode above:
//
//   --flag UC_WORKSPACE_IDS=<uuid>[,<uuid>…]       default «*»: every workspace, as before the switch
//   --flag USE_CASE_HUB_WORKSPACES=<uuid>[,<uuid>…]  unset by default (area off)
//   --flag MCP_CONNECTOR_ENABLED=true               unset by default
//   --flag MCP_TEAM_ENABLED=true                    unset by default
//
// `--flag NAME=` passes an empty value (for UC_WORKSPACE_IDS: section off everywhere). Any
// other name is refused. Packages after C0 pass switches with --flag and never edit this file.
//
// The environment is an allowlist: no provider keys, no RESEND_API_KEY (notifications stay
// «in coda»), no BLOB_READ_WRITE_TOKEN (files go to UC_LOCAL_STORAGE_DIR). Secrets are
// generated in memory for this process only.
//
// The harness database selectors UC_TEST_PG_PORT and UC_TEST_PG_DB, when set, reach the app
// too: the local-neon.cjs preload inside Next reads them to accept another loopback test
// cluster (the hub on 55479, the connector on 55469). They pick a test database, they are not
// app switches, so they stay off the --flag list.
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  UC_TEST_APP_PORT,
  UC_TEST_AUTH_PORT,
  UC_TEST_AUTH_PROJECT,
  UC_TEST_DATABASE_URL,
  UC_TEST_HOST,
  UC_TEST_LS_DOMAIN,
  ucTestRoot,
} from "./config.mjs";

if (readdirSync(process.cwd()).some((name) => /^\.env($|\.)/.test(name))) {
  throw new Error("Run the isolated harness in a checkout without .env files; Next loads them independently");
}
const MODES = ["--build", "--production", "--uc-disabled"];
// Closed list: nothing else reaches the app through --flag.
const FLAGS = ["UC_WORKSPACE_IDS", "USE_CASE_HUB_WORKSPACES", "MCP_CONNECTOR_ENABLED", "MCP_TEAM_ENABLED"];
const usage = `Use no mode for dev or one of ${MODES.join(", ")}, plus any --flag NAME=value with NAME in ${FLAGS.join(", ")}`;

function parseOptions(args) {
  let mode = "--dev";
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (MODES.includes(arg)) {
      if (mode !== "--dev") throw new Error(`Only one mode at a time. ${usage}`);
      mode = arg;
      continue;
    }
    if (arg === "--flag" || arg.startsWith("--flag=")) {
      const spec = arg === "--flag" ? args[++i] : arg.slice("--flag=".length);
      const eq = typeof spec === "string" ? spec.indexOf("=") : -1;
      if (eq <= 0) throw new Error(`--flag needs NAME=value. ${usage}`);
      const name = spec.slice(0, eq);
      const value = spec.slice(eq + 1);
      if (!FLAGS.includes(name)) throw new Error(`--flag ${name} is not allowed. ${usage}`);
      if (Object.hasOwn(flags, name)) throw new Error(`--flag ${name} given twice`);
      if (/[\0\r\n]/.test(value)) throw new Error(`--flag ${name}: the value cannot contain control characters`);
      flags[name] = value;
      continue;
    }
    throw new Error(`Unknown option ${arg}. ${usage}`);
  }
  return { mode, flags };
}

const { mode, flags } = parseOptions(process.argv.slice(2));
const root = ucTestRoot();
const storageDir = join(root, "uc-blob");
mkdirSync(storageDir, { recursive: true });

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const secret = () => randomBytes(32).toString("base64");

// Do not inherit provider keys or URLs from the caller's environment.
const env = Object.fromEntries(
  ["PATH", "TMPDIR", "LANG", "LC_ALL", "SHELL", "USER", "HOME"].filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]),
);
Object.assign(env, {
  DATABASE_URL: UC_TEST_DATABASE_URL,
  UC_TEST_DATABASE_URL,
  UC_TEST_ISOLATED: "true",
  FIREBASE_AUTH_EMULATOR_HOST: `${UC_TEST_HOST}:${UC_TEST_AUTH_PORT}`,
  NEXT_PUBLIC_FIREBASE_API_KEY: "AIzaSyLocalUcTestOnlyNotARealApiKey",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: UC_TEST_AUTH_PROJECT,
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "localhost",
  FIREBASE_ADMIN_CLIENT_EMAIL: `local-test@${UC_TEST_AUTH_PROJECT}.iam.gserviceaccount.com`,
  FIREBASE_ADMIN_PRIVATE_KEY: privateKey,
  NEXT_PUBLIC_APP_URL: `http://${UC_TEST_HOST}:${UC_TEST_APP_PORT}`,
  NEXT_TELEMETRY_DISABLED: "1",
  UC_LS_EMAIL_DOMAINS: UC_TEST_LS_DOMAIN,
  UC_SECRET: secret(),
  UC_PERSONAL_ZONE_KEY: secret(),
  CRON_SECRET: secret(),
  UC_LOCAL_STORAGE_DIR: storageDir,
  NODE_OPTIONS: `--require=${resolve("scripts/uc-test/local-neon.cjs")}`,
});
// Harness database selectors, forwarded as given (config.mjs and local-neon.cjs validate them).
const DB_SELECTORS = ["UC_TEST_PG_PORT", "UC_TEST_PG_DB"];
for (const key of DB_SELECTORS) {
  const value = process.env[key]?.trim();
  if (!value) continue;
  if (/[\0\r\n]/.test(value)) throw new Error(`${key}: the value cannot contain control characters`);
  env[key] = value;
}
if (mode !== "--uc-disabled") env.UC_ENABLED = "true";
// Per-workspace switch of the dossiers (DESIGN §7.1 P0-1): every workspace unless told
// otherwise, so the harness behaves as before the switch existed.
env.UC_WORKSPACE_IDS = "*";
Object.assign(env, flags);
const shown = FLAGS.filter((name) => env[name] !== undefined).map((name) => `${name}=${env[name] === "" ? "(empty)" : env[name]}`);
const selectors = DB_SELECTORS.filter((key) => env[key] !== undefined).map((key) => `${key}=${env[key]}`);
console.log(
  `Harness app: ${mode.slice(2)} on ${UC_TEST_HOST}:${UC_TEST_APP_PORT}; database: ${UC_TEST_DATABASE_URL}${selectors.length ? ` (${selectors.join(" ")})` : ""}; switches: ${shown.join(" ") || "none"}`,
);

const command =
  mode === "--build"
    ? ["build"]
    : mode === "--dev"
      ? ["dev", "--webpack", "--hostname", UC_TEST_HOST, "--port", String(UC_TEST_APP_PORT)]
      : ["start", "--hostname", UC_TEST_HOST, "--port", String(UC_TEST_APP_PORT)];
const child = spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), ...command], { cwd: process.cwd(), env, stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 1));
