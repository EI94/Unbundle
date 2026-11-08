import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_REVIEW_TEAM_NAME } from "../review-team.ts";
import type { UseCaseRealization } from "../uc/views/realization.ts";
import { findHubForbiddenIn } from "./copy-guard.ts";
import {
  GUIDED_TEXT,
  arrivalTarget,
  arrivalTargetIn,
  detailTargetIds,
  foldSummaries,
  impactView,
  isReadyToStart,
  limitsSummary,
  nextStepOf,
  paybackText,
  requestGroupView,
  startsInBox,
  toTeam,
  pathOfUseCase,
  workClamps,
  workFlowLabels,
  type GuidedInfo,
  type GuidedItem,
  type NextStepInput,
  type PathStep,
} from "./guided.ts";
import { infoProgressView, type InfoProgress } from "./info-progress.ts";
import { NEED_REQUIREMENT_STATUSES, type NeedStatus } from "./needs.ts";
import type { ReferentGate } from "./referent/contract.ts";
import type { CostFigure, ValueFigure } from "./valuation.ts";
import type { ValueModel } from "./value-model.ts";

// La scheda guidata (rilascio 3): percorso, «Prossimo passo», «Impatto», pieghe e ancore. Il nome
// del team viene dalla costante, mai scritto a mano.

const TEAM = DEFAULT_REVIEW_TEAM_NAME;
const T = toTeam(TEAM);
const TODAY = "2026-11-01";
const WS = "6f1c2b3a-0000-4000-8000-0000000000aa";
const UC = "6f1c2b3a-0000-4000-8000-0000000000b1";

function item(over: Partial<GuidedItem> = {}): GuidedItem {
  return {
    id: UC,
    phase: "da_valutare",
    subState: "nuova",
    kind: "da_costruire",
    phaseLabel: "Da valutare · Nuova",
    targetQuarter: null,
    reviewBy: null,
    waitingSince: "2026-10-26",
    realizedOn: null,
    answered: false,
    possibleDuplicateOf: null,
    value: { source: null },
    dossier: null,
    ...over,
  };
}

const approved = (over: Partial<GuidedItem> = {}) => item({ phase: "approvato", subState: "trimestre", phaseLabel: "Approvato · T4 2026", targetQuarter: "2026-Q4", ...over });

function progress(over: Partial<InfoProgress>): GuidedInfo {
  const base: InfoProgress = {
    state: "da_chiedere",
    since: null,
    reminded: false,
    until: null,
    silentReason: null,
    blocked: false,
    received: 0,
    total: 10,
    toAsk: 10,
    toVerify: 0,
    waiting: 0,
    unanswered: 0,
    blockedCount: 0,
  };
  return infoProgressView({ ...base, ...over })!;
}

const COMPLETE = progress({ state: "complete", received: 10, toAsk: 0 });

function input(over: Partial<NextStepInput> = {}): NextStepInput {
  return {
    workspaceId: WS,
    item: item(),
    today: TODAY,
    teamName: TEAM,
    companyName: "TopJet",
    canDecide: true,
    canOpenAnyDossier: false,
    info: null,
    referents: null,
    askEntry: null,
    realizationVariant: null,
    realization: null,
    dossierRead: "ok",
    closedOn: null,
    ...over,
  };
}

/** Il passo come si legge nei test: chiave, titolo, riga, azione, `mine` e decisioni. */
function brief(next: ReturnType<typeof nextStepOf>) {
  return { key: next.key, title: next.title, line: next.line, action: next.action.type, mine: next.mine, decisions: next.decisions };
}

// ─── «Tocca a …» ─────────────────────────────────────────────────────

test("toTeam: «ad» davanti a una a, altrimenti «a»; il nome dal workspace", () => {
  assert.equal(toTeam(DEFAULT_REVIEW_TEAM_NAME), `Tocca ad ${DEFAULT_REVIEW_TEAM_NAME}.`);
  assert.equal(toTeam("Team X"), "Tocca a Team X.");
  assert.equal(toTeam("  Digital   Factory "), "Tocca a Digital Factory.");
  assert.equal(toTeam("analisti"), "Tocca ad analisti.");
});

// ─── Il percorso ─────────────────────────────────────────────────────

/** «fatto/adesso/dopo» e le sotto-etichette, passo per passo. */
function shape(steps: readonly PathStep[]) {
  return steps.map((s) => `${s.key}:${s.state}${s.sub ? `:${s.sub}` : ""}`);
}

function path(over: Partial<GuidedItem>, opts: { info?: GuidedInfo | null; dossierRead?: "ok" | "spenta" | "errore" } = {}) {
  const view = pathOfUseCase({ item: item(over), today: TODAY, info: opts.info ?? null, dossierRead: opts.dossierRead ?? "ok" });
  assert.ok(view, "il percorso c'è");
  // Un solo passo corrente, con aria-current, e al massimo un «adesso».
  assert.equal(view.steps.filter((s) => s.current).length, 1, "un solo aria-current");
  assert.ok(view.steps.filter((s) => s.state === "adesso").length <= 1);
  return view;
}

test("percorso da valutare: Valutato adesso finché non c'è una valutazione del team; un punteggio dell'AI non basta", () => {
  for (const subState of ["nuova", "possibile_doppione", "serve_info"] as const) {
    const view = path({ subState });
    assert.deepEqual(shape(view.steps), ["proposto:fatto", "valutato:adesso", "approvato:dopo", "informazioni:dopo", "realizzazione:dopo", "in_uso:dopo"], subState);
    assert.equal(view.steps.find((s) => s.current)?.key, "valutato");
  }
  assert.deepEqual(shape(path({ subState: "nuova", answered: true }).steps).slice(0, 2), ["proposto:fatto", "valutato:adesso"], "risposta ricevuta");
  assert.deepEqual(shape(path({ subState: "nuova", value: { source: "ai" } }).steps).slice(0, 2), ["proposto:fatto", "valutato:adesso"], "solo l'AI");
  for (const subState of ["valutata", "rimandata", "da_rivedere"] as const) {
    assert.deepEqual(shape(path({ subState, value: { source: "team" } }).steps).slice(0, 3), ["proposto:fatto", "valutato:fatto:dal team", "approvato:adesso"], subState);
  }
  assert.deepEqual(shape(path({ subState: "valutata", value: { source: "ai" } }).steps).slice(0, 3), ["proposto:fatto", "valutato:fatto", "approvato:adesso"], "valutata, punteggio dell'AI: niente «dal team»");
  assert.deepEqual(path({}).steps.map((s) => s.label), ["Proposto", "Valutato", "Approvato", "Informazioni", "Realizzazione", "In uso"]);
});

test("percorso approvato: trimestre, più avanti, scaduto, illeggibile × informazioni nessuna, in corso, complete", () => {
  const running = progress({ received: 2, total: 6, toAsk: 4 });
  const cases: Array<[string, Partial<GuidedItem>, GuidedInfo | null, string[]]> = [
    ["trimestre, senza informazioni", {}, null, ["approvato:fatto:T4 2026", "informazioni:fatto:nessuna da chiedere", "realizzazione:adesso:da avviare", "in_uso:dopo"]],
    ["trimestre, in corso", {}, running, ["approvato:fatto:T4 2026", "informazioni:adesso:2 di 6", "realizzazione:dopo", "in_uso:dopo"]],
    ["trimestre, complete", {}, COMPLETE, ["approvato:fatto:T4 2026", "informazioni:fatto:a posto", "realizzazione:adesso:da avviare", "in_uso:dopo"]],
    ["più avanti, senza", { subState: "piu_avanti", targetQuarter: null }, null, ["approvato:adesso:più avanti", "informazioni:dopo:nessuna da chiedere", "realizzazione:dopo", "in_uso:dopo"]],
    ["più avanti, in corso", { subState: "piu_avanti", targetQuarter: null }, running, ["approvato:adesso:più avanti", "informazioni:dopo:2 di 6", "realizzazione:dopo", "in_uso:dopo"]],
    ["più avanti, complete", { subState: "piu_avanti", targetQuarter: null }, COMPLETE, ["approvato:adesso:più avanti", "informazioni:dopo:a posto", "realizzazione:dopo", "in_uso:dopo"]],
    ["scaduto, senza", { targetQuarter: "2026-Q2" }, null, ["approvato:adesso:T2 2026 passato", "informazioni:dopo:nessuna da chiedere", "realizzazione:dopo", "in_uso:dopo"]],
    ["scaduto, in corso", { targetQuarter: "2026-Q2" }, running, ["approvato:adesso:T2 2026 passato", "informazioni:dopo:2 di 6", "realizzazione:dopo", "in_uso:dopo"]],
    ["scaduto, complete", { targetQuarter: "2026-Q2" }, COMPLETE, ["approvato:adesso:T2 2026 passato", "informazioni:dopo:a posto", "realizzazione:dopo", "in_uso:dopo"]],
    ["illeggibile, senza", { targetQuarter: "2026-Q9" }, null, ["approvato:fatto:2026-Q9", "informazioni:fatto:nessuna da chiedere", "realizzazione:adesso:da avviare", "in_uso:dopo"]],
    ["illeggibile, in corso", { targetQuarter: "2026-Q9" }, running, ["approvato:fatto:2026-Q9", "informazioni:adesso:2 di 6", "realizzazione:dopo", "in_uso:dopo"]],
    ["illeggibile, complete", { targetQuarter: "2026-Q9" }, COMPLETE, ["approvato:fatto:2026-Q9", "informazioni:fatto:a posto", "realizzazione:adesso:da avviare", "in_uso:dopo"]],
  ];
  for (const [label, over, info, tail] of cases) {
    const view = path(approved(over), { info });
    assert.deepEqual(shape(view.steps).slice(2), tail, label);
    assert.deepEqual(shape(view.steps).slice(0, 2), ["proposto:fatto", "valutato:fatto"], label);
  }
});

