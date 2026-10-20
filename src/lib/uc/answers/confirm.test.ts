import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { RESPONSE_TYPES } from "../vocab.ts";
import {
  TEXTUAL_RESPONSE_TYPES,
  answerIsTyped,
  answerKindForChoice,
  canConfirmDeclared,
  confirmValueConfig,
  confirmationBase,
  normalizeConfermaFormula,
  normalizeConfermaRegola,
  normalizeConfermaValore,
  readChoice,
  stableStringify,
  textHash,
  valueHash,
} from "./confirm.ts";
import { normalizeOutcome } from "./normalize.ts";
import type { NormalizeContext } from "./types.ts";

const ctx: NormalizeContext = { today: "2026-10-07", tz: "Europe/Rome", strict: true };
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const codes = (o: { errors: { code: string }[] }) => o.errors.map((e) => e.code);

test("textHash = sha256 of the NFC text with collapsed spaces", () => {
  assert.equal(textHash("  Mai due\n consegne   nello stesso giro "), sha("Mai due consegne nello stesso giro"));
  assert.equal(textHash("café"), sha("café"));
  assert.equal(textHash("a  b"), textHash("a b"));
});

test("stableStringify sorts keys and valueHash is stable", () => {
  assert.equal(stableStringify({ b: 1, a: [1, { d: null, c: "x" }], u: undefined }), '{"a":[1,{"c":"x","d":null}],"b":1}');
  assert.equal(valueHash({ b: 1, a: 2 }), valueHash({ a: 2, b: 1 }));
  assert.equal(valueHash("  testo  "), textHash("testo"));
  assert.equal(valueHash({ text: "testo" }), textHash("testo"));
  assert.notEqual(valueHash({ amount: 1 }), valueHash({ amount: 2 }));
});

test("readChoice reads codes and labels", () => {
  const allowed = ["confermo", "correggo", "non_so"] as const;
  assert.equal(readChoice("Confermo", allowed), "confermo");
  assert.equal(readChoice("Non lo so", allowed), "non_so");
  assert.equal(readChoice("correzione", allowed), "correggo");
  assert.equal(readChoice("non_vale", allowed), null);
  assert.equal(readChoice(1, allowed), null);
});

test("conferma_regola: confirm hashes the proposed text, correct needs a new text", () => {
  const confirm = normalizeConfermaRegola({ choice: "confermo" }, {}, { proposedText: "Mai due consegne nello stesso giro" });
  assert.deepEqual(confirm.value, { choice: "confermo" });
  assert.equal(confirm.textHash, textHash("Mai due consegne nello stesso giro"));
  const correct = normalizeConfermaRegola({ choice: "correggo", text: " Mai due consegne nello stesso giro, salvo urgenze " }, {}, {});
  assert.deepEqual(correct.value, { choice: "correggo", text: "Mai due consegne nello stesso giro, salvo urgenze" });
  assert.equal(correct.textHash, textHash("Mai due consegne nello stesso giro, salvo urgenze"));
  assert.deepEqual(codes(normalizeConfermaRegola({ choice: "correggo" }, {}, {})), ["correzione_mancante"]);
  assert.deepEqual(codes(normalizeConfermaRegola({ choice: "confermo" }, {}, {})), ["testo_proposto_mancante"]);
  assert.equal(normalizeConfermaRegola({ choice: "confermo" }, { proposed_text: "Regola" }, {}).textHash, textHash("Regola"));
  assert.deepEqual(normalizeConfermaRegola({ choice: "non_vale" }, {}, {}).normalized, { choice: "non_vale" });
  assert.deepEqual(normalizeConfermaRegola("Non lo so", {}, {}).value, { choice: "non_so" });
  assert.deepEqual(codes(normalizeConfermaRegola({ choice: "forse" }, {}, {})), ["scelta_mancante"]);
});

test("conferma_regola: exceptions when the item asks for them", () => {
  const cfg = { ask_exceptions: true };
  assert.deepEqual(codes(normalizeConfermaRegola({ choice: "confermo" }, cfg, { proposedText: "R" })), ["eccezioni_mancanti"]);
  assert.deepEqual(normalizeConfermaRegola({ choice: "confermo", exceptions: "nessuna" }, cfg, { proposedText: "R" }).value, {
    choice: "confermo",
    exceptions: "nessuna",
  });
  assert.deepEqual(codes(normalizeConfermaRegola({ choice: "non_vale" }, cfg, {})), []);
});

test("conferma_formula: confirm or correct", () => {
  assert.equal(normalizeConfermaFormula({ choice: "confermo" }, {}, { proposedText: "prezzo − costi" }).textHash, textHash("prezzo − costi"));
  const c = normalizeConfermaFormula({ choice: "correggo", formula: "prezzo − costi − tasse" }, {}, {});
  assert.deepEqual(c.normalized, { choice: "correggo", formula: "prezzo − costi − tasse" });
  assert.deepEqual(codes(normalizeConfermaFormula({ choice: "non_vale" }, {}, {})), ["scelta_mancante"]);
  assert.deepEqual(codes(normalizeConfermaFormula({ choice: "correggo" }, {}, {})), ["correzione_mancante"]);
});

