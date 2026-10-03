import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Read-only integration probe. No real identity, Firebase SDK, DB or credentials.
const args = process.argv.slice(2);
let requestedOrigin = "http://localhost:53110";
let explicitOrigin = false;
let authorizedRemote = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--base-url" && args[i + 1]) {
    requestedOrigin = args[++i]; explicitOrigin = true;
  } else if (args[i] === "--confirm-authorized") authorizedRemote = true;
  else throw new Error("Use --base-url ORIGIN; non-local targets also require --confirm-authorized.");
}
const parsedOrigin = new URL(requestedOrigin);
assert.ok(["http:", "https:"].includes(parsedOrigin.protocol));
assert.equal(parsedOrigin.username, ""); assert.equal(parsedOrigin.password, "");
assert.equal(parsedOrigin.pathname, "/"); assert.equal(parsedOrigin.search, ""); assert.equal(parsedOrigin.hash, "");
const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsedOrigin.hostname);
assert.ok(local || (explicitOrigin && authorizedRemote), "A remote target requires an explicit origin and authorization flag.");
const origin = parsedOrigin.origin;
const path = "/dashboard/00000000-0000-4000-8000-000000000001/learning/00000000-0000-4000-8000-000000000002/activities/m1-check";
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const invalidCookie = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ exp: Math.floor(Date.now() / 1000) + 3600, sub: "synthetic-rejected-cookie" })}.invalid-test-signature`;
const results = [];
async function request(url, headers = {}) {
  return fetch(url, { headers, redirect: "manual", signal: AbortSignal.timeout(20000) });
}
async function redirectTarget(headers = {}) {
  const response = await request(origin + path, headers);
  const html = await response.text();
  const location = response.headers.get("location") ?? html.match(/http-equiv="refresh" content="[^;]*;url=([^\"]+)/i)?.[1]?.replaceAll("&amp;", "&");
  return { status: response.status, target: location ? new URL(location, origin) : null };
}
async function check(name, run) {
  try { await run(); results.push({ name, status: "PASS" }); }
  catch (error) { results.push({ name, status: "FAIL", reason: error.message.slice(0, 400) }); }
}
await check("anonymous deep link retains callback without stale marker", async () => {
  const { status, target } = await redirectTarget();
  assert.equal(status, 307); assert.equal(target?.origin, origin); assert.equal(target.pathname, "/login");
  assert.equal(target.searchParams.get("callbackUrl"), path); assert.equal(target.searchParams.has("session"), false);
});
await check("rejected nonexpired cookie retains callback and stale marker", async () => {
  const { target } = await redirectTarget({ cookie: "__session=" + invalidCookie });
  assert.equal(target?.origin, origin); assert.equal(target.pathname, "/login");
  assert.equal(target.searchParams.get("session"), "stale"); assert.equal(target.searchParams.get("callbackUrl"), path);
});
for (const [label, injected] of [["absolute external", "https://attacker.invalid/elsewhere"], ["protocol relative", "//attacker.invalid/path"], ["different internal", "/dashboard/unrelated"]]) {
  await check(`proxy replaces ${label} caller pathname header`, async () => {
    const { target } = await redirectTarget({ cookie: "__session=" + invalidCookie, "x-unbundle-pathname": injected });
    assert.equal(target?.origin, origin); assert.equal(target.pathname, "/login"); assert.equal(target.searchParams.get("callbackUrl"), path);
  });
}
await check("stale login clears invalid cookie and serves form without loop", async () => {
  const response = await request(origin + "/login?session=stale&callbackUrl=" + encodeURIComponent(path), { cookie: "__session=" + invalidCookie });
  assert.equal(response.status, 200); assert.equal(response.headers.get("location"), null);
  assert.match(response.headers.get("set-cookie") ?? "", /__session=;/); assert.match(await response.text(), /id="email"/);
});
await check("anonymous ordinary login remains available", async () => {
  const response = await request(origin + "/login"); assert.equal(response.status, 200);
  assert.equal(response.headers.get("location"), null); assert.match(await response.text(), /id="email"/);
});
const report = { timestamp: new Date().toISOString(), origin, probePath: path, scope: "GET-only requests; fake rejected cookie, no real identities, login, database writes or provider mutation", results, passed: results.filter(r => r.status === "PASS").length, failed: results.filter(r => r.status === "FAIL").length };
const directory = await mkdtemp(join(tmpdir(), "unbundle-auth-callback-"));
const receipt = join(directory, "result.json");
await writeFile(receipt, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
console.log(JSON.stringify({ passed: report.passed, failed: report.failed, receipt, results }));
if (report.failed) process.exitCode = 1;
