// Le decisioni ancora valide (rilascio 8.0a): una scelta rifatta sostituisce quella di prima sullo stesso
// argomento, da qualunque parte venga; le decisioni senza argomento restano tutte.
import test from "node:test";
import assert from "node:assert/strict";
import { currentDecisions, withSupersession } from "./decisions.ts";

const d = (id: string, decidedOn: string, topicKey: string | null, createdAt = `${decidedOn}T10:00:00.000Z`) => ({ id, decidedOn, topicKey, createdAt });

test("la scelta rifatta sostituisce quella di prima, con il giorno; le altre restano", () => {
  const rows = [d("c", "2026-11-10", "modelli"), d("b", "2026-11-09", "modelli"), d("a", "2026-11-08", "modelli"), d("x", "2026-11-08", "dati")];
  const marked = withSupersession(rows);
  assert.deepEqual(
    marked.map((r) => [r.id, r.supersededOn]),
    [
      ["c", null],
      ["b", "2026-11-10"],
      ["a", "2026-11-09"],
      ["x", null],
    ],
  );
  assert.deepEqual(currentDecisions(rows).map((r) => r.id), ["c", "x"]);
});

test("lo stesso giorno decide l'ora; l'ordine di ingresso non conta", () => {
  const rows = [d("prima", "2026-11-10", "dati", "2026-11-10T09:00:00.000Z"), d("dopo", "2026-11-10", "dati", "2026-11-10T11:00:00.000Z")];
  assert.deepEqual(currentDecisions(rows).map((r) => r.id), ["dopo"]);
  assert.deepEqual(currentDecisions([...rows].reverse()).map((r) => r.id), ["dopo"]);
});

test("una decisione del team su un argomento sostituisce la scelta; senza argomento non sostituisce niente", () => {
  const rows = [d("team", "2026-11-11", "integrazioni"), d("libera", "2026-11-11", null), d("libera2", "2026-11-12", null), d("scelta", "2026-11-09", "integrazioni")];
  assert.deepEqual(currentDecisions(rows).map((r) => r.id), ["team", "libera", "libera2"]);
  assert.deepEqual(currentDecisions([]), []);
});
