import test from "node:test";
import assert from "node:assert/strict";
import { areaForPath, digestOf, errorCodeOf, idsFromPath, pgCodeOf, redactUcPath, timeUc, ucLog, ucLogError, ucLogLine, type UcLogLevel } from "./log.ts";

const WS = "0f8e2a64-1b7c-4d3e-9a5f-6c2b1d0e9f8a";
const CASE = "7c1d9e2f-3a4b-4c5d-8e6f-0a1b2c3d4e5f";
const TOKEN = "Zk3v9QpL2mN8xR4tY7uW1aB5cD6eF0gH";

function capture() {
  const lines: { level: UcLogLevel; text: string }[] = [];
  return { lines, sink: (level: UcLogLevel, text: string) => lines.push({ level, text }) };
}

test("the personal link token never reaches the log", () => {
  assert.equal(redactUcPath(`/r/${TOKEN}`), "/r/[token]");
  assert.equal(redactUcPath(`/r/${TOKEN}?apri=1#fine`), "/r/[token]");
  assert.equal(redactUcPath(`/api/r/${TOKEN}/answers`), "/api/r/[token]/answers");
  assert.equal(redactUcPath(`/api/r/${TOKEN}/files/upload-token`), "/api/r/[token]/files/upload-token");
  // Even a short token is a token on these routes.
  assert.equal(redactUcPath("/r/abc"), "/r/[token]");
  assert.equal(redactUcPath(`https://www.example.test/r/${TOKEN}?x=1`), "/r/[token]");
  // Not a link route: only the shape of the path decides.
  assert.equal(redactUcPath(`/dashboard/${WS}/casi-duso/${CASE}/domande`), `/dashboard/${WS}/casi-duso/${CASE}/domande`);
  assert.equal(redactUcPath("/dashboard/r/visible"), "/dashboard/r/visible");
});

test("queries, emails and opaque segments are dropped from any path", () => {
  assert.equal(redactUcPath("/api/mcp/casi/cases?token=ub_mcp_segreto"), "/api/mcp/casi/cases");
  assert.equal(redactUcPath("/share/portfolio/persona@cliente.test/x"), "/share/portfolio/[redatto]/x");
  assert.equal(redactUcPath("/share/portfolio/persona%40cliente.test/x"), "/share/portfolio/[redatto]/x");
  assert.equal(redactUcPath(`/join/${TOKEN}`), "/join/[redatto]");
  assert.equal(redactUcPath(`/dashboard/${WS}`), `/dashboard/${WS}`);
  assert.equal(redactUcPath(""), "/");
  assert.equal(redactUcPath(undefined), "/");
});

test("area and ids come from the path shape", () => {
  assert.equal(areaForPath("/r/[token]"), "uc.r");
  assert.equal(areaForPath("/api/r/[token]/answers"), "uc.r");
  assert.equal(areaForPath("/api/mcp/casi/cases"), "uc.mcp");
  assert.equal(areaForPath("/api/cron/uc-reminders"), "uc.cron");
  assert.equal(areaForPath(`/dashboard/${WS}/casi-duso/${CASE}`), "uc");
  assert.equal(areaForPath(`/dashboard/${WS}/portfolio`), "app");
  assert.equal(areaForPath("/api/mcp/portfolio/requirements"), "app");
  assert.deepEqual(idsFromPath(`/dashboard/${WS.toUpperCase()}/casi-duso/${CASE}/via`), { workspaceId: WS, caseId: CASE });
  assert.deepEqual(idsFromPath(`/dashboard/${WS}/use-cases`), { workspaceId: WS });
  assert.deepEqual(idsFromPath("/dashboard/non-un-id/casi-duso/altro"), {});
  assert.deepEqual(idsFromPath("/r/[token]"), {});
});

