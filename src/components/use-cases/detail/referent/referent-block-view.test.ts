import test from "node:test";
import assert from "node:assert/strict";
import type { ReferentBlockCheck, ReferentBlockView, ReferentRequestView } from "../../../../lib/use-cases/referent/contract.ts";
import { findHubForbidden } from "../../../../lib/use-cases/copy-guard.ts";
import { blockCheckOf } from "../../../../lib/use-cases/referent/block.ts";
import { benefitButtonsOf, benefitLinesOf, checkLinesOf, outcomeLine, referentBlockModel, referentHeaderLine, reviewButtonsOf, type CheckLine } from "./referent-block-view.ts";

/** Il testo di una riga della conferma (il pulsante: la sua etichetta; una voce: la sua prima riga). */
const txt = (l: CheckLine) => (l.kind === "button" ? l.button.label : l.kind === "benefit" ? l.benefit.head : l.text);

// Il blocco «Referente» (rilascio 5, SPEC §9.2): righe e pulsanti per stato, nessun pulsante pieno, nessun conteggio per persona.

const TODAY = "2026-11-03";
const R: ReferentRequestView = {
  id: "aaaaaaaa-0000-4000-8000-000000000101",
  version: 2,
  contact: { id: "aaaaaaaa-0000-4000-8000-000000000001", name: "Aldo Prova", roleLabel: "Amministrazione", emailMasked: "a•••@cliente.test", hubOnly: true },
  status: "inviata",
  statusLabel: "In attesa",
  silent: false,
  lines: [],
  notices: [],
  email: { state: "partita", label: null },
  needIds: [],
  openNeedIds: [],
  kind: "referente",
  actions: { remind: { allowed: true, reason: null }, add: { allowed: true, reason: null }, revoke: true, askAgain: false, retry: false, correctEmail: true, erase: true },
  createdAt: "2026-11-02T09:00:00.000Z",
  expiresAt: "2026-12-02T09:00:00.000Z",
  sentAt: "2026-11-02T09:00:05.000Z",
  lastReminderAt: null,
};
const CHECK = (over: Partial<ReferentBlockCheck> = {}): ReferentBlockCheck => ({
  submittedAt: "2026-11-03T10:00:00.000Z",
  confirm: "si",
  note: null,
  estimate: "si",
  timesPerMonth: null,
  minutesEach: null,
  correctionDoneAt: null,
  outcome: null,
  outcomeAt: null,
  team: { key: "pratiche", volumeYear: 3000, minutes: 12, hours: 600, perMonth: 250 },
  teamChanged: false,
  teamNow: true,
  referentHours: null,
  version: 3,
  ...over,
});
const REF = (over: Partial<ReferentBlockView> = {}): ReferentBlockView => ({
  contact: { id: R.contact.id, name: "Aldo Prova", roleLabel: "Amministrazione", emailMasked: "a•••@cliente.test", team: false },
  requestId: R.id,
  referentRequestId: R.id,
  state: "in_attesa",
  review: null,
  live: true,
  check: CHECK({ submittedAt: null, confirm: null, estimate: null }),
  declinedNeedIds: [],
  hints: [],
  askableForReferent: [],
  ...over,
});
const base = { canAssign: true, canAsk: true, boxOwnsChoose: false, canAskMore: false, today: TODAY };

test("manca: «Manca il referente.» e «Scegli il referente» non pieno, salvo quando il riquadro ha già quello pieno", () => {
  const m = referentBlockModel({ ...base, referent: null, request: null });
  assert.equal(m.state, "manca");
  assert.deepEqual(m.lines, [{ kind: "text", text: "Manca il referente." }]);
  assert.deepEqual(m.buttons, [{ key: "choose", label: "Scegli il referente", variant: "outline" }]);
  assert.deepEqual(referentBlockModel({ ...base, referent: null, request: null, boxOwnsChoose: true }).buttons, []);
  assert.deepEqual(referentBlockModel({ ...base, referent: null, request: null, canAssign: false }).buttons, []);
  assert.equal(referentHeaderLine(null), null, "in «Manca il referente» niente riga sotto il titolo (D37)");
});