test("percorso in realizzazione: con il dossier, senza, in uso, chiuso, dossier non letto; realizzato tutto fatto", () => {
  const base = { phase: "in_realizzazione" as const, subState: "dossier" as const, targetQuarter: "2026-Q4" };
  const cases: Array<[string, Partial<GuidedItem>, "ok" | "errore", string[]]> = [
    ["con il dossier", { dossier: { status: "in_sviluppo" } }, "ok", ["informazioni:fatto", "realizzazione:adesso:In sviluppo", "in_uso:dopo"]],
    ["senza dossier", { subState: "senza_dossier" }, "ok", ["informazioni:fatto", "realizzazione:adesso:senza dossier", "in_uso:dopo"]],
    ["in uso", { dossier: { status: "in_esercizio" } }, "ok", ["informazioni:fatto", "realizzazione:fatto", "in_uso:adesso:da segnare"]],
    ["dossier chiuso", { dossier: { status: "chiuso" } }, "ok", ["informazioni:fatto", "realizzazione:adesso:Chiuso", "in_uso:dopo"]],
    ["dossier non letto", {}, "errore", ["informazioni:fatto", "realizzazione:adesso:non disponibile ora", "in_uso:dopo"]],
  ];
  for (const [label, over, dossierRead, tail] of cases) {
    const view = path({ ...base, ...over }, { dossierRead });
    assert.deepEqual(shape(view.steps).slice(2), ["approvato:fatto:T4 2026", ...tail], label);
  }
  const done = path({ phase: "realizzato", subState: "realizzato", realizedOn: "2026-10-03" });
  assert.deepEqual(shape(done.steps), ["proposto:fatto", "valutato:fatto", "approvato:fatto", "informazioni:fatto", "realizzazione:fatto", "in_uso:fatto:dal 3 ott"]);
  assert.equal(done.steps.find((s) => s.current)?.key, "in_uso", "tutti fatti: l'ultimo è il passo corrente");
});

test("percorso best practice: quattro passi fino a Diffusa; chiuso: nessun percorso", () => {
  const spread = path({ phase: "approvato", subState: "piu_avanti", kind: "da_diffondere" });
  assert.deepEqual(shape(spread.steps), ["proposto:fatto", "valutato:fatto", "approvato:fatto", "diffusa:adesso:da segnare"]);
  const diffused = path({ phase: "realizzato", subState: "diffusa", kind: "da_diffondere", realizedOn: "2026-10-03" });
  assert.deepEqual(shape(diffused.steps), ["proposto:fatto", "valutato:fatto", "approvato:fatto", "diffusa:fatto:il 3 ott"]);
  assert.equal(diffused.steps.at(-1)?.current, true);
  for (const subState of ["non_avviato", "doppione", "archiviato"] as const) {
    assert.equal(pathOfUseCase({ item: item({ phase: "chiuso", subState }), today: TODAY, info: null, dossierRead: "ok" }), null, subState);
  }
});

// ─── «Prossimo passo» ────────────────────────────────────────────────

test("C: chiuso, «Fuori dal percorso», il titolo dopo «Chiuso · »; riaprire, o resta chiuso con un dossier", () => {
  const closed = (over: Partial<GuidedItem>, extra: Partial<NextStepInput> = {}) => nextStepOf(input({ item: item({ phase: "chiuso", ...over }), ...extra }));
  const notStarted = closed({ subState: "non_avviato", phaseLabel: "Chiuso · Non avviato" }, { closedOn: new Date("2026-10-03T10:00:00Z") });
  assert.equal(notStarted.heading, "Fuori dal percorso");
  assert.deepEqual(brief(notStarted), { key: "C", title: "Non avviato", line: "Deciso il 3 ott. Si può riaprire: torna in «Da decidere».", action: "decisione", mine: false, decisions: "full" });
  assert.equal(notStarted.primaryOutline, true, "Riapri outline");
  assert.equal(closed({ subState: "non_avviato", phaseLabel: "Chiuso · Non avviato" }).line, "Si può riaprire: torna in «Da decidere».", "senza il giorno");
  const duplicate = closed({ subState: "doppione", phaseLabel: "Chiuso · Doppione di XX-0007" });
  assert.deepEqual([duplicate.title, duplicate.line], ["Doppione di XX-0007", "Si può riaprire."], "senza `status`: non si sa dove torna");
  assert.equal(closed({ subState: "archiviato", phaseLabel: "Chiuso · Archiviato", status: "accepted" }).line, "Si può riaprire: torna alla fase di prima.");
  const stays = closed({ subState: "non_avviato", phaseLabel: "Chiuso · Non avviato", dossier: { status: "chiuso" } });
  assert.deepEqual([stays.line, stays.action.type], ["Resta chiuso: ha un dossier collegato.", "none"]);
});

test("D1, D2: realizzato e diffusa, nessun passo da fare", () => {
  assert.deepEqual(brief(nextStepOf(input({ item: item({ phase: "realizzato", subState: "realizzato", realizedOn: "2026-10-03" }) }))), {
    key: "D1",
    title: "Nessun passo da fare",
    line: "In uso dal 3 ott.",
    action: "none",
    mine: false,
    decisions: "compact",
  });
  assert.equal(nextStepOf(input({ item: item({ phase: "realizzato", subState: "realizzato" }) })).line, "");
  const diffused = nextStepOf(input({ item: item({ phase: "realizzato", subState: "diffusa", kind: "da_diffondere", realizedOn: "2026-10-03" }) }));
  assert.deepEqual([diffused.key, diffused.line], ["D2", "Diffusa il 3 ott."]);
});

function avviata(over: Partial<Extract<UseCaseRealization, { state: "avviata" }>["dossier"]> = {}): UseCaseRealization {
  return {
    state: "avviata",
    dossier: {
      caseId: "6f1c2b3a-0000-4000-8000-0000000000c1",
      statusLabel: "In preparazione",
      statusTone: "blu",
      closed: false,
      progress: { ok: 3, required: 10, inReview: 0 },
      myStep: null,
      nextMilestone: "15 nov",
      figures: { cost: null, benefit: null, breakEven: null },
      href: `/dashboard/${WS}/casi-duso/6f1c2b3a-0000-4000-8000-0000000000c1`,
      ...over,
    },
  };
}

test("E1-E7: in realizzazione; il dossier non letto viene prima di tutto", () => {
  const inRealization = (over: Partial<GuidedItem>, extra: Partial<NextStepInput> = {}) =>
    nextStepOf(input({ item: item({ phase: "in_realizzazione", subState: "dossier", phaseLabel: "In realizzazione", ...over }), ...extra }));
  assert.deepEqual(brief(inRealization({ subState: "senza_dossier" }, { dossierRead: "errore" })), {
    key: "E7",
    title: "Portare avanti la realizzazione",
    line: "Il riepilogo del dossier non è disponibile ora.",
    action: "decisione",
    mine: false,
    decisions: "compact",
  });
  assert.equal(inRealization({ dossier: { status: "in_sviluppo" } }, { realizationVariant: "non_disponibile" }).key, "E7");
  assert.deepEqual(brief(inRealization({ dossier: { status: "in_esercizio" } })), {
    key: "E1",
    title: "Segnare come realizzato",
    line: `${T} Il dossier dice che l'agente è in uso.`,
    action: "decisione",
    mine: true,
    decisions: "compact",
  });
  assert.deepEqual(brief(inRealization({ subState: "senza_dossier" }, { dossierRead: "spenta" })), {
    key: "E2",
    title: "Segnare come realizzato quando è in uso",
    line: T,
    action: "decisione",
    mine: true,
    decisions: "compact",
  });
  assert.deepEqual(brief(inRealization({ dossier: { status: "chiuso" } }, { realizationVariant: "dossier" })), {
    key: "E3",
    title: "Decidere cosa farne",
    line: `${T} Il dossier è chiuso.`,
    action: "decisione",
    mine: false,
    decisions: "compact",
  });
  const mine = inRealization(
    { dossier: { status: "raccolta", caseId: "c1" } },
    { realizationVariant: "riepilogo", realization: avviata({ myStep: { label: "Invia le domande", href: "/casi-duso/c1/domande" } }) },
  );
  assert.deepEqual(brief(mine), {
    key: "E4",
    title: "Invia le domande",
    line: "Tocca a te, nel dossier. Dossier in preparazione · 3 di 10 indispensabili a posto.",
    action: "dossier",
    mine: true,
    decisions: "none",
  });
  assert.deepEqual(mine.action, { type: "dossier", href: "/casi-duso/c1/domande", label: "Apri il dossier", variant: "default" });
  const members = inRealization({ dossier: { status: "raccolta", caseId: "c1" } }, { realizationVariant: "riepilogo", realization: avviata() });
  assert.deepEqual(brief(members), {
    key: "E5",
    title: "Portare avanti la realizzazione",
    line: "La seguono i membri del dossier. Dossier in preparazione · 3 di 10 indispensabili a posto · prossima tappa 15 nov.",
    action: "dossier",
    mine: false,
    decisions: "none",
  });
  assert.equal(members.action.type === "dossier" && members.action.variant, "outline");
  const closedDoor = inRealization({ dossier: { status: "raccolta", caseId: "c1" } }, { realizationVariant: "riepilogo", realization: avviata({ href: null }) });
  assert.deepEqual(brief(closedDoor), {
    key: "E6",
    title: "Portare avanti la realizzazione",
    line: "La seguono i membri del dossier. Dossier in preparazione. Il dossier lo vedono i suoi membri e chi gestisce il workspace.",
    action: "none",
    mine: false,
    decisions: "none",
  });
  const manager = inRealization({ dossier: { status: "in_sviluppo", caseId: "c1" } }, { realizationVariant: "dossier", canOpenAnyDossier: true });
  assert.equal(manager.line, "La seguono i membri del dossier. Dossier in sviluppo.");
  assert.deepEqual(manager.action, { type: "dossier", href: `/dashboard/${WS}/casi-duso/c1`, label: "Apri il dossier", variant: "outline" });
});

