import { generateKeyPairSync } from "node:crypto";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { readdir } from "node:fs/promises";

if ((await readdir(process.cwd())).some((name) => /^\.env($|\.)/.test(name))) {
  throw new Error("Run the isolated harness in a checkout without .env files; Next loads them independently");
}
const options = process.argv.slice(2);
if (options.some((option) => !["--build", "--production", "--disabled"].includes(option)) || options.length > 1) {
  throw new Error("Use no option for dev, --build for a production build, --production for next start, or --disabled for the flag-off probe on 53103");
}
const port = options[0] === "--disabled" ? "53103" : "53100";

const databaseUrl = "postgresql://learning_test@127.0.0.1:55439/unbundle_learning_test";
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
// Do not inherit provider keys or URLs from the caller's environment.
const env = Object.fromEntries(["PATH", "TMPDIR", "LANG", "LC_ALL", "SHELL", "USER", "HOME"]
  .filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
Object.assign(env, {
  DATABASE_URL: databaseUrl, LEARNING_TEST_DATABASE_URL: databaseUrl,
  LEARNING_TEST_ISOLATED: "true",
  FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:59099",
  NEXT_PUBLIC_FIREBASE_API_KEY: "AIzaSyLocalTestOnlyNotARealApiKey",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-unbundle-learning",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "localhost",
  FIREBASE_ADMIN_CLIENT_EMAIL: "local-test@demo-unbundle-learning.iam.gserviceaccount.com",
  FIREBASE_ADMIN_PRIVATE_KEY: privateKey,
  NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${port}`,
  NEXT_TELEMETRY_DISABLED: "1",
  LEARNING_ENABLED: options[0] === "--disabled" ? "false" : "true",
  NODE_OPTIONS: `--require=${resolve("scripts/learning-test/local-neon.cjs")}`,
});
const command = options[0] === "--build" ? ["build"]
  : ["--production", "--disabled"].includes(options[0]) ? ["start", "--hostname", "127.0.0.1", "--port", port]
  : ["dev", "--webpack", "--hostname", "127.0.0.1", "--port", port];
const child = spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), ...command], {
  cwd: process.cwd(), env, stdio: "inherit",
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 1));
