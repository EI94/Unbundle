import test from "node:test";
import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import { ucToDrizzle } from "./use-case-hub-uc-drizzle.ts";

const dialect = new PgDialect();
const built = (text: string, params: unknown[]) => dialect.sqlToQuery(ucToDrizzle({ text, params }));

test("ucToDrizzle: i segnaposto diventano parametri, nello stesso ordine", () => {
  const q = built("SELECT $1::uuid AS a, $2::text AS b", ["11111111-1111-1111-1111-111111111111", "x"]);
  assert.equal(q.sql, "SELECT $1::uuid AS a, $2::text AS b");
  assert.deepEqual(q.params, ["11111111-1111-1111-1111-111111111111", "x"]);
});

test("ucToDrizzle: da $1 a $12, e $1 non si confonde con $10", () => {
  const params = Array.from({ length: 12 }, (_, i) => `p${i + 1}`);
  const text = params.map((_, i) => `$${i + 1}`).reverse().join(", ");
  const q = built(`SELECT ${text}`, params);
  assert.deepEqual(q.params, [...params].reverse());
  assert.equal(q.sql, `SELECT ${params.map((_, i) => `$${i + 1}`).join(", ")}`);
  const ten = built("SELECT $10, $1", params);
  assert.deepEqual(ten.params, ["p10", "p1"]);
});

test("ucToDrizzle: lo stesso parametro due volte, e nessun segnaposto", () => {
  assert.deepEqual(built("SELECT $1, $1", ["a"]).params, ["a", "a"]);
  const none = built("SELECT 1", []);
  assert.equal(none.sql, "SELECT 1");
  assert.deepEqual(none.params, []);
});

test("ucToDrizzle: un array resta un solo parametro", () => {
  const q = built("SELECT $1::uuid[]", [["a", "b"]]);
  assert.equal(q.sql, "SELECT $1::uuid[]");
  assert.deepEqual(q.params, [["a", "b"]]);
});

test("ucToDrizzle: un segnaposto senza parametro è un errore", () => {
  assert.throws(() => ucToDrizzle({ text: "SELECT $2", params: ["a"] }), /Parametro \$2 mancante/);
});