test("F1: best practice approvata, «Segna come diffusa» pieno", () => {
  assert.deepEqual(brief(nextStepOf(input({ item: item({ phase: "approvato", subState: "piu_avanti", kind: "da_diffondere" }) }))), {
    key: "F1",
    title: "Diffondere la best practice",
    line: `${T} Quando i colleghi la usano, segnala come diffusa.`,
    action: "decisione",
    mine: true,
    decisions: "compact",
  });
});

const gate = {
  subprocessors: (canDeclare: boolean): ReferentGate => ({
    code: "sub_responsabili_mancanti",
    message: canDeclare ? "TopJet deve autorizzare i fornitori: puoi farlo tu." : "TopJet deve autorizzare i fornitori.",
    canDeclare,
    settingsHref: `/dashboard/${WS}/settings#sub-responsabili`,
    linkLabel: "Apri Impostazioni",
  }),
  email: { code: "email_non_configurata", message: "Le email non sono ancora attive: per ora non possiamo scrivere al referente." } as ReferentGate,
  writes: { code: "risposte_non_attive", message: "Le risposte dal link non sono attive in questo momento." } as ReferentGate,
  verified: { code: "email_non_verificata", message: "Per chiedere serve un account con l'email verificata." } as ReferentGate,
};

const panel = (gates: ReferentGate[], requestCount = 0) => ({ available: true, canAsk: true, gates, requestCount });
const entry = (gates: ReferentGate[]) => ({ canOpen: gates.length === 0, gates });

test("G1-G3: verificare, sollecitare, poi il trimestre (più avanti o scaduto)", () => {
  const toVerify = progress({ state: "da_verificare", received: 3, toVerify: 1, toAsk: 7 });
  const g1 = nextStepOf(input({ item: approved(), info: toVerify, referents: panel([]), askEntry: entry([]) }));
  assert.deepEqual(brief(g1), { key: "G1", title: "Verificare le risposte arrivate", line: `${T} 3 di 10 informazioni ricevute (1 da verificare).`, action: "vai", mine: true, decisions: "compact" });
  assert.deepEqual(g1.action, { type: "vai", id: "cosa-serve", label: "Vedi le risposte" });
  // G1 vince anche su «Più avanti».
  assert.equal(nextStepOf(input({ item: approved({ subState: "piu_avanti", targetQuarter: null }), info: toVerify })).key, "G1");

  const silent = progress({ state: "senza_risposta", toAsk: 8, waiting: 0, unanswered: 2 });
  const withRequests = nextStepOf(input({ item: approved(), info: silent, referents: panel([], 2), askEntry: entry([]) }));
  assert.deepEqual(brief(withRequests), { key: "G2", title: "Sollecitare chi non ha risposto", line: `${T} 2 informazioni senza risposta.`, action: "vai", mine: true, decisions: "compact" });
  assert.deepEqual(withRequests.action, { type: "vai", id: "richieste", label: "Vedi le richieste" });
  const noRequests = nextStepOf(input({ item: approved(), info: progress({ state: "senza_risposta", unanswered: 1 }) }));
  assert.equal(noRequests.line, `${T} 1 informazione senza risposta.`);
  assert.deepEqual(noRequests.action, { type: "vai", id: "cosa-serve", label: "Vedi le richieste" }, "senza richieste: «Cosa serve»");

  const later = nextStepOf(input({ item: approved({ subState: "piu_avanti", targetQuarter: null, phaseLabel: "Approvato · Più avanti" }), info: progress({}) }));
  // (Rilascio 6) «Scegli il trimestre» porta a «Quando»: bordato per «Più avanti», pieno a trimestre finito per chi decide.
  assert.deepEqual(brief(later), { key: "G3", title: "Approvato per più avanti", line: `${T} Le informazioni si chiedono quando si sceglie il trimestre.`, action: "vai", mine: false, decisions: "compact" });
  assert.deepEqual(later.action, { type: "vai", id: "quando", label: "Scegli il trimestre" });
  assert.deepEqual([later.cta, later.icon, later.turn, later.why, later.link], ["Scegli il trimestre", "trimestre", null, "Approvato per più avanti. Le informazioni si chiedono quando si sceglie il trimestre.", null]);
  const expired = nextStepOf(input({ item: approved({ targetQuarter: "2026-Q2" }) }));
  assert.deepEqual(brief(expired), { key: "G3", title: "Scegliere un nuovo trimestre", line: `${T} Il T2 2026 è finito: il trimestre si sceglie in «Quando».`, action: "vai", mine: true, decisions: "compact" });
  assert.deepEqual([expired.cta, expired.turn, expired.why], ["Scegli il trimestre", T, "Il T2 2026 è finito: il trimestre si sceglie in «Quando»."]);
  assert.equal(nextStepOf(input({ item: approved({ targetQuarter: "2026-Q2" }), canDecide: false })).mine, false, "chi non decide: bordato");
});

test("G4-G6: autorizzare i fornitori, chiedere al referente, oppure il motivo; l'ordine dei controlli", () => {
  const info = progress({ received: 0, total: 10, toAsk: 7, waiting: 1, blockedCount: 2 });
  const g4 = nextStepOf(input({ item: approved(), info, referents: panel([gate.subprocessors(true), gate.email]), askEntry: entry([gate.subprocessors(true), gate.email]) }));
  assert.deepEqual(brief(g4), { key: "G4", title: "Autorizzare i fornitori", line: "TopJet deve autorizzare i fornitori: puoi farlo tu.", action: "impostazioni", mine: true, decisions: "compact" });
  assert.equal(g4.gate, "sub_responsabili_mancanti");
  assert.deepEqual(g4.action, { type: "impostazioni", href: `/dashboard/${WS}/settings#sub-responsabili`, label: "Apri Impostazioni" });
  // Lateral Space non autorizza: nessun pulsante.
  const ls = nextStepOf(input({ item: approved(), info, referents: panel([gate.subprocessors(false)]), askEntry: entry([gate.subprocessors(false)]) }));
  assert.deepEqual([ls.key, ls.action.type, ls.mine, ls.line], ["G4", "none", false, "TopJet deve autorizzare i fornitori."]);
  // Il primo controllo conta: con l'email prima, è G6.
  assert.equal(nextStepOf(input({ item: approved(), info, referents: panel([gate.email, gate.subprocessors(true)]), askEntry: entry([gate.email, gate.subprocessors(true)]) })).key, "G6");

  const g5 = nextStepOf(input({ item: approved(), info, referents: panel([]), askEntry: entry([]) }));
  assert.deepEqual(brief(g5), { key: "G5", title: "Chiedere le informazioni a TopJet", line: `${T} 7 delle 10 informazioni sono ancora da chiedere.`, action: "chiedi", mine: true, decisions: "compact" });
  assert.equal(g5.gate, null);
  assert.equal(nextStepOf(input({ item: approved(), info: progress({ toAsk: 1 }), referents: panel([]), askEntry: entry([]) })).line, `${T} 1 delle 10 informazioni è ancora da chiedere.`);
  assert.equal(nextStepOf(input({ item: approved(), info: progress({ total: 1, toAsk: 1 }), referents: panel([]), askEntry: entry([]) })).line, `${T} L'informazione è ancora da chiedere.`);

  // G6: i motivi che nessuno nel workspace toglie, da soli; gli altri con «Tocca a»; la funzione spenta con la frase di G5.
  for (const system of [gate.email, gate.writes]) {
    const g6 = nextStepOf(input({ item: approved(), info, referents: panel([system]), askEntry: entry([system]) }));
    assert.deepEqual(brief(g6), { key: "G6", title: "Chiedere le informazioni a TopJet", line: system.message, action: "none", mine: false, decisions: "compact" });
    assert.equal(g6.gate, system.code);
  }
  const verified = nextStepOf(input({ item: approved(), info, referents: panel([gate.verified]), askEntry: entry([gate.verified]) }));
  assert.deepEqual([verified.key, verified.line, verified.gate], ["G6", `${T} ${gate.verified.message}`, "email_non_verificata"]);
  const off = nextStepOf(input({ item: approved(), info, referents: { available: false, canAsk: true, gates: [], requestCount: 0 } }));
  assert.deepEqual([off.key, off.line, off.gate, off.action.type], ["G6", `${T} 7 delle 10 informazioni sono ancora da chiedere.`, null, "none"]);
  assert.equal(nextStepOf(input({ item: approved(), info })).key, "G6", "senza «Chiedi al referente» (pannello)");
});

