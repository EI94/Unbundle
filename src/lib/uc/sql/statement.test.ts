import test from "node:test";
import assert from "node:assert/strict";
import { cast, ident, join, jsonb, raw, ref, requireRows, toStatement, ucSql } from "./statement.ts";
import { requestLiveSql, requestVisibleSql } from "./requests.ts";

test("values become numbered parameters, nested fragments keep their order", () => {
  const inner = ucSql`status = ${"validata"}`;
  const s = toStatement(ucSql`SELECT 1 FROM uc_items WHERE id = ${cast("x", "uuid")} AND ${inner} AND payload = ${jsonb({ a: 1 })}`);
  assert.equal(s.text, "SELECT 1 FROM uc_items WHERE id = $1::uuid AND status = $2 AND payload = $3::jsonb");
  assert.deepEqual(s.params, ["x", "validata", '{"a":1}']);
});

test("undefined becomes null and strings never reach the SQL text", () => {
  const evil = "'; DROP TABLE uc_items; --";
  const s = toStatement(ucSql`SELECT ${evil}, ${undefined}`);
  assert.equal(s.text, "SELECT $1, $2");
  assert.deepEqual(s.params, [evil, null]);
});

test("identifiers and references are validated", () => {
  assert.equal(toStatement(ident("uc_items")).text, '"uc_items"');
  assert.throws(() => ident("uc_items; drop"));
  assert.throws(() => ident("Upper"));
  assert.equal(toStatement(ref("c.status")).text, "c.status");
  assert.throws(() => ref("c.status OR 1=1"));
});

test("join uses a constant separator", () => {
  const s = toStatement(join([ucSql`${1}`, ucSql`${2}`, raw("3")], " + "));
  assert.equal(s.text, "$1 + $2 + 3");
  assert.deepEqual(s.params, [1, 2]);
});

test("requireRows wraps a CAS in uc_require with the expected row count", () => {
  const s = toStatement(requireRows(ucSql`UPDATE uc_items SET status = ${"chiesta"} WHERE id = ${cast("i", "uuid")} AND status = 'da_chiedere' RETURNING 1`, 1));
  assert.equal(
    s.text,
    "WITH uc_cas AS (UPDATE uc_items SET status = $1 WHERE id = $2::uuid AND status = 'da_chiedere' RETURNING 1) SELECT uc_require(count(*) = $3::int, 'conflitto') AS ok FROM uc_cas",
  );
  assert.deepEqual(s.params, ["chiesta", "i", 1]);
  assert.throws(() => requireRows(raw("x"), -1));
  assert.throws(() => requireRows(raw("x"), 1, "bad code'"));
});

test("the live predicate requires sent status, no revocation, DB clock, same epoch and an open, complete case", () => {
  const text = toStatement(requestLiveSql("r", "c")).text.replace(/\s+/g, " ");
  assert.match(text, /r\.status IN \('inviata', 'aperta', 'in_corso', 'completata'\)/);
  assert.match(text, /r\.revoked_at IS NULL/);
  assert.match(text, /r\.expires_at > now\(\)/);
  assert.match(text, /r\.share_epoch = c\.share_epoch/);
  assert.match(text, /c\.setup_completed_at IS NOT NULL/);
  assert.match(text, /c\.status NOT IN \('chiuso', 'sospeso'\)/);
  assert.doesNotMatch(text, /bozza/);
});

test("the visible predicate admits a suspended case but never a closed one", () => {
  const text = toStatement(requestVisibleSql("req", "cs")).text.replace(/\s+/g, " ");
  assert.match(text, /cs\.status <> 'chiuso'/);
  assert.doesNotMatch(text, /sospeso/);
  assert.match(text, /req\.expires_at > now\(\)/);
  assert.throws(() => requestVisibleSql("r; --", "c"));
});
