import test from "node:test";
import assert from "node:assert/strict";
import { CASE_STATUSES, type CaseStatus } from "../uc/vocab.ts";
import { findHubForbidden } from "./copy-guard.ts";
import { applyDecision, DECISION_MESSAGES, type DecisionCard } from "./decisions.ts";
import {
  ACTION_FAILED_MESSAGE,
  ARCHIVE_OPTIONS,
  DECISION_KEYS,
  DECISION_LABEL,
  DIALOG_COMMON_TEXT,
  DIALOG_EXTRA_TEXT,
  PUBLIC_NOTE_TEXT,
  REDACTED_PLACEHOLDER,
  addDays,
  addMonths,
  checkDecisionNote,
  checkPostponeDate,
  checkWhenLabels,
  proposesNoteUpdate,
  currentWhenChoice,
  decisionLayout,
  decisionNote,
  decisionToast,
  dialogText,
  draftFollowsSavedNote,
  followPageNote,
  lastSavedNote,
  dossierSituation,
  duplicateCandidates,
  futureDayLabel,
  instantOfDay,
  isActionTarget,
  minPostponeDate,
  parseDecisionInput,
  parseWhenChoice,
  postponeOptions,
  publicNoteChange,
  publicNoteCounter,
  publicNoteFieldState,
  publicNoteHints,
  publicNotePrefill,
  reopenDestination,
  rereadsPage,
  showMarkInProgress,
  STALE_PAGE_ERRORS,
  staleWhenLabelsResult,
  teamValuationMissing,
  toActionResult,
  toDecisionItem,
  toDuplicateCandidates,
  typedDuplicateCode,
  visibilityToast,
  whenOptions,
  type DecisionItem,
  type DecisionKey,
  type DecisionLayout,
} from "./decision-ui.ts";
import { PUBLIC_NOTE_REQUIRED_ERROR, tooLongMessage } from "./inputs.ts";
import { SERVICE_ERRORS, type Decision, type LifecycleStatus, type Phase, type SubState, type UseCaseKind } from "./types.ts";

// Le decisioni a schermo: docs/use-case/DESIGN.md §3.6, §3.7, §6.4, §6.5, §14.3 (PIANO-LAVORI
// H3b). Codici, titoli e note sintetici.

/** 14 ottobre 2026, a metà mattina a Roma. */
const OCT_14 = new Date("2026-10-14T08:00:00Z");

// ─── «Rimanda»: date proposte nel fuso giusto ────────────────────────

test("Rimanda: le date proposte da oggi a Roma, con le etichette di §14.3", () => {
  assert.deepEqual(postponeOptions(OCT_14), [
    { key: "un_mese", label: "Tra un mese (14 nov)", date: "2026-11-14" },
    { key: "tre_mesi", label: "Tra tre mesi (14 gen)", date: "2027-01-14" },
    { key: "prossimo_trimestre", label: "All'inizio del prossimo trimestre (1 gen)", date: "2027-01-01" },
    { key: "data", label: "Scegli una data", date: null },
  ]);
});

test("Rimanda: a mezzanotte il giorno è quello di Roma, non quello del server (UTC)", () => {
  // 31 dicembre, 23:30 UTC: a Roma è già il primo gennaio 2027 (trimestre T1).
  const newYear = new Date("2026-12-31T23:30:00Z");
  assert.deepEqual(
    postponeOptions(newYear).map((option) => option.date),
    ["2027-02-01", "2027-04-01", "2027-04-01", null],
  );
  assert.equal(minPostponeDate(newYear), "2027-01-02", "domani a Roma");
  // Ora legale: 31 marzo, 22:30 UTC è il primo aprile a Roma (T2).
  const april = new Date("2026-03-31T22:30:00Z");
  assert.deepEqual(
    postponeOptions(april).map((option) => option.date),
    ["2026-05-01", "2026-07-01", "2026-07-01", null],
  );
  // Un'ora prima a Roma è ancora il 31 marzo (T1): il prossimo trimestre parte il primo aprile.
  const march = new Date("2026-03-31T21:30:00Z");
  assert.deepEqual(
    postponeOptions(march).map((option) => option.date),
    ["2026-04-30", "2026-06-30", "2026-04-01", null],
  );
});

test("Rimanda: le date proposte sono sempre future, anche alla fine di un mese o del trimestre", () => {
  for (const iso of ["2026-01-31T12:00:00Z", "2026-03-31T09:00:00Z", "2027-12-31T22:59:00Z", "2028-02-29T12:00:00Z", "2026-06-30T21:59:00Z"]) {
    const now = new Date(iso);
    const tomorrow = minPostponeDate(now);
    for (const option of postponeOptions(now)) {
      if (option.date === null) continue;
      assert.ok(option.date >= tomorrow, `${iso}: ${option.key} ${option.date} non è futura`);
      assert.deepEqual(checkPostponeDate(option.date, now), { ok: true, date: option.date }, `${iso}: ${option.key}`);
    }
  }
});

test("addMonths tiene l'ultimo giorno del mese più corto; addDays passa il mese e l'anno", () => {
  assert.equal(addMonths("2027-01-31", 1), "2027-02-28");
  assert.equal(addMonths("2028-01-31", 1), "2028-02-29");
  assert.equal(addMonths("2026-11-30", 3), "2027-02-28");
  assert.equal(addMonths("2026-10-14", 12), "2027-10-14");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.throws(() => addMonths("2026-02-30", 1), RangeError);
});

test("Rimanda: data obbligatoria e futura (a Roma)", () => {
  assert.deepEqual(checkPostponeDate("", OCT_14), { ok: false, message: DECISION_MESSAGES.reviewByInvalid });
  assert.deepEqual(checkPostponeDate(null, OCT_14), { ok: false, message: DECISION_MESSAGES.reviewByInvalid });
  assert.deepEqual(checkPostponeDate("2026-02-30", OCT_14), { ok: false, message: DECISION_MESSAGES.reviewByInvalid });
  assert.deepEqual(checkPostponeDate("14/11/2026", OCT_14), { ok: false, message: DECISION_MESSAGES.reviewByInvalid });
  assert.deepEqual(checkPostponeDate("2026-10-14", OCT_14), { ok: false, message: DECISION_MESSAGES.reviewByNotFuture });
  assert.deepEqual(checkPostponeDate("2026-10-01", OCT_14), { ok: false, message: DECISION_MESSAGES.reviewByNotFuture });
  assert.deepEqual(checkPostponeDate("2026-10-15", OCT_14), { ok: true, date: "2026-10-15" });
  // 23:30 UTC del 31 dicembre: a Roma il primo gennaio è già oggi.
  const newYear = new Date("2026-12-31T23:30:00Z");
  assert.deepEqual(checkPostponeDate("2027-01-01", newYear), { ok: false, message: DECISION_MESSAGES.reviewByNotFuture });
  assert.deepEqual(checkPostponeDate("2027-01-02", newYear), { ok: true, date: "2027-01-02" });
});

