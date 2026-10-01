// Test transport only. The production Neon/Drizzle SQL and result parsers still run.
// This preload cannot connect to a non-loopback host or another database.
/* eslint-disable @typescript-eslint/no-require-imports -- Node --require preloads execute as CommonJS before Next starts. */
const { createRequire } = require("node:module");
const path = require("node:path");
const fs = require("node:fs");
const requireFromApp = createRequire(path.join(process.cwd(), "package.json"));
const { Pool } = requireFromApp("pg");
const databaseUrl = process.env.LEARNING_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("LEARNING_TEST_DATABASE_URL is required");
const url = new URL(databaseUrl);
if (url.hostname !== "127.0.0.1" || url.pathname !== "/unbundle_learning_test" || url.username !== "learning_test") {
  throw new Error("Local test adapter refuses non-test database");
}
const pool = new Pool({ connectionString: databaseUrl, max: 60, allowExitOnIdle: true });
// Optional, bounded faults for browser acceptance only. The fixed control path
// is outside Git; no application request, SQL text or response is written there.
const controlPath = "/private/tmp/unbundle-m1-evidence/transport-control.json";
const ackPath = "/private/tmp/unbundle-m1-evidence/transport-ack-started.json";
const unavailablePath = "/private/tmp/unbundle-m1-evidence/transport-unavailable.json";
function faultControl() {
  if (process.env.LEARNING_TEST_ISOLATED !== "true") return null;
  try {
    const stat = fs.lstatSync(controlPath);
    if (!stat.isFile() || stat.size > 4096) return null;
    const control = JSON.parse(fs.readFileSync(controlPath, "utf8"));
    if (control.mode === "delay-ack") {
      if (typeof control.attemptId !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(control.attemptId)) return null;
      const delayMs = control.delayMs ?? 5000;
      if (!Number.isInteger(delayMs) || delayMs < 1 || delayMs > 10000 || Date.now() - stat.mtimeMs > 60000) return null;
      return { mode: "delay-ack", attemptId: control.attemptId, delayMs };
    }
    if (control.mode === "unavailable") {
      const durationMs = control.durationMs ?? 60000;
      if (!Number.isInteger(durationMs) || durationMs < 1 || durationMs > 60000) return null;
      const expiresAt = stat.mtimeMs + durationMs;
      return Date.now() < expiresAt ? { mode: "unavailable", expiresAt } : null;
    }
  } catch { /* A missing or invalid control has no effect on the harness. */ }
  return null;
}
function claimDelayedAck(query) {
  const control = faultControl();
  if (control?.mode !== "delay-ack" || typeof query.query !== "string" || !Array.isArray(query.params)) return null;
  if (!/^\s*update\s+"?learning_attempts"?\s+set\b/i.test(query.query) || !/"?responses"?\s*=/i.test(query.query) || !query.params.includes(control.attemptId)) return null;
  // Rename claims the one-shot fault atomically even if Next has >1 worker.
  const claimedPath = `${controlPath}.claimed-${process.pid}`;
  try { fs.renameSync(controlPath, claimedPath); fs.unlinkSync(claimedPath); }
  catch { return null; }
  return control;
}
function wrapFetch(delegate) {
return async function localNeonFetch(input, init) {
  const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
  const connection = headers.get("Neon-Connection-String");
  if (!connection) return delegate(input, init);
  if (connection !== databaseUrl) throw new Error("Local test adapter rejected another database");
  const body = JSON.parse(init?.body || await input.text());
  const fault = faultControl();
  if (fault?.mode === "unavailable") {
    fs.writeFileSync(unavailablePath, JSON.stringify({ mode: fault.mode, observedAt: new Date().toISOString(), expiresAt: new Date(fault.expiresAt).toISOString() }));
    throw new Error("Local test database transport unavailable (injected)");
  }
  const client = await pool.connect();
  let delayedAck = null;
  const run = async (query) => {
    const requestedDelay = claimDelayedAck(query);
    const result = await client.query({
      text: query.query,
      values: query.params,
      rowMode: "array",
      types: { getTypeParser: () => (value) => value },
    });
    const row = Array.isArray(result) ? result[result.length - 1] : result;
    if (requestedDelay && row.rowCount > 0) delayedAck = requestedDelay;
    return {
      command: row.command, rowCount: row.rowCount, rows: row.rows,
      fields: row.fields.map((field) => ({ name: field.name, dataTypeID: field.dataTypeID })),
    };
  };
  try {
    let result;
    if (body.queries) {
      await client.query("BEGIN");
      result = { results: [] };
      for (const query of body.queries) result.results.push(await run(query));
      await client.query("COMMIT");
    } else result = await run(body);
    if (delayedAck) {
      // The real query has committed before the ACK is held. Never fabricate a
      // successful result: constraint errors and zero-row updates are unchanged.
      const marker = { ...delayedAck, committed: true, startedAt: new Date().toISOString() };
      fs.writeFileSync(ackPath, JSON.stringify(marker));
      await new Promise((resolve) => setTimeout(resolve, delayedAck.delayMs));
      fs.writeFileSync(ackPath, JSON.stringify({ ...marker, releasedAt: new Date().toISOString() }));
    }
    return Response.json(result);
  } catch (error) {
    if (body.queries) await client.query("ROLLBACK");
    return Response.json({
      message: error.message, code: error.code, severity: error.severity,
      detail: error.detail, constraint: error.constraint,
    }, { status: 400 });
  } finally {
    client.release();
  }
};
}
// Next installs its own fetch wrapper during startup and HMR. Keep the local
// transport around each replacement, preserving its behavior for other fetches.
let activeFetch = wrapFetch(globalThis.fetch);
Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  get: () => activeFetch,
  set: (nextFetch) => { activeFetch = wrapFetch(nextFetch); },
});
