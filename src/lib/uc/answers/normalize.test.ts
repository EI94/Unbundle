import test from "node:test";
import assert from "node:assert/strict";
import { RESPONSE_TYPES, type ResponseType } from "../vocab.ts";
import { MAX_ANSWER_JSON_LENGTH, answerContext, normalizeAnswer, prefillFromDeclared, toJsonValue } from "./normalize.ts";
import type { NormalizeContext, ResponseConfig } from "./types.ts";

const NOW = new Date("2026-10-07T10:00:00Z");
const send = answerContext(NOW, true);
const draft = answerContext(NOW, false);
const FILE = "0b0c3a1e-9d7b-4c52-9a7e-5f1b2c3d4e5f";
const DATASET = "6f9a1b2c-3d4e-4f50-8a1b-2c3d4e5f6a7b";

/** Un esempio valido e uno non valido per ogni tipo di risposta. */
const CASES: Record<ResponseType, { config?: ResponseConfig; ctx?: Partial<NormalizeContext>; valid: unknown; invalid: unknown }> = {
  numero: { config: { unit: "metri" }, valid: "1.200 m", invalid: "1.2.3" },
  valuta: { valid: "€ 1.200,50 a volo IVA esclusa", invalid: "€ 1.200" },
  percentuale: { valid: "12,5% del venduto", invalid: "120%" },
  durata: { valid: "2:30", invalid: "tanto" },
  data: { valid: "30/09/2025", invalid: "31/02/2025" },
  intervallo: { valid: "22:00-06:00", invalid: "20-10" },
  si_no: { valid: "sì", invalid: "forse" },
  scelta: { config: { options: ["Ogni ora", "Ogni mese"] }, valid: "ogni ora", invalid: "Non lo so" },
  scelta_multipla: { config: { options: ["A", "B"] }, valid: { options: ["A", "B"] }, invalid: { options: ["A", "a"] } },
  testo: { valid: "Eccezione d'estate", invalid: "   " },
  codice: { config: { pattern: "^[A-Z]{4}$" }, valid: "abcd", invalid: "ABC" },
  tabella: { valid: "A\tB\nx\t1\n", invalid: "A\tB\nx\t1\nx\t2\n" },
  file: { ctx: { usableFileIds: [FILE] }, valid: { file_ids: [FILE] }, invalid: { file_ids: [DATASET] } },
  dataset: { ctx: { usableDatasets: [{ fileId: FILE, datasetId: DATASET }] }, valid: { file_id: FILE, dataset_id: DATASET }, invalid: { file_id: FILE } },
  conferma_regola: { ctx: { proposedText: "Mai due consegne nello stesso giro" }, valid: { choice: "confermo" }, invalid: { choice: "correggo" } },
  conferma_formula: { ctx: { proposedText: "prezzo − costi" }, valid: { choice: "confermo" }, invalid: { choice: "forse" } },
  collegamento_sistema: { valid: { sistema: "Gestionale", oggetto: "Aeromobili", accesso: "export" }, invalid: { sistema: "Gestionale" } },
  data_ora: { valid: "30/09/2025 23:30", invalid: "29/03/2026 02:30" },
  conferma_valore: { config: { base_type: "durata" }, valid: { choice: "correggo", value: "90 min" }, invalid: { choice: "correggo" } },
  caso_prova: { valid: { richiesta: "4 passeggeri", atteso: "tre strategie", regole: ["rule.commerciale.x"] }, invalid: { richiesta: "x" } },
};

test("every response type has a normalizer: a valid and an invalid answer each", () => {
  assert.deepEqual(Object.keys(CASES).sort(), [...RESPONSE_TYPES].sort());
  for (const type of RESPONSE_TYPES) {
    const c = CASES[type];
    const ok = normalizeAnswer(type, c.valid, c.config ?? {}, { ...send, ...c.ctx });
    assert.ok(ok.ok, `${type} valido: ${ok.ok ? "" : ok.errors.map((e) => e.code).join(", ")}`);
    const ko = normalizeAnswer(type, c.invalid, c.config ?? {}, { ...send, ...c.ctx });
    assert.ok(!ko.ok, `${type} non valido accettato`);
    assert.ok(ko.errors.length > 0 && ko.errors.every((e) => typeof e.message === "string" && e.message.length > 0), type);
  }
});

