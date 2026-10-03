import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const outputDirectory = process.env.LEARNING_TEST_OUTPUT;
if (!outputDirectory?.startsWith("/private/tmp/") && !outputDirectory?.startsWith("/tmp/")) throw new Error("Use a temporary fixture directory");
const fixtures = JSON.parse(await readFile(resolve(outputDirectory, "synthetic-fixtures.json"), "utf8"));
createServer(async (req, res) => {
  try {
    const name = new URL(req.url, "http://127.0.0.1:53102").pathname.replace(/^\/as\//, "");
    const account = fixtures.accounts[name];
    if (!account || req.method !== "GET" || req.headers.host !== "127.0.0.1:53102") { res.writeHead(404); res.end(); return; }
    const signIn = await fetch("http://127.0.0.1:59099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local-only", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: account.email, password: account.password, returnSecureToken: true }),
    });
    const token = await signIn.json();
    if (!signIn.ok || !token.idToken) throw new Error("Emulator login failed");
    const response = await fetch("http://127.0.0.1:53100/api/auth/session", {
      method: "POST", headers: { "content-type": "application/json", origin: "http://127.0.0.1:53100" },
      body: JSON.stringify({ idToken: token.idToken }),
    });
    const cookie = response.headers.get("set-cookie");
    if (!response.ok || !cookie?.startsWith("__session=")) throw new Error("Real session endpoint refused synthetic ID token");
    const target = fixtures.workspaces[name.startsWith("learner-b") ? "b" : "a"];
    const suffix = name === "reviewer-a" ? "/manage" : name === "sponsor-a" ? "/live" : "";
    res.writeHead(302, {
      "set-cookie": cookie,
      location: `http://127.0.0.1:53100/dashboard/${target.workspaceId}/learning/${target.programId}${suffix}`,
      "cache-control": "no-store",
    });
    res.end();
  } catch {
    res.writeHead(502, { "content-type": "text/plain", "cache-control": "no-store" });
    res.end("Synthetic session could not be created. Check the local emulator/app logs.");
  }
}).listen(53102, "127.0.0.1", () => console.log("Synthetic browser login helper on 127.0.0.1:53102/as/learner-a"));
