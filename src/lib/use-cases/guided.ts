/**
 * La scheda guidata (rilascio 3 «Scheda guidata»): le regole della pagina di uno use case per i
 * revisori, fuori dai componenti perché le provi `node --test`.
 *
 * - **Percorso** (`pathOfUseCase`): i passi da Proposto a In uso (o a Diffusa per una best
 *   practice), ognuno fatto, adesso o dopo, con le sole sotto-etichette che la pagina mostra. Un
 *   use case chiuso non ha percorso.
 * - **Prossimo passo** (`nextStepOf`): il riquadro sotto il percorso, con il passo da fare, chi lo
 *   fa («Tocca a …», un team o un ruolo, mai una persona; l'eccezione è «Tocca a te, nel
 *   dossier.» del dossier) e l'azione. Vince la prima regola che vale: C (chiuso), D (realizzato),
 *   E1-E7 (in realizzazione), F1 (best practice approvata), G1-G9 (approvato), H1-H7 (da valutare).
 * - **Impatto** (`impactView`, `paybackText`): la cifra grande in testa alla pagina, con il
 *   costo, le voci di «Benefici e costi» e la frase su quando rientra l'avvio.
 * - **Come cambia il lavoro** (`workFlowLabels`, `limitsSummary`), **pieghe** (`foldSummaries`),
 *   **ancore** (`detailTargetIds`, `arrivalTarget`) e i **cinque gruppi** delle richieste
 *   (`requestGroupView`).
 * - **Pronto da avviare** (`isReadyToStart`): la regola di G9, una sola per la pagina e per chi
 *   la userà altrove.
 *
 * I contributori non passano mai da qui: la loro scheda resta quella di prima, senza cifre, senza
 * esigenze e senza conteggi. I conteggi sono di esigenze di una scheda, mai di persone. Il nome
 * del team arriva sempre da fuori (`reviewTeamName`): qui nessun nome scritto a mano.
 *
 * Modulo puro: solo import relativi `.ts`, nessun `@/`, nessun componente. Quello che sta nei
 * componenti (la variante di «Realizzazione», `askEntry` della finestra «Chiedi al referente»)
 * arriva già calcolato.
 */
import { CASE_STATUS_LABEL } from "../uc/case-state.ts";
import type { CaseStatus } from "../uc/vocab.ts";
import type { UseCaseRealization } from "../uc/views/realization.ts";
import { REALIZATION_TEXT } from "../uc/views/realization.ts";
import { titleAgent } from "./agents.ts";
import { decisionLayout, decisionNote, dossierSituation, instantOfDay, reopenDestination, type DecisionItem } from "./decision-ui.ts";
import { FIGURE_SEPARATOR, formatDayInYear, formatEuro, formatInteger, lowerFirst, shownPerYear, showsZone, zoneText } from "./format.ts";
import type { InfoProgressView } from "./info-progress.ts";
import { askGroupOf, componentFormulaText, returnsToConfirm, type NeedStatus } from "./needs.ts";
import { isPastQuarter, parseQuarter, quarterLabel } from "./quarter.ts";
import type { ReferentGate } from "./referent/contract.ts";
import { companyLabel } from "./referent/labels.ts";
import type { Phase, SubState, UseCaseKind } from "./types.ts";
import type { CostFigure, ValueFigure } from "./valuation.ts";
import { VALUE_CONFIDENCE_LABELS, type ValueModel, type ValueParams } from "./value-model.ts";
import type { SemaforoColor } from "../uc/vocab.ts";
import type { Zone } from "./labels.ts";

// ═══ Testi ═══════════════════════════════════════════════════════════

