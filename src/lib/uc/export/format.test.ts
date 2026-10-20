import test from "node:test";
import assert from "node:assert/strict";
import { buildCatalogSnapshot, type CatalogSnapshot } from "../snapshot.ts";
import { sampleInput } from "../snapshot.fixtures.ts";
import { displayAnswer, displayJsonValue, displaySource } from "./format.ts";

function snap(over: Parameters<typeof sampleInput>[0] = {}): CatalogSnapshot {
  const r = buildCatalogSnapshot(sampleInput(over));
  assert.ok(r.ok);
  return r.value;
}

test("values are shown plainly: text, number and unit, amounts, choices, yes/no, percentages, date-times, hidden reasons", () => {
  assert.equal(displayJsonValue({ text: "ciao" }), "ciao");
  assert.equal(displayJsonValue({ value: 42, unit: "min" }), "42 min");
  assert.equal(displayJsonValue({ amount: 120, currency: "EUR", vat: "esclusa", per: "ora" }), "120 EUR, IVA esclusa, per ora");
  assert.equal(displayJsonValue({ choice: "correggo", text: "nuovo testo" }), "Va corretta: nuovo testo");
  assert.equal(displayJsonValue({ choice: "confermo", exceptions: "nessuna" }), "È così; eccezioni: nessuna");
  assert.equal(displayJsonValue({ choice: "confermo" }), "È così");
  assert.equal(displayJsonValue({ value: true }), "Sì");
  assert.equal(displayJsonValue({ value: false }), "No");
  assert.equal(displayJsonValue({ value: 12.5, base: "delle richieste" }), "12.5% delle richieste");
  assert.equal(displayJsonValue({ local: "2026-09-30T23:15", tz: "Europe/Rome" }), "2026-09-30 23:15 (Europe/Rome)");
  assert.equal(displayJsonValue({ value: 1200, unit: "richieste al mese" }), "1200 richieste al mese");
  assert.equal(displayJsonValue({ option: "altro", other_text: "spiegazione" }), "altro: spiegazione");
  assert.equal(displayJsonValue({ options: ["a", "b"] }), "a, b");
  assert.equal(displayJsonValue({ from: 10, to: 20, unit: "kg" }), "10 – 20 kg");
  assert.equal(displayJsonValue({ rows: [{}, {}] }), "Tabella: 2 righe");
  assert.equal(displayJsonValue("x".repeat(3000)).length, 2000);
  assert.equal(displayAnswer(null), "");
  const s = snap();
  assert.equal(displayAnswer(s.items.find((i) => i.key === "q.esempio.04")?.answer ?? null), "(nascosto: dato personale)");
  assert.equal(displaySource(s.items.find((i) => i.key === "q.esempio.01")?.answer ?? null), "referente");
  const draft = snap({ version: "bozza", frozenAt: null });
  assert.equal(displaySource(draft.items.find((i) => i.key === "q.esempio.03")?.answer ?? null), "dichiarato in call · F001");
});