test("date future: «14 gen» entro un anno, con l'anno più in là", () => {
  assert.equal(futureDayLabel("2027-01-14", "2026-10-14"), "14 gen");
  assert.equal(futureDayLabel("2027-10-13", "2026-10-14"), "13 ott");
  assert.equal(futureDayLabel("2027-10-14", "2026-10-14"), "14 ott 2027");
  assert.equal(futureDayLabel("2028-03-01", "2026-10-14"), "1 mar 2028");
});

test("instantOfDay: mezzogiorno UTC, lo stesso giorno a Roma", () => {
  assert.equal(instantOfDay("2026-10-14").toISOString(), "2026-10-14T12:00:00.000Z");
  assert.ok(Math.abs(instantOfDay("non è una data").getTime() - Date.now()) < 5000, "un giorno illeggibile vale adesso");
});

// ─── «Quando» ────────────────────────────────────────────────────────

test("Quando: le tre scelte con il trimestre di oggi e quello dopo; la scelta del trimestre salvato", () => {
  assert.deepEqual(whenOptions(OCT_14), [
    { choice: "questo_trimestre", label: "Questo trimestre (T4 2026)" },
    { choice: "prossimo_trimestre", label: "Prossimo trimestre (T1 2027)" },
    { choice: "piu_avanti", label: "Più avanti" },
  ]);
  assert.equal(currentWhenChoice("2026-Q4", OCT_14), "questo_trimestre");
  assert.equal(currentWhenChoice("2027-Q1", OCT_14), "prossimo_trimestre");
  assert.equal(currentWhenChoice(null, OCT_14), "piu_avanti");
  assert.equal(currentWhenChoice("2026-Q3", OCT_14), null, "trimestre passato: nessuna scelta");
  assert.equal(currentWhenChoice("2027-Q3", OCT_14), null, "trimestre esplicito del MCP del team: nessuna scelta");
  assert.equal(parseWhenChoice("prossimo_trimestre"), "prossimo_trimestre");
  assert.equal(parseWhenChoice("2027-Q3"), null, "la pagina manda solo le tre scelte");
  assert.equal(parseWhenChoice(3), null);
});

test("Quando: le etichette lette con la pagina valgono finché non comincia un altro trimestre (fuso di Roma)", () => {
  // 31 dicembre a Roma, le 23:30: ancora T4 2026.
  const lastEvening = new Date("2026-12-31T22:30:00Z");
  // 1 gennaio a Roma, le 00:30 (in UTC è ancora il 31 dicembre).
  const newYear = new Date("2026-12-31T23:30:00Z");
  for (const choice of ["questo_trimestre", "prossimo_trimestre", "piu_avanti"] as const) {
    assert.equal(checkWhenLabels(choice, "2026-10-14", OCT_14), "ok", choice);
    assert.equal(checkWhenLabels(choice, "2026-12-31", lastEvening), "ok", `${choice}, stesso trimestre a Roma`);
  }
  // Pagina letta il 31 dicembre, clic dopo la mezzanotte di Roma: le etichette dicono T4 2026 e
  // T1 2027, adesso le stesse scelte salverebbero 2027-Q1 e 2027-Q2.
  assert.equal(checkWhenLabels("questo_trimestre", "2026-12-31", newYear), "superate");
  assert.equal(checkWhenLabels("prossimo_trimestre", "2026-12-31", newYear), "superate");
  assert.equal(checkWhenLabels("piu_avanti", "2026-12-31", newYear), "ok", "«Più avanti» non ha un trimestre");
  assert.equal(checkWhenLabels("questo_trimestre", "2027-01-01", newYear), "ok");
  // Senza il giorno della pagina non c'è niente da controllare; un giorno illeggibile non lo manda la pagina.
  assert.equal(checkWhenLabels("questo_trimestre", undefined, newYear), "ok");
  for (const raw of ["2026-02-30", "31/12/2026", "", null, 20261231]) {
    assert.equal(checkWhenLabels("questo_trimestre", raw, newYear), "non_valido", String(raw));
  }
  // Niente si salva: si sceglie di nuovo, sulla pagina riletta.
  assert.deepEqual(staleWhenLabelsResult({ field: true }), {
    ok: false,
    error: "dati_non_validi",
    message: DECISION_MESSAGES.whenInvalid,
    fieldErrors: { quando: DECISION_MESSAGES.whenInvalid },
  });
  assert.deepEqual(staleWhenLabelsResult({ field: false }), { ok: false, error: "dati_non_validi", message: DECISION_MESSAGES.whenInvalid });
});

// ─── Nota pubblica ───────────────────────────────────────────────────

test("nota pubblica: obbligatoria per «Serve info» e «Non avviare», al massimo 1.000 caratteri", () => {
  assert.deepEqual(checkDecisionNote(""), { ok: false, message: PUBLIC_NOTE_REQUIRED_ERROR });
  assert.deepEqual(checkDecisionNote("   \n "), { ok: false, message: PUBLIC_NOTE_REQUIRED_ERROR });
  assert.deepEqual(checkDecisionNote("x".repeat(1001)), { ok: false, message: tooLongMessage(1000) });
  assert.equal(tooLongMessage(1000), "Massimo 1.000 caratteri.");
  assert.deepEqual(checkDecisionNote("  Quante richieste arrivano a settimana?  "), { ok: true, value: "Quante richieste arrivano a settimana?" });
  assert.deepEqual(checkDecisionNote("x".repeat(1000)), { ok: true, value: "x".repeat(1000) });
});

test("nota pubblica: precompilata con quella salvata, mai con il segnaposto di «Oscura testo»", () => {
  assert.equal(publicNotePrefill(null), "");
  assert.equal(publicNotePrefill(undefined), "");
  assert.equal(publicNotePrefill("Serve il volume mensile."), "Serve il volume mensile.");
  assert.equal(publicNotePrefill(REDACTED_PLACEHOLDER), "");
  assert.equal(publicNotePrefill(` ${REDACTED_PLACEHOLDER} `), "");
  assert.equal(REDACTED_PLACEHOLDER, "[testo rimosso]");
});

test("nota pubblica: avviso fisso, seconda riga per una scheda nascosta, contatore", () => {
  assert.deepEqual(publicNoteHints(false), ["Chi conosce il codice la legge tramite Claude. Non scrivere dati personali."]);
  assert.deepEqual(publicNoteHints(true), [
    "Chi conosce il codice la legge tramite Claude. Non scrivere dati personali.",
    "Questa scheda è nascosta alla ricerca: tramite Claude chi conosce il codice vede solo la fase.",
  ]);
  assert.equal(PUBLIC_NOTE_TEXT.label, "Nota pubblica");
  assert.equal(publicNoteCounter(""), "0 / 1.000");
  assert.equal(publicNoteCounter("Ciao"), "4 / 1.000");
});