/** Tutti i testi della scheda guidata. I segnaposto `{x}` li riempie `fill`. */
export const GUIDED_TEXT = Object.freeze({
  toTeam: "Tocca a {nome}.",
  toTeamVowel: "Tocca ad {nome}.",
  lateralSpace: "Lateral Space",
  path: Object.freeze({
    ariaLabel: "Percorso dello use case",
    srDone: " (fatto)",
    srNow: " (adesso)",
    steps: Object.freeze({
      proposto: "Proposto",
      valutato: "Valutato",
      approvato: "Approvato",
      informazioni: "Informazioni",
      realizzazione: "Realizzazione",
      in_uso: "In uso",
      diffusa: "Diffusa",
    }),
    byTeam: "dal team",
    later: "più avanti",
    expired: "{trimestre} passato",
    infoDone: "a posto",
    infoCount: "{ricevute} di {totale}",
    infoNone: "nessuna da chiedere",
    toStart: "da avviare",
    unavailable: "non disponibile ora",
    noDossier: "senza dossier",
    toMark: "da segnare",
    inUseSince: "dal {giorno}",
    diffusedOn: "il {giorno}",
  }),
  box: Object.freeze({
    heading: "Prossimo passo",
    closedHeading: "Fuori dal percorso",
    // C
    closedDecidedOn: "Deciso il {giorno}.",
    reopenToDecide: "Si può riaprire: torna in «Da decidere».",
    reopenBefore: "Si può riaprire: torna alla fase di prima.",
    reopen: "Si può riaprire.",
    staysClosed: "Resta chiuso: ha un dossier collegato.",
    // D
    nothingToDo: "Nessun passo da fare",
    inUseSince: "In uso dal {giorno}.",
    diffusedOn: "Diffusa il {giorno}.",
    // E
    carryOn: "Portare avanti la realizzazione",
    unavailable: "Il riepilogo del dossier non è disponibile ora.",
    markRealized: "Segnare come realizzato",
    dossierInUse: "Il dossier dice che l'agente è in uso.",
    markWhenInUse: "Segnare come realizzato quando è in uso",
    decideWhat: "Decidere cosa farne",
    dossierClosed: "Il dossier è chiuso.",
    yourTurn: "Tocca a te, nel dossier.",
    members: "La seguono i membri del dossier.",
    dossierStatus: "Dossier {stato}",
    readiness: "{ok} di {richiesti} indispensabili a posto",
    milestone: "prossima tappa {tappa}",
    openDossier: "Apri il dossier",
    // F
    spread: "Diffondere la best practice",
    spreadLine: "Quando i colleghi la usano, segnala come diffusa.",
    // G
    verify: "Verificare le risposte arrivate",
    seeAnswers: "Vedi le risposte",
    chase: "Sollecitare chi non ha risposto",
    unansweredOne: "1 informazione senza risposta.",
    unansweredMany: "{n} informazioni senza risposta.",
    seeRequests: "Vedi le richieste",
    laterTitle: "Approvato per più avanti",
    laterLine: "Le informazioni si chiedono quando si sceglie il trimestre.",
    expiredTitle: "Scegliere un nuovo trimestre",
    expiredLine: "Il {trimestre} è finito: il trimestre si sceglie in «Quando».",
    goToWhen: "Vai a «Quando»",
    authorize: "Autorizzare i fornitori",
    askTitle: "Chiedere le informazioni a {azienda}",
    toAskOne: "1 delle {totale} informazioni è ancora da chiedere.",
    toAskMany: "{n} delle {totale} informazioni sono ancora da chiedere.",
    toAskOnly: "L'informazione è ancora da chiedere.",
    ask: "Chiedi al referente",
    wait: "Aspettare le risposte",
    referents: "Tocca ai referenti.",
    waitingSince: "In attesa dal {giorno}",
    reminded: "promemoria inviato",
    remindedAlone: "Promemoria inviato.",
    unblock: "Sbloccare le informazioni ferme",
    blockedOne: "1 ferma: si chiede quando si sblocca.",
    blockedMany: "{n} ferme: si chiedono quando si sbloccano.",
    start: "Avviare la realizzazione",
    allIn: "Le informazioni ci sono tutte.",
    noneNeeded: "Da {azienda} non serve nessuna informazione.",
    startButton: "Avvia la realizzazione",
    // H
    readAnswer: "Leggere la risposta e decidere",
    answered: "Chi ha proposto ha risposto.",
    readAnswerLink: "Leggi la risposta",
    waitProposer: "Aspettare la risposta di chi ha proposto",
    proposerTurn: "Tocca a chi ha proposto. La domanda è nella nota pubblica.",
    seePublicNote: "Vedi la nota pubblica",
    resumeOn: "Riprendere la decisione il {giorno}",
    resume: "Riprendere la decisione",
    postponed: "La decisione è rimandata.",
    resumeDue: "La data per riprenderla è passata.",
    decideApprove: "Decidere se approvarlo",
    checkDuplicate: "Controllare se è un doppione e decidere",
    maybeDuplicate: "Potrebbe essere un doppione di {codice}.",
    evaluate: "Valutare e decidere",
  }),
  impact: Object.freeze({
    title: "Impatto",
    hoursOne: "ora all'anno",
    hoursMany: "ore all'anno",
    perYear: "all'anno",
    hourly: "a {euro} l'ora",
    upTo: "fino a {euro}",
    pending: "e fino a {euro} da misurare",
    toMeasure: "all'anno, da misurare",
    measureNote: "Entra nel conto quando c'è la misura di oggi.",
    qualitative: "Qualitativo",
    qualitativeNote: "Nessuna cifra: il ritorno è qualitativo.",
    toEstimate: "Da stimare",
    toEstimateNote: "Il valore si stima in «Valutazione del team».",
    estimateLink: "Stima benefici e costi",
    unofficial: "C'è una stima non ufficiale in «Valutazione del team».",
    toConfirm: "Ipotesi da confermare",
    measuredBy: "Si misura con: {indicatore}",
    origin: "Da dove vengono i numeri",
    originBasis: "{voce} · Da dove viene la stima",
    easeValue: "{facilita} su 5",
    params: "Ipotesi di calcolo",
    paramsValue: "{ora} l'ora · {giornata} a giornata",
  }),
  payback: Object.freeze({
    notCovered: "Il beneficio contato non copre i costi ricorrenti.",
    underMonth: "L'avvio rientra in meno di un mese a regime",
    aboutMonth: "L'avvio rientra in circa un mese a regime",
    aboutMonths: "L'avvio rientra in circa {n} mesi a regime",
    overTwoYears: "L'avvio rientra in più di due anni a regime",
    devDayOne: ", senza contare il giorno di sviluppo",
    devDaysMany: ", senza contare i {n} giorni di sviluppo",
  }),
  work: Object.freeze({
    title: "Come cambia il lavoro",
    today: "Oggi",
    before: "Prima",
    withAgent: "Con {agente}",
    withAnyAgent: "Con l'agente",
    now: "Adesso",
    human: "Decide una persona",
    whoUses: "Chi la usa",
    limits: "Cosa {agente} non fa mai",
    limitsAnyAgent: "Cosa l'agente non fa mai",
    limitOne: "1 limite",
    limitsMany: "{n} limiti",
    toComplete: "da completare",
    readMore: "Leggi tutto",
    readLess: "Mostra meno",
  }),
  folds: Object.freeze({
    valutazione: "Valutazione del team",
    dettagli: "Dettagli",
    realizzazione: "Realizzazione",
    storia: "Storia",
    estimates: "stime non ufficiali",
    aiSuggestion: "suggerimento AI",
    zone: "zona: {zona}",
    editValuation: "modifica benefici e costi",
    moreFields: " e altri {n}",
    toComplete: "da completare",
    notStarted: "non ancora partita",
    dossier: "dossier {stato}",
    dossierReady: "{ok} di {richiesti} a posto",
    startedByLs: "la avvia Lateral Space",
    diffused: "diffusa",
    diffusedOn: "diffusa il {giorno}",
    unavailable: "non disponibile ora",
    lastChange: "ultimo cambiamento il {giorno}",
    noChange: "nessun cambiamento",
  }),
  requestGroups: Object.freeze({
    toAsk: "Da chiedere",
    waiting: "In attesa",
    toVerify: "Da verificare",
    blocked: "Ferma",
    done: "A posto",
  }),
  requestNotes: Object.freeze({
    mancante: "manca il dato",
    parziale: "risposta parziale",
    non_applicabile: "non si applica",
  }),
});

const fill = (template: string, values: Readonly<Record<string, string | number>>): string =>
  template.replace(/\{([A-Za-zÀ-ÿ]+)\}/g, (whole, key: string) => (Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : whole));

const DECIMAL = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 });

/**
 * «Tocca ad AI Transformation.», «Tocca a Digital Factory.»: chi fa il prossimo passo, dal nome
 * scelto dal workspace (`reviewTeamName`). «ad» davanti a una a.
 */
export function toTeam(name: string): string {
  const clean = name.replace(/\s+/g, " ").trim();
  return fill(/^[aA]/.test(clean) ? GUIDED_TEXT.toTeamVowel : GUIDED_TEXT.toTeam, { nome: clean });
}

/** Due pezzi di frase uniti da uno spazio, senza pezzi vuoti. */
function sentence(...parts: Array<string | null | undefined | false>): string {
  return parts.filter((part): part is string => typeof part === "string" && part.trim() !== "").join(" ");
}

// ═══ Lo use case come lo leggono le regole ═══════════════════════════

/** Come è andata la lettura del dossier (`UseCaseDetailResult.dossierRead`). */
export type GuidedDossierRead = "ok" | "spenta" | "errore";

/** La variante del pannello «Realizzazione» (`realizationVariant` di section-realization.tsx), già calcolata. */
export type GuidedRealizationVariant = "avvia" | "segna" | "lo_avvia_ls" | "riepilogo" | "dossier" | "non_disponibile" | "diffusa" | "fase";

/** Le parti di uno use case che le regole leggono: `UseCaseDetail` e `HubItem` le hanno tutte. */
export interface GuidedItem {
  id: string;
  phase: Phase;
  subState: SubState;
  kind: UseCaseKind;
  phaseLabel: string;
  targetQuarter: string | null;
  reviewBy: string | null;
  waitingSince: string;
  realizedOn: string | null;
  answered?: boolean;
  /** «Possibile doppione di» della scheda; il pannello non lo porta. */
  possibleDuplicateOf?: string | null;
  value: Pick<ValueFigure, "source"> | null;
  dossier: { status: CaseStatus; caseId?: string } | null;
  status?: DecisionItem["status"];
}

