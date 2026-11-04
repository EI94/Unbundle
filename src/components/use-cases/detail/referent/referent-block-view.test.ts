import test from "node:test";
import assert from "node:assert/strict";
import type { ReferentBlockCheck, ReferentBlockView, ReferentRequestView } from "../../../../lib/use-cases/referent/contract.ts";
import { findHubForbidden } from "../../../../lib/use-cases/copy-guard.ts";
import { blockCheckOf } from "../../../../lib/use-cases/referent/block.ts";
import { checkLinesOf, outcomeLine, referentBlockModel, referentHeaderLine, reviewButtonsOf } from "./referent-block-view.ts";

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
  assert.deepEqual(yes.checkLines.map((l) => l.text), ["Ha risposto il 3 nov.", "Lo use case: confermato.", "Il tempo: il team stimava 600 ore di lavoro l'anno.", "Aldo Prova: sì."]);
  assert.deepEqual(yes.menu.map((i) => i.key), ["askMore", "change", "erase"]);
  const less = checkLinesOf(CHECK({ confirm: "correggi", note: "Arrivano anche via PEC.", estimate: "meno", timesPerMonth: 200, minutesEach: 10, referentHours: 400 }), "Aldo Prova", TODAY, false);
  assert.deepEqual(
    less.map((l) => `${l.kind}:${l.text}`),
    ["text:Ha risposto il 3 nov.", "text:Lo use case: da correggere.", "quote:Arrivano anche via PEC.", "text:Il tempo: il team stimava 600 ore di lavoro l'anno.", "text:Aldo Prova: è di meno. Circa 400 ore (200 al mese, 10 minuti)."],
  );
  const changed = checkLinesOf(CHECK({ estimate: "piu", teamChanged: true }), "Aldo Prova", TODAY, false);
  assert.deepEqual(changed.slice(-2).map((l) => l.text), ["Aldo Prova: è di più.", "La stima del team è cambiata dopo la risposta."]);
  const noTeam = checkLinesOf(CHECK({ team: null, estimate: null, timesPerMonth: 20, minutesEach: 30, referentHours: 120, teamNow: false }), "Aldo Prova", TODAY, false);
  assert.deepEqual(noTeam.slice(-2).map((l) => l.text), ["Il tempo: nessuna stima del team.", "Aldo Prova: circa 120 ore di lavoro l'anno (20 al mese, 30 minuti)."]);
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
  const lines = checkLinesOf(CHECK({ confirm: "correggi", note: "n", estimate: "meno", timesPerMonth: 2, referentHours: 4 }), "Aldo", TODAY, true).map((l) => l.text);
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
  };
  const teamNow = { key: "pratiche", volumeYear: 1800, minutes: 8.5, hours: 255, perMonth: 150, perYear: null, unit: "pratiche", label: null };
  const lines = checkLinesOf(blockCheckOf(row, 3, teamNow), "Bruna Esempio", TODAY, true).map((l) => l.text);
  assert.ok(!lines.includes("La stima del team è cambiata dopo la risposta."), JSON.stringify(lines));
  assert.ok(lines.includes("Stima del referente usata il 3 nov."), JSON.stringify(lines));
  // Il team cambia ancora la stima dopo l'adozione: la riga torna.
  const later = checkLinesOf(blockCheckOf(row, 3, { ...teamNow, volumeYear: 2400 }), "Bruna Esempio", TODAY, true).map((l) => l.text);
  assert.ok(later.includes("La stima del team è cambiata dopo la risposta."), JSON.stringify(later));
});
