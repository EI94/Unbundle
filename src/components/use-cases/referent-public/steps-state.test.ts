import test from "node:test";
import assert from "node:assert/strict";
import type { ReferentAskView, ReferentCheckView, ReferentQuestionView } from "../../../lib/use-cases/referent/contract.ts";
import {
  STEP_SETTLE_MS,
  confirmDone,
  estimateDone,
  firstOpenStep,
  hasSteps,
  isRepeatActivation,
  numberField,
  numberText,
  parseStep,
  perMonthLabel,
  placeholderOf,
  resolveStep,
  stepLabel,
  stepSearch,
  stepStates,
  stepsOf,
} from "./steps-state.ts";

// (Rilascio 5, §7.1, §7.7) I passi della pagina del referente: quali, quando sono fatti, dove si arriva.

const N = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
const question = (i: number, over: Partial<ReferentQuestionView> = {}): ReferentQuestionView => ({ needId: N[i], position: i + 1, title: `Domanda ${i}`, state: "aperta", fileRequired: false, draft: null, answer: null, files: [], ...over });
const TEAM = { key: "tempo-1", volumeYear: 3000, minutes: 12, hours: 600, perMonth: 250, perYear: null, unit: "pratiche", label: null };
const draft = (over: Partial<ReferentCheckView["draft"]> = {}): ReferentCheckView["draft"] => ({ confirm: null, note: null, estimate: null, timesPerMonth: null, minutesEach: null, stale: false, savedAt: null, ...over });
const check = (over: Partial<ReferentCheckView> = {}, d: Partial<ReferentCheckView["draft"]> = {}): ReferentCheckView => ({ description: "Le fatture arrivano via PEC.", team: TEAM, draft: draft(d), submittedAt: null, ...over });
function view(over: Partial<ReferentAskView> = {}): ReferentAskView {
  return {
    state: "aperta",
    privacy: { accepted: true, version: "ucq-2026-10-1", contact: "privacy@example.test" },
    company: "TopJet",
    useCase: { code: "TJ-0002", title: "Fatture fornitori" },
    requester: { name: "Giulia Neri" },
    message: null,
    expiresOn: "2026-12-03",
    questions: [question(0), question(1)],
    upload: { clientMode: true },
    kind: "referente",
    check: check(),
    ...over,
  };
}

test("i passi: 1, 2 e 3 con domande; 1 e 2 senza; nessuno per le sole domande o dopo l'invio", () => {
  assert.deepEqual(stepsOf(view()), [1, 2, 3]);
  assert.deepEqual(stepsOf(view({ questions: [] })), [1, 2]);
  assert.deepEqual(stepsOf(view({ questions: [question(0, { state: "inviata" })] })), [1, 2]);
  assert.deepEqual(stepsOf(view({ kind: "domande", check: null })), []);
  assert.deepEqual(stepsOf(view({ check: check({ submittedAt: "2026-11-03T10:00:00Z" }) })), []);
  assert.equal(hasSteps(view({ state: "completata" })), false);
});

test("quando un passo è fatto: la conferma con una nota vera, la stima per la sua istantanea", () => {
  assert.equal(confirmDone(draft()), false);
  assert.equal(confirmDone(draft({ confirm: "si" })), true);
  assert.equal(confirmDone(draft({ confirm: "correggi" })), false);
  assert.equal(confirmDone(draft({ confirm: "correggi", note: " x " })), false);
  assert.equal(confirmDone(draft({ confirm: "correggi", note: "Anche via PEC" })), true);
  assert.equal(estimateDone(check()), false);
  assert.equal(estimateDone(check({}, { estimate: "si" })), true);
  assert.equal(estimateDone(check({}, { estimate: "meno" })), true, "i numeri sono facoltativi");
  assert.equal(estimateDone(check({}, { estimate: "si", stale: true })), false, "una stima cambiata riapre il passo");
  assert.equal(estimateDone(check({ team: null }, { timesPerMonth: 20 })), false);
  assert.equal(estimateDone(check({ team: null }, { timesPerMonth: 20, minutesEach: 3 })), true);
});