test("G7-G9: aspettare, sbloccare, avviare", () => {
  const waiting = progress({ state: "in_attesa", toAsk: 0, waiting: 3, since: "2026-10-27", reminded: true, received: 5, blockedCount: 2 });
  assert.deepEqual(brief(nextStepOf(input({ item: approved(), info: waiting }))), {
    key: "G7",
    title: "Aspettare le risposte",
    line: "Tocca ai referenti. In attesa dal 27 ott, promemoria inviato.",
    action: "none",
    mine: false,
    decisions: "compact",
  });
  assert.equal(nextStepOf(input({ item: approved(), info: progress({ state: "in_attesa", toAsk: 0, waiting: 1, since: "2026-10-27" }) })).line, "Tocca ai referenti. In attesa dal 27 ott.");
  assert.equal(nextStepOf(input({ item: approved(), info: progress({ state: "in_attesa", toAsk: 0, waiting: 1 }) })).line, "Tocca ai referenti.");

  const blocked = progress({ state: "da_chiedere", blocked: true, toAsk: 0, received: 8, blockedCount: 2 });
  assert.deepEqual(brief(nextStepOf(input({ item: approved(), info: blocked }))), {
    key: "G8",
    title: "Sbloccare le informazioni ferme",
    line: `${T} 2 ferme: si chiedono quando si sbloccano.`,
    action: "none",
    mine: false,
    decisions: "compact",
  });
  assert.equal(nextStepOf(input({ item: approved(), info: progress({ toAsk: 0, blockedCount: 1 }) })).line, `${T} 1 ferma: si chiede quando si sblocca.`);

  const start = nextStepOf(input({ item: approved(), info: COMPLETE, realizationVariant: "avvia" }));
  assert.deepEqual(brief(start), { key: "G9", title: "Avviare la realizzazione", line: "Tocca a Lateral Space. Le informazioni ci sono tutte.", action: "avvia", mine: true, decisions: "compact" });
  assert.deepEqual(start.action, { type: "avvia", href: `/dashboard/${WS}/casi-duso/nuovo?useCaseId=${UC}`, label: "Avvia la realizzazione" });
  const fromHref = nextStepOf(input({ item: approved(), info: null, realizationVariant: "avvia", realization: { state: "da_avviare", canStart: true, startHref: "/inizio" } }));
  assert.deepEqual([fromHref.line, fromHref.action.type === "avvia" && fromHref.action.href], ["Tocca a Lateral Space. Da TopJet non serve nessuna informazione.", "/inizio"]);
  const mark = nextStepOf(input({ item: approved(), info: null, realizationVariant: "segna" }));
  assert.deepEqual([mark.key, mark.action.type, mark.mine], ["G9", "segna_in_realizzazione", true]);
  for (const variant of ["lo_avvia_ls", "fase"] as const) {
    const client = nextStepOf(input({ item: approved(), info: COMPLETE, realizationVariant: variant }));
    assert.deepEqual([client.key, client.action.type, client.mine, client.line], ["G9", "none", false, "Tocca a Lateral Space. Le informazioni ci sono tutte."], variant);
  }
  const unavailable = nextStepOf(input({ item: approved(), info: COMPLETE, realizationVariant: "non_disponibile" }));
  assert.deepEqual([unavailable.key, unavailable.line, unavailable.action.type], ["G9", "Il riepilogo del dossier non è disponibile ora.", "none"]);
  assert.equal(nextStepOf(input({ item: approved(), companyName: null, info: null, realizationVariant: "fase" })).line, "Tocca a Lateral Space. Da la tua azienda non serve nessuna informazione.");
});

test("H1-H7: da valutare, «Approva» pieno tranne in «Serve info» e «Rimandata»", () => {
  const decide = (over: Partial<GuidedItem>) => nextStepOf(input({ item: item(over) }));
  const h2 = decide({ subState: "serve_info", answered: true });
  // (Rilascio 6, B.1.7) «Approva» in vista, le altre decisioni nel menu «⋯».
  assert.deepEqual(brief(h2), { key: "H2", title: "Leggere la risposta e decidere", line: `${T} Chi ha proposto ha risposto.`, action: "decisione", mine: true, decisions: "compact" });
  assert.deepEqual(h2.link, { id: "nota-pubblica", label: "Leggi la risposta" });
  assert.equal(decide({ subState: "valutata", answered: true }).key, "H2", "una risposta vale in ogni sotto-stato");
  const h1 = decide({ subState: "serve_info" });
  assert.deepEqual(brief(h1), { key: "H1", title: "Aspettare la risposta di chi ha proposto", line: "Tocca a chi ha proposto. La domanda è nella nota pubblica.", action: "decisione", mine: false, decisions: "compact" });
  assert.deepEqual([h1.cta, h1.turn, h1.why], ["In attesa di chi ha proposto", "Tocca a chi ha proposto.", "La domanda è nella nota pubblica."]);
  assert.deepEqual(h1.link, { id: "nota-pubblica", label: "Vedi la nota pubblica" });
  assert.equal(h1.primaryOutline, true);
  const h3 = decide({ subState: "rimandata", reviewBy: "2027-01-14" });
  assert.deepEqual(brief(h3), { key: "H3", title: "Riprendere la decisione il 14 gen 2027", line: `${T} La decisione è rimandata.`, action: "decisione", mine: false, decisions: "compact" });
  assert.deepEqual([h3.cta, h3.turn, h3.why], ["Rimandata al 14 gen 2027", null, "Riprendere la decisione il 14 gen 2027. La decisione è rimandata."]);
  assert.equal(h3.primaryOutline, true);
  assert.deepEqual(brief(decide({ subState: "da_rivedere" })), { key: "H4", title: "Riprendere la decisione", line: `${T} La data per riprenderla è passata.`, action: "decisione", mine: true, decisions: "compact" });
  assert.deepEqual(brief(decide({ subState: "valutata" })), { key: "H5", title: "Decidere se approvarlo", line: `${T} In attesa da 6 giorni.`, action: "decisione", mine: true, decisions: "compact" });
  assert.deepEqual(brief(decide({ subState: "possibile_doppione", possibleDuplicateOf: "XX-0007" })), {
    key: "H6",
    title: "Controllare se è un doppione e decidere",
    line: `${T} Potrebbe essere un doppione di XX-0007.`,
    action: "decisione",
    mine: true,
    decisions: "compact",
  });
  assert.equal(decide({ subState: "possibile_doppione" }).line, `${T} In attesa da 6 giorni.`, "senza codice: la riga della decisione");
  const h7 = decide({});
  assert.deepEqual(brief(h7), { key: "H7", title: "Valutare e decidere", line: `${T} In attesa da 6 giorni.`, action: "decisione", mine: true, decisions: "compact" });
  assert.deepEqual([h7.turn, h7.why, h7.icon], [T, "In attesa da 6 giorni.", "decidi"]);
  assert.equal(h7.primaryOutline, false);
  assert.equal(h7.heading, "Prossimo passo");
});