test("typed values and the «Confermo» button on declared values", () => {
  assert.deepEqual([...TEXTUAL_RESPONSE_TYPES].sort(), ["conferma_formula", "conferma_regola", "file", "tabella", "testo"]);
  for (const t of RESPONSE_TYPES) {
    const textual = (TEXTUAL_RESPONSE_TYPES as readonly string[]).includes(t);
    assert.equal(answerIsTyped(t, null), textual, t);
    assert.equal(answerIsTyped(t, { value_si: 1 }), true, t);
    assert.equal(canConfirmDeclared(t, { normalized: null }), textual, t);
  }
  assert.equal(canConfirmDeclared("valuta", null), false);
  assert.equal(answerIsTyped(null, null), false);
});

test("conferma_valore: «Confermo» on a typed declared value keeps it and records its hash", () => {
  const declared = { value: { amount: 4500, currency: "EUR", vat: "esclusa", per: "volo" }, normalized: { amount_eur: 4500 } };
  const o = normalizeConfermaValore({ choice: "confermo" }, confirmValueConfig("valuta", {}), { ...ctx, declared }, normalizeOutcome);
  assert.deepEqual(o.errors, []);
  assert.deepEqual(o.value, { choice: "confermo", value: declared.value });
  assert.deepEqual(o.normalized, { amount_eur: 4500 });
  assert.equal(o.textHash, valueHash({ amount_eur: 4500 }));
});

test("conferma_valore: a value declared in prose cannot be confirmed as is (valore_non_tipizzato)", () => {
  const declared = { value: { text: "circa 4.500 € a volo" }, normalized: null };
  const o = normalizeConfermaValore({ choice: "confermo" }, confirmValueConfig("valuta", {}), { ...ctx, declared }, normalizeOutcome);
  assert.deepEqual(codes(o), ["valore_non_tipizzato"]);
  // Il referente reinserisce il valore nel formato giusto e conferma.
  const retyped = normalizeConfermaValore(
    { choice: "confermo", value: "4.500 € a volo IVA esclusa" },
    confirmValueConfig("valuta", {}),
    { ...ctx, declared },
    normalizeOutcome,
  );
  assert.deepEqual(retyped.errors, []);
  assert.deepEqual(retyped.normalized, { amount_eur: 4500 });
  // Un tipo testuale si conferma anche in prosa.
  const text = normalizeConfermaValore({ choice: "confermo" }, confirmValueConfig("testo", {}), { ...ctx, declared }, normalizeOutcome);
  assert.deepEqual(text.errors, []);
  assert.equal(text.textHash, textHash("circa 4.500 € a volo"));
});

test("conferma_valore: «Correggo» normalizes with the base type, in the same unit", () => {
  const o = normalizeConfermaValore({ choice: "correggo", value: "1,5 ore" }, confirmValueConfig("durata", { unit: "ore" }), ctx, normalizeOutcome);
  assert.deepEqual(o.value, { choice: "correggo", value: { amount: 1.5, unit: "h" } });
  assert.deepEqual(o.normalized, { minutes: 90 });
  const bad = normalizeConfermaValore({ choice: "correggo", value: "tanto" }, confirmValueConfig("durata", {}), ctx, normalizeOutcome);
  assert.equal(bad.errors[0].field, "value.amount");
  assert.equal(bad.textHash, null);
  assert.deepEqual(codes(normalizeConfermaValore({ choice: "correggo" }, confirmValueConfig("durata", {}), ctx, normalizeOutcome)), ["correzione_mancante"]);
});

test("conferma_valore: «Non lo so», missing declared value, missing base type", () => {
  assert.deepEqual(normalizeConfermaValore({ choice: "non so" }, confirmValueConfig("valuta", {}), ctx, normalizeOutcome).value, { choice: "non_so" });
  assert.deepEqual(codes(normalizeConfermaValore({ choice: "confermo" }, confirmValueConfig("valuta", {}), ctx, normalizeOutcome)), [
    "valore_dichiarato_mancante",
  ]);
  assert.deepEqual(codes(normalizeConfermaValore({ choice: "confermo" }, {}, ctx, normalizeOutcome)), ["tipo_base_mancante"]);
  assert.deepEqual(confirmationBase({ base_type: "conferma_valore" }).type, null);
  assert.deepEqual(codes(normalizeConfermaValore({}, {}, ctx, normalizeOutcome)), ["scelta_mancante"]);
});

test("answerKindForChoice maps choices to answer kinds", () => {
  assert.equal(answerKindForChoice("conferma_regola", { choice: "confermo" }), "conferma");
  assert.equal(answerKindForChoice("conferma_regola", { choice: "correggo" }), "correzione");
  assert.equal(answerKindForChoice("conferma_regola", { choice: "non_vale" }), "correzione");
  assert.equal(answerKindForChoice("conferma_valore", { choice: "non_so" }), "non_so");
  assert.equal(answerKindForChoice("conferma_formula", { choice: "confermo" }), "conferma");
  assert.equal(answerKindForChoice("numero", { value: 3 }), "valore");
});