/** «Raccolta informazioni» della scheda: la vista con i conteggi (`infoProgressView`). */
export type GuidedInfo = Pick<InfoProgressView, "state" | "received" | "total" | "count" | "receivedNote" | "counts">;

/** Il trimestre approvato vale ancora: c'è, e non è finito (uno che non si legge non è finito). */
function quarterHolds(targetQuarter: string | null, today: string): boolean {
  if (!targetQuarter) return false;
  if (!parseQuarter(targetQuarter)) return true;
  return !isPastQuarter(targetQuarter, instantOfDay(today));
}

/** Il trimestre approvato è finito. */
function quarterExpired(targetQuarter: string | null, today: string): boolean {
  return Boolean(targetQuarter && parseQuarter(targetQuarter) && isPastQuarter(targetQuarter, instantOfDay(today)));
}

/** Il passo «Approvato» è fatto. */
function approvedDone(item: Pick<GuidedItem, "phase" | "subState" | "kind" | "targetQuarter">, today: string): boolean {
  if (item.phase === "in_realizzazione" || item.phase === "realizzato") return true;
  if (item.phase !== "approvato") return false;
  if (item.kind === "da_diffondere") return true;
  return item.subState === "trimestre" && quarterHolds(item.targetQuarter, today);
}

/**
 * «Pronto da avviare» (G9): uno use case «Da costruire» approvato per un trimestre che non è
 * finito (uno che non si legge vale come non finito), con le informazioni del cliente tutte a
 * posto oppure senza informazioni da chiedere. È la regola del riquadro «Prossimo passo» («Avviare
 * la realizzazione») e del passo «Realizzazione» («da avviare»); chi avvisa Lateral Space che una
 * scheda è pronta deve usare questa, così pagina e avviso dicono la stessa cosa.
 *
 * `info` è lo stato di «Raccolta informazioni» (`deriveInfoProgress` o la sua vista): null senza
 * esigenze del cliente. `today` è il giorno a Roma (`AAAA-MM-GG`).
 */
export function isReadyToStart(
  item: Pick<GuidedItem, "phase" | "subState" | "kind" | "targetQuarter">,
  info: { state: InfoProgressView["state"] } | null,
  today: string,
): boolean {
  if (item.phase !== "approvato" || item.kind !== "da_costruire") return false;
  if (!approvedDone(item, today)) return false;
  return info === null || info.state === "complete";
}

// ═══ Il percorso ═════════════════════════════════════════════════════

export type PathStepKey = keyof typeof GUIDED_TEXT.path.steps;
export type PathStepState = "fatto" | "adesso" | "dopo";

export interface PathStep {
  key: PathStepKey;
  /** Da 1. */
  number: number;
  label: string;
  state: PathStepState;
  /** La riga piccola sotto l'etichetta; null senza. */
  sub: string | null;
  /** `aria-current="step"`: il passo adesso, oppure l'ultimo quando sono tutti fatti. */
  current: boolean;
}

export interface UseCasePathView {
  kind: UseCaseKind;
  steps: PathStep[];
}

export interface PathInput {
  item: Pick<GuidedItem, "phase" | "subState" | "kind" | "targetQuarter" | "realizedOn" | "value" | "dossier">;
  today: string;
  info: Pick<InfoProgressView, "state" | "received" | "total"> | null;
  dossierRead: GuidedDossierRead;
}

const BUILD_STEPS: readonly PathStepKey[] = ["proposto", "valutato", "approvato", "informazioni", "realizzazione", "in_uso"];
const SPREAD_STEPS: readonly PathStepKey[] = ["proposto", "valutato", "approvato", "diffusa"];
const VALUED_SUB_STATES: readonly SubState[] = ["valutata", "rimandata", "da_rivedere"];

function day(value: string | null, today: string): string | null {
  return value ? formatDayInYear(value, instantOfDay(today)) : null;
}

/**
 * Il percorso dello use case: sei passi per «Da costruire» (Proposto, Valutato, Approvato,
 * Informazioni, Realizzazione, In uso), quattro per una best practice (fino a Diffusa); null per
 * uno use case chiuso. Il passo «adesso» è il primo non fatto; quelli prima sono fatti, quelli
 * dopo vengono dopo. Con tutti fatti, l'ultimo è il passo corrente. Un punteggio dell'AI da solo
 * non fa «Valutato».
 */
export function pathOfUseCase({ item, today, info, dossierRead }: PathInput): UseCasePathView | null {
  if (item.phase === "chiuso") return null;
  const t = GUIDED_TEXT.path;
  const approved = approvedDone(item, today);
  const done: Record<PathStepKey, boolean> = {
    proposto: true,
    valutato: item.phase !== "da_valutare" || VALUED_SUB_STATES.includes(item.subState),
    approvato: approved,
    informazioni: item.phase === "in_realizzazione" || item.phase === "realizzato" || (approved && (info === null || info.state === "complete")),
    realizzazione: item.phase === "realizzato" || (item.phase === "in_realizzazione" && dossierSituation(item.dossier) === "in_uso"),
    in_uso: item.phase === "realizzato",
    diffusa: item.phase === "realizzato",
  };
  const keys = item.kind === "da_diffondere" ? SPREAD_STEPS : BUILD_STEPS;
  const firstOpen = keys.findIndex((key) => !done[key]);
  const steps = keys.map((key, index): PathStep => {
    const state: PathStepState = firstOpen === -1 || index < firstOpen ? "fatto" : index === firstOpen ? "adesso" : "dopo";
    return {
      key,
      number: index + 1,
      label: t.steps[key],
      state,
      sub: subLabel(key, state, { item, today, info, dossierRead }),
      current: firstOpen === -1 ? index === keys.length - 1 : index === firstOpen,
    };
  });
  return { kind: item.kind, steps };
}

function subLabel(key: PathStepKey, state: PathStepState, { item, today, info, dossierRead }: PathInput): string | null {
  const t = GUIDED_TEXT.path;
  switch (key) {
    case "proposto":
      return null;
    case "valutato":
      return state === "fatto" && item.value?.source === "team" ? t.byTeam : null;
    case "approvato":
      if (state === "fatto") return item.targetQuarter ? quarterLabel(item.targetQuarter) : null;
      if (state !== "adesso" || item.phase !== "approvato") return null;
      if (item.subState === "piu_avanti") return t.later;
      return quarterExpired(item.targetQuarter, today) ? fill(t.expired, { trimestre: quarterLabel(item.targetQuarter!) }) : null;
    case "informazioni":
      if (item.phase !== "approvato") return null;
      if (info?.state === "complete") return t.infoDone;
      if (info && info.total > 0) return fill(t.infoCount, { ricevute: formatInteger(info.received), totale: formatInteger(info.total) });
      return info === null ? t.infoNone : null;
    case "realizzazione":
      if (state !== "adesso") return null;
      if (item.phase === "approvato") return t.toStart;
      if (item.phase === "in_realizzazione" && dossierRead === "errore") return t.unavailable;
      return item.dossier ? CASE_STATUS_LABEL[item.dossier.status] : t.noDossier;
    case "in_uso":
      if (state === "adesso") return t.toMark;
      if (state === "fatto") {
        const since = day(item.realizedOn, today);
        return since ? fill(t.inUseSince, { giorno: since }) : null;
      }
      return null;
    case "diffusa":
      if (state === "adesso") return t.toMark;
      if (state === "fatto") {
        const on = day(item.realizedOn, today);
        return on ? fill(t.diffusedOn, { giorno: on }) : null;
      }
      return null;
  }
}