test("in attesa: la persona, la riga di attesa, «Altro» con promemoria, cambio, revoca, email, cancellazione", () => {
  const m = referentBlockModel({ ...base, referent: REF(), request: R });
  assert.equal(m.name, "Aldo Prova");
  assert.equal(m.meta, "Amministrazione");
  assert.deepEqual(m.lines, [{ kind: "muted", text: "In attesa del referente · inviata il 2 nov · scade il 2 dic" }]);
  assert.deepEqual(m.checkLines, []);
  assert.deepEqual(m.buttons, []);
  assert.deepEqual(m.menu.map((i) => i.key), ["remind", "change", "revoke", "correct", "erase"]);
  const reminded = referentBlockModel({ ...base, referent: REF(), request: { ...R, lastReminderAt: "2026-11-05T09:00:00.000Z" } });
  assert.match((reminded.lines[0] as { text: string }).text, / · promemoria inviato il 5 nov$/);
  assert.equal(referentHeaderLine(REF()), "Referente: Aldo Prova · In attesa del referente");
});

test("nessuna risposta: «Chiedi di nuovo» visibile, non pieno", () => {
  const expired = { ...R, status: "scaduta" as const, actions: { ...R.actions, askAgain: true } };
  const m = referentBlockModel({ ...base, referent: REF({ state: "nessuna_risposta", live: false }), request: expired });
  assert.deepEqual(m.lines[0], { kind: "muted", text: "Nessuna risposta · inviata il 2 nov · scaduta il 2 dic" });
  assert.deepEqual(m.buttons, [{ key: "askAgain", label: "Chiedi di nuovo", variant: "outline" }]);
  assert.ok(!m.menu.some((i) => i.key === "revoke"));
});

test("ha risposto: la conferma, la stima del team e quella del referente; mai «Revoca il link» su una risposta", () => {
  const yes = referentBlockModel({ ...base, referent: REF({ state: "fatto", live: false, check: CHECK() }), request: { ...R, status: "completata" }, canAskMore: true });
  assert.deepEqual(yes.checkLines.map(txt), ["Ha risposto il 3 nov.", "Lo use case: confermato.", "Il tempo: il team stimava 600 ore di lavoro l'anno.", "Aldo Prova: sì."]);
  assert.deepEqual(yes.menu.map((i) => i.key), ["askMore", "change", "erase"]);
  const less = checkLinesOf(CHECK({ confirm: "correggi", note: "Arrivano anche via PEC.", estimate: "meno", timesPerMonth: 200, minutesEach: 10, referentHours: 400 }), "Aldo Prova", TODAY, false);
  assert.deepEqual(
    less.map((l) => `${l.kind}:${txt(l)}`),
    ["text:Ha risposto il 3 nov.", "text:Lo use case: da correggere.", "quote:Arrivano anche via PEC.", "text:Il tempo: il team stimava 600 ore di lavoro l'anno.", "text:Aldo Prova: è di meno. Circa 400 ore (200 al mese, 10 minuti)."],
  );
  const changed = checkLinesOf(CHECK({ estimate: "piu", teamChanged: true }), "Aldo Prova", TODAY, false);
  assert.deepEqual(changed.slice(-2).map(txt), ["Aldo Prova: è di più.", "La stima del team è cambiata dopo la risposta."]);
  const noTeam = checkLinesOf(CHECK({ team: null, estimate: null, timesPerMonth: 20, minutesEach: 30, referentHours: 120, teamNow: false }), "Aldo Prova", TODAY, false);
  assert.deepEqual(noTeam.slice(-2).map(txt), ["Il tempo: nessuna stima del team.", "Aldo Prova: circa 120 ore di lavoro l'anno (20 al mese, 30 minuti)."]);
  const old = referentBlockModel({ ...base, referent: REF({ state: "fatto", live: false, check: CHECK({ submittedAt: null, confirm: null, estimate: null }) }), request: { ...R, status: "completata" } });
  assert.deepEqual(old.checkLines, [{ kind: "text", text: "Lo use case: nessuna conferma." }], "dopo un ritorno alla versione di prima (RUNBOOK §10.9 punto 7)");
});

