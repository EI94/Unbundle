// Firebase Auth emulator for the Casi d'uso harness: 127.0.0.1:59109, project demo-unbundle-uc.
// Point FIREBASE_TOOLS_ROOT to the installed firebase-tools package, never to a service-account key.
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { UC_TEST_AUTH_PORT, UC_TEST_AUTH_PROJECT, UC_TEST_HOST } from "./config.mjs";

const cliRoot = process.env.FIREBASE_TOOLS_ROOT;
if (!cliRoot) throw new Error("Set FIREBASE_TOOLS_ROOT to the installed firebase-tools package directory");
const requireFromCli = createRequire(resolve(cliRoot, "package.json"));
const { createApp } = requireFromCli("./lib/emulator/auth/server.js");
const app = await createApp(UC_TEST_AUTH_PROJECT);
app.listen(UC_TEST_AUTH_PORT, UC_TEST_HOST, () => {
  console.log(`Synthetic Firebase Auth emulator ready on ${UC_TEST_HOST}:${UC_TEST_AUTH_PORT} (${UC_TEST_AUTH_PROJECT})`);
});