// ═══ «Prossimo passo» ════════════════════════════════════════════════

export type NextStepKey =
  | "C"
  | "D1"
  | "D2"
  | "E1"
  | "E2"
  | "E3"
  | "E4"
  | "E5"
  | "E6"
  | "E7"
  | "F1"
  | "G1"
  | "G2"
  | "G3"
  | "G4"
  | "G5"
  | "G6"
  | "G7"
  | "G8"
  | "G9"
  | "H1"
  | "H2"
  | "H3"
  | "H4"
  | "H5"
  | "H6"
  | "H7";

/** L'azione principale del riquadro, oltre ai pulsanti delle decisioni. */
export type NextStepAction =
  /** Il pulsante principale delle decisioni (`decisionLayout`): Approva, Segna come…, Riapri. */
  | { type: "decisione" }
  /** «Chiedi al referente»: apre la finestra. */
  | { type: "chiedi"; label: string }
  /** «Apri Impostazioni» (autorizzazione dei fornitori). */
  | { type: "impostazioni"; href: string; label: string }
  /** Un'ancora della pagina («Vedi le risposte» → #cosa-serve). */
  | { type: "vai"; id: string; label: string }
  /** «Avvia la realizzazione». */
  | { type: "avvia"; href: string; label: string }
  /** «Segna come in realizzazione» (sezione Casi d'uso spenta). */
  | { type: "segna_in_realizzazione" }
  /** «Apri il dossier». */
  | { type: "dossier"; href: string; label: string; variant: "default" | "outline" }
  | { type: "none" };

export interface NextStep {
  key: NextStepKey;
  /** «Prossimo passo», oppure «Fuori dal percorso» per uno use case chiuso. */
  heading: string;
  title: string;
  /** La riga sotto il titolo, con «Tocca a …»; vuota quando non c'è niente da dire. */
  line: string;
  /** La riga è il motivo che blocca «Chiedi al referente» (`role="status"`, `data-gate`). */
  gate: ReferentGate["code"] | null;
  /** Un link tranquillo nel testo («Leggi la risposta» → #nota-pubblica). */
  link: { id: string; label: string } | null;
  action: NextStepAction;
  /** Il passo è di chi guarda adesso: solo allora il pulsante principale è pieno. */
  mine: boolean;
  /**
   * I pulsanti delle decisioni: `full` (da valutare: Approva, poi Rimanda, Serve info e Non avviare
   * visibili), `compact` (le decisioni secondarie nel menu «⋯ Altre decisioni»), `none`.
   */
  decisions: "full" | "compact" | "none";
  /** Il pulsante principale delle decisioni si mostra `outline` (il passo non è di chi guarda). */
  primaryOutline: boolean;
}

export interface NextStepInput {
  workspaceId: string;
  item: GuidedItem;
  /** Oggi a Roma, `AAAA-MM-GG`. */
  today: string;
  /** Il nome del team che valuta (`reviewTeamName`). */
  teamName: string;
  /** Il nome del workspace (`access.workspace.name`): «Chiedere le informazioni a TopJet». */
  companyName: string | null;
  canDecide: boolean;
  /** Chi gestisce il workspace apre ogni dossier. */
  canOpenAnyDossier: boolean;
  /** «Raccolta informazioni» con i conteggi; null senza esigenze del cliente. */
  info: GuidedInfo | null;
  /** «Chiedi al referente» (`loadUseCaseReferentPanel`); null nel pannello o senza. */
  referents: { available: boolean; canAsk: boolean; gates: readonly ReferentGate[]; requestCount: number } | null;
  /** `askEntry(referents)` della finestra; null senza «Chiedi al referente». */
  askEntry: { canOpen: boolean; gates: readonly ReferentGate[] } | null;
  /** `realizationVariant(...)`; null quando non si conosce (pannello). */
  realizationVariant: GuidedRealizationVariant | null;
  /** Il riepilogo del dossier (`realizationOfUseCase`); null se non letto. */
  realization: UseCaseRealization | null;
  dossierRead: GuidedDossierRead;
  /** Il giorno di «Non avviare», dalla Storia (`closedOnFrom`); null se non si sa. */
  closedOn: Date | string | null;
}

interface StepParts {
  title: string;
  line?: string;
  gate?: ReferentGate["code"] | null;
  link?: { id: string; label: string } | null;
  action?: NextStepAction;
  mine?: boolean;
  decisions?: NextStep["decisions"];
  heading?: string;
}

function step(key: NextStepKey, parts: StepParts): NextStep {
  const mine = parts.mine ?? false;
  return {
    key,
    heading: parts.heading ?? GUIDED_TEXT.box.heading,
    title: parts.title,
    line: parts.line ?? "",
    gate: parts.gate ?? null,
    link: parts.link ?? null,
    action: parts.action ?? { type: "none" },
    mine,
    decisions: parts.decisions ?? "compact",
    primaryOutline: !mine,
  };
}

const ANCHOR = Object.freeze({
  decisione: "decisione",
  impatto: "impatto",
  cosaE: "cosa-e",
  cosaServe: "cosa-serve",
  richieste: "richieste",
  quando: "quando",
  notaPubblica: "nota-pubblica",
  valutazione: "valutazione",
  dettagli: "dettagli",
  realizzazione: "realizzazione",
  storia: "storia",
});

/**
 * Il riquadro «Prossimo passo» (vince la prima regola che vale, vedi l'intestazione del modulo).
 * `mine` dice se il passo è di chi guarda: solo allora il pulsante principale è pieno, e nella
 * pagina ce n'è al massimo uno.
 */
export function nextStepOf(input: NextStepInput): NextStep {
  const { item } = input;
  switch (item.phase) {
    case "chiuso":
      return closedStep(input);
    case "realizzato":
      return realizedStep(input);
    case "in_realizzazione":
      return inRealizationStep(input);
    case "approvato":
      return item.kind === "da_diffondere"
        ? step("F1", {
            title: GUIDED_TEXT.box.spread,
            line: sentence(toTeam(input.teamName), GUIDED_TEXT.box.spreadLine),
            action: { type: "decisione" },
            mine: true,
          })
        : approvedStep(input);
    case "da_valutare":
      return toDecideStep(input);
  }
}