test("nota pubblica all'uscita dal campo: salva solo se cambia; vuota toglie la nota", () => {
  assert.deepEqual(publicNoteChange(null, ""), { change: false });
  assert.deepEqual(publicNoteChange(null, "   "), { change: false });
  assert.deepEqual(publicNoteChange("Nota", " Nota "), { change: false });
  assert.deepEqual(publicNoteChange("Nota", "Nota nuova"), { change: true, value: "Nota nuova" });
  assert.deepEqual(publicNoteChange("Nota", ""), { change: true, value: null });
  assert.deepEqual(publicNoteChange(null, "Prima nota"), { change: true, value: "Prima nota" });
  assert.deepEqual(publicNoteChange(null, "x".repeat(1001)), { change: false, error: tooLongMessage(1000) });
});

test("nota pubblica: il campo segue la nota salvata altrove solo se non la si sta scrivendo; spazi in coda non contano", () => {
  // Scritta con un a capo in fondo e salvata: il servizio toglie l'a capo.
  let field = { ...publicNoteFieldState(null), draft: "Servono i volumi.\n" };
  const change = publicNoteChange(lastSavedNote(field), field.draft);
  assert.deepEqual(change, { change: true, value: "Servono i volumi." });
  field = { ...field, ownSave: "Servono i volumi." };
  assert.equal(lastSavedNote(field), "Servono i volumi.", "uscire di nuovo dal campo non riscrive");
  // La pagina riletta porta la nota salvata.
  field = followPageNote(field, "Servono i volumi.");
  assert.equal(field.synced, "Servono i volumi.");
  // Poi «Serve info» salva «Nuova nota»: il campo la prende, non tiene il testo di prima con l'a capo.
  field = followPageNote(field, "Nuova nota");
  assert.deepEqual(field, { draft: "Nuova nota", synced: "Nuova nota" });
  assert.deepEqual(publicNoteChange(lastSavedNote(field), field.draft), { change: false }, "uscire dal campo non riscrive la nota vecchia");
  // Stessa nota: lo stesso stato.
  assert.equal(followPageNote(field, "Nuova nota"), field);
});

test("nota pubblica: la pagina arriva già con «Serve info» dopo la nota del campo; il testo che si sta scrivendo resta", () => {
  // La nota del campo e «Serve info» sono partite una dopo l'altra: la pagina passa da nessuna
  // nota a quella di «Serve info» senza mai mostrare quella del campo.
  let field = { ...publicNoteFieldState(null), draft: "Servono i volumi." };
  field = { ...field, ownSave: "Servono i volumi." };
  assert.deepEqual(followPageNote(field, "Quante richieste al giorno?"), { draft: "Quante richieste al giorno?", synced: "Quante richieste al giorno?" });
  // Testo scritto e non salvato: resta, anche se un'altra persona cambia la nota.
  const typing = { ...publicNoteFieldState("Nota"), draft: "Nota più lunga" };
  assert.deepEqual(followPageNote(typing, "Nota di un'altra persona"), { draft: "Nota più lunga", synced: "Nota di un'altra persona" });
  // Campo svuotato e non salvato: resta vuoto.
  const cleared = { ...publicNoteFieldState("Nota"), draft: "" };
  assert.equal(followPageNote(cleared, "Altra nota").draft, "");
  assert.equal(draftFollowsSavedNote("  ", null), true);
  assert.equal(draftFollowsSavedNote("Nota\n", "Nota"), true);
});

// ─── «Doppione di…» ──────────────────────────────────────────────────

const WORKSPACE_CASES = [
  { id: "00000000-0000-4000-8000-000000000001", code: "XX-0001", title: "Smistamento richieste" },
  { id: "00000000-0000-4000-8000-000000000002", code: "XX-0002", title: "Perché le fatture arrivano tardi" },
  { id: "00000000-0000-4000-8000-000000000003", code: null, title: "Bozza senza codice" },
  { id: "00000000-0000-4000-8000-000000000004", code: "xx-0004", title: "Riassunto delle riunioni" },
  { id: "00000000-0000-4000-8000-000000000005", code: "XX-0005", title: "Smistamento delle email" },
];

test("Doppione di…: esclude la scheda stessa, per id e per codice, e quelle senza codice", () => {
  const self = WORKSPACE_CASES[0];
  const all = duplicateCandidates(WORKSPACE_CASES, self);
  assert.deepEqual(
    all.map((item) => item.code),
    ["XX-0002", "XX-0004", "XX-0005"],
  );
  assert.ok(!all.some((item) => item.id === self.id), "mai la scheda stessa");
  // Anche se la stessa scheda arriva con l'id in maiuscolo o solo con il codice.
  assert.ok(!duplicateCandidates(WORKSPACE_CASES, { id: self.id.toUpperCase(), code: null }).some((item) => item.code === "XX-0001"));
  assert.ok(!duplicateCandidates(WORKSPACE_CASES, { id: "00000000-0000-4000-8000-0000000000ff", code: "xx-0001" }).some((item) => item.code === "XX-0001"));
  // Il codice esce normalizzato, come lo salva il servizio.
  assert.equal(all.find((item) => item.id.endsWith("4"))?.code, "XX-0004");
});

test("Doppione di…: cerca nel titolo e nel codice, senza maiuscole e accenti; codice scritto per intero", () => {
  const self = WORKSPACE_CASES[0];
  assert.deepEqual(duplicateCandidates(WORKSPACE_CASES, self, "smistamento").map((item) => item.code), ["XX-0005"]);
  assert.deepEqual(duplicateCandidates(WORKSPACE_CASES, self, "PERCHE").map((item) => item.code), ["XX-0002"]);
  assert.deepEqual(duplicateCandidates(WORKSPACE_CASES, self, "x-0004").map((item) => item.code), ["XX-0004"]);
  assert.deepEqual(duplicateCandidates(WORKSPACE_CASES, self, "XX-0001"), [], "il codice della scheda stessa non trova nulla");
  assert.equal(duplicateCandidates(WORKSPACE_CASES, self, "", 2).length, 2, "al massimo `limit`");
  assert.equal(typedDuplicateCode(" xx-0099 ", self), "XX-0099");
  assert.equal(typedDuplicateCode("xx-0001", self), null, "non la scheda stessa");
  assert.equal(typedDuplicateCode("smistamento", self), null);
});

// ─── Pulsanti per fase (§6.4) ────────────────────────────────────────

