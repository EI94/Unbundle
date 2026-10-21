import test from "node:test";
import assert from "node:assert/strict";
import { findHubForbidden } from "./copy-guard.ts";
import { ESTIMATES_TEXT, PROPOSER_RISK_WORDS, unofficialEstimateLines } from "./estimates.ts";

// «Stime non ufficiali» (H4p): un riquadro solo, una frase sola, parole semplici. Dati sintetici.

test("il titolo e la frase del riquadro", () => {
  assert.equal(ESTIMATES_TEXT.title, "Stime non ufficiali");
  assert.equal(ESTIMATES_TEXT.note, "Conta la valutazione del team.");
});

test("stima di Claude e di chi ha proposto, in parole semplici: niente «semaforo», niente «sforzo»", () => {
  const lines = unofficialEstimateLines({
    frequency: "giornaliera",
    timeSavedMinutesPerRun: 15,
    beneficiaries: 3,
    valuePerRunEur: 2,
    proposerEstimate: { efficiency: { score: 4 }, effort: { score: 2 }, impactFlag: { value: "rosso" } },
  });
  assert.deepEqual(lines, [
    "Circa 180 ore all'anno (15 minuti × 240 volte × 3 persone).",
    "Circa 1.440 € all'anno, secondo chi ha proposto.",
    "Secondo chi ha proposto: efficienza 4 su 5, impegno 2 su 5, serve una decisione dell'AI Board.",
  ]);
  for (const line of lines) {
    assert.doesNotMatch(line, /semaforo|sforzo/i, line);
    assert.deepEqual(findHubForbidden(line, "area"), [], line);
  }
  assert.deepEqual(Object.keys(PROPOSER_RISK_WORDS), ["verde", "giallo", "rosso"]);
});

test("senza dati raccolti niente righe; un segnale sconosciuto non si scrive", () => {
  assert.deepEqual(unofficialEstimateLines(null), []);
  assert.deepEqual(unofficialEstimateLines({ hiddenFromSearch: true }), []);
  assert.deepEqual(unofficialEstimateLines({ proposerEstimate: { impactFlag: { value: "viola" } } }), []);
  assert.deepEqual(unofficialEstimateLines({ proposerEstimate: { impactFlag: { value: "verde" } } }), ["Secondo chi ha proposto: nessun rischio particolare."]);
});