test("(Rilascio 6, B.1) il pulsante del passo: un verbo di due o tre parole, «Tocca a …» a parte, la spiegazione nel «?»", () => {
  const info = progress({ received: 0, total: 10, toAsk: 7 });
  const referent = (state: "manca" | "in_attesa" | "nessuna_risposta" | "da_verificare" | "fatto", over: Partial<NonNullable<NextStepInput["referent"]>> = {}) => ({ state, review: null, canChoose: true, askableForReferent: null, canOpen: true, ...over });
  // «Indica il referente»: apre «Scegli il referente»; la spiegazione è la riga senza «Tocca a».
  const choose = nextStepOf(input({ item: approved(), info, referents: panel([]), askEntry: entry([]), referent: referent("manca") }));
  assert.deepEqual([choose.key, choose.cta, choose.icon, choose.turn, choose.why, choose.mine], ["G5", "Indica il referente", "referente", T, "Il referente conferma lo use case e l'impatto, poi risponde alle domande.", true]);
  assert.deepEqual(choose.action, { type: "referente", mode: "scegli", label: "Scegli il referente" });
  // Le email spente fermano solo l'invio: il pulsante c'è, bordato, e la finestra dice il motivo.
  const gated = nextStepOf(input({ item: approved(), info, referents: panel([gate.email]), askEntry: entry([gate.email]), referent: referent("manca", { canChoose: false }) }));
  assert.deepEqual([gated.key, gated.cta, gated.action.type, gated.mine, gated.turn, gated.gate], ["G6", "Indica il referente", "referente", false, null, "email_non_configurata"]);
  const closed = nextStepOf(input({ item: approved(), info, referents: panel([gate.verified]), askEntry: entry([gate.verified]), referent: referent("manca", { canChoose: false, canOpen: false }) }));
  assert.deepEqual([closed.key, closed.action.type, closed.turn], ["G6", "none", T], "una finestra che non si apre: nessun pulsante, lo stato e «Tocca a»");
  // Il referente che ha risposto: «Chiedi al referente»; senza domande per lui, «Chiedi a un'altra persona».
  const ask = nextStepOf(input({ item: approved(), info, referents: panel([]), askEntry: entry([]), referent: referent("fatto", { askableForReferent: 3 }) }));
  assert.deepEqual([ask.cta, ask.icon, ask.why], ["Chiedi al referente", "chiedi", "7 delle 10 informazioni sono ancora da chiedere."]);
  const other = nextStepOf(input({ item: approved(), info, referents: panel([]), askEntry: entry([]), referent: referent("fatto", { askableForReferent: 0 }) }));
  assert.deepEqual([other.cta, other.action.type === "referente" && other.action.mode], ["Chiedi a un'altra persona", "altra"]);
  const noReferent = nextStepOf(input({ item: approved(), info, referents: panel([]), askEntry: entry([]) }));
  assert.deepEqual([noReferent.cta, noReferent.action.type], ["Chiedi le informazioni", "chiedi"]);
  // «Sollecita il referente» apre «Chiedi di nuovo»; con risposte mancanti alle domande va alle richieste.
  const silent = nextStepOf(input({ item: approved(), info: progress({ toAsk: 0, waiting: 0 }), referents: panel([], 1), askEntry: entry([]), referent: referent("nessuna_risposta") }));
  assert.deepEqual([silent.key, silent.cta, silent.icon, silent.why], ["G2", "Sollecita il referente", "sollecita", "Il referente non ha risposto."]);
  assert.deepEqual(silent.action, { type: "referente", mode: "di_nuovo", label: "Sollecita il referente" });
  assert.equal(nextStepOf(input({ item: approved(), info: progress({ toAsk: 0, waiting: 0 }), referents: panel([], 1), askEntry: entry([]), referent: referent("nessuna_risposta", { canOpen: false }) })).action.type, "vai");
  const unanswered = nextStepOf(input({ item: approved(), info: progress({ state: "senza_risposta", unanswered: 2 }), referents: panel([], 2), askEntry: entry([]) }));
  assert.deepEqual([unanswered.cta, unanswered.why], ["Sollecita le risposte", "2 informazioni senza risposta."]);
  // «Verifica le risposte»; «Autorizza i fornitori» per chi può, altrimenti lo stato e a chi tocca.
  const verify = nextStepOf(input({ item: approved(), info: progress({ state: "da_verificare", received: 3, toVerify: 1, toAsk: 7 }) }));
  assert.deepEqual([verify.cta, verify.icon, verify.why], ["Verifica le risposte", "verifica", "3 di 10 informazioni ricevute (1 da verificare)."]);
  const authorize = nextStepOf(input({ item: approved(), info, referents: panel([gate.subprocessors(true)]), askEntry: entry([gate.subprocessors(true)]), referent: referent("manca") }));
  assert.deepEqual([authorize.key, authorize.cta, authorize.turn, authorize.mine], ["G4", "Autorizza i fornitori", null, true]);
  const waitOk = nextStepOf(input({ item: approved(), info, referents: panel([gate.subprocessors(false)]), askEntry: entry([gate.subprocessors(false)]), referent: referent("manca") }));
  assert.deepEqual([waitOk.cta, waitOk.turn, waitOk.action.type], ["Manca l'ok sui fornitori", "Tocca a TopJet.", "none"]);
  // Senza pulsante, le parole dello stato e a chi tocca: il referente, i referenti, Lateral Space.
  const wait = nextStepOf(input({ item: approved(), info: progress({ state: "in_attesa", toAsk: 0, waiting: 1, since: "2026-10-27" }), referent: referent("in_attesa") }));
  assert.deepEqual([wait.key, wait.cta, wait.icon, wait.turn, wait.why, wait.action.type], ["G7", "In attesa del referente", "attesa", "Tocca al referente.", "In attesa dal 27 ott.", "none"]);
  const answers = nextStepOf(input({ item: approved(), info: progress({ state: "in_attesa", toAsk: 0, waiting: 1 }) }));
  assert.deepEqual([answers.cta, answers.turn, answers.why], ["In attesa delle risposte", "Tocca ai referenti.", ""]);
  const ready = nextStepOf(input({ item: approved(), info: COMPLETE, realizationVariant: "lo_avvia_ls" }));
  assert.deepEqual([ready.cta, ready.turn, ready.why], ["Pronto da avviare", "Tocca a Lateral Space.", "Le informazioni ci sono tutte."]);
  const start = nextStepOf(input({ item: approved(), info: COMPLETE, realizationVariant: "avvia" }));
  assert.deepEqual([start.cta, start.icon, start.mine], ["Avvia la realizzazione", "avvia", true]);
  // Chiuso: «Riapri» per chi decide; «Resta chiuso» per chi decide senza niente da premere; il sotto-stato per chi non decide.
  const closedCard = item({ phase: "chiuso", subState: "non_avviato", phaseLabel: "Chiuso · Non avviato" });
  assert.equal(nextStepOf(input({ item: closedCard })).cta, "Non avviato");
  assert.equal(nextStepOf(input({ item: closedCard, canDecide: false })).cta, "Non avviato");
  assert.equal(nextStepOf(input({ item: { ...closedCard, dossier: { status: "chiuso" } } })).cta, "Resta chiuso");
  const done = nextStepOf(input({ item: item({ phase: "realizzato", subState: "realizzato", realizedOn: "2026-10-03" }) }));
  assert.deepEqual([done.cta, done.why, done.turn], ["Nessun passo da fare", "In uso dal 3 ott.", null]);
  // Mai «Tocca a» nella spiegazione, mai un segnaposto; il verbo sta in quattro parole al massimo.
  const samples = [choose, gated, closed, ask, other, noReferent, silent, unanswered, verify, authorize, waitOk, wait, answers, ready, start, done];
  for (const next of samples) {
    assert.ok(!/Tocca a/.test(next.why), `${next.key}: ${next.why}`);
    assert.ok(!next.cta.includes("{") && !next.why.includes("{"), next.key);
    assert.ok(next.cta.split(/\s+/).length <= 4, `${next.key}: ${next.cta}`);
  }
});

test("«Prossimo passo»: un passo mio solo dove la pagina vuole un pulsante pieno", () => {
  const mineKeys = new Set(["E1", "E2", "E4", "F1", "G1", "G2", "G4", "G5", "G9", "H2", "H4", "H5", "H6", "H7"]);
  const samples: NextStepInput[] = [
    input({ item: item({ phase: "chiuso", subState: "archiviato", phaseLabel: "Chiuso · Archiviato" }) }),
    input({ item: item({ phase: "realizzato", subState: "realizzato" }) }),
    input({ item: item({ phase: "in_realizzazione", subState: "dossier", dossier: { status: "chiuso" } }), realizationVariant: "dossier" }),
    input({ item: approved({ subState: "piu_avanti", targetQuarter: null }) }),
    input({ item: item({ subState: "serve_info" }) }),
    input({ item: item({ subState: "rimandata" }) }),
    input({ item: item({ subState: "valutata" }) }),
  ];
  for (const sample of samples) {
    const next = nextStepOf(sample);
    assert.equal(next.mine, mineKeys.has(next.key), next.key);
    assert.equal(next.primaryOutline, !next.mine, next.key);
    assert.ok(!next.line.includes("{") && !next.title.includes("{"), `${next.key}: segnaposto riempiti`);
  }
});

// ─── «Pronto da avviare» ─────────────────────────────────────────────

test("isReadyToStart: approvato da costruire, trimestre che vale, informazioni complete o nessuna", () => {
  assert.equal(isReadyToStart(approved(), null, TODAY), true);
  assert.equal(isReadyToStart(approved(), { state: "complete" }, TODAY), true);
  assert.equal(isReadyToStart(approved(), { state: "in_attesa" }, TODAY), false);
  assert.equal(isReadyToStart(approved({ targetQuarter: "2026-Q9" }), null, TODAY), true, "illeggibile: non scaduto");
  assert.equal(isReadyToStart(approved({ targetQuarter: "2026-Q3" }), null, TODAY), false, "scaduto");
  assert.equal(isReadyToStart(approved({ subState: "piu_avanti", targetQuarter: null }), null, TODAY), false, "più avanti");
  assert.equal(isReadyToStart(approved({ kind: "da_diffondere" }), null, TODAY), false, "best practice");
  assert.equal(isReadyToStart(item({ phase: "in_realizzazione", subState: "dossier", targetQuarter: "2026-Q4" }), null, TODAY), false);
  assert.equal(isReadyToStart(approved({ targetQuarter: "2027-Q1" }), null, TODAY), true, "prossimo trimestre");
});

// ─── «Impatto» ───────────────────────────────────────────────────────

const PARAMS = { hourlyCostEur: 35, dayCostEur: 0, includeUnmeasured: false };