/** Il sotto-stato che la fase ha di solito; in «Chiuso» quello di «Non avviare». */
function defaultSubState(phase: Phase, kind: UseCaseKind, dossier: CaseStatus | null): SubState {
  switch (phase) {
    case "da_valutare":
      return "nuova";
    case "approvato":
      return "piu_avanti";
    case "in_realizzazione":
      return dossier ? "dossier" : "senza_dossier";
    case "realizzato":
      return kind === "da_diffondere" ? "diffusa" : "realizzato";
    case "chiuso":
      return "non_avviato";
  }
}

function item(
  phase: Phase,
  kind: UseCaseKind = "da_costruire",
  dossier: CaseStatus | null = null,
  subState: SubState = defaultSubState(phase, kind, dossier),
  status?: LifecycleStatus,
): Pick<DecisionItem, "phase" | "subState" | "kind" | "dossier" | "status"> {
  return { phase, subState, kind, dossier: dossier ? { status: dossier } : null, ...(status ? { status } : {}) };
}

const L = (primary: DecisionKey | null, outline: DecisionKey[], menu: DecisionKey[]): DecisionLayout => ({ primary, outline, menu });

test("pulsanti per fase: la tabella di §6.4", () => {
  const can = { canDecide: true };
  assert.deepEqual(decisionLayout(item("da_valutare"), can), L("approva", ["rimanda", "serve_info", "non_avviare"], ["doppione", "archivia"]));
  assert.deepEqual(decisionLayout(item("approvato"), can), L(null, ["non_avviare"], ["doppione", "archivia"]));
  assert.deepEqual(decisionLayout(item("approvato", "da_diffondere"), can), L("segna_diffusa", ["non_avviare"], ["archivia"]));
  assert.deepEqual(decisionLayout(item("realizzato"), can), L(null, [], ["archivia"]));
  assert.deepEqual(decisionLayout(item("realizzato", "da_diffondere"), can), L(null, [], ["archivia"]));
  assert.deepEqual(decisionLayout(item("chiuso"), can), L("riapri", [], []));
  assert.deepEqual(decisionLayout(item("chiuso", "da_costruire", null, "doppione"), can), L("riapri", [], []));
  assert.deepEqual(decisionLayout(item("chiuso", "da_costruire", null, "archiviato"), can), L("riapri", [], []));
});

test("«Chiuso · Non avviato» con un dossier collegato (§6.5): nessun «Riapri», che il servizio rifiuta", () => {
  const can = { canDecide: true };
  // «Non avviare» da «In realizzazione» con il dossier chiuso: la scheda resta legata al dossier.
  assert.deepEqual(decisionLayout(item("chiuso", "da_costruire", "chiuso", "non_avviato"), can), L(null, [], []));
  // Archiviata da «In realizzazione» con il dossier chiuso: «Riapri» la riporta lì, si mostra.
  assert.deepEqual(decisionLayout(item("chiuso", "da_costruire", "chiuso", "archiviato"), can), L("riapri", [], []));
});

test("«Riapri» con lo `status`: archiviata con un dossier e ancora da decidere, nessun pulsante; dove torna la scheda", () => {
  const can = { canDecide: true };
  // Righe di prima dell'area: archiviata ma ancora `rejected` (o `proposed`), con un dossier.
  for (const status of ["rejected", "proposed", "draft"] as const) {
    assert.deepEqual(decisionLayout(item("chiuso", "da_costruire", "chiuso", "archiviato", status), can), L(null, [], []), status);
    assert.deepEqual(decisionLayout(item("chiuso", "da_costruire", "chiuso", "doppione", status), can), L(null, [], []), `doppione ${status}`);
    // Senza dossier il servizio la riporta in «Da decidere»: il pulsante c'è.
    assert.deepEqual(decisionLayout(item("chiuso", "da_costruire", null, "archiviato", status), can), L("riapri", [], []), `senza dossier ${status}`);
  }
  for (const status of ["accepted", "in_progress", "implemented"] as const) {
    assert.deepEqual(decisionLayout(item("chiuso", "da_costruire", "chiuso", "archiviato", status), can), L("riapri", [], []), status);
  }
  assert.deepEqual(decisionLayout(item("chiuso", "da_costruire", "chiuso", "non_avviato", "rejected"), can), L(null, [], []));

  assert.equal(reopenDestination({ subState: "non_avviato" }), "da_decidere", "«Non avviato» è `rejected`, non archiviata (§3.5)");
  assert.equal(reopenDestination({ subState: "non_avviato", status: null }), "da_decidere");
  assert.equal(reopenDestination({ subState: "archiviato" }), null, "archiviata senza `status`: non si sa");
  assert.equal(reopenDestination({ subState: "doppione" }), null);
  for (const status of ["rejected", "proposed", "draft"] as const) assert.equal(reopenDestination({ subState: "archiviato", status }), "da_decidere", status);
  for (const status of ["accepted", "in_progress", "implemented"] as const) {
    assert.equal(reopenDestination({ subState: "archiviato", status }), "fase_di_prima", status);
  }
});

test("pulsanti di «In realizzazione» nei tre casi di §6.4: dossier attivo, senza dossier, dossier chiuso", () => {
  const can = { canDecide: true };
  // Senza dossier («Segna come in realizzazione», sezione Casi d'uso spenta).
  assert.deepEqual(decisionLayout(item("in_realizzazione"), can), L("segna_realizzato", ["non_avviare"], ["archivia"]));
  // Dossier chiuso: si può non avviare o archiviare, non segnare come realizzato.
  assert.deepEqual(decisionLayout(item("in_realizzazione", "da_costruire", "chiuso"), can), L(null, ["non_avviare"], ["archivia"]));
  // Dossier attivo: «Segna come realizzato» solo «In uso» o «Misura del valore»; niente «Archivia» né «Non avviare».
  assert.deepEqual(decisionLayout(item("in_realizzazione", "da_costruire", "in_esercizio"), can), L("segna_realizzato", [], []));
  assert.deepEqual(decisionLayout(item("in_realizzazione", "da_costruire", "misura_roi"), can), L("segna_realizzato", [], []));
  for (const status of ["bozza", "raccolta", "pronto_sviluppo", "in_sviluppo", "backtest", "collaudo", "stabilizzazione", "sospeso"] as const) {
    assert.deepEqual(decisionLayout(item("in_realizzazione", "da_costruire", status), can), L(null, [], []), status);
  }
  assert.equal(dossierSituation(null), "nessuno");
  assert.equal(dossierSituation({ status: "chiuso" }), "chiuso");
  assert.equal(dossierSituation({ status: "in_esercizio" }), "in_uso");
  assert.equal(dossierSituation({ status: "raccolta" }), "attivo");
});

