import test from "node:test";
import assert from "node:assert/strict";
import {
  adoptionPatch,
  formatDecimalIt,
  hoursComponentByKey,
  hoursText,
  minutesText,
  parseItalianNumber,
  referentHours,
  referentNumber,
  sameTeamEstimate,
  teamEstimateDetail,
  teamEstimateOf,
  teamEstimateQuestion,
  teamEstimateStatement,
  teamSnapshotOf,
} from "./estimate.ts";

// Rilascio 5 (§3.3): la stima del team in ore di lavoro, i numeri del referente. Modelli sintetici,
// di prova (3.000 volte l'anno, 12 minuti: 600 ore di lavoro, 250 al mese).

const ore = (key: string, volumeYear: number, minutesPerUnit: number, extra: Record<string, unknown> = {}) => ({
  kind: "ore",
  key,
  lever: "tempo",
  label: "Controllo delle fatture",
  confidence: "ipotesi",
  volumeYear,
  minutesPerUnit,
  automatablePct: 50,
  ...extra,
});
const model = (...components: unknown[]) => ({ primaryLever: "tempo", components });

test("la stima del team: la voce «ore» con più ore di lavoro, la prima a parità, mai con zero", () => {
  assert.equal(teamEstimateOf(null), null);
  assert.equal(teamEstimateOf(model()), null);
  assert.equal(teamEstimateOf(model(ore("a", 0, 12), ore("b", 100, 0))), null);
  assert.equal(teamEstimateOf(model({ kind: "euro", key: "e", eurYear: 5000 })), null);
  const tj = teamEstimateOf(model(ore("tempo-1", 3000, 12, { unit: "pratiche" })));
  assert.deepEqual(tj, { key: "tempo-1", volumeYear: 3000, minutes: 12, hours: 600, perMonth: 250, perYear: null, unit: "pratiche", label: null });
  const several = teamEstimateOf(model(ore("piccola", 10, 5), ore("grande", 1000, 30, { label: "Inserimento ordini" }), ore("pari", 1000, 30)));
  assert.equal(several?.key, "grande");
  assert.equal(several?.label, "Inserimento ordini", "il nome della voce solo con più voci «ore»");
  assert.equal(teamEstimateOf(model(ore("rara", 6, 30)))?.perYear, 6);
  assert.equal(teamEstimateOf(model(ore("rara", 6, 30)))?.perMonth, null);
});

test("unità ed etichetta: passano il filtro della descrizione e dei titoli, altrimenti restano fuori", () => {
  const withMoney = teamEstimateOf(model(ore("x", 1200, 10, { unit: "€ di fatture", label: "Costo 40 €" }), ore("y", 1, 1)));
  assert.equal(withMoney?.unit, null);
  assert.equal(withMoney?.label, null);
  const withEmail = teamEstimateOf(model(ore("x", 1200, 10, { unit: "mail a mario.rossi@cliente.test" })));
  assert.equal(withEmail?.unit, null);
});

test("i testi: ore, minuti, al mese o l'anno, con la virgola", () => {
  assert.equal(hoursText(600), "600 ore di lavoro l'anno");
  assert.equal(hoursText(1200), "1.200 ore di lavoro l'anno");
  assert.equal(hoursText(1), "1 ora di lavoro l'anno");
  assert.equal(hoursText(0.4), "meno di un'ora di lavoro l'anno");
  assert.equal(minutesText(12), "12 minuti");
  assert.equal(minutesText(1), "1 minuto");
  assert.equal(minutesText(1.5), "1,5 minuti");
  assert.equal(formatDecimalIt(2.25), "2,3");
  const tj = teamEstimateOf(model(ore("tempo-1", 3000, 12, { unit: "pratiche" })))!;
  assert.equal(teamEstimateQuestion(tj), "Il team stima 600 ore di lavoro l'anno: ti torna?");
  assert.equal(teamEstimateStatement({ hours: 600 }), "Il team stima 600 ore di lavoro l'anno.");
  assert.equal(teamEstimateDetail(tj), "Circa 292 fatture al mese, 12 minuti ogni volta.");
  assert.equal(teamEstimateDetail({ perMonth: 250, perYear: null, unit: null, minutes: 12 }), "Circa 250 volte al mese, 12 minuti ogni volta.");
  assert.equal(teamEstimateDetail({ perMonth: null, perYear: 6, unit: null, minutes: 30 }), "Circa 6 volte l'anno, 30 minuti ogni volta.");
});