/** Un use case di prova, con numeri inventati: 300 ore all'anno, 10.500 €, avvio 600 €, ricorrenti 800 €/anno, 4 giorni di sviluppo. */
const SAMPLE_MODEL: ValueModel = {
  v: 1,
  primary: "tempo",
  whyPrimary: "Le pratiche si smistano a mano.",
  components: [
    { key: "pratiche", lever: "tempo", label: "Pratiche in entrata", kind: "ore", confidence: "ipotesi", volumeYear: 2400, unit: "pratiche", minutesPerUnit: 15, automatablePct: 50, indicator: "minuti per pratica", basis: "Stima dell'ufficio" },
    { key: "errori", lever: "qualita", label: "Meno errori di smistamento", kind: "qualitativo", confidence: "ipotesi" },
    { key: "picco", lever: "output", label: "Picchi di fine mese gestiti", kind: "qualitativo", confidence: "fonte" },
  ],
  ease: 4,
  costs: { devDays: 4, internalHours: 16, runCostEurYear: 800 },
};
const SAMPLE_VALUE: ValueFigure = { score: 2.2, word: "basso", source: "team", perYear: { amount: 10_500, source: "team" }, benefits: { state: "contato", benefitEur: 10_500, pendingEur: 0, hours: 300 } };
const SAMPLE_COST: CostFigure = { source: "stima", amount: 600, band: 1, fromBand: false, runEurYear: 800, position: 1, referenceEur: 600 };

test("impactView A: ore contate, euro con la fonte, l'ora, il rientro, le voci", () => {
  const view = impactView({ value: SAMPLE_VALUE, cost: SAMPLE_COST, valueModel: SAMPLE_MODEL, params: PARAMS, unofficial: false });
  assert.equal(view.variant, "A");
  if (view.variant !== "A") return;
  assert.deepEqual([view.hoursText, view.unit, view.hourly, view.pending], ["300", "ore all'anno", "a 35 € l'ora", null]);
  assert.deepEqual(view.perYear, { amount: 10_500, source: "team" });
  assert.equal(view.payback, "L'avvio rientra in meno di un mese a regime, senza contare i 4 giorni di sviluppo.");
  assert.deepEqual(view.items.lines, [{ label: "Pratiche in entrata", formula: "2.400 pratiche all'anno × 15 min × 50% ≈ 300 h · 10.500 €", confidence: "ipotesi" }]);
  assert.deepEqual(view.items.qualitative, ["Meno errori di smistamento", "Picchi di fine mese gestiti"]);
  assert.equal(view.items.toConfirm, true);
  assert.equal(view.items.measuredBy, "Si misura con: minuti per pratica");
  assert.deepEqual(
    view.items.origin.map((row) => ["key" in row.term ? row.term.key : row.term.text, row.detail]),
    [
      ["whyPrimary", "Le pratiche si smistano a mano."],
      ["Pratiche in entrata · Da dove viene la stima", "Stima dell'ufficio"],
      ["ease", "4 su 5"],
      ["Ipotesi di calcolo", "35 € l'ora · 0 € a giornata"],
    ],
  );
  const one = impactView({ value: { ...SAMPLE_VALUE, benefits: { ...SAMPLE_VALUE.benefits!, hours: 1, pendingEur: 4200 } }, cost: SAMPLE_COST, valueModel: SAMPLE_MODEL, params: PARAMS, unofficial: false });
  assert.ok(one.variant === "A" && one.unit === "ora all'anno" && one.pending === "e fino a 4.200 € da misurare");
});

test("impactView B-G: solo euro, da misurare, qualitativo, euro senza modello (anche dal dossier), parola, niente", () => {
  const euroOnly = impactView({ value: { ...SAMPLE_VALUE, benefits: { ...SAMPLE_VALUE.benefits!, hours: 0 } }, cost: SAMPLE_COST, valueModel: SAMPLE_MODEL, params: PARAMS, unofficial: false });
  assert.ok(euroOnly.variant === "B" && euroOnly.perYear.amount === 10_500 && euroOnly.payback?.startsWith("L'avvio rientra"));
  const pending = impactView({ value: { score: null, word: null, source: "team", perYear: null, benefits: { state: "da_misurare", benefitEur: 0, pendingEur: 4200, hours: 0 } }, cost: SAMPLE_COST, valueModel: SAMPLE_MODEL, params: PARAMS, unofficial: false });
  assert.ok(pending.variant === "C");
  if (pending.variant === "C") assert.deepEqual([pending.big, pending.unit, pending.note], ["fino a 4.200 €", "all'anno, da misurare", "Entra nel conto quando c'è la misura di oggi."]);
  const qualitative = impactView({ value: { score: null, word: null, source: "team", perYear: null, benefits: { state: "qualitativo", benefitEur: 0, pendingEur: 0, hours: 0 } }, cost: null, valueModel: SAMPLE_MODEL, params: PARAMS, unofficial: false });
  assert.ok(qualitative.variant === "D" && qualitative.big === "Qualitativo" && qualitative.note === "Nessuna cifra: il ritorno è qualitativo.");
  const dossier = impactView({ value: { score: 4, word: "alto", source: "team", perYear: { amount: 40_000, source: "dossier" } }, cost: { ...SAMPLE_COST, source: "dossier", amount: 30_000 }, valueModel: null, params: PARAMS, unofficial: false });
  assert.deepEqual(dossier, { variant: "E", perYear: { amount: 40_000, source: "dossier" } }, "gli euro del dossier, come nella riga e nel MCP");
  assert.deepEqual(impactView({ value: { score: 3.8, word: "alto", source: "team", perYear: null }, cost: null, valueModel: null, params: PARAMS, unofficial: false }), { variant: "F" });
  const nothing = impactView({ value: { score: null, word: null, source: null, perYear: null }, cost: null, valueModel: null, params: PARAMS, unofficial: false });
  assert.deepEqual(nothing, { variant: "G", big: "Da stimare", note: "Il valore si stima in «Valutazione del team».", link: { id: "valutazione", label: "Stima benefici e costi" }, unofficial: null });
  const unofficial = impactView({ value: null, cost: null, valueModel: null, params: PARAMS, unofficial: true });
  assert.ok(unofficial.variant === "G" && unofficial.unofficial === "C'è una stima non ufficiale in «Valutazione del team».");
  // Un solo riquadro di stime: «Impatto» non ne porta nessuno.
  assert.ok(!JSON.stringify(unofficial).includes("Stime non ufficiali"));
});

test("paybackText: meno di un mese, circa 2 mesi, un mese, costi non coperti, oltre due anni; null senza le condizioni", () => {
  const at = (amount: number, run: number, opts: { devDays?: number; dayCostEur?: number } = {}) =>
    paybackText({
      value: { ...SAMPLE_VALUE, perYear: { amount: 12_000, source: "team" }, benefits: { state: "contato", benefitEur: 12_000, pendingEur: 0, hours: 300 } },
      cost: { ...SAMPLE_COST, amount, runEurYear: run },
      valueModel: { ...SAMPLE_MODEL, costs: { devDays: opts.devDays ?? 0, internalHours: 0, runCostEurYear: run } },
      params: { ...PARAMS, dayCostEur: opts.dayCostEur ?? 0 },
    });
  assert.equal(paybackText({ value: SAMPLE_VALUE, cost: SAMPLE_COST, valueModel: SAMPLE_MODEL, params: PARAMS }), "L'avvio rientra in meno di un mese a regime, senza contare i 4 giorni di sviluppo.");
  assert.equal(at(1700, 0), "L'avvio rientra in circa 2 mesi a regime.", "1,7 mesi");
  assert.equal(at(1000, 0), "L'avvio rientra in circa un mese a regime.", "un mese esatto");
  assert.equal(at(1000, 0, { devDays: 1 }), "L'avvio rientra in circa un mese a regime, senza contare il giorno di sviluppo.");
  assert.equal(at(1000, 0, { devDays: 2.5 }), "L'avvio rientra in circa un mese a regime, senza contare i 2,5 giorni di sviluppo.");
  assert.equal(at(1000, 0, { devDays: 5, dayCostEur: 600 }), "L'avvio rientra in circa un mese a regime.", "con la giornata a pagamento i giorni sono già nel costo");
  assert.equal(at(24_000, 0), "L'avvio rientra in circa 24 mesi a regime.");
  assert.equal(at(30_000, 0), "L'avvio rientra in più di due anni a regime.");
  assert.equal(at(1000, 12_000), "Il beneficio contato non copre i costi ricorrenti.");
  assert.equal(at(1000, 15_000), "Il beneficio contato non copre i costi ricorrenti.");
  assert.equal(at(0, 0), null, "avvio a 0 €");
  assert.equal(paybackText({ value: SAMPLE_VALUE, cost: { ...SAMPLE_COST, source: "team_importo" }, valueModel: SAMPLE_MODEL, params: PARAMS }), null, "costo non di «Benefici e costi»");
  assert.equal(paybackText({ value: { ...SAMPLE_VALUE, perYear: { amount: 10_500, source: "dossier" } }, cost: SAMPLE_COST, valueModel: SAMPLE_MODEL, params: PARAMS }), null, "euro del dossier: il pareggio è del dossier");
  assert.equal(paybackText({ value: { ...SAMPLE_VALUE, benefits: { state: "da_misurare", benefitEur: 0, pendingEur: 100, hours: 0 } }, cost: SAMPLE_COST, valueModel: SAMPLE_MODEL, params: PARAMS }), null);
  assert.equal(paybackText({ value: SAMPLE_VALUE, cost: null, valueModel: SAMPLE_MODEL, params: PARAMS }), null);
});

// ─── I cinque gruppi, le pieghe, le ancore, «Come cambia il lavoro» ──