test("pulsanti: al massimo uno pieno, nessun doppione tra le tre file; chi non decide non ne vede nessuno", () => {
  const phases: Phase[] = ["da_valutare", "approvato", "in_realizzazione", "realizzato", "chiuso"];
  for (const phase of phases) {
    for (const kind of ["da_costruire", "da_diffondere"] as const) {
      for (const dossier of [null, ...CASE_STATUSES]) {
        const shown = decisionLayout(item(phase, kind, dossier), { canDecide: true });
        const all = [shown.primary, ...shown.outline, ...shown.menu].filter(Boolean);
        assert.equal(new Set(all).size, all.length, `${phase} ${kind} ${dossier}: ripetuto`);
        assert.ok(all.every((key) => (DECISION_KEYS as readonly string[]).includes(key!)));
        assert.deepEqual(decisionLayout(item(phase, kind, dossier), { canDecide: false }), L(null, [], []), "contributore");
      }
    }
  }
});

/** Una scheda nella fase data, per chiedere a `decisions.ts` se il pulsante mostrato è ammesso. */
function cardFor(
  phase: Phase,
  kind: UseCaseKind,
  dossier: CaseStatus | null,
  subState: SubState = defaultSubState(phase, kind, dossier),
  status?: LifecycleStatus,
): DecisionCard {
  const base: DecisionCard = {
    id: "00000000-0000-4000-8000-0000000000aa",
    code: "XX-0100",
    phase,
    portfolioKind: kind === "da_diffondere" ? "best_practice" : "use_case_ai",
    dossierStatus: dossier,
    status: "proposed",
    portfolioReviewStatus: "in_review",
    targetQuarter: null,
    reviewBy: null,
    reviewedBy: null,
    publicNote: null,
    intake: null,
  };
  switch (phase) {
    case "approvato":
      return { ...base, status: "accepted" };
    case "in_realizzazione":
      return { ...base, status: dossier ? "accepted" : "in_progress" };
    case "realizzato":
      return { ...base, status: "implemented" };
    case "chiuso":
      if (subState === "non_avviato") return { ...base, status: "rejected" };
      // Archiviata (o doppione) dalla fase in cui era: con un dossier, da «In realizzazione».
      return {
        ...base,
        status: status ?? (dossier ? "accepted" : "proposed"),
        portfolioReviewStatus: "archived",
        intake: subState === "doppione" ? { archiveReason: "duplicato", duplicateOfCode: "XX-0007" } : { archiveReason: "superato" },
      };
    default:
      return base;
  }
}

const DECISION_FOR: Record<DecisionKey, Decision> = {
  approva: { type: "approva", quando: "piu_avanti" },
  rimanda: { type: "rimanda", reviewBy: "2027-01-14" },
  serve_info: { type: "serve_info", publicNote: "Quante richieste al giorno?" },
  non_avviare: { type: "non_avviare", publicNote: "Fuori dal budget di quest'anno." },
  doppione: { type: "doppione", ofCode: "XX-0007" },
  archivia: { type: "archivia", reason: "superato" },
  riapri: { type: "riapri" },
  segna_diffusa: { type: "segna_diffusa" },
  segna_realizzato: { type: "segna_realizzato" },
};

test("ogni pulsante mostrato è una decisione che il servizio ammette in quella fase (decisions.ts)", () => {
  const ctx = {
    now: OCT_14,
    actor: { userId: "00000000-0000-4000-8000-0000000000bb", isReviewer: true, isLateralSpace: false },
    ucSectionEnabled: true,
    duplicateTarget: { id: "00000000-0000-4000-8000-0000000000cc", code: "XX-0007" },
  };
  const scenarios: Array<[Phase, UseCaseKind, CaseStatus | null, SubState?, LifecycleStatus?]> = [
    ["da_valutare", "da_costruire", null],
    ["da_valutare", "da_diffondere", null],
    ["approvato", "da_costruire", null],
    ["approvato", "da_diffondere", null],
    ["in_realizzazione", "da_costruire", null],
    ["in_realizzazione", "da_costruire", "chiuso"],
    ["in_realizzazione", "da_costruire", "in_esercizio"],
    ["in_realizzazione", "da_costruire", "misura_roi"],
    ["in_realizzazione", "da_costruire", "raccolta"],
    ["realizzato", "da_costruire", null],
    ["realizzato", "da_diffondere", null],
    ["chiuso", "da_costruire", null],
    ["chiuso", "da_costruire", null, "doppione"],
    ["chiuso", "da_costruire", null, "archiviato"],
    // «Non avviare» da «In realizzazione» con il dossier chiuso (§6.5), poi archiviata.
    ["chiuso", "da_costruire", "chiuso", "non_avviato"],
    ["chiuso", "da_costruire", "chiuso", "archiviato"],
    // Archiviate da Approvato o Realizzato: «Riapri» le riporta lì.
    ["chiuso", "da_costruire", null, "archiviato", "accepted"],
    ["chiuso", "da_costruire", null, "archiviato", "implemented"],
    // Righe di prima dell'area: archiviata ma ancora `rejected` o `proposed`, con un dossier.
    ["chiuso", "da_costruire", "chiuso", "archiviato", "rejected"],
    ["chiuso", "da_costruire", "chiuso", "archiviato", "proposed"],
    ["chiuso", "da_costruire", "chiuso", "doppione", "rejected"],
    ["chiuso", "da_costruire", null, "archiviato", "rejected"],
  ];
  for (const [phase, kind, dossier, subState, status] of scenarios) {
    const card = cardFor(phase, kind, dossier, subState, status);
    // La pagina che passa lo `status` della scheda (`DecisionItem.status`).
    const shown = decisionLayout(item(phase, kind, dossier, subState, card.status), { canDecide: true });
    const offered = new Set([shown.primary, ...shown.outline, ...shown.menu].filter((key): key is DecisionKey => key !== null));
    for (const key of DECISION_KEYS) {
      const result = applyDecision(card, DECISION_FOR[key], ctx);
      if (offered.has(key)) assert.equal(result.ok, true, `${phase} ${subState ?? ""} ${kind} ${dossier}: «${key}» mostrato ma rifiutato`);
    }
    // In «Chiuso» il solo passo è «Riapri»: se il servizio lo ammette, il pulsante c'è.
    if (phase === "chiuso") {
      const reopen = applyDecision(card, DECISION_FOR.riapri, ctx);
      assert.equal(offered.has("riapri"), reopen.ok, `${subState} ${dossier} ${card.status}: «Riapri» mostrato solo se ammesso`);
      // Il dialogo dice «Torna in «Da decidere».» solo se la scheda ci torna.
      if (reopen.ok) {
        const after = reopen.patch.status ?? card.status;
        const toDecide = after === "draft" || after === "proposed";
        const text = dialogText("riapri", card.code, { reopensTo: reopenDestination({ subState: subState ?? "non_avviato", status: card.status }) });
        assert.equal(text.description, toDecide ? "Torna in «Da decidere»." : null, `${subState} ${card.status}: testo di «Riapri»`);
      }
    }
    // In «In realizzazione» con un dossier attivo, ciò che non è mostrato è anche rifiutato.
    if (phase === "in_realizzazione" && dossier && dossier !== "chiuso") {
      for (const key of ["non_avviare", "archivia"] as const) {
        assert.equal(applyDecision(cardFor(phase, kind, dossier), DECISION_FOR[key], ctx).ok, false, `${dossier}: ${key}`);
      }
    }
  }
});