function closedStep({ item, canDecide, closedOn, today }: NextStepInput): NextStep {
  const t = GUIDED_TEXT.box;
  const title = item.phaseLabel.replace(/^Chiuso · /, "");
  const layout = decisionLayout({ ...item, dossier: item.dossier ? { status: item.dossier.status } : null }, { canDecide });
  const hasButtons = layout.primary !== null || layout.outline.length > 0 || layout.menu.length > 0;
  const decided = item.subState === "non_avviato" && closedOn ? formatDayInYear(closedOn, instantOfDay(today)) : null;
  const destination = reopenDestination({ subState: item.subState, status: item.status ?? null });
  const reopen = !canDecide ? null : !hasButtons ? t.staysClosed : destination === "da_decidere" ? t.reopenToDecide : destination === "fase_di_prima" ? t.reopenBefore : t.reopen;
  return step("C", {
    heading: t.closedHeading,
    title,
    line: sentence(decided ? fill(t.closedDecidedOn, { giorno: decided }) : null, reopen),
    action: hasButtons ? { type: "decisione" } : { type: "none" },
    decisions: "full",
  });
}

function realizedStep({ item, today }: NextStepInput): NextStep {
  const t = GUIDED_TEXT.box;
  const on = day(item.realizedOn, today);
  if (item.kind === "da_diffondere") return step("D2", { title: t.nothingToDo, line: on ? fill(t.diffusedOn, { giorno: on }) : "" });
  return step("D1", { title: t.nothingToDo, line: on ? fill(t.inUseSince, { giorno: on }) : "" });
}

/** «Dossier in preparazione · 3 di 10 indispensabili a posto»: lo stato e, se c'è, l'avanzamento. */
function dossierLine(statusLabel: string, progress: { ok: number; required: number } | null, milestone?: string | null): string {
  const t = GUIDED_TEXT.box;
  const pieces = [fill(t.dossierStatus, { stato: lowerFirst(statusLabel) })];
  if (progress && progress.required > 0) pieces.push(fill(t.readiness, { ok: formatInteger(progress.ok), richiesti: formatInteger(progress.required) }));
  if (milestone) pieces.push(fill(t.milestone, { tappa: milestone }));
  return `${pieces.join(FIGURE_SEPARATOR)}.`;
}

function inRealizationStep({ workspaceId, item, teamName, canOpenAnyDossier, realizationVariant: variant, realization, dossierRead }: NextStepInput): NextStep {
  const t = GUIDED_TEXT.box;
  const team = toTeam(teamName);
  if (dossierRead === "errore" || variant === "non_disponibile") return step("E7", { title: t.carryOn, line: t.unavailable, action: { type: "decisione" } });
  const situation = dossierSituation(item.dossier);
  if (situation === "in_uso") return step("E1", { title: t.markRealized, line: sentence(team, t.dossierInUse), action: { type: "decisione" }, mine: true });
  if (situation === "nessuno") return step("E2", { title: t.markWhenInUse, line: team, action: { type: "decisione" }, mine: true });
  if (situation === "chiuso") return step("E3", { title: t.decideWhat, line: sentence(team, t.dossierClosed), action: { type: "decisione" } });
  const dossier = realization?.state === "avviata" ? realization.dossier : null;
  if (variant === "riepilogo" && dossier?.myStep) {
    return step("E4", {
      title: dossier.myStep.label,
      line: sentence(t.yourTurn, dossierLine(dossier.statusLabel, dossier.progress)),
      action: { type: "dossier", href: dossier.myStep.href, label: t.openDossier, variant: "default" },
      mine: true,
      decisions: "none",
    });
  }
  if (variant === "riepilogo" && dossier?.href) {
    return step("E5", {
      title: t.carryOn,
      line: sentence(t.members, dossierLine(dossier.statusLabel, dossier.progress, dossier.nextMilestone)),
      action: { type: "dossier", href: dossier.href, label: t.openDossier, variant: "outline" },
      decisions: "none",
    });
  }
  const status = item.dossier!.status;
  const canOpen = variant === "dossier" && canOpenAnyDossier && Boolean(item.dossier?.caseId);
  return step("E6", {
    title: t.carryOn,
    line: sentence(t.members, dossierLine(CASE_STATUS_LABEL[status], null), canOpen ? null : REALIZATION_TEXT.membersOnly),
    action: canOpen
      ? { type: "dossier", href: `/dashboard/${workspaceId}/casi-duso/${item.dossier!.caseId}`, label: t.openDossier, variant: "outline" }
      : { type: "none" },
    decisions: "none",
  });
}

/** «3 delle 10 informazioni sono ancora da chiedere.» */
function toAskSentence(toAsk: number, total: number): string {
  const t = GUIDED_TEXT.box;
  if (total === 1) return t.toAskOnly;
  if (toAsk === 1) return fill(t.toAskOne, { totale: formatInteger(total) });
  return fill(t.toAskMany, { n: formatInteger(toAsk), totale: formatInteger(total) });
}

/** I motivi che nessuno nel workspace può togliere: la riga li dice da soli, senza «Tocca a». */
const SYSTEM_GATES: ReadonlyArray<ReferentGate["code"]> = ["email_non_configurata", "risposte_non_attive"];