test("i numeri in italiano: virgola, punto delle migliaia, spazi; non negativi, al massimo due decimali", () => {
  assert.equal(parseItalianNumber("20"), 20);
  assert.equal(parseItalianNumber("  20 "), 20);
  assert.equal(parseItalianNumber("1,5"), 1.5);
  assert.equal(parseItalianNumber("1.200"), 1200);
  assert.equal(parseItalianNumber("1.200,5"), 1200.5);
  assert.equal(parseItalianNumber("12.75"), 12.75);
  assert.equal(parseItalianNumber("0"), 0);
  assert.equal(parseItalianNumber(3.25), 3.25);
  for (const bad of ["", "  ", "-3", "1,234", "abc", "1.2.3", "1,2,3", "1e3", "12.345.6", null, undefined, Number.NaN, -1, 1.234]) assert.equal(parseItalianNumber(bad), null, String(bad));
  assert.deepEqual(referentNumber("", 100), { ok: true, value: null });
  assert.deepEqual(referentNumber(null, 100), { ok: true, value: null });
  assert.deepEqual(referentNumber("8.333.333", 8_333_333), { ok: true, value: 8_333_333 });
  assert.deepEqual(referentNumber("8.333.334", 8_333_333), { ok: false });
  assert.deepEqual(referentNumber("x", 100), { ok: false });
});

test("le ore del referente: con uno o due numeri, quelli del team per il resto", () => {
  const snap = { volumeYear: 3000, minutes: 12 };
  assert.equal(referentHours(snap, { timesPerMonth: 200, minutesEach: 10 }), 400);
  assert.equal(referentHours(snap, { timesPerMonth: 200, minutesEach: null }), 480);
  assert.equal(Math.round(referentHours(snap, { timesPerMonth: null, minutesEach: 6 })!), 300);
  assert.equal(Math.round(referentHours(snap, { timesPerMonth: null, minutesEach: null })!), 600);
  assert.equal(referentHours(null, { timesPerMonth: 20, minutesEach: 30 }), 120);
  assert.equal(referentHours(null, { timesPerMonth: 20, minutesEach: null }), null);
});

test("la freschezza: chiave, volte e minuti a due decimali; null solo con null", () => {
  const a = { key: "tempo-1", volumeYear: 3004.333, minutes: 12 };
  assert.deepEqual(teamSnapshotOf(a), { key: "tempo-1", volumeYear: 3004.33, minutes: 12 });
  assert.equal(sameTeamEstimate(teamSnapshotOf(a), a), true, "la colonna numeric(14,2) e il modello");
  assert.equal(sameTeamEstimate(a, { ...a, key: "tempo-2" }), false);
  assert.equal(sameTeamEstimate(a, { ...a, volumeYear: 3600 }), false);
  assert.equal(sameTeamEstimate(a, { ...a, minutes: 10 }), false);
  assert.equal(sameTeamEstimate(null, null), true);
  assert.equal(sameTeamEstimate(a, null), false);
  assert.equal(sameTeamEstimate(null, a), false);
  assert.equal(teamSnapshotOf(null), null);
});

test("l'adozione cambia solo i numeri dati; la voce si ritrova per chiave", () => {
  assert.deepEqual(adoptionPatch({ timesPerMonth: 200, minutesEach: 10 }), { volumeYear: 2400, minutesPerUnit: 10 });
  assert.deepEqual(adoptionPatch({ timesPerMonth: 1.5, minutesEach: null }), { volumeYear: 18 });
  assert.deepEqual(adoptionPatch({ timesPerMonth: null, minutesEach: 7.5 }), { minutesPerUnit: 7.5 });
  assert.deepEqual(adoptionPatch({ timesPerMonth: null, minutesEach: null }), {});
  const m = model(ore("a", 10, 5), ore("b", 20, 6));
  assert.equal(hoursComponentByKey(m, "b")?.volumeYear, 20);
  assert.equal(hoursComponentByKey(m, "c"), null);
});