test("«Segna come in realizzazione»: solo Lateral Space, approvato «Da costruire» senza dossier, sezione Casi d'uso spenta", () => {
  const ls = { canMarkInProgress: true, dossiersEnabled: false };
  assert.equal(showMarkInProgress(item("approvato"), ls), true);
  assert.equal(showMarkInProgress(item("approvato"), { canMarkInProgress: false, dossiersEnabled: false }), false, "AI Builder del cliente");
  assert.equal(showMarkInProgress(item("approvato"), { canMarkInProgress: true, dossiersEnabled: true }), false, "dossier accesi: «Avvia»");
  assert.equal(showMarkInProgress(item("approvato", "da_diffondere"), ls), false);
  assert.equal(showMarkInProgress(item("approvato", "da_costruire", "chiuso"), ls), false);
  assert.equal(showMarkInProgress(item("da_valutare"), ls), false);
  assert.equal(showMarkInProgress(item("in_realizzazione"), ls), false);
});

// ─── Decisione attuale, testi, toast (§6.4, §14.3) ───────────────────

const today = "2026-10-14";

function noteOf(over: Partial<DecisionItem>, closedOn?: string): string | null {
  const base = { phase: "da_valutare" as Phase, subState: "nuova" as DecisionItem["subState"], waitingSince: "2026-10-08" };
  return decisionNote({ ...base, ...over }, today, { closedOn });
}

test("sotto «Decisione» solo quello che la pillola non dice (§6.4; la fase una volta sola, H4p)", () => {
  assert.equal(noteOf({}), "In attesa da 6 giorni");
  assert.equal(noteOf({ waitingSince: "2026-10-13" }), "In attesa da 1 giorno");
  assert.equal(noteOf({ waitingSince: today }), "In attesa da oggi");
  assert.equal(noteOf({ subState: "valutata" }), "In attesa da 6 giorni");
  assert.equal(noteOf({ subState: "da_rivedere" }), "In attesa da 6 giorni");
  assert.equal(noteOf({ subState: "serve_info" }), "In attesa di risposta da chi ha proposto");
  // La pillola dice già «Rimandata al 14 gen», «Approvato · T1 2027», «Chiuso · Doppione di XX-0007».
  assert.equal(noteOf({ subState: "rimandata" }), null);
  assert.equal(noteOf({ phase: "approvato", subState: "trimestre" }), null);
  assert.equal(noteOf({ phase: "approvato", subState: "piu_avanti" }), null);
  assert.equal(noteOf({ phase: "chiuso", subState: "non_avviato" }, "2026-10-03"), "Deciso il 3 ott");
  assert.equal(noteOf({ phase: "chiuso", subState: "non_avviato" }, "2025-10-03T09:00:00Z"), "Deciso il 3 ott 2025");
  assert.equal(noteOf({ phase: "chiuso", subState: "non_avviato" }), null);
  assert.equal(noteOf({ phase: "chiuso", subState: "doppione" }), null);
  assert.equal(noteOf({ phase: "chiuso", subState: "archiviato" }), null);
  assert.equal(noteOf({ phase: "in_realizzazione", subState: "dossier" }), null);
  assert.equal(noteOf({ phase: "realizzato", subState: "realizzato" }), null);
});

test("dialoghi: titoli, testi e pulsanti esatti di §14.3", () => {
  assert.deepEqual(dialogText("approva", "XX-0012"), { title: "Approva XX-0012", description: "Quando lo facciamo?", confirm: "Approva" });
  assert.deepEqual(dialogText("rimanda", "XX-0012"), { title: "Rimanda XX-0012", description: "Quando lo riguardiamo?", confirm: "Rimanda" });
  assert.deepEqual(dialogText("serve_info", "XX-0012"), { title: "Cosa serve sapere?", description: null, confirm: "Chiedi informazioni" });
  assert.deepEqual(dialogText("non_avviare", "XX-0012"), { title: "Perché non lo avviamo?", description: null, confirm: "Non avviare" });
  assert.deepEqual(dialogText("doppione", "XX-0012"), {
    title: "Di quale use case è un doppione?",
    description: "Si chiude e chi lo segue vede il codice dell'altro.",
    confirm: "Segna come doppione",
  });
  assert.deepEqual(dialogText("archivia", "XX-0012"), { title: "Perché lo archivi?", description: "Non si cancella niente: si può riaprire.", confirm: "Archivia" });
  assert.deepEqual(dialogText("riapri", "XX-0012", { reopensTo: "da_decidere" }), { title: "Riaprire XX-0012?", description: "Torna in «Da decidere».", confirm: "Riapri" });
  // Un'archiviata da Approvato, In realizzazione o Realizzato torna lì: nessuna promessa sbagliata.
  assert.deepEqual(dialogText("riapri", "XX-0012", { reopensTo: "fase_di_prima" }), { title: "Riaprire XX-0012?", description: null, confirm: "Riapri" });
  assert.equal(dialogText("riapri", "XX-0012").description, null, "senza sapere dove torna, nessun testo");
  assert.equal(dialogText("riapri", "XX-0012", { reopensTo: null }).description, null);
  assert.deepEqual(dialogText("segna_diffusa", null), { title: "Segnare come diffusa?", description: "La best practice risulta realizzata.", confirm: "Segna come diffusa" });
  assert.deepEqual(dialogText("segna_realizzato", null), {
    title: "Segnare come realizzato?",
    description: "Lo use case risulta realizzato. Il dossier resta com'è.",
    confirm: "Segna come realizzato",
  });
  assert.deepEqual(dialogText("segna_in_realizzazione", null), {
    title: "Segnare come in realizzazione?",
    description: "Senza dossier: la sezione Casi d'uso è spenta per questo workspace.",
    confirm: "Segna come in realizzazione",
  });
  assert.equal(dialogText("approva", null).title, "Approva", "senza codice, il solo verbo");
  assert.equal(dialogText("riapri", null).title, "Riaprire?");
  assert.equal(DIALOG_EXTRA_TEXT.approveNoValuation, "Valore e Costo non sono ancora valutati dal team.");
  assert.equal(DIALOG_EXTRA_TEXT.approveShowToColleagues, "Mostralo ai colleghi (ricerca di Claude e lista)");
  assert.equal(DIALOG_EXTRA_TEXT.postponeNote, "Fino ad allora resta fuori da «Da decidere». Chi l'ha proposto vede «Valutata, da decidere».");
  assert.equal(DIALOG_EXTRA_TEXT.duplicateSearch, "Cerca per titolo o codice");
  assert.deepEqual(
    ARCHIVE_OPTIONS.map((option) => option.label),
    ["Superato da altro", "Ritirato da chi l'ha proposto", "Fuori dal perimetro", "Altro motivo"],
  );
  assert.deepEqual(
    DECISION_KEYS.map((key) => DECISION_LABEL[key]),
    ["Approva", "Rimanda", "Serve info", "Non avviare", "Doppione di…", "Archivia", "Riapri", "Segna come diffusa", "Segna come realizzato"],
  );
});