test("le azioni del team sulla risposta (§9.2): usare, tenere, rivedere, aggiungere; mai pieni", () => {
  const numbers = CHECK({ estimate: "meno", timesPerMonth: 200, minutesEach: null, referentHours: 480 });
  assert.deepEqual(reviewButtonsOf(numbers, "Aldo Prova", true).map((b) => `${b.key}:${b.variant}:${b.label}`), ["adopt:outline:Usa la stima di Aldo Prova", "keep:ghost:Tieni la nostra"]);
  assert.deepEqual(reviewButtonsOf(numbers, "Aldo Prova", false).map((b) => b.key), ["keep"], "senza permesso sulla valutazione, niente «Usa la stima»");
  assert.deepEqual(reviewButtonsOf(CHECK({ estimate: "piu" }), "Aldo Prova", true).map((b) => `${b.key}:${b.variant}`), ["review:link", "seen:ghost"]);
  assert.deepEqual(reviewButtonsOf(CHECK({ team: null, estimate: null, timesPerMonth: 20, minutesEach: 30, teamNow: false }), "Aldo Prova", true).map((b) => b.key), ["addEstimate", "notNeeded"]);
  assert.deepEqual(reviewButtonsOf(CHECK({ confirm: "correggi", note: "x" }), "Aldo Prova", true).map((b) => b.key), ["correctionDone"]);
  assert.deepEqual(reviewButtonsOf(CHECK(), "Aldo Prova", true), [], "«Sì»: niente da decidere");
  assert.deepEqual(reviewButtonsOf(CHECK({ estimate: "meno", timesPerMonth: 1, outcome: "tenuta", outcomeAt: "2026-11-04T09:00:00.000Z" }), "Aldo Prova", true), []);
  assert.equal(outcomeLine(CHECK({ outcome: "adottata", outcomeAt: "2026-11-04T09:00:00.000Z", timesPerMonth: 1 }), TODAY), "Stima del referente usata il 4 nov.");
  assert.equal(outcomeLine(CHECK({ outcome: "tenuta", outcomeAt: "2026-11-04T09:00:00.000Z", timesPerMonth: 1 }), TODAY), "Tenuta la stima del team.");
  assert.equal(outcomeLine(CHECK({ outcome: "tenuta", outcomeAt: "2026-11-04T09:00:00.000Z", estimate: "piu" }), TODAY), "Vista il 4 nov.");
  assert.equal(outcomeLine(CHECK({ outcome: "tenuta", outcomeAt: "2026-11-04T09:00:00.000Z", team: null }), TODAY), "Stima del referente non usata.");
  assert.equal(outcomeLine(CHECK({ team: null, teamNow: true, estimate: null }), TODAY), "Il team ha aggiunto una stima.");
  const withReview = referentBlockModel({ ...base, referent: REF({ state: "da_verificare", review: "stima", live: false, check: numbers }), request: { ...R, status: "completata" }, withReview: true, canEditValuation: true });
  assert.deepEqual(withReview.buttons.map((b) => b.key), ["adopt", "keep"]);
  for (const b of withReview.buttons) assert.notEqual(b.variant, "default" as never);
});

test("i testi del blocco passano il controllo dell'area", () => {
  const lines = checkLinesOf(CHECK({ confirm: "correggi", note: "n", estimate: "meno", timesPerMonth: 2, referentHours: 4 }), "Aldo", TODAY, true).map(txt);
  for (const text of lines) assert.deepEqual(findHubForbidden(text, "area"), [], text);
});

test("dopo «Usa la stima di …»: «Stima del referente usata il …», mai «La stima del team è cambiata dopo la risposta.»", () => {
  // La riga del pannello dopo l'adozione: il componente del team ha i numeri del referente (150 × 12 volte, 8,5 minuti).
  const row = {
    submittedAt: new Date("2026-11-03T10:00:00.000Z"),
    confirm: "si" as const,
    confirmNote: null,
    estimate: "meno" as const,
    timesPerMonth: 150,
    minutesEach: 8.5,
    teamComponentKey: "pratiche",
    teamVolumeYear: 3000,
    teamMinutes: 12,
    correctionDoneAt: null,
    estimateOutcome: "adottata" as const,
    estimateOutcomeAt: new Date("2026-11-03T11:00:00.000Z"),
    benefits: null,
  };
  const teamNow = { key: "pratiche", volumeYear: 1800, minutes: 8.5, hours: 255, perMonth: 150, perYear: null, unit: "pratiche", label: null };
  const lines = checkLinesOf(blockCheckOf(row, 3, teamNow), "Bruna Esempio", TODAY, true).map(txt);
  assert.ok(!lines.includes("La stima del team è cambiata dopo la risposta."), JSON.stringify(lines));
  assert.ok(lines.includes("Stima del referente usata il 3 nov."), JSON.stringify(lines));
  // Il team cambia ancora la stima dopo l'adozione: la riga torna.
  const later = checkLinesOf(blockCheckOf(row, 3, { ...teamNow, volumeYear: 2400 }), "Bruna Esempio", TODAY, true).map(txt);
  assert.ok(later.includes("La stima del team è cambiata dopo la risposta."), JSON.stringify(later));
});