test("an error leaves its code, SQLSTATE and digest, never its message", () => {
  const pg = Object.assign(new Error("duplicate key value violates unique constraint (persona@cliente.test)"), { code: "23505" });
  assert.equal(pgCodeOf(pg), "23505");
  assert.equal(errorCodeOf(pg), "Error");
  assert.equal(pgCodeOf(new Error("x", { cause: { code: "42P01" } })), "42P01");
  assert.equal(pgCodeOf({ code: "ECONNREFUSED" }), undefined);
  assert.equal(errorCodeOf(Object.assign(new Error("Sezione non disponibile."), { name: "UcAccessError", code: "non_disponibile" })), "non_disponibile");
  assert.equal(errorCodeOf(new Error("uc:conflitto")), "conflitto");
  assert.equal(errorCodeOf(new TypeError("valore segreto")), "TypeError");
  assert.equal(errorCodeOf("stringa"), "errore");
  assert.equal(digestOf(Object.assign(new Error("x"), { digest: "1234567890" })), "1234567890");
  assert.equal(digestOf(Object.assign(new Error("x"), { digest: "con spazi e @" })), undefined);

  const { lines, sink } = capture();
  ucLogError({ area: "uc", op: "accesso", workspaceId: WS, caseId: CASE, route: `/r/${TOKEN}` }, Object.assign(pg, { digest: "42" }), sink);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].level, "error");
  const parsed = JSON.parse(lines[0].text);
  assert.deepEqual(parsed, { level: "error", area: "uc", op: "accesso", code: "Error", pgCode: "23505", digest: "42", workspaceId: WS, caseId: CASE, route: "/r/[token]" });
  assert.ok(!lines[0].text.includes("cliente.test"));
  assert.ok(!lines[0].text.includes(TOKEN));
});

test("every field is filtered: only short codes, uuids and numbers", () => {
  const line = ucLogLine({
    level: "warn",
    area: "uc mcp con spazi",
    op: "persona@cliente.test",
    code: "x".repeat(200),
    pgCode: "abc",
    digest: "ok_1",
    workspaceId: "non-un-id",
    caseId: CASE.toUpperCase(),
    durationMs: 12.6,
    route: `/api/r/${TOKEN}`,
  });
  assert.deepEqual(line, { level: "warn", area: "uc", op: "altro", digest: "ok_1", caseId: CASE, durationMs: 13, route: "/api/r/[token]" });
  assert.deepEqual(ucLogLine({ level: "info", area: "uc", op: "x", durationMs: -1 }), { level: "info", area: "uc", op: "x" });
  assert.deepEqual(ucLogLine({ level: "debug" as UcLogLevel, area: "uc", op: "x", durationMs: Number.NaN }), { level: "info", area: "uc", op: "x" });
});

test("one JSON line per event on the console level of the entry", () => {
  const { lines, sink } = capture();
  ucLog({ level: "info", area: "uc.cron", op: "uc-reminders", durationMs: 5 }, sink);
  ucLog({ level: "warn", area: "uc.schema", op: "sonda", code: "schema_non_aggiornato" }, sink);
  assert.deepEqual(
    lines.map((l) => l.level),
    ["info", "warn"],
  );
  for (const l of lines) assert.ok(!l.text.includes("\n"));
});

test("loader timing: info with the duration, error with the code, and the error goes on", async () => {
  const { lines, sink } = capture();
  let t = 100;
  const now = () => (t += 40);
  assert.equal(await timeUc({ area: "uc.mcp", op: "get_gate_status", workspaceId: WS }, async () => "ok", { sink, now }), "ok");
  await assert.rejects(
    timeUc({ area: "uc.mcp", op: "get_gate_status" }, async () => {
      throw Object.assign(new Error("valore 42 riservato"), { code: "57014" });
    }, { sink, now }),
    /riservato/,
  );
  assert.deepEqual(JSON.parse(lines[0].text), { level: "info", area: "uc.mcp", op: "get_gate_status", workspaceId: WS, durationMs: 40 });
  assert.deepEqual(JSON.parse(lines[1].text), { level: "error", area: "uc.mcp", op: "get_gate_status", code: "Error", pgCode: "57014", durationMs: 40 });
  assert.ok(!lines[1].text.includes("riservato"));
});