test("toast esatti di §14.3", () => {
  const toasts: Array<[Decision, string]> = [
    [{ type: "approva", quando: "prossimo_trimestre" }, "Approvato. Lo trovi nella Panoramica."],
    [{ type: "rimanda", reviewBy: "2027-01-14" }, "Rimandato al 14 gen."],
    [{ type: "serve_info", publicNote: "x" }, "Richiesta salvata. La nota è visibile a chi conosce il codice."],
    [{ type: "non_avviare", publicNote: "x" }, "Segnato come non avviato."],
    [{ type: "doppione", ofCode: " xx-0007 " }, "Segnato come doppione di XX-0007."],
    [{ type: "archivia", reason: "ritirato" }, "Archiviato."],
    [{ type: "riapri" }, "Riaperto."],
    [{ type: "segna_diffusa" }, "Segnata come diffusa."],
    [{ type: "segna_realizzato" }, "Segnato come realizzato."],
    [{ type: "segna_in_realizzazione" }, "Segnato come in realizzazione."],
  ];
  for (const [decision, text] of toasts) assert.equal(decisionToast(decision, today), text, decision.type);
  assert.equal(visibilityToast(true), "Nascosta alla ricerca.");
  assert.equal(visibilityToast(false), "Visibile ai colleghi.");
});

test("i testi delle decisioni non usano le parole vietate nell'area (§14.5)", () => {
  const texts = [
    ...Object.values(DECISION_LABEL),
    ...[...DECISION_KEYS, "segna_in_realizzazione" as const].flatMap((key) =>
      Object.values(dialogText(key, "XX-0012", { reopensTo: "da_decidere" })).filter((v): v is string => typeof v === "string"),
    ),
    ...Object.values(DIALOG_EXTRA_TEXT),
    ...Object.values(DIALOG_COMMON_TEXT),
    ...Object.values(PUBLIC_NOTE_TEXT),
    ...ARCHIVE_OPTIONS.map((option) => option.label),
    ...postponeOptions(OCT_14).map((option) => option.label),
    ...whenOptions(OCT_14).map((option) => option.label),
  ];
  for (const text of texts) assert.deepEqual(findHubForbidden(text, "area"), [], text);
});

// ─── «Approva»: avviso senza valutazione del team ────────────────────

test("Approva: avviso solo quando né Valore né Costo vengono dal team", () => {
  assert.equal(teamValuationMissing({ value: { source: null, perYear: null }, cost: null }), true);
  assert.equal(teamValuationMissing({ value: { source: "ai", perYear: null }, cost: { source: "sforzo" } }), true);
  assert.equal(teamValuationMissing({ value: null, cost: null }), true);
  assert.equal(teamValuationMissing({ value: { source: "team", perYear: null }, cost: null }), false);
  assert.equal(teamValuationMissing({ value: { source: "ai", perYear: { source: "team" } }, cost: null }), false);
  assert.equal(teamValuationMissing({ value: { source: null, perYear: null }, cost: { source: "team_importo" } }), false);
  assert.equal(teamValuationMissing({ value: { source: null, perYear: null }, cost: { source: "team_fascia" } }), false);
});

// ─── Ingresso e risposta delle action ────────────────────────────────

test("parseDecisionInput: solo le forme che la pagina manda", () => {
  const valid: Decision[] = [
    { type: "approva", quando: "questo_trimestre" },
    { type: "approva", quando: "piu_avanti", showToColleagues: true },
    { type: "rimanda", reviewBy: "2027-01-14" },
    { type: "serve_info", publicNote: "Quante?" },
    { type: "non_avviare", publicNote: "Fuori budget." },
    { type: "doppione", ofCode: "XX-0007" },
    { type: "archivia", reason: "fuori_perimetro" },
    { type: "riapri" },
    { type: "segna_diffusa" },
    { type: "segna_realizzato" },
    // D17: la nota cambiata dopo una risposta va con la decisione; vuota la toglie.
    { type: "approva", quando: "piu_avanti", publicNote: "Approvato, partiamo a gennaio." },
    { type: "rimanda", reviewBy: "2027-01-14", publicNote: "" },
    { type: "doppione", ofCode: "XX-0007", publicNote: "È lo stesso di XX-0007." },
    { type: "archivia", reason: "superato", publicNote: "Superato dal nuovo gestionale." },
  ];
  for (const decision of valid) assert.deepEqual(parseDecisionInput(decision), { ok: true, decision }, decision.type);
  const invalid: unknown[] = [
    null,
    "approva",
    { type: "cancella" },
    { type: "segna_in_realizzazione" },
    { type: "approva", quando: "2027-Q3" },
    { type: "approva" },
    { type: "non_avviare", publicNote: null, legacy: true },
    { type: "non_avviare" },
    { type: "archivia", reason: "duplicato" },
    { type: "riapri", extra: 1 },
    { type: "rimanda", reviewBy: 20270114 },
    { type: "serve_info", publicNote: "x".repeat(2001) },
    { type: "approva", quando: "piu_avanti", publicNote: null },
    { type: "archivia", reason: "superato", publicNote: "x".repeat(2001) },
    { type: "riapri", publicNote: "Nota" },
  ];
  for (const raw of invalid) assert.equal(parseDecisionInput(raw).ok, false, JSON.stringify(raw));
});

