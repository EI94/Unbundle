// Firebase Auth emulator for the connector harness: 127.0.0.1:59129, project
// demo-unbundle-connector (scripts/connettore-test/auth-config.mjs). Synthetic accounts
// only, kept in memory; it never talks to Google.
//
//   FIREBASE_TOOLS_ROOT=/opt/homebrew/lib/node_modules/firebase-tools node scripts/connettore-test/start-auth.mjs
//
// Point FIREBASE_TOOLS_ROOT to the installed firebase-tools package, never to a service-account key.
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { CONNECTOR_AUTH_HOST, CONNECTOR_AUTH_PORT, CONNECTOR_AUTH_PROJECT } from "./auth-config.mjs";

const cliRoot = process.env.FIREBASE_TOOLS_ROOT;
if (!cliRoot) throw new Error("Set FIREBASE_TOOLS_ROOT to the installed firebase-tools package directory");
const requireFromCli = createRequire(resolve(cliRoot, "package.json"));
const { createApp } = requireFromCli("./lib/emulator/auth/server.js");
const app = await createApp(CONNECTOR_AUTH_PROJECT);
app.listen(CONNECTOR_AUTH_PORT, CONNECTOR_AUTH_HOST, () => {
  console.log(`Synthetic Firebase Auth emulator ready on ${CONNECTOR_AUTH_HOST}:${CONNECTOR_AUTH_PORT} (${CONNECTOR_AUTH_PROJECT})`);
});