test("requestGroupView: gli 8 stati nei 5 gruppi, con il dettaglio", () => {
  const expected: Record<NeedStatus, [string, string, string | null]> = {
    da_chiedere: ["Da chiedere", "grigio", null],
    mancante: ["Da chiedere", "grigio", "manca il dato"],
    parziale: ["Da chiedere", "grigio", "risposta parziale"],
    chiesta: ["In attesa", "blu", null],
    in_verifica: ["Da verificare", "giallo", null],
    bloccata: ["Ferma", "lucchetto", null],
    validata: ["A posto", "verde", null],
    non_applicabile: ["A posto", "verde", "non si applica"],
  } as Record<NeedStatus, [string, string, string | null]>;
  assert.deepEqual([...NEED_REQUIREMENT_STATUSES].sort(), Object.keys(expected).sort(), "tutti gli stati dei requisiti");
  for (const [status, [label, tone, note]] of Object.entries(expected)) {
    const view = requestGroupView(status as NeedStatus);
    assert.deepEqual([view.label, view.tone, view.note], [label, tone, note], status);
  }
  assert.equal(requestGroupView("proposta" as NeedStatus).label, "Da chiedere", "uno stato sconosciuto vale «da chiedere»");
});

test("foldSummaries: valutazione, dettagli, realizzazione, storia", () => {
  const base = {
    valuation: { estimates: false, aiSuggestion: false, value: null, zone: null },
    filledDetails: [] as string[],
    realization: null,
    events: null,
    today: TODAY,
  };
  assert.deepEqual(foldSummaries(base), { valutazione: "modifica benefici e costi", dettagli: "da completare", realizzazione: null, storia: null });
  const full = foldSummaries({
    valuation: { estimates: true, aiSuggestion: true, value: { perYear: null, benefits: null }, zone: "subito" },
    filledDetails: ["Impatto atteso", "Dati", "Area", "AI Lab", "Impatto ambientale e sociale"],
    realization: { variant: "riepilogo", realization: avviata(), dossier: { status: "raccolta", readiness: null }, realizedOn: null },
    events: [{ at: "2026-10-28T09:00:00.000Z" }, { at: "2026-10-01T09:00:00.000Z" }],
    today: TODAY,
  });
  assert.deepEqual(full, {
    valutazione: "stime non ufficiali · suggerimento AI · zona: Subito",
    dettagli: "impatto atteso · dati · area e altri 2",
    realizzazione: "dossier in preparazione · 3 di 10 a posto",
    storia: "ultimo cambiamento il 28 ott",
  });
  // La zona solo per un Valore senza euro.
  assert.equal(foldSummaries({ ...base, valuation: { ...base.valuation, value: { perYear: { amount: 10, source: "team" }, benefits: null }, zone: "subito" } }).valutazione, "modifica benefici e costi");
  assert.equal(foldSummaries({ ...base, filledDetails: ["AI Lab"] }).dettagli, "AI Lab");
  assert.equal(foldSummaries({ ...base, filledDetails: ["Impatto atteso", "Dati", "Area", "AI Lab"] }).dettagli, "impatto atteso · dati · area e un altro");
  assert.equal(foldSummaries({ ...base, events: [] }).storia, "nessun cambiamento");
  const summary = (variant: Parameters<typeof foldSummaries>[0]["realization"]) => foldSummaries({ ...base, realization: variant }).realizzazione;
  assert.equal(summary({ variant: "avvia", realization: null, dossier: null, realizedOn: null }), "non ancora partita");
  assert.equal(summary({ variant: "segna", realization: null, dossier: null, realizedOn: null }), "non ancora partita");
  assert.equal(summary({ variant: "lo_avvia_ls", realization: null, dossier: null, realizedOn: null }), "la avvia Lateral Space");
  assert.equal(summary({ variant: "diffusa", realization: null, dossier: null, realizedOn: "2026-10-03" }), "diffusa il 3 ott");
  assert.equal(summary({ variant: "non_disponibile", realization: null, dossier: null, realizedOn: null }), "non disponibile ora");
  assert.equal(summary({ variant: "dossier", realization: null, dossier: { status: "in_sviluppo", readiness: { ok: 1, required: 4 } }, realizedOn: null }), "dossier in sviluppo · 1 di 4 a posto");
  assert.equal(summary({ variant: "dossier", realization: null, dossier: { status: "in_sviluppo", readiness: null }, realizedOn: null }), "dossier in sviluppo");
});

test("detailTargetIds e arrivalTarget: le ancore che ci sono; «Realizzazione» senza piega va al riquadro", () => {
  const all = detailTargetIds({ phase: "approvato", needs: true, requests: true, realization: true, history: true });
  assert.deepEqual(all, ["decisione", "impatto", "cosa-e", "cosa-serve", "richieste", "quando", "nota-pubblica", "valutazione", "dettagli", "realizzazione", "storia"]);
  const few = detailTargetIds({ phase: "da_valutare", needs: true, requests: false, realization: false, history: true });
  assert.deepEqual(few, ["decisione", "impatto", "cosa-e", "cosa-serve", "nota-pubblica", "valutazione", "dettagli", "storia"]);
  assert.deepEqual(detailTargetIds({ phase: "da_valutare", needs: false, requests: true, realization: false, history: false }), ["decisione", "impatto", "cosa-e", "nota-pubblica", "valutazione", "dettagli"]);
  assert.equal(arrivalTarget("storia", few), "storia");
  assert.equal(arrivalTarget("realizzazione", few), "decisione");
  assert.equal(arrivalTarget("realizzazione", all), "realizzazione");
  assert.equal(arrivalTarget("quando", few), null);
  assert.equal(arrivalTarget(null, few), null);
});

test("arrivalTarget: «Realizzazione» va al riquadro quando l'avvio è lì (G9), anche dai link già mandati", () => {
  const all = detailTargetIds({ phase: "approvato", needs: true, requests: true, realization: true, history: true });
  const avvia = { key: "G9", action: { type: "avvia", href: `/dashboard/${WS}/casi-duso/nuovo?useCaseId=${UC}`, label: "Avvia la realizzazione" } } as const;
  const segna = { key: "G9", action: { type: "segna_in_realizzazione" } } as const;
  // «Pronto da avviare» (campanella, email) porta a `?capitolo=realizzazione`: con l'avvio nel riquadro la piega non ha niente da fare.
  assert.equal(arrivalTarget("realizzazione", all, avvia), "decisione");
  assert.equal(arrivalTarget("realizzazione", all, segna), "decisione");
  // Il revisore del cliente («Tocca a Lateral Space.») e chi non può avviare restano sulla piega, che dice chi avvia.
  assert.equal(arrivalTarget("realizzazione", all, { key: "G9", action: { type: "none" } }), "realizzazione");
  // Non più pronto (trimestre finito, informazioni da chiedere, già partito): la piega, con «Avvia» outline o il dossier.
  assert.equal(arrivalTarget("realizzazione", all, { key: "G3", action: { type: "none" } }), "realizzazione");
  assert.equal(arrivalTarget("realizzazione", all, { key: "G5", action: { type: "chiedi", label: "Chiedi al referente" } }), "realizzazione");
  assert.equal(arrivalTarget("realizzazione", all, { key: "E5", action: { type: "dossier", href: "/x", label: "Apri il dossier", variant: "outline" } }), "realizzazione");
  assert.equal(arrivalTarget("realizzazione", all, null), "realizzazione");
  // Gli altri capitoli non cambiano.
  assert.equal(arrivalTarget("storia", all, avvia), "storia");
  assert.equal(arrivalTarget("cosa-serve", all, avvia), "cosa-serve");
});

test("arrivalTargetIn: la regola di arrivalTarget con `startsInBox` già detto, per `?capitolo=` e per un `#ancora`", () => {
  const all = detailTargetIds({ phase: "approvato", needs: true, requests: true, realization: true, history: true });
  const avvia = { key: "G9", action: { type: "avvia", href: `/dashboard/${WS}/casi-duso/nuovo?useCaseId=${UC}`, label: "Avvia la realizzazione" } } as const;
  const steps = [avvia, { key: "G9", action: { type: "segna_in_realizzazione" } }, { key: "G9", action: { type: "none" } }, { key: "G3", action: { type: "none" } }, null] as const;
  for (const chapter of [null, "realizzazione", "richieste", "storia", "quando", "decisione", "nessuna"]) {
    for (const step of steps) {
      assert.equal(arrivalTargetIn(chapter, all, step !== null && startsInBox(step)), arrivalTarget(chapter, all, step), `${chapter} ${step?.key ?? "-"}`);
    }
  }
  // Un vecchio link «…#realizzazione» su una scheda pronta: il riquadro, come `?capitolo=realizzazione`.
  assert.equal(arrivalTargetIn("realizzazione", all, true), "decisione");
  assert.equal(arrivalTargetIn("realizzazione", all, false), "realizzazione");
});

test("arrivalTarget: «Richieste inviate» («Nessuna risposta») si apre se c'è, altrimenti «Cosa serve»", () => {
  const all = detailTargetIds({ phase: "approvato", needs: true, requests: true, realization: true, history: true });
  const noRequests = detailTargetIds({ phase: "approvato", needs: true, requests: false, realization: true, history: true });
  const noNeeds = detailTargetIds({ phase: "approvato", needs: false, requests: true, realization: true, history: true });
  assert.equal(arrivalTarget("richieste", all), "richieste");
  assert.equal(arrivalTarget("richieste", noRequests), "cosa-serve", "senza richieste a vista, il capitolo che le conterrebbe");
  assert.equal(arrivalTarget("richieste", noNeeds), null, "senza «Cosa serve», la cima della pagina");
});