test("toDecisionItem: solo le parti delle decisioni, non la scheda intera", () => {
  const detail = {
    id: "00000000-0000-4000-8000-000000000001",
    code: "XX-0012",
    title: "Smistamento richieste",
    phase: "approvato" as const,
    subState: "trimestre" as const,
    phaseLabel: "Approvato · T1 2027",
    kind: "da_costruire" as const,
    hiddenFromSearch: true,
    publicNote: "Nota pubblica",
    targetQuarter: "2027-Q1",
    reviewBy: null,
    waitingSince: "2026-10-01",
    value: { source: "team" as const, perYear: { source: "team" as const, amount: 60000 }, score: 3.8, word: "alto" },
    cost: { source: "team_importo" as const, amount: 40000, band: 2 },
    dossier: { status: "raccolta" as const, caseId: "c", code: "XX-0012", readiness: null },
    version: 4,
    reviewNotes: "NOTA INTERNA",
    description: "Problema",
    customScores: { impact: { efficiency: 4 } },
  };
  const picked = toDecisionItem(detail);
  assert.deepEqual(picked, {
    id: detail.id,
    code: "XX-0012",
    title: "Smistamento richieste",
    phase: "approvato",
    subState: "trimestre",
    phaseLabel: "Approvato · T1 2027",
    kind: "da_costruire",
    hiddenFromSearch: true,
    publicNote: "Nota pubblica",
    answered: false,
    targetQuarter: "2027-Q1",
    reviewBy: null,
    waitingSince: "2026-10-01",
    value: { source: "team", perYear: { source: "team" } },
    cost: { source: "team_importo" },
    dossier: { status: "raccolta" },
    status: null,
    version: 4,
  });
  assert.ok(!JSON.stringify(picked).includes("NOTA INTERNA"));
  assert.deepEqual(toDecisionItem({ ...detail, value: null, cost: null, dossier: null }).value, null);
  // Lo `status` della scheda passa, se la pagina lo ha: dice dove riporta «Riapri».
  assert.equal(toDecisionItem({ ...detail, status: "accepted" }).status, "accepted");
});

test("toDuplicateCandidates: al browser solo id, codice e titolo di ogni use case", () => {
  const hubItems = [
    { id: "00000000-0000-4000-8000-000000000001", code: "XX-0001", title: "Smistamento richieste", publicNote: "NOTA PUBBLICA", problemPreview: "PROBLEMA", value: { score: 4 }, cost: { amount: 40000 } },
    { id: "00000000-0000-4000-8000-000000000002", code: null, title: "Bozza senza codice", reviewNotes: "NOTA INTERNA", dossier: { status: "raccolta" } },
  ];
  const picked = toDuplicateCandidates(hubItems);
  assert.deepEqual(picked, [
    { id: "00000000-0000-4000-8000-000000000001", code: "XX-0001", title: "Smistamento richieste" },
    { id: "00000000-0000-4000-8000-000000000002", code: null, title: "Bozza senza codice" },
  ]);
  for (const text of ["NOTA PUBBLICA", "PROBLEMA", "NOTA INTERNA", "40000", "raccolta"]) assert.ok(!JSON.stringify(picked).includes(text), text);
  assert.equal(toDuplicateCandidates(undefined), undefined);
  assert.equal(toDuplicateCandidates(null), undefined);
});

test("isActionTarget e toActionResult", () => {
  const ws = "00000000-0000-4000-8000-000000000001";
  const uc = "00000000-0000-4000-8000-000000000002";
  assert.equal(isActionTarget(ws, uc, 3), true);
  assert.equal(isActionTarget(ws, uc, 0), true);
  for (const [w, u, v] of [
    ["nope", uc, 1],
    [ws, "nope", 1],
    [ws, uc, -1],
    [ws, uc, 1.5],
    [ws, uc, "1"],
    [ws, uc, Number.NaN],
  ] as const) {
    assert.equal(isActionTarget(w, u, v), false, `${w} ${u} ${String(v)}`);
  }
  assert.deepEqual(toActionResult({ ok: true, value: { version: 7 } }, "Riaperto."), { ok: true, version: 7, message: "Riaperto." });
  assert.deepEqual(toActionResult({ ok: false, error: "versione_superata", message: "m" }, "x"), { ok: false, error: "versione_superata", message: "m" });
  assert.deepEqual(toActionResult({ ok: false, error: "dati_non_validi", message: "m", fieldErrors: {} }, null), { ok: false, error: "dati_non_validi", message: "m" });
  assert.deepEqual(toActionResult({ ok: false, error: "dati_non_validi", message: "m", fieldErrors: { publicNote: "e" } }, null), {
    ok: false,
    error: "dati_non_validi",
    message: "m",
    fieldErrors: { publicNote: "e" },
  });
  // La scheda intera non esce dalla action: solo la versione.
  const leaked = toActionResult({ ok: true, value: { version: 2, title: "Titolo", publicNote: "n" } as { version: number } }, null);
  assert.deepEqual(Object.keys(leaked).sort(), ["message", "ok", "version"]);
  assert.equal(ACTION_FAILED_MESSAGE, "Non riusciamo a salvare. Riprova.");
});

test("rereadsPage: la pagina si rilegge dopo una scrittura e dopo ogni errore che dice pagina vecchia (§9.1, §6.8)", () => {
  assert.equal(rereadsPage({ ok: true, version: 3, message: null }), true);
  // Il dossier, il ruolo, l'area o la fase cambiano senza alzare `version`: il servizio rifiuta, la pagina si rilegge.
  for (const error of ["versione_superata", "transizione_non_ammessa", "permesso_mancante", "non_trovato", "area_spenta"] as const) {
    assert.equal(rereadsPage({ ok: false, error, message: "m" }), true, error);
  }
  // Un ingresso sbagliato resta nel dialogo; un guasto passeggero lascia la pagina com'è per riprovare.
  assert.equal(rereadsPage({ ok: false, error: "dati_non_validi", message: "m", fieldErrors: { reviewBy: "e" } }), false);
  assert.equal(rereadsPage({ ok: false, error: "riprova", message: ACTION_FAILED_MESSAGE }), false);
  // Ogni errore del servizio ha una scelta: o rilegge o no.
  assert.deepEqual(
    SERVICE_ERRORS.filter((error) => !STALE_PAGE_ERRORS.includes(error)).sort(),
    ["dati_non_validi", "riprova"],
  );
});

test("dopo una risposta a «Serve info» (D17): i dialoghi senza un loro campo propongono la nota pubblica da aggiornare", () => {
  const answered = { answered: true, publicNote: "Quante visite fate al mese?" };
  for (const key of ["approva", "rimanda", "doppione", "archivia"] as const) assert.equal(proposesNoteUpdate(answered, key), true, key);
  // «Serve info» e «Non avviare» hanno già il campo della nota; «Riapri» e le altre non cambiano fase da qui.
  for (const key of ["serve_info", "non_avviare", "riapri", "segna_diffusa"] as const) assert.equal(proposesNoteUpdate(answered, key), false, key);
  assert.equal(proposesNoteUpdate({ answered: false, publicNote: "Domanda" }, "approva"), false, "senza risposta");
  assert.equal(proposesNoteUpdate({ answered: true, publicNote: "  " }, "approva"), false, "senza nota");
  assert.equal(PUBLIC_NOTE_TEXT.optionalLabel, "Nota pubblica (facoltativa)");
  assert.deepEqual(findHubForbidden(PUBLIC_NOTE_TEXT.answeredHint, "area"), []);
});
