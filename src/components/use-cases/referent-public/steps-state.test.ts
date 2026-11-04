import test from "node:test";
import assert from "node:assert/strict";
import type { ReferentAskView, ReferentCheckView, ReferentQuestionView } from "../../../lib/use-cases/referent/contract.ts";
import {
  STEP_SETTLE_MS,
  benefitDone,
  confirmDone,
  estimateDone,
  firstOpenStep,
  hasSteps,
  isRepeatActivation,
  numberField,
  missingBenefits,
  numberText,
  parseStep,
  placeholderOf,
  resolveStep,
  stepLabel,
  stepSearch,
  stepStates,
  stepsOf,
  stepOfSubmitRefusal,
  stepOneWarning,
} from "./steps-state.ts";

// (Rilascio 5, §7.1, §7.7) I passi della pagina del referente: quali, quando sono fatti, dove si arriva.
// (Rilascio 5.1) Il passo 2 «L'impatto»: una riga per ogni voce, o i due numeri senza modello.

const N = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
const question = (i: number, over: Partial<ReferentQuestionView> = {}): ReferentQuestionView => ({ needId: N[i], position: i + 1, title: `Domanda ${i}`, state: "aperta", fileRequired: false, draft: null, answer: null, files: [], ...over });
type Row = NonNullable<ReferentCheckView["benefits"]>[number];
const rowDraft = (over: Partial<NonNullable<Row["draft"]>> = {}): NonNullable<Row["draft"]> => ({ answer: null, timesPerMonth: null, minutesEach: null, eurYear: null, comment: null, stale: false, ...over });
const ORE: Row = { key: "tempo-1", form: "ore", label: "Controllo delle fatture", team: { kind: "ore", volumeYear: 3000, minutes: 12, eurYear: null }, draft: null };
const EURO: Row = { key: "costi-1", form: "euro", label: "Meno solleciti", team: { kind: "euro", volumeYear: null, minutes: null, eurYear: 4000 }, draft: null };
const FATTO: Row = { key: "qualita-1", form: "fatto", label: "Meno errori", team: { kind: "qualitativo", volumeYear: null, minutes: null, eurYear: null }, draft: null };
const NUMERI: Row = { key: "tempo-2", form: "ore_numeri", label: "Archiviazione", team: { kind: "ore", volumeYear: 0, minutes: 0, eurYear: null }, draft: null };
/** Le tre righe di prova, tutte con una risposta. */
const answeredRows = (): Row[] => [{ ...ORE, draft: rowDraft({ answer: "si" }) }, { ...EURO, draft: rowDraft({ answer: "meno" }) }, { ...FATTO, draft: rowDraft({ answer: "non_so" }) }];
const draft = (over: Partial<ReferentCheckView["draft"]> = {}): ReferentCheckView["draft"] => ({ confirm: null, note: null, estimate: null, timesPerMonth: null, minutesEach: null, stale: false, savedAt: null, ...over });
const check = (over: Partial<ReferentCheckView> = {}, d: Partial<ReferentCheckView["draft"]> = {}): ReferentCheckView => ({ description: "Le fatture arrivano via PEC.", benefits: [ORE, EURO, FATTO], draft: draft(d), submittedAt: null, ...over });
/** Una conferma con «Sì, è così» e (con `impact`) ogni riga dell'impatto con la sua risposta. */
const confirmed = (impact = true, over: Partial<ReferentCheckView> = {}): ReferentCheckView => check({ ...(impact ? { benefits: answeredRows() } : {}), ...over }, { confirm: "si" });
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
  // (Rilascio 5.1) Con un modello: ogni riga con la sua risposta.
  assert.equal(estimateDone(check()), false);
  assert.equal(estimateDone(check({ benefits: answeredRows() })), true);
  assert.equal(estimateDone(check({ benefits: [{ ...ORE, draft: rowDraft({ answer: "meno" }) }] })), true, "i numeri sono facoltativi");
  assert.equal(estimateDone(check({ benefits: [...answeredRows().slice(0, 2), FATTO] })), false, "una riga senza risposta");
  assert.deepEqual(missingBenefits(check({ benefits: [...answeredRows().slice(0, 2), FATTO] })), ["qualita-1"]);
  assert.equal(estimateDone(check({ benefits: [{ ...ORE, draft: rowDraft({ answer: "si", stale: true }) }] })), false, "una cifra cambiata riapre la riga");
  assert.equal(estimateDone(check({ benefits: [] })), false);
  assert.equal(benefitDone({ ...NUMERI, draft: rowDraft({ timesPerMonth: 20 }) }), false, "i due numeri, tutti e due");
  assert.equal(benefitDone({ ...NUMERI, draft: rowDraft({ timesPerMonth: 20, minutesEach: 5 }) }), true);
  assert.equal(benefitDone({ ...FATTO, draft: rowDraft({ answer: "meno" }) }), false, "una scelta che non è della sua forma");
  assert.equal(benefitDone({ ...EURO, draft: rowDraft({ comment: "Solo il commento" }) }), false);
  // Senza modello: i due numeri del tempo (rilascio 5).
  assert.equal(estimateDone(check({ benefits: null }, { timesPerMonth: 20 })), false);
  assert.equal(estimateDone(check({ benefits: null }, { timesPerMonth: 20, minutesEach: 3 })), true);
  assert.equal(estimateDone(check({ benefits: null }, { timesPerMonth: 20, minutesEach: 3, stale: true })), false);
});