test("«Fatto» della correzione sta subito sotto la nota; i pulsanti della stima restano nella loro riga", () => {
  const both = CHECK({ confirm: "correggi", note: "Arrivano anche via PEC.", estimate: "meno" });
  const m = referentBlockModel({ ...base, referent: REF({ state: "da_verificare", review: "correzione", live: false, check: both }), request: { ...R, status: "completata" }, withReview: true, canEditValuation: true });
  const at = m.checkLines.findIndex((l) => l.kind === "quote");
  const next = m.checkLines[at + 1];
  assert.ok(at > 0, "la nota c'è");
  assert.deepEqual(next?.kind === "button" ? [next.button.key, next.button.label, next.button.variant] : null, ["correctionDone", "Fatto", "ghost"]);
  assert.deepEqual(m.buttons.map((b) => b.key), ["review", "seen"], "una sola «Fatto» nella riga della stima");
  // Senza nota, «Fatto» sta sotto «Lo use case: da correggere.».
  const noNote = referentBlockModel({ ...base, referent: REF({ state: "da_verificare", review: "correzione", live: false, check: CHECK({ confirm: "correggi", note: null }) }), request: { ...R, status: "completata" }, withReview: true });
  const fix = noNote.checkLines.findIndex((l) => l.kind === "button");
  assert.equal((noNote.checkLines[fix - 1] as { text: string }).text, "Lo use case: da correggere.");
  assert.deepEqual(noNote.buttons, []);
  // Dopo «Usa la stima di …» nessun «Fatto» da solo sotto la stima: resta solo quello sotto la nota.
  const adopted = CHECK({ confirm: "correggi", note: "x", estimate: "meno", timesPerMonth: 2, referentHours: 4, outcome: "adottata", outcomeAt: "2026-11-04T09:00:00.000Z" });
  const after = referentBlockModel({ ...base, referent: REF({ state: "da_verificare", review: "correzione", live: false, check: adopted }), request: { ...R, status: "completata" }, withReview: true, canEditValuation: true });
  assert.deepEqual(after.buttons, []);
  assert.deepEqual(after.checkLines.filter((l) => l.kind === "button").length, 1);
  // Senza le azioni del team (withReview false) nessun pulsante tra le righe.
  const plain = referentBlockModel({ ...base, referent: REF({ state: "da_verificare", review: "correzione", live: false, check: both }), request: { ...R, status: "completata" } });
  assert.ok(!plain.checkLines.some((l) => l.kind === "button"));
});

// ─── (Rilascio 5.1) La risposta per beneficio ────────────────────────

type Benefit = NonNullable<ReferentBlockCheck["benefits"]>[number];
const BENEFIT = (over: Partial<Benefit> = {}): Benefit => ({
  key: "tempo-1",
  form: "ore",
  label: "Controllo delle fatture",
  team: { kind: "ore", volumeYear: 3000, minutes: 12, eurYear: null },
  answer: "si",
  timesPerMonth: null,
  minutesEach: null,
  eurYear: null,
  comment: null,
  outcome: null,
  outcomeAt: null,
  changed: null,
  needsReview: false,
  adoptable: false,
  ...over,
});
const EURO = (over: Partial<Benefit> = {}) => BENEFIT({ key: "costi-1", form: "euro", label: "Meno solleciti", team: { kind: "euro", volumeYear: null, minutes: null, eurYear: 4000 }, ...over });
const FATTO = (over: Partial<Benefit> = {}) => BENEFIT({ key: "qualita-1", form: "fatto", label: "Meno errori", team: { kind: "qualitativo", volumeYear: null, minutes: null, eurYear: null }, ...over });
const NUMERI = (over: Partial<Benefit> = {}) => BENEFIT({ key: "tempo-2", form: "ore_numeri", label: "Archiviazione", team: { kind: "ore", volumeYear: 0, minutes: 0, eurYear: null }, answer: null, ...over });
const lineOf = (b: Benefit, review = false) => {
  const l = benefitLinesOf(b, "Aldo Prova", TODAY, review);
  return [l.head, l.says, ...(l.comment ? [`«${l.comment}»`] : []), ...l.notes];
};