function approvedStep(input: NextStepInput): NextStep {
  const { workspaceId, item, today, info, referents, askEntry, realizationVariant: variant, realization } = input;
  const t = GUIDED_TEXT.box;
  const team = toTeam(input.teamName);
  const company = companyLabel(input.companyName);
  const counts = info?.counts ?? null;

  if (info && counts && counts.toVerify > 0) {
    return step("G1", {
      title: t.verify,
      line: sentence(team, `${info.receivedNote ? `${info.count} (${info.receivedNote})` : info.count}.`),
      action: { type: "vai", id: ANCHOR.cosaServe, label: t.seeAnswers },
      mine: true,
    });
  }
  if (counts && counts.unanswered > 0) {
    const toRequests = Boolean(referents?.available && referents.requestCount > 0);
    return step("G2", {
      title: t.chase,
      line: sentence(team, counts.unanswered === 1 ? t.unansweredOne : fill(t.unansweredMany, { n: formatInteger(counts.unanswered) })),
      action: { type: "vai", id: toRequests ? ANCHOR.richieste : ANCHOR.cosaServe, label: t.seeRequests },
      mine: true,
    });
  }
  if (!approvedDone(item, today)) {
    const later = item.subState === "piu_avanti" || !item.targetQuarter;
    return step("G3", {
      title: later ? t.laterTitle : t.expiredTitle,
      line: sentence(team, later ? t.laterLine : fill(t.expiredLine, { trimestre: quarterLabel(item.targetQuarter!) })),
      link: { id: ANCHOR.quando, label: t.goToWhen },
    });
  }
  if (isReadyToStart(item, info, today)) {
    const why = info === null ? fill(t.noneNeeded, { azienda: company }) : t.allIn;
    const lsTurn = toTeam(GUIDED_TEXT.lateralSpace);
    if (variant === "non_disponibile") return step("G9", { title: t.start, line: t.unavailable });
    if (variant === "avvia") {
      const startHref = realization?.state === "da_avviare" ? realization.startHref : null;
      return step("G9", {
        title: t.start,
        line: sentence(lsTurn, why),
        action: { type: "avvia", href: startHref ?? `/dashboard/${workspaceId}/casi-duso/nuovo?useCaseId=${item.id}`, label: t.startButton },
        mine: true,
      });
    }
    if (variant === "segna") return step("G9", { title: t.start, line: sentence(lsTurn, why), action: { type: "segna_in_realizzazione" }, mine: true });
    return step("G9", { title: t.start, line: sentence(lsTurn, why) });
  }
  const askTitle = fill(t.askTitle, { azienda: company });
  if (counts && info && counts.toAsk > 0) {
    const firstGate = referents?.available ? (referents.gates[0] ?? null) : null;
    if (firstGate?.code === "sub_responsabili_mancanti") {
      return step("G4", {
        title: t.authorize,
        line: firstGate.message,
        gate: firstGate.code,
        action: firstGate.canDeclare ? { type: "impostazioni", href: firstGate.settingsHref, label: firstGate.linkLabel } : { type: "none" },
        mine: firstGate.canDeclare,
      });
    }
    const asks = toAskSentence(counts.toAsk, info.total);
    if (referents?.available && referents.canAsk && askEntry?.canOpen) {
      return step("G5", { title: askTitle, line: sentence(team, asks), action: { type: "chiedi", label: t.ask }, mine: true });
    }
    const gate = referents?.available ? (askEntry?.gates[0] ?? referents.gates[0] ?? null) : null;
    if (!gate) return step("G6", { title: askTitle, line: sentence(team, asks) });
    return step("G6", { title: askTitle, line: SYSTEM_GATES.includes(gate.code) ? gate.message : sentence(team, gate.message), gate: gate.code });
  }
  if (counts && counts.waiting > 0) {
    const since = counts.since ? day(counts.since, today) : null;
    const tail = since
      ? `${fill(t.waitingSince, { giorno: since })}${counts.reminded ? `, ${t.reminded}` : ""}.`
      : counts.reminded
        ? t.remindedAlone
        : null;
    return step("G7", { title: t.wait, line: sentence(t.referents, tail) });
  }
  if (counts && counts.blockedCount > 0) {
    return step("G8", {
      title: t.unblock,
      line: sentence(team, counts.blockedCount === 1 ? t.blockedOne : fill(t.blockedMany, { n: formatInteger(counts.blockedCount) })),
    });
  }
  // Non succede: una raccolta non completa ha sempre qualcosa da chiedere, da aspettare o fermo.
  return step("G7", { title: t.wait, line: t.referents });
}

function toDecideStep({ item, today, teamName }: NextStepInput): NextStep {
  const t = GUIDED_TEXT.box;
  const team = toTeam(teamName);
  const note = decisionNote({ phase: item.phase, subState: item.subState, waitingSince: item.waitingSince }, today);
  const noteSentence = note ? `${note}.` : null;
  const decide = { action: { type: "decisione" } as const, decisions: "full" as const };
  if (item.answered) {
    return step("H2", { ...decide, title: t.readAnswer, line: sentence(team, t.answered), link: { id: ANCHOR.notaPubblica, label: t.readAnswerLink }, mine: true });
  }
  switch (item.subState) {
    case "serve_info":
      return step("H1", { ...decide, title: t.waitProposer, line: t.proposerTurn, link: { id: ANCHOR.notaPubblica, label: t.seePublicNote } });
    case "rimandata": {
      const on = day(item.reviewBy, today);
      return step("H3", { ...decide, title: on ? fill(t.resumeOn, { giorno: on }) : t.resume, line: sentence(team, t.postponed) });
    }
    case "da_rivedere":
      return step("H4", { ...decide, title: t.resume, line: sentence(team, t.resumeDue), mine: true });
    case "valutata":
      return step("H5", { ...decide, title: t.decideApprove, line: sentence(team, noteSentence), mine: true });
    case "possibile_doppione": {
      const of = item.possibleDuplicateOf?.trim() ? fill(t.maybeDuplicate, { codice: item.possibleDuplicateOf.trim() }) : noteSentence;
      return step("H6", { ...decide, title: t.checkDuplicate, line: sentence(team, of), mine: true });
    }
    default:
      return step("H7", { ...decide, title: t.evaluate, line: sentence(team, noteSentence), mine: true });
  }
}

// ═══ «Impatto» ═══════════════════════════════════════════════════════

/** Una voce a ore o in euro di «Benefici e costi»: etichetta, conto e quanto è sicura. */
export interface ImpactItemLine {
  label: string;
  formula: string;
  confidence: string;
}

/** Una riga di «Da dove vengono i numeri»: la chiave dell'etichetta dell'editor, oppure il testo. */
export interface ImpactOriginRow {
  /** Il nome nel modulo «Benefici e costi» (`VALUE_MODEL_EDITOR_TEXT`), oppure il testo già scritto. */
  term: { key: "whyPrimary" | "notCounted" | "confirmBy" | "runCostNote" | "ease" | "easeWhy" } | { text: string };
  detail: string;
}

export interface ImpactItems {
  lines: ImpactItemLine[];
  /** Le voci qualitative, una per chip. */
  qualitative: string[];
  /** Il chip «Ipotesi da confermare». */
  toConfirm: boolean;
  /** «Si misura con: …», dalla prima voce del ritorno principale. */
  measuredBy: string | null;
  /** «Da dove vengono i numeri»; vuoto senza niente da dire. */
  origin: ImpactOriginRow[];
}

type PerYear = NonNullable<ValueFigure["perYear"]>;

export type ImpactView =
  | { variant: "A"; hours: number; hoursText: string; unit: string; perYear: PerYear | null; hourly: string; payback: string | null; pending: string | null; items: ImpactItems }
  | { variant: "B"; perYear: PerYear; payback: string | null; items: ImpactItems }
  | { variant: "C"; big: string; unit: string; note: string; items: ImpactItems }
  | { variant: "D"; big: string; note: string; items: ImpactItems }
  | { variant: "E"; perYear: PerYear }
  | { variant: "F" }
  | { variant: "G"; big: string; note: string; link: { id: string; label: string }; unofficial: string | null };

export interface ImpactInput {
  value: ValueFigure | null;
  cost: CostFigure | null;
  valueModel: ValueModel | null;
  params: Pick<ValueParams, "hourlyCostEur" | "dayCostEur" | "includeUnmeasured">;
  /** C'è una stima non ufficiale (di Claude, di chi ha proposto) o un suggerimento dell'AI. */
  unofficial: boolean;
}