test("Come cambia il lavoro: etichette per tipo e agente, limiti, testi lunghi corti", () => {
  assert.deepEqual(workFlowLabels("da_costruire", "LIBRA L1 · Smistamento delle pratiche"), { today: "Oggi", agent: "Con LIBRA", human: "Decide una persona", limits: "Cosa LIBRA non fa mai" });
  assert.deepEqual(workFlowLabels("da_costruire", "Smistamento delle pratiche"), { today: "Oggi", agent: "Con l'agente", human: "Decide una persona", limits: "Cosa l'agente non fa mai" });
  assert.deepEqual(workFlowLabels("da_diffondere", "LIBRA L1 · Prompt condiviso"), { today: "Prima", agent: "Adesso", human: "Chi la usa", limits: null });
  assert.equal(limitsSummary("Non paga\n\n- Non firma\n• Non archivia\n  \nNon cancella\nNon scrive al fornitore"), "5 limiti");
  assert.equal(limitsSummary("Non paga"), "1 limite");
  assert.equal(limitsSummary(" \n "), "da completare");
  assert.equal(limitsSummary(null), "da completare");
  assert.equal(workClamps("x".repeat(280)), false);
  assert.equal(workClamps("x".repeat(281)), true);
  assert.equal(workClamps(null), false);
});

test("i testi della scheda guidata passano copy-guard: «use case», mai «caso d'uso» né «wave»", () => {
  const strings: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === "string") strings.push(value);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(GUIDED_TEXT);
  assert.ok(strings.length > 100, `${strings.length} testi`);
  assert.deepEqual(findHubForbiddenIn(strings, "area"), []);
});

// ─── Rilascio 5: il referente nel riquadro (§9.6) ────────────────────

type RefInput = NonNullable<NextStepInput["referent"]>;
const referent = (over: Partial<RefInput> = {}): RefInput => ({ state: "manca", review: null, canChoose: true, askableForReferent: null, ...over });

test("rilascio 5: senza referente, «Scegliere il referente» prima di «Quando» e dopo G1, G2; uno use case pronto resta G9", () => {
  const info = progress({ received: 0, total: 10, toAsk: 7 });
  const g5 = nextStepOf(input({ item: approved(), info, referents: panel([]), askEntry: entry([]), referent: referent() }));
  assert.deepEqual(brief(g5), { key: "G5", title: "Scegliere il referente", line: `${T} Il referente conferma lo use case e l'impatto, poi risponde alle domande.`, action: "referente", mine: true, decisions: "compact" });
  assert.deepEqual(g5.action, { type: "referente", mode: "scegli", label: "Scegli il referente" });
  // Senza un trimestre (il G3 di oggi su 15 card di TopJet): prima il referente.
  const later = nextStepOf(input({ item: approved({ subState: "piu_avanti", targetQuarter: null }), info, referents: panel([]), askEntry: entry([]), referent: referent() }));
  assert.equal(later.key, "G5");
  assert.equal(later.title, "Scegliere il referente");
  // Nessuna domanda da chiedere: solo la conferma e la stima.
  const none = nextStepOf(input({ item: approved({ subState: "piu_avanti", targetQuarter: null }), info: null, referents: panel([]), askEntry: entry([]), referent: referent() }));
  assert.equal(none.line, `${T} Il referente conferma lo use case e l'impatto.`);
  // L'email non attiva (il harness): G6 con il motivo, nessun pulsante.
  const g6 = nextStepOf(input({ item: approved(), info, referents: panel([gate.email]), askEntry: entry([gate.email]), referent: referent({ canChoose: false }) }));
  assert.deepEqual(brief(g6), { key: "G6", title: "Scegliere il referente", line: gate.email.message, action: "none", mine: false, decisions: "compact" });
  // L'ok sui fornitori: G4 come oggi.
  const g4 = nextStepOf(input({ item: approved(), info, referents: panel([gate.subprocessors(true)]), askEntry: entry([gate.subprocessors(true)]), referent: referent({ canChoose: false }) }));
  assert.deepEqual([g4.key, g4.action.type, g4.mine], ["G4", "impostazioni", true]);
  // Pronto da avviare (informazioni complete): G9, il referente non blocca (D36).
  assert.equal(nextStepOf(input({ item: approved(), info: COMPLETE, referents: panel([]), askEntry: entry([]), referent: referent() })).key, "G9");
  // Le risposte da verificare vengono prima.
  assert.equal(nextStepOf(input({ item: approved(), info: progress({ toVerify: 2, received: 2 }), referents: panel([]), askEntry: entry([]), referent: referent() })).key, "G1");
});

test("rilascio 5: con il referente, G1 per la sua risposta, G2 senza risposta, G7 «Tocca al referente.», poi le domande", () => {
  const info = progress({ received: 0, total: 10, toAsk: 7 });
  const correction = nextStepOf(input({ item: approved(), info, referents: panel([]), askEntry: entry([]), referent: referent({ state: "da_verificare", review: "correzione" }) }));
  assert.deepEqual(brief(correction), { key: "G1", title: "Verificare le risposte arrivate", line: `${T} Il referente chiede di correggere lo use case.`, action: "vai", mine: true, decisions: "compact" });
  assert.deepEqual(correction.action, { type: "vai", id: "referente", label: "Vedi le risposte" });
  assert.equal(nextStepOf(input({ item: approved(), info, referents: panel([]), askEntry: entry([]), referent: referent({ state: "da_verificare", review: "stima" }) })).line, `${T} Il referente ha una stima diversa da quella del team.`);
  assert.equal(nextStepOf(input({ item: approved(), info, referents: panel([]), askEntry: entry([]), referent: referent({ state: "da_verificare", review: "stima", noTeamEstimate: true }) })).line, `${T} Il referente ha dato una stima del tempo.`);
  // (Rilascio 5.1) «Non so» su una cifra del team: la stima resta da guardare, senza dire «diversa».
  const unknown = nextStepOf(input({ item: approved(), info, referents: panel([]), askEntry: entry([]), referent: referent({ state: "da_verificare", review: "non_sa" }) }));
  assert.deepEqual([unknown.key, unknown.line], ["G1", `${T} Il referente non sa rispondere su una stima.`]);
  assert.deepEqual(unknown.action, { type: "vai", id: "referente", label: "Vedi le risposte" });
  const silent = nextStepOf(input({ item: approved(), info, referents: panel([]), askEntry: entry([]), referent: referent({ state: "nessuna_risposta" }) }));
  assert.deepEqual([silent.key, silent.line], ["G2", `${T} Il referente non ha risposto.`]);
  assert.deepEqual(silent.action, { type: "vai", id: "referente", label: "Vedi le richieste" });
  const waiting = nextStepOf(input({ item: approved(), info, referents: panel([]), askEntry: entry([]), referent: referent({ state: "in_attesa" }) }));
  assert.deepEqual(brief(waiting), { key: "G7", title: "Aspettare le risposte", line: "Tocca al referente.", action: "none", mine: false, decisions: "compact" });
  const more = nextStepOf(input({ item: approved(), info, referents: panel([]), askEntry: entry([]), referent: referent({ state: "fatto", askableForReferent: 3 }) }));
  assert.deepEqual(more.action, { type: "referente", mode: "chiedi", label: "Chiedi al referente" });
  assert.equal(more.title, "Chiedere le informazioni a TopJet");
  const other = nextStepOf(input({ item: approved(), info, referents: panel([]), askEntry: entry([]), referent: referent({ state: "fatto", askableForReferent: 0 }) }));
  assert.deepEqual(brief(other), { key: "G5", title: "Chiedere a un'altra persona", line: `${T} Il referente non ha queste informazioni: chiedi a un'altra persona.`, action: "referente", mine: true, decisions: "compact" });
  assert.deepEqual(other.action, { type: "referente", mode: "altra", label: "Chiedi a un'altra persona" });
  // Con un motivo che blocca (l'email non attiva): G6 con il titolo «Chiedere a un'altra persona» e il motivo.
  const blocked = nextStepOf(input({ item: approved(), info, referents: panel([gate.email]), askEntry: entry([gate.email]), referent: referent({ state: "fatto", askableForReferent: 0 }) }));
  assert.deepEqual([blocked.key, blocked.title, blocked.line, blocked.action.type], ["G6", "Chiedere a un'altra persona", gate.email.message, "none"]);
  // Il pannello laterale (askableForReferent null): il G5 di oggi, senza nomi.
  assert.equal(nextStepOf(input({ item: approved(), info, referents: panel([]), askEntry: entry([]), referent: referent({ state: "fatto", askableForReferent: null }) })).action.type, "chiedi");
});

test("rilascio 5: con referent null ogni passo resta quello del rilascio 4", () => {
  const info = progress({ received: 0, total: 10, toAsk: 7, waiting: 1 });
  for (const over of [{}, { subState: "piu_avanti" as const, targetQuarter: null }, { targetQuarter: "2026-Q2" }]) {
    const a = nextStepOf(input({ item: approved(over), info, referents: panel([]), askEntry: entry([]) }));
    const b = nextStepOf(input({ item: approved(over), info, referents: panel([]), askEntry: entry([]), referent: null }));
    assert.deepEqual(a, b);
  }
});