test("per beneficio: ogni voce con la cifra che il referente ha visto e la sua risposta, in parole semplici", () => {
  assert.deepEqual(lineOf(BENEFIT()), ["Controllo delle fatture: il team stimava 600 ore di lavoro l'anno.", "Aldo Prova: sì."]);
  assert.deepEqual(lineOf(BENEFIT({ answer: "piu", timesPerMonth: 300 })), ["Controllo delle fatture: il team stimava 600 ore di lavoro l'anno.", "Aldo Prova: è di più. Circa 720 ore (300 al mese, 12 minuti)."]);
  assert.deepEqual(lineOf(BENEFIT({ answer: "meno", minutesEach: 9 }))[1], "Aldo Prova: è di meno. Circa 450 ore (250 al mese, 9 minuti).");
  assert.deepEqual(lineOf(BENEFIT({ answer: "meno" }))[1], "Aldo Prova: è di meno.");
  assert.deepEqual(lineOf(EURO({ answer: "meno", eurYear: 3500 })), ["Meno solleciti: il team stimava 4.000 € l'anno.", "Aldo Prova: è di meno. Circa 3.500 € l'anno."]);
  assert.deepEqual(lineOf(EURO()), ["Meno solleciti: il team stimava 4.000 € l'anno.", "Aldo Prova: sì."]);
  assert.deepEqual(lineOf(FATTO({ answer: "no", comment: "Solo a fine mese." })), ["Meno errori.", "Aldo Prova: non succede.", "«Solo a fine mese.»"]);
  assert.deepEqual(lineOf(FATTO())[1], "Aldo Prova: succede.");
  assert.deepEqual(lineOf(FATTO({ answer: "non_so" }))[1], "Aldo Prova: non lo sa.");
  assert.deepEqual(lineOf(NUMERI({ timesPerMonth: 20, minutesEach: 5 })), ["Archiviazione: nessuna stima del team.", "Aldo Prova: circa 20 ore di lavoro l'anno (20 al mese, 5 minuti)."]);
  assert.deepEqual(lineOf(BENEFIT({ answer: "piu", changed: "cambiata" })).slice(-1), ["La stima del team è cambiata dopo la risposta."]);
  assert.deepEqual(lineOf(FATTO({ changed: "tolta" })).slice(-1), ["Questa voce non c'è più nella valutazione."]);
  // Una riga senza risposta salvata: mai «sì» o «succede» al posto del referente.
  for (const b of [BENEFIT({ answer: null }), EURO({ answer: null }), FATTO({ answer: null }), NUMERI({ timesPerMonth: 20, minutesEach: null })]) {
    assert.equal(lineOf(b)[1], "Aldo Prova: nessuna risposta.", b.key);
  }
  // Dopo la decisione del team.
  const at = "2026-11-04T09:00:00.000Z";
  assert.deepEqual(lineOf(BENEFIT({ answer: "piu", timesPerMonth: 300, outcome: "adottata", outcomeAt: at, adoptable: true }), true).slice(-1), ["Stima del referente usata il 4 nov."]);
  assert.deepEqual(lineOf(BENEFIT({ answer: "piu", timesPerMonth: 300, outcome: "tenuta", outcomeAt: at, adoptable: true }), true).slice(-1), ["Tenuta la stima del team."]);
  assert.deepEqual(lineOf(FATTO({ answer: "no", outcome: "tenuta", outcomeAt: at }), true).slice(-1), ["Vista il 4 nov."]);
  assert.deepEqual(lineOf(NUMERI({ timesPerMonth: 20, minutesEach: 5, outcome: "tenuta", outcomeAt: at, adoptable: true }), true).slice(-1), ["Stima del referente non usata."]);
  for (const b of [BENEFIT({ answer: "piu", timesPerMonth: 300 }), EURO({ answer: "meno", eurYear: 1 }), FATTO({ answer: "no" }), NUMERI({ timesPerMonth: 1, minutesEach: 1 })]) {
    for (const text of lineOf(b, true)) assert.deepEqual(findHubForbidden(text, "area"), [], text);
  }
});