function impactItems(model: ValueModel | null, params: ImpactInput["params"]): ImpactItems {
  const t = GUIDED_TEXT.impact;
  if (!model) return { lines: [], qualitative: [], toConfirm: false, measuredBy: null, origin: [] };
  const lines: ImpactItemLine[] = [];
  const qualitative: string[] = [];
  for (const component of model.components) {
    if (component.kind === "qualitativo") qualitative.push(component.label);
    else lines.push({ label: component.label, formula: componentFormulaText(component, params), confidence: VALUE_CONFIDENCE_LABELS[component.confidence].toLocaleLowerCase("it-IT") });
  }
  const primary = model.components.find((component) => component.lever === model.primary);
  const origin: ImpactOriginRow[] = [];
  if (model.whyPrimary) origin.push({ term: { key: "whyPrimary" }, detail: model.whyPrimary });
  for (const component of model.components) {
    if (component.basis) origin.push({ term: { text: fill(t.originBasis, { voce: component.label }) }, detail: component.basis });
  }
  if (model.notCounted) origin.push({ term: { key: "notCounted" }, detail: model.notCounted });
  if (model.confirmBy) origin.push({ term: { key: "confirmBy" }, detail: model.confirmBy });
  if (model.costs?.runCostNote) origin.push({ term: { key: "runCostNote" }, detail: model.costs.runCostNote });
  if (model.ease !== undefined) {
    origin.push({ term: { key: "ease" }, detail: fill(t.easeValue, { facilita: model.ease }) });
    if (model.easeWhy) origin.push({ term: { key: "easeWhy" }, detail: model.easeWhy });
  }
  origin.push({ term: { text: t.params }, detail: fill(t.paramsValue, { ora: formatEuro(params.hourlyCostEur), giornata: formatEuro(params.dayCostEur) }) });
  return {
    lines,
    qualitative,
    toConfirm: returnsToConfirm(model, params).length > 0,
    measuredBy: primary?.indicator ? fill(t.measuredBy, { indicatore: primary.indicator }) : null,
    origin,
  };
}

/**
 * La cifra grande di «Impatto» e quello che le sta intorno, per variante:
 * A ore contate; B solo euro contati; C da misurare; D qualitativo; E euro senza modello; F solo
 * la parola del punteggio; G niente («Da stimare», con il link alla valutazione). Gli euro
 * all'anno sono sempre quelli a schermo (`shownPerYear`, quelli del dossier quando c'è); il costo
 * lo scrive sempre `CostFigure`.
 */
export function impactView({ value, cost, valueModel, params, unofficial }: ImpactInput): ImpactView {
  const t = GUIDED_TEXT.impact;
  const benefits = value?.benefits ?? null;
  const perYear = shownPerYear(value);
  if (benefits) {
    if (benefits.state === "contato" && benefits.hours > 0) {
      const hours = Math.round(benefits.hours);
      return {
        variant: "A",
        hours,
        hoursText: formatInteger(hours),
        unit: hours === 1 ? t.hoursOne : t.hoursMany,
        perYear,
        hourly: fill(t.hourly, { euro: formatEuro(params.hourlyCostEur) }),
        payback: paybackText({ value, cost, valueModel, params }),
        pending: benefits.pendingEur > 0 ? fill(t.pending, { euro: formatEuro(benefits.pendingEur) }) : null,
        items: impactItems(valueModel, params),
      };
    }
    if (benefits.state === "contato" && perYear) {
      return { variant: "B", perYear, payback: paybackText({ value, cost, valueModel, params }), items: impactItems(valueModel, params) };
    }
    if (benefits.state === "da_misurare") {
      return { variant: "C", big: fill(t.upTo, { euro: formatEuro(benefits.pendingEur) }), unit: t.toMeasure, note: t.measureNote, items: impactItems(valueModel, params) };
    }
    if (benefits.state === "qualitativo") return { variant: "D", big: t.qualitative, note: t.qualitativeNote, items: impactItems(valueModel, params) };
  }
  if (perYear) return { variant: "E", perYear };
  if (value?.word) return { variant: "F" };
  return {
    variant: "G",
    big: t.toEstimate,
    note: t.toEstimateNote,
    link: { id: ANCHOR.valutazione, label: t.estimateLink },
    unofficial: unofficial ? t.unofficial : null,
  };
}

/**
 * Quando rientra l'avvio, con i benefici contati e i costi di «Benefici e costi» (la stessa
 * formula del pareggio del dossier): mesi = avvio / ((beneficio − ricorrenti) / 12). Solo con
 * benefici contati non del dossier e un costo d'avvio stimato dal team maggiore di zero;
 * altrimenti null. Con giorni di sviluppo e una giornata a 0 € la frase lo dice.
 */
export function paybackText({ value, cost, valueModel, params }: Omit<ImpactInput, "unofficial">): string | null {
  const t = GUIDED_TEXT.payback;
  const benefits = value?.benefits;
  if (!benefits || benefits.state !== "contato") return null;
  if (value?.perYear?.source === "dossier") return null;
  if (!cost || cost.source !== "stima" || cost.amount === null || !(cost.amount > 0)) return null;
  const net = benefits.benefitEur - (cost.runEurYear ?? 0);
  if (!(net > 0)) return t.notCovered;
  const months = cost.amount / (net / 12);
  const EPSILON = 1e-9;
  const head =
    months < 1 - EPSILON
      ? t.underMonth
      : Math.abs(months - 1) <= EPSILON
        ? t.aboutMonth
        : months <= 24 + EPSILON
          ? fill(t.aboutMonths, { n: Math.ceil(months - EPSILON) })
          : t.overTwoYears;
  const devDays = valueModel?.costs?.devDays ?? 0;
  const caveat = devDays > 0 && params.dayCostEur === 0 ? (devDays === 1 ? t.devDayOne : fill(t.devDaysMany, { n: DECIMAL.format(devDays) })) : "";
  return `${head}${caveat}.`;
}

// ═══ «Come cambia il lavoro» ═════════════════════════════════════════

export interface WorkFlowLabels {
  /** «Oggi» («Prima» per una best practice). */
  today: string;
  /** «Con LIBRA», «Con l'agente» («Adesso»). */
  agent: string;
  /** «Decide una persona» («Chi la usa»). */
  human: string;
  /** «Cosa LIBRA non fa mai»; null per una best practice (non ha limiti). */
  limits: string | null;
}

/** Le etichette dei tre passi e della piega dei limiti, dal tipo e dal titolo (l'agente del prefisso). */
export function workFlowLabels(kind: UseCaseKind, title: string): WorkFlowLabels {
  const t = GUIDED_TEXT.work;
  if (kind === "da_diffondere") return { today: t.before, agent: t.now, human: t.whoUses, limits: null };
  const agent = titleAgent(title)?.agent ?? null;
  return {
    today: t.today,
    agent: agent ? fill(t.withAgent, { agente: agent }) : t.withAnyAgent,
    human: t.human,
    limits: agent ? fill(t.limits, { agente: agent }) : t.limitsAnyAgent,
  };
}

/** «5 limiti», «1 limite» (le righe non vuote), oppure «da completare». */
export function limitsSummary(guardrails: string | null | undefined): string {
  const t = GUIDED_TEXT.work;
  const lines = (guardrails ?? "").split(/\r?\n/).filter((line) => line.replace(/^[\s•*·-]+/, "").trim() !== "").length;
  if (lines === 0) return t.toComplete;
  return lines === 1 ? t.limitOne : fill(t.limitsMany, { n: formatInteger(lines) });
}

/** Oltre questi caratteri un passo di «Come cambia il lavoro» si mostra corto, con «Leggi tutto». */
export const WORK_CLAMP_AFTER = 280;