test("dove si arriva: il primo passo non fatto; un passo prima vale, uno dopo no", () => {
  assert.equal(firstOpenStep(view()), 1);
  assert.equal(firstOpenStep(view({ check: check({}, { confirm: "si" }) })), 2);
  assert.equal(firstOpenStep(view({ check: confirmed() })), 3);
  assert.equal(firstOpenStep(view({ questions: [], check: confirmed() })), 2, "senza domande l'ultimo è il 2");
  assert.equal(firstOpenStep(view({ check: confirmed(true, { benefits: [{ ...ORE, draft: rowDraft({ answer: "si", stale: true }) }] }) })), 2, "cifra cambiata: di nuovo al 2");
  assert.equal(firstOpenStep(view({ check: check({ benefits: null }, { confirm: "si", timesPerMonth: 20, minutesEach: 3 }) })), 3, "senza modello, i due numeri");
  const done = view({ check: confirmed() });
  assert.equal(resolveStep(done, null), 3);
  assert.equal(resolveStep(done, 1), 1);
  assert.equal(resolveStep(done, 2), 2);
  assert.equal(resolveStep(view(), 3), 1, "riportato al primo non fatto");
  assert.equal(resolveStep(view({ questions: [], check: confirmed() }), 3), 2, "il 3 non c'è");
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
  assert.deepEqual(stepLabel(2, "current"), { text: "L'impatto", suffix: " (adesso)" });
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
  assert.deepEqual(numberField("1.200,50", "eurYear"), { ok: true, value: 1200.5 });
  assert.deepEqual(numberField("1000000001", "eurYear"), { ok: false });
  assert.equal(numberText(1.5), "1,5");
  assert.equal(numberText(null), "");
  assert.equal(placeholderOf(291.666), "291,7");
  assert.equal(placeholderOf(12), "12");
});

test("un «Invia» rifiutato per la conferma o la stima riporta al suo passo, con il messaggio lì", () => {
  assert.deepEqual(stepOfSubmitRefusal({ code: "conferma_mancante", message: "Manca la conferma." }), { step: 1, message: "Manca la conferma." });
  assert.deepEqual(stepOfSubmitRefusal({ code: "stima_mancante", message: "Manca la stima." }), { step: 2, message: "Manca la stima." });
  // La nota di «Correggi» con un nome o un'email: il campo «conferma» non è di nessuna domanda, si torna al passo 1.
  const NAME = "Non scrivere nomi di persone: indica il ruolo.";
  assert.deepEqual(stepOfSubmitRefusal({ code: "risposte_da_correggere", message: "Alcune risposte vanno corrette: le trovi evidenziate.", issues: [{ field: "conferma", message: NAME }] }), { step: 1, message: NAME });
  assert.deepEqual(
    stepOfSubmitRefusal({ code: "risposte_da_correggere", message: "x", issues: [{ field: "aaaaaaaa-0000-4000-8000-000000000001", message: "Sulla domanda" }, { field: "conferma", message: NAME }] }),
    { step: 1, message: NAME },
    "prima la nota, poi le domande",
  );
  // (Rilascio 5.1) Il commento di una riga dell'impatto: si torna al passo 2.
  assert.deepEqual(stepOfSubmitRefusal({ code: "risposte_da_correggere", message: "x", issues: [{ field: "beneficio.costi-1", message: "Sul commento" }] }), { step: 2, message: "Sul commento" });
  // Le domande da correggere restano dove sono: evidenziate sulla loro domanda.
  assert.equal(stepOfSubmitRefusal({ code: "risposte_da_correggere", message: "x", issues: [{ field: "aaaaaaaa-0000-4000-8000-000000000001", message: "Sulla domanda" }] }), null);
  assert.equal(stepOfSubmitRefusal({ code: "domande_aperte", message: "x", issues: [] }), null);
  assert.equal(stepOfSubmitRefusal({ code: "rete", message: "x" }), null);
});

test("l'avviso di una bozza si dice solo per la nota del passo 1, il primo del server", () => {
  assert.equal(stepOneWarning({ step: 1 }, [{ message: "Non scrivere nomi di persone." }, { message: "altro" }]), "Non scrivere nomi di persone.");
  assert.equal(stepOneWarning({ step: 1 }, []), null, "una bozza pulita toglie l'avviso di prima");
  assert.equal(stepOneWarning({ step: 1 }, undefined), null);
  assert.equal(stepOneWarning({ step: 2 }, [{ message: "x" }]), null);
});
