// Local-only login helper for the Casi d'uso harness: 127.0.0.1:53112.
// GET /as/<account>[?to=/dashboard/…|/r/…] signs in to the Auth emulator, exchanges the
// real ID token at the app's POST /api/auth/session and redirects with the cookie.
// Never deploy this helper.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { UC_TEST_APP_PORT, UC_TEST_AUTH_PORT, UC_TEST_HOST, UC_TEST_LOGIN_PORT, ucTestRoot } from "./config.mjs";

const fixtures = JSON.parse(readFileSync(join(ucTestRoot(), "uc-fixtures", "synthetic-fixtures.json"), "utf8"));
const app = `http://${UC_TEST_HOST}:${UC_TEST_APP_PORT}`;

createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${UC_TEST_HOST}:${UC_TEST_LOGIN_PORT}`);
    const name = requestUrl.pathname.replace(/^\/as\//, "");
    const account = fixtures.accounts[name];
    if (!account || req.method !== "GET" || req.headers.host !== `${UC_TEST_HOST}:${UC_TEST_LOGIN_PORT}`) {
      res.writeHead(404);
      res.end();
      return;
    }
    const signIn = await fetch(`http://${UC_TEST_HOST}:${UC_TEST_AUTH_PORT}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local-only`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: account.email, password: account.password, returnSecureToken: true }),
    });
    const token = await signIn.json();
    if (!signIn.ok || !token.idToken) throw new Error("Emulator login failed");
    const session = await fetch(`${app}/api/auth/session`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: app },
      body: JSON.stringify({ idToken: token.idToken }),
    });
    const cookie = session.headers.get("set-cookie");
    if (!session.ok || !cookie?.startsWith("__session=")) throw new Error("The real session endpoint refused the synthetic ID token");
    const workspace = fixtures.workspaces[account.workspace];
    const to = requestUrl.searchParams.get("to");
    const target = to && /^\/(dashboard|r)\//.test(to) ? to : `/dashboard/${workspace.workspaceId}/casi-duso`;
    res.writeHead(302, { "set-cookie": cookie, location: `${app}${target}`, "cache-control": "no-store" });
    res.end();
  } catch {
    res.writeHead(502, { "content-type": "text/plain", "cache-control": "no-store" });
    res.end("Synthetic session could not be created. Check the local emulator and app logs.");
  }
}).listen(UC_TEST_LOGIN_PORT, UC_TEST_HOST, () => console.log(`Synthetic login helper on http://${UC_TEST_HOST}:${UC_TEST_LOGIN_PORT}/as/ls-lead`));