/** Il passo si mostra corto? Deciso sul server, dal testo: i testi brevi non si tagliano mai. */
export function workClamps(text: string | null | undefined): boolean {
  return typeof text === "string" && text.trim().length > WORK_CLAMP_AFTER;
}

// ═══ Le pieghe ═══════════════════════════════════════════════════════

export interface FoldSummaryInput {
  valuation: { estimates: boolean; aiSuggestion: boolean; value: Pick<ValueFigure, "perYear" | "benefits"> | null; zone: Zone | null };
  /** Le etichette dei campi di «Dettagli» che hanno un testo, nell'ordine. */
  filledDetails: readonly string[];
  realization: { variant: GuidedRealizationVariant; realization: UseCaseRealization | null; dossier: { status: CaseStatus; readiness: { ok: number; required: number } | null } | null; realizedOn: string | null } | null;
  /** Le righe della Storia, dalla più recente. */
  events: readonly { at: Date | string }[] | null;
  today: string;
}

export interface FoldSummaries {
  valutazione: string;
  dettagli: string;
  /** null: la piega non c'è. */
  realizzazione: string | null;
  storia: string | null;
}

/** La riga grigia accanto al titolo di ogni piega chiusa. */
export function foldSummaries(input: FoldSummaryInput): FoldSummaries {
  const t = GUIDED_TEXT.folds;
  const { valuation } = input;
  const valuationPieces = [
    valuation.estimates ? t.estimates : null,
    valuation.aiSuggestion ? t.aiSuggestion : null,
    valuation.zone && showsZone(valuation.value) ? fill(t.zone, { zona: zoneText(valuation.zone, valuation.value) }) : null,
  ].filter((piece): piece is string => piece !== null);
  const filled = input.filledDetails.map((label) => lowerFirst(label));
  const dettagli = filled.length
    ? `${filled.slice(0, 3).join(FIGURE_SEPARATOR)}${filled.length > 3 ? fill(t.moreFields, { n: formatInteger(filled.length - 3) }) : ""}`
    : t.toComplete;
  const latest = input.events?.[0]?.at ?? null;
  const latestDay = latest ? formatDayInYear(latest, instantOfDay(input.today)) : null;
  return {
    valutazione: valuationPieces.length ? valuationPieces.join(FIGURE_SEPARATOR) : t.editValuation,
    dettagli,
    realizzazione: input.realization ? realizationSummary(input.realization, input.today) : null,
    storia: input.events ? (latestDay ? fill(t.lastChange, { giorno: latestDay }) : t.noChange) : null,
  };
}

function realizationSummary(r: NonNullable<FoldSummaryInput["realization"]>, today: string): string | null {
  const t = GUIDED_TEXT.folds;
  switch (r.variant) {
    case "avvia":
    case "segna":
      return t.notStarted;
    case "lo_avvia_ls":
      return t.startedByLs;
    case "non_disponibile":
      return t.unavailable;
    case "diffusa": {
      const on = day(r.realizedOn, today);
      return on ? fill(t.diffusedOn, { giorno: on }) : t.diffused;
    }
    case "riepilogo":
    case "dossier": {
      const dossier = r.realization?.state === "avviata" ? r.realization.dossier : null;
      const statusLabel = dossier?.statusLabel ?? (r.dossier ? CASE_STATUS_LABEL[r.dossier.status] : null);
      if (!statusLabel) return null;
      const progress = dossier?.progress ?? r.dossier?.readiness ?? null;
      const head = fill(t.dossier, { stato: lowerFirst(statusLabel) });
      return progress && progress.required > 0 ? `${head}${FIGURE_SEPARATOR}${fill(t.dossierReady, { ok: formatInteger(progress.ok), richiesti: formatInteger(progress.required) })}` : head;
    }
    case "fase":
      return null;
  }
}

// ═══ Le ancore ═══════════════════════════════════════════════════════

export interface TargetInput {
  phase: Phase;
  /** «Cosa serve» c'è (`canSeeNeeds` e le esigenze lette). */
  needs: boolean;
  /** «Richieste inviate» c'è (funzione accesa e almeno una richiesta). */
  requests: boolean;
  /** La piega «Realizzazione» c'è. */
  realization: boolean;
  /** La «Storia» c'è (`canSeeHistory` e le righe lette). */
  history: boolean;
}

/** Le ancore della scheda di un revisore, nell'ordine della pagina: solo quelle che ci sono. */
export function detailTargetIds(input: TargetInput): string[] {
  const ids: string[] = [ANCHOR.decisione, ANCHOR.impatto, ANCHOR.cosaE];
  if (input.needs) ids.push(ANCHOR.cosaServe);
  if (input.needs && input.requests) ids.push(ANCHOR.richieste);
  if (input.phase === "approvato") ids.push(ANCHOR.quando);
  ids.push(ANCHOR.notaPubblica, ANCHOR.valutazione, ANCHOR.dettagli);
  if (input.realization) ids.push(ANCHOR.realizzazione);
  if (input.history) ids.push(ANCHOR.storia);
  return ids;
}

/**
 * Dove arriva `?capitolo=`: l'ancora stessa, se la pagina ce l'ha; «Realizzazione» senza la sua
 * piega va al riquadro «Prossimo passo»; altrimenti la cima della pagina (null).
 */
export function arrivalTarget(chapter: string | null | undefined, ids: readonly string[]): string | null {
  if (!chapter) return null;
  if (ids.includes(chapter)) return chapter;
  return chapter === ANCHOR.realizzazione ? ANCHOR.decisione : null;
}

// ═══ I cinque gruppi delle richieste ═════════════════════════════════

export type RequestGroup = "toAsk" | "waiting" | "toVerify" | "blocked" | "done";

export interface RequestGroupView {
  group: RequestGroup;
  /** «Da chiedere», «In attesa», «Da verificare», «Ferma», «A posto». */
  label: string;
  tone: SemaforoColor;
  /** Il dettaglio dello stato dentro il gruppo: «manca il dato», «risposta parziale», «non si applica»; null senza. */
  note: string | null;
}

const GROUP_TONE: Readonly<Record<RequestGroup, SemaforoColor>> = Object.freeze({
  toAsk: "grigio",
  waiting: "blu",
  toVerify: "giallo",
  blocked: "lucchetto",
  done: "verde",
});

/**
 * Lo stato di un requisito nei cinque gruppi che si leggono a schermo (gli otto stati restano nel
 * modulo di modifica, nel MCP del team e nell'export): da chiedere (anche «manca il dato» e
 * «risposta parziale»), in attesa, da verificare, ferma, a posto (anche «non si applica»).
 */
export function requestGroupView(status: NeedStatus): RequestGroupView {
  const group = askGroupOf(status);
  const notes = GUIDED_TEXT.requestNotes as Readonly<Record<string, string>>;
  return {
    group,
    label: GUIDED_TEXT.requestGroups[group],
    tone: GROUP_TONE[group],
    note: Object.prototype.hasOwnProperty.call(notes, status) ? notes[status] : null,
  };
}
