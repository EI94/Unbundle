import test from "node:test";
import assert from "node:assert/strict";
import { INPUT_ERRORS, parseAsks, parseDay, parseEmployees, parseItalianNumber, parseLsCosts, parsePct, parseRevenue, parseWeights } from "./inputs.ts";

// I campi di «Programma» (rilascio 7): i numeri si scrivono come si dicono.

test("i numeri all'italiana: migliaia col punto, decimali con la virgola, mln e k", () => {
  assert.equal(parseItalianNumber("1.250"), 1250);
  assert.equal(parseItalianNumber("1250"), 1250);
  assert.equal(parseItalianNumber("12,5"), 12.5);
  assert.equal(parseItalianNumber("12.5"), 12.5);
  assert.equal(parseItalianNumber("1.250.000"), 1_250_000);
  assert.equal(parseItalianNumber("12 mln"), 12_000_000);
  assert.equal(parseItalianNumber("12,5 milioni"), 12_500_000);
  assert.equal(parseItalianNumber("800k"), 800_000);
  assert.equal(parseItalianNumber("€ 4.000"), 4000);
  assert.equal(parseItalianNumber("4.000 €"), 4000);
  assert.equal(parseItalianNumber("1 200"), 1200);
  assert.equal(parseItalianNumber("-3"), -3);
  assert.equal(parseItalianNumber("abc"), null);
  assert.equal(parseItalianNumber("1,2,3"), null);
  assert.equal(parseItalianNumber("12.34.5"), null);
  assert.equal(parseItalianNumber(""), null);
});

test("dipendenti: un intero più di zero", () => {
  assert.deepEqual(parseEmployees("420"), { ok: true, value: 420 });
  assert.deepEqual(parseEmployees("1.200"), { ok: true, value: 1200 });
  assert.deepEqual(parseEmployees("12,5"), { ok: false, error: INPUT_ERRORS.integer });
  assert.deepEqual(parseEmployees("0"), { ok: false, error: INPUT_ERRORS.positive });
  assert.deepEqual(parseEmployees("tanti"), { ok: false, error: INPUT_ERRORS.number });
});

test("ricavo: facoltativo, in euro interi", () => {
  assert.deepEqual(parseRevenue(""), { ok: true, value: null });
  assert.deepEqual(parseRevenue("12 mln"), { ok: true, value: 12_000_000 });
  assert.deepEqual(parseRevenue("0"), { ok: false, error: INPUT_ERRORS.positive });
});

test("i costi di Lateral Space: canone, mesi, percentuale; la fine non prima dell'inizio", () => {
  assert.deepEqual(parseLsCosts({ supportMonthEur: "4.000", supportFrom: "2026-10", supportTo: "", devPct: "15" }), {
    ok: true,
    value: { supportMonthEur: 4000, supportFrom: "2026-10", supportTo: null, devPct: 15 },
  });
  const bad = parseLsCosts({ supportMonthEur: "x", supportFrom: "2026-10", supportTo: "2026-09", devPct: "120" });
  assert.equal(bad.ok, false);
  assert.deepEqual(!bad.ok && Object.keys(bad.fieldErrors).sort(), ["devPct", "supportMonthEur", "supportTo"]);
  assert.deepEqual(parseLsCosts({ supportMonthEur: "", supportFrom: "", supportTo: "", devPct: "" }), { ok: true, value: { supportMonthEur: null, supportFrom: null, supportTo: null, devPct: null } });
});

test("percentuale e pesi", () => {
  assert.deepEqual(parsePct("12,5 %"), { ok: true, value: 12.5 });
  assert.deepEqual(parsePct("101"), { ok: false, error: INPUT_ERRORS.pct });
  assert.deepEqual(parseWeights({ persone: "40", use_case: "20", valore: "20", adozione: "20" }), { ok: true, value: { persone: 40, use_case: 20, valore: 20, adozione: 20 } });
  assert.deepEqual(parseWeights({ persone: "0", use_case: "0", valore: "0", adozione: "0" }), { ok: false, error: INPUT_ERRORS.weights });
});

test("decisioni per la leadership: righe vuote tolte, al massimo 8 da 200 caratteri", () => {
  assert.deepEqual(parseAsks([{ id: "a", text: "  Budget del T1  " }, { id: "b", text: " " }]), { ok: true, value: [{ id: "a", text: "Budget del T1" }] });
  assert.equal(parseAsks(Array.from({ length: 9 }, (_, i) => ({ id: `x${i}`, text: "x" }))).ok, false);
  assert.equal(parseAsks([{ id: "a", text: "x".repeat(201) }]).ok, false);
  assert.equal(parseAsks([{ id: "a b", text: "ok" }]).ok, false);
});

test("un giorno che esiste", () => {
  assert.deepEqual(parseDay("2026-11-09"), { ok: true, value: "2026-11-09" });
  assert.equal(parseDay("2026-02-30").ok, false);
  assert.equal(parseDay("9/11/2026").ok, false);
});
