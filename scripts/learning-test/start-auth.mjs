import { createRequire } from "node:module";
import { resolve } from "node:path";

// Point to an installed Firebase CLI package, never a service-account key.
const cliRoot = process.env.FIREBASE_TOOLS_ROOT;
if (!cliRoot) throw new Error("Set FIREBASE_TOOLS_ROOT to the installed firebase-tools package directory");
const requireFromCli = createRequire(resolve(cliRoot, "package.json"));
const { createApp } = requireFromCli("./lib/emulator/auth/server.js");
const app = await createApp("demo-unbundle-learning");
app.listen(59099, "127.0.0.1", () => {
  console.log("Synthetic Firebase Auth emulator ready on 127.0.0.1:59099");
});