test("strict send rejects; draft saves the answer and returns the errors", () => {
  const sent = normalizeAnswer("valuta", "€ 1.200", {}, send);
  assert.ok(!sent.ok);
  assert.deepEqual(
    sent.errors.map((e) => e.code),
    ["iva_mancante", "per_mancante"],
  );
  const saved = normalizeAnswer("valuta", "€ 1.200", {}, draft);
  assert.ok(saved.ok);
  assert.deepEqual(saved.value, { amount: 1200, currency: "EUR", vat: null, per: null });
  assert.equal(saved.normalized, null);
  assert.deepEqual(
    saved.errors.map((e) => e.code),
    ["iva_mancante", "per_mancante"],
  );
  // Una bozza illeggibile si salva com'è scritta.
  const raw = normalizeAnswer("numero", "boh, forse tanti", {}, draft);
  assert.ok(raw.ok);
  assert.equal(raw.value, "boh, forse tanti");
  assert.equal(raw.normalized, null);
});

test("extra results travel with the answer: partial, valid_from, text hash", () => {
  const partial = normalizeAnswer("tabella", "A\tB\nx\t1\n", { min_rows: 2 }, send);
  assert.ok(partial.ok && partial.partial === true);
  const money = normalizeAnswer("valuta", { amount: "10", vat: "inclusa", per: "volo", valid_from: "01/10/2026" }, {}, send);
  assert.ok(money.ok && money.validFrom === "2026-10-01");
  const rule = normalizeAnswer("conferma_regola", { choice: "confermo" }, { proposed_text: "Regola" }, send);
  assert.ok(rule.ok && typeof rule.textHash === "string" && rule.textHash.length === 64);
});

test("unknown types, missing answers and oversized payloads", () => {
  const unknown = normalizeAnswer("riferimento" as ResponseType, "x", {}, send);
  assert.ok(!unknown.ok && unknown.errors[0].code === "tipo_non_supportato");
  const missing = normalizeAnswer("testo", undefined, {}, send);
  assert.ok(!missing.ok && missing.errors[0].code === "testo_mancante");
  const huge = normalizeAnswer("testo", "x".repeat(MAX_ANSWER_JSON_LENGTH + 1), {}, send);
  assert.ok(!huge.ok && huge.errors[0].code === "risposta_troppo_lunga");
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  const cyc = normalizeAnswer("testo", circular, {}, send);
  assert.ok(!cyc.ok && cyc.errors[0].code === "risposta_troppo_lunga");
  // Configurazione assente o non valida: vale vuota.
  assert.ok(normalizeAnswer("testo", "ok", null, send).ok);
  assert.ok(normalizeAnswer("testo", "ok", "x" as never, send).ok);
});

test("toJsonValue keeps only JSON values", () => {
  assert.deepEqual(toJsonValue({ a: 1, b: undefined, c: () => 1, d: [Number.NaN, "x"], e: new Date(0) }), { a: 1, d: [null, "x"], e: null });
  let deep: unknown = "fondo";
  for (let i = 0; i < 20; i++) deep = [deep];
  assert.ok(JSON.stringify(toJsonValue(deep)).length < 40);
});

test("answerContext uses the Rome calendar", () => {
  assert.deepEqual(answerContext(new Date("2026-10-07T22:30:00Z"), true), { today: "2026-10-08", tz: "Europe/Rome", strict: true });
  assert.deepEqual(answerContext(NOW, false, { usableFileIds: [FILE] }).usableFileIds, [FILE]);
});

test("prefillFromDeclared reads a value declared in prose and says what is missing", () => {
  const ctx = { today: "2026-10-07", tz: "Europe/Rome" as const };
  const money = prefillFromDeclared("valuta", "circa 1.750 € (F123)", { unit: "€ per evento" }, ctx);
  assert.deepEqual(money?.value, { amount: 1750, currency: "EUR", vat: null, per: "evento" });
  assert.deepEqual(
    money?.missing.map((e) => e.code),
    ["iva_mancante"],
  );
  const duration = prefillFromDeclared("durata", "arrivo 2,5 ore prima della partenza", {}, ctx);
  assert.deepEqual(duration?.value, { amount: 2.5, unit: "h" });
  assert.deepEqual(duration?.missing, []);
  const choice = prefillFromDeclared("scelta", "ogni ora", { options: ["Ogni ora", "Ogni mese"] }, ctx);
  assert.deepEqual(choice?.value, { option: "Ogni ora" });
  assert.equal(prefillFromDeclared("numero", "dipende dal periodo", {}, ctx), null);
  assert.equal(prefillFromDeclared("numero", "", {}, ctx), null);
});