test("per beneficio: i pulsanti del team sotto ogni voce che aspetta, mai pieni; «Usa la stima di …» solo con numeri e il permesso", () => {
  const keys = (b: Benefit, can = true) => benefitButtonsOf(b, "Aldo Prova", can).map((x) => `${x.key}:${x.variant}:${x.label}:${x.benefit}`);
  assert.deepEqual(keys(BENEFIT({ answer: "piu", timesPerMonth: 300, needsReview: true, adoptable: true })), ["adopt:outline:Usa la stima di Aldo Prova:tempo-1", "keep:ghost:Tieni la nostra:tempo-1"]);
  assert.deepEqual(keys(BENEFIT({ answer: "piu", timesPerMonth: 300, needsReview: true, adoptable: true }), false), ["keep:ghost:Tieni la nostra:tempo-1"]);
  assert.deepEqual(keys(BENEFIT({ answer: "piu", timesPerMonth: 300, needsReview: true, adoptable: true, changed: "cambiata" })), ["keep:ghost:Tieni la nostra:tempo-1"], "una cifra cambiata non si sovrascrive");
  assert.deepEqual(keys(EURO({ answer: "meno", needsReview: true })), ["review:link:Rivedi la stima:costi-1", "seen:ghost:Fatto:costi-1"]);
  assert.deepEqual(keys(FATTO({ answer: "no", needsReview: true })), ["seen:ghost:Fatto:qualita-1"]);
  assert.deepEqual(keys(NUMERI({ timesPerMonth: 20, minutesEach: 5, needsReview: true, adoptable: true })), ["adopt:outline:Usa la stima di Aldo Prova:tempo-2", "keep:ghost:Non serve:tempo-2"]);
  assert.deepEqual(keys(BENEFIT()), [], "«Sì»: niente da decidere");
  // Una voce tolta dalla valutazione dopo la risposta: solo «Fatto», così lo use case non resta in «Risposte da verificare».
  assert.deepEqual(keys(FATTO({ answer: "no", needsReview: true, changed: "tolta" })), ["seen:ghost:Fatto:qualita-1"], "una voce tolta: solo «Fatto»");
  assert.deepEqual(keys(BENEFIT({ answer: "piu", timesPerMonth: 300, needsReview: true, adoptable: true, changed: "tolta" })), ["seen:ghost:Fatto:tempo-1"], "una voce a ore tolta: niente «Usa la stima»");
  assert.deepEqual(keys(EURO({ answer: "meno", needsReview: true, changed: "tolta" })), ["seen:ghost:Fatto:costi-1"], "una voce in euro tolta: niente «Rivedi la stima»");
  assert.deepEqual(keys(FATTO({ answer: "no", needsReview: false, changed: "tolta", outcome: "tenuta" })), [], "già vista: niente");
  // Nel blocco: le righe di ogni voce con i loro pulsanti; in fondo niente, salvo «Fatto» della correzione sotto la nota.
  const check = CHECK({ team: null, estimate: null, confirm: "correggi", note: "Anche via PEC.", benefits: [BENEFIT({ answer: "piu", timesPerMonth: 300, needsReview: true, adoptable: true }), FATTO({ answer: "no", needsReview: true }), EURO()] });
  const m = referentBlockModel({ ...base, referent: REF({ state: "da_verificare", review: "correzione", live: false, check }), request: { ...R, status: "completata" }, withReview: true, canEditValuation: true });
  assert.deepEqual(m.buttons, []);
  const shape = m.checkLines.map((l) => (l.kind === "benefit" ? `voce:${l.benefit.key}:${l.benefit.buttons.map((b) => b.key).join("+")}` : l.kind === "button" ? `pulsante:${l.button.key}` : `${l.kind}:${l.text}`));
  assert.deepEqual(shape, ["text:Ha risposto il 3 nov.", "text:Lo use case: da correggere.", "quote:Anche via PEC.", "pulsante:correctionDone", "voce:tempo-1:adopt+keep", "voce:qualita-1:seen", "voce:costi-1:"]);
  assert.ok(!m.checkLines.some((l) => l.kind === "text" && l.text.startsWith("Il tempo:")), "niente righe della stima del tempo del rilascio 5");
  // Senza le azioni (il pannello di lato): solo le righe.
  const plain = referentBlockModel({ ...base, referent: REF({ state: "da_verificare", review: "stima", live: false, check }), request: { ...R, status: "completata" } });
  assert.ok(plain.checkLines.every((l) => l.kind !== "benefit" || l.benefit.buttons.length === 0));
});