test("dove si arriva: il primo passo non fatto; un passo prima vale, uno dopo no", () => {
  assert.equal(firstOpenStep(view()), 1);
  assert.equal(firstOpenStep(view({ check: check({}, { confirm: "si" }) })), 2);
  assert.equal(firstOpenStep(view({ check: check({}, { confirm: "si", estimate: "si" }) })), 3);
  assert.equal(firstOpenStep(view({ questions: [], check: check({}, { confirm: "si", estimate: "si" }) })), 2, "senza domande l'ultimo è il 2");
  assert.equal(firstOpenStep(view({ check: check({}, { confirm: "si", estimate: "si", stale: true }) })), 2, "stima cambiata: di nuovo al 2");
  const done = view({ check: check({}, { confirm: "si", estimate: "si" }) });
  assert.equal(resolveStep(done, null), 3);
  assert.equal(resolveStep(done, 1), 1);
  assert.equal(resolveStep(done, 2), 2);
  assert.equal(resolveStep(view(), 3), 1, "riportato al primo non fatto");
  assert.equal(resolveStep(view({ questions: [], check: check({}, { confirm: "si", estimate: "si" }) }), 3), 2, "il 3 non c'è");
  assert.equal(resolveStep(view({ kind: "domande", check: null }), 1), 3, "le sole domande non hanno passi");
  assert.equal(parseStep("1"), 1);
  assert.equal(parseStep("3"), 3);
  for (const bad of ["0", "4", "", "x", null, undefined, " 2"]) assert.equal(parseStep(bad), null, String(bad));
  assert.equal(stepSearch(2), "?passo=2");
});

test("la barra: fatto, adesso, dopo; i nomi e il testo per i lettori di schermo", () => {
  const v = view({ check: check({}, { confirm: "si" }) });
  assert.deepEqual(stepStates(v, 2), [
    { step: 1, state: "done" },
    { step: 2, state: "current" },
    { step: 3, state: "later" },
  ]);
  assert.deepEqual(stepStates(v, 1), [
    { step: 1, state: "current" },
    { step: 2, state: "later" },
    { step: 3, state: "later" },
  ]);
  assert.deepEqual(stepLabel(1, "done"), { text: "Lo use case", suffix: " (fatto)" });
  assert.deepEqual(stepLabel(2, "current"), { text: "Il tempo", suffix: " (adesso)" });
  assert.deepEqual(stepLabel(3, "later"), { text: "Le domande", suffix: "" });
});

test("il doppio clic dopo un cambio di passo non conta", () => {
  assert.equal(STEP_SETTLE_MS, 450);
  assert.equal(isRepeatActivation({ clickCount: 2, msSinceStep: 5000 }), true);
  assert.equal(isRepeatActivation({ clickCount: 1, msSinceStep: 100 }), true);
  assert.equal(isRepeatActivation({ clickCount: 1, msSinceStep: 600 }), false);
  assert.equal(isRepeatActivation({ clickCount: 0, msSinceStep: 600 }), false, "Invio da tastiera");
});

test("i campi dei numeri: la virgola, i limiti, le etichette e i segnaposto del team", () => {
  assert.deepEqual(numberField("1,5", "minutesEach"), { ok: true, value: 1.5 });
  assert.deepEqual(numberField("", "minutesEach"), { ok: true, value: null });
  assert.deepEqual(numberField("1.200", "timesPerMonth"), { ok: true, value: 1200 });
  assert.deepEqual(numberField("100001", "minutesEach"), { ok: false });
  assert.deepEqual(numberField("tanti", "timesPerMonth"), { ok: false });
  assert.equal(numberText(1.5), "1,5");
  assert.equal(numberText(null), "");
  assert.equal(perMonthLabel("fatture"), "Fatture al mese");
  assert.equal(perMonthLabel(null), "Volte al mese");
  assert.equal(perMonthLabel("  "), "Volte al mese");
  assert.equal(placeholderOf(291.666), "291,7");
  assert.equal(placeholderOf(12), "12");
});
