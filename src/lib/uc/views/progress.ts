/**
 * Panoramica e Via allo sviluppo (DESIGN §3.4, §3.5): il modulo puro dietro le
 * due pagine che prendono il posto del vecchio Avanzamento.
 *
 * - Panoramica: le sezioni per ruolo, le domande indispensabili per argomento
 *   (prima chi manca di più), i blocchi con un'etichetta breve per chiave (mai
 *   quello dei dati sanitari), le prossime tappe, l'avviso del via appena
 *   approvato.
 * - Via allo sviluppo: lo stato del via, le condizioni in parole semplici, le
 *   firme dei due lati, l'azione della pagina per ogni stato della tabella di
 *   §3.5, «Come funziona» e lo storico.
 *
 * I testi seguono il vocabolario di §2.6: «via allo sviluppo», «domanda»,
 * «argomento», «Responsabile Lateral Space» (`ROLE_LABEL`). Nessuna chiave,
 * nessun articolo, nessun G1 (il controllo è `copy-guard.ts`, nei test).
 * Restano le funzioni del vecchio Avanzamento che altre pagine usano ancora
 * (`blockerResolver`, `BLOCKER_STATUS_LABEL`, `caseStepper`).
 *
 * Modulo puro e senza dipendenze di Node.
 */
import { CASE_STATUS_LABEL, CASE_STEPPER_ORDER, isCasePastG1 } from "../case-state.ts";
import type { GateCondition } from "../gates.ts";
import { signatureSideOf } from "../permissions.ts";
import type { CaseRole, CaseStatus, GatePolicyScope, ItemStatus, SemaforoColor } from "../vocab.ts";
import { formatCountIt, formatDayIt, stripLegalRefs } from "./format.ts";
import { CASE_PHASES, CASE_PHASE_LABEL, CASE_STATUS_PHASE, ROLE_LABEL, SIGNERS_TEXT, casePhaseOf, WORDS, dayWithArticle, gateStateLabel, type CasePhase, type GateState } from "./labels.ts";
import { seesValidatedOnly } from "./page-access.ts";
import { STATUS_GROUP_OF, STATUS_GROUP_SLUG, groupCountText, isLsViewer, type Audience, type StatusGroup } from "./status-groups.ts";
import { UUID } from "../ids.ts";

const n = formatCountIt;

// ── Panoramica: chi vede quali sezioni ────────────────────────────────

/**
 * Le sezioni della Panoramica, nell'ordine in cui si leggono (DESIGN §3.4,
 * «Varianti per ruolo e per stato»):
 * - `firma`: il riquadro «Serve la tua firma» del responsabile del cliente;
 * - `fare`: «Da fare adesso» e la riga «Tocca a …»;
 * - `via`, `argomenti`, `blocchi`, `tappe`, `caso`.
 */
export type OverviewSection = "firma" | "fare" | "via" | "argomenti" | "blocchi" | "tappe" | "caso";

/**
 * - `ls`: responsabile Lateral Space e analista, tutto;
 * - `sviluppatore`: solo il ruolo di sviluppatore, il catalogo validato;
 * - `cliente`: il responsabile del cliente, gruppi del cliente e niente blocchi;
 * - `lettore`: AI Board e osservatore, il caso, il numero e le tappe.
 */
export type OverviewKind = "ls" | "sviluppatore" | "cliente" | "lettore";

export interface OverviewLayout {
  kind: OverviewKind;
  audience: Audience;
  sections: OverviewSection[];
}

const SECTIONS: Readonly<Record<OverviewKind, readonly OverviewSection[]>> = {
  ls: ["fare", "via", "argomenti", "blocchi", "tappe", "caso"],
  sviluppatore: ["fare", "via", "argomenti", "tappe", "caso"],
  cliente: ["firma", "fare", "via", "argomenti", "tappe", "caso"],
  lettore: ["caso", "via", "tappe"],
};

/** Le sezioni della Panoramica per chi guarda: vince il ruolo che vede di più. */
export function overviewLayout(roles: readonly CaseRole[]): OverviewLayout {
  let kind: OverviewKind;
  if (isLsViewer(roles)) kind = seesValidatedOnly(roles) ? "sviluppatore" : "ls";
  else if (roles.includes("owner_cliente")) kind = "cliente";
  else kind = "lettore";
  return { kind, audience: kind === "ls" || kind === "sviluppatore" ? "ls" : "cliente", sections: [...SECTIONS[kind]] };
}

/** «Serve la tua firma · 2 decisioni aspettano te» (responsabile del cliente, solo con firme in attesa). */
export function signatureCalloutText(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count === 1 ? "Serve la tua firma · 1 decisione aspetta te" : `Serve la tua firma · ${n(count)} decisioni aspettano te`;
}

/** Via approvato da meno di `days` giorni (7): la riga discreta in cima alla Panoramica. */
export function recentlyApprovedText(i: { status: CaseStatus; statusBeforeSuspension: CaseStatus | null; catalog: { version: number; frozenAt: Date | string | null } | null; now: Date; days?: number }): string | null {
  if (!i.catalog || i.status === "chiuso" || !isCasePastG1(i.status, i.statusBeforeSuspension)) return null;
  const at = i.catalog.frozenAt instanceof Date ? i.catalog.frozenAt : i.catalog.frozenAt ? new Date(i.catalog.frozenAt) : null;
  if (!at || Number.isNaN(at.getTime())) return null;
  const age = i.now.getTime() - at.getTime();
  if (age < 0 || age > (i.days ?? 7) * 86_400_000) return null;
  return `Via allo sviluppo approvato. Il catalogo v${i.catalog.version} è congelato.`;
}

/**
 * Il via è stato approvato almeno una volta: il caso è oltre la preparazione
 * (anche in pausa) oppure ha un catalogo congelato, che resta anche a caso
 * chiuso.
 */
export function viaEverApproved(i: { status: CaseStatus; statusBeforeSuspension: CaseStatus | null; catalogVersion: number }): boolean {
  return isCasePastG1(i.status, i.statusBeforeSuspension) || i.catalogVersion > 0;
}

/**
 * La riga dello sviluppatore sotto il numero: prima del via e dopo (DESIGN
 * §3.4). `pastVia` è `viaEverApproved`: un caso chiuso dopo il via ha ancora
 * il suo catalogo validato.
 */
export function developerCatalogText(i: { pastVia: boolean; catalog: { version: number; frozenAt: Date | string | null } | null; now: Date }): string {
  if (!i.pastVia || !i.catalog) return "Il catalogo validato arriva con il via allo sviluppo.";
  const day = formatDayIt(i.catalog.frozenAt, { now: i.now });
  return `Catalogo validato v${i.catalog.version}${day ? ` · congelato ${dayWithArticle("il", day)}` : ""}`;
}

// ── Domande indispensabili: conteggi per gruppo ───────────────────────

/** Una domanda indispensabile del via: argomento, stato e se è a posto (`isItemOk`). */
export interface RequiredItemFact {
  moduleKey: string | null;
  status: ItemStatus;
  ok: boolean;
}

export interface ViaProgress {
  required: number;
  ok: number;
  /** Indispensabili in verifica e non ancora a posto: la parte gialla della barra. */
  inReview: number;
  /** Gruppi delle indispensabili non a posto, senza gli zeri, nell'ordine dei segmenti. */
  open: { group: StatusGroup; slug: string; count: number; text: string }[];
}

/**
 * Il numero del via e i conteggi dei gruppi (DESIGN §3.4, «Via allo
 * sviluppo»): «140 da fare · 95 da verificare · 10 bloccate», per il cliente
 * «80 da rispondere · 40 in verifica · 5 in attesa». «A posto» è il numero
 * grande: non si ripete. I gruppi a zero non compaiono.
 */
export function viaProgress(items: readonly RequiredItemFact[], audience: Audience): ViaProgress {
  const counts: Record<StatusGroup, number> = { da_fare: 0, da_verificare: 0, bloccate: 0, a_posto: 0 };
  let ok = 0;
  let inReview = 0;
  for (const it of items) {
    if (it.ok) {
      ok++;
      continue;
    }
    const group = STATUS_GROUP_OF[it.status];
    // Una domanda «validata» scaduta o «non si applica» senza le due firme non è a posto: resta da fare.
    counts[group === "a_posto" ? "da_fare" : group]++;
    if (it.status === "in_verifica") inReview++;
  }
  const open = (["da_fare", "da_verificare", "bloccate"] as const)
    .filter((g) => counts[g] > 0)
    .map((g) => ({ group: g, slug: STATUS_GROUP_SLUG[g], count: counts[g], text: groupCountText(g, counts[g], audience) }));
  return { required: items.length, ok, inReview, open };
}

/**
 * Il via senza domande indispensabili (regola o schema da controllare): lo
 * dice solo a Lateral Space, con dove guardare. Al cliente niente: lo zero
 * non si mostra (DESIGN §1, principio 4) e lo schema non è una sua parola.
 */
export function noRequiredText(audience: Audience): string | null {
  return audience === "ls" ? "Nessuna domanda indispensabile: controlla la regola del via in Diagnostica." : null;
}

/** «Si muove quando arrivano le prime risposte.» sotto il numero, solo in bozza. */
export function viaProgressHint(status: CaseStatus): string | null {
  return status === "bozza" ? "Si muove quando arrivano le prime risposte." : null;
}

// ── Per argomento ─────────────────────────────────────────────────────

export interface ModuleRef {
  key: string;
  title: string;
  roleKey: string | null;
}

export interface ModuleProgressRow {
  /** Chiave dell'argomento (per `?argomento=`), null per le domande fuori dagli argomenti. */
  key: string | null;
  title: string;
  /** Chi risponde (ruolo dello schema), in grigio. */
  roleLabel: string | null;
  ok: number;
  total: number;
  missing: number;
  /** Celle piene della mini-barra (su `MODULE_BAR_CELLS`): piena solo se è tutto a posto. */
  cells: number;
}

export const MODULE_BAR_CELLS = 5;
/** Righe visibili; le altre stanno in «Tutti gli argomenti (n) ▾». */
export const MODULE_ROWS_VISIBLE = 6;
const OTHER_QUESTIONS = "Altre domande";

/** Celle piene di una mini-barra: arrotondate per difetto, così la barra è piena solo a «14 di 14». */
export function progressCells(ok: number, total: number, cells = MODULE_BAR_CELLS): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  const done = Math.max(0, Math.min(total, Number.isFinite(ok) ? ok : 0));
  return Math.floor((done * cells) / total);
}

/**
 * Le domande indispensabili per argomento (DESIGN §3.4, «Per argomento»):
 * titolo, chi risponde, «ok di totale». Prima gli argomenti a cui ne mancano
 * di più; a pari merito l'ordine dello schema; le domande fuori dagli
 * argomenti in fondo. Gli argomenti senza indispensabili non compaiono.
 */
export function moduleProgress(items: readonly Pick<RequiredItemFact, "moduleKey" | "ok">[], modules: readonly ModuleRef[], opts: { roleLabels?: Readonly<Record<string, string>> } = {}): ModuleProgressRow[] {
  const order = new Map(modules.map((m, i) => [m.key, i]));
  const tally = new Map<string | null, { ok: number; total: number }>();
  for (const it of items) {
    const t = tally.get(it.moduleKey) ?? { ok: 0, total: 0 };
    t.total++;
    if (it.ok) t.ok++;
    tally.set(it.moduleKey, t);
  }
  const rows = [...tally].map(([key, t]): ModuleProgressRow => {
    const mod = key === null ? undefined : modules.find((m) => m.key === key);
    const roleKey = mod?.roleKey ?? null;
    return {
      key,
      title: key === null ? OTHER_QUESTIONS : (mod?.title ?? key),
      roleLabel: roleKey ? (opts.roleLabels?.[roleKey] ?? null) : null,
      ok: t.ok,
      total: t.total,
      missing: t.total - t.ok,
      cells: progressCells(t.ok, t.total),
    };
  });
  const rank = (k: string | null) => (k === null ? Number.MAX_SAFE_INTEGER : (order.get(k) ?? Number.MAX_SAFE_INTEGER - 1));
  return rows.sort((a, b) => b.missing - a.missing || rank(a.key) - rank(b.key) || (a.key ?? "").localeCompare(b.key ?? ""));
}

// ── Blocchi ───────────────────────────────────────────────────────────

/** Chi deve sciogliere un blocco, in italiano semplice (DESIGN §2.6: niente articoli né sigle). */
export function blockerResolver(key: string): string {
  switch (key) {
    case "a8":
      return "Il responsabile Lateral Space e l'approvatore privacy del cliente: servono le due firme sulla scheda privacy.";
    case "decisione_board":
    case "fuori_foundation":
      return "Il responsabile Lateral Space, con il verbale o l'email dell'AI Board.";
    case "costi_art_8_4":
      return "Il responsabile Lateral Space, con l'approvazione scritta dei costi.";
    case "accesso_sistema":
      return "Il responsabile Lateral Space, quando l'accesso al sistema è attivo.";
    case "sanitario":
      return "Nessuno: i dati sanitari non entrano mai.";
    default:
      return "Il responsabile Lateral Space, con una prova scritta.";
  }
}

export const BLOCKER_STATUS_LABEL: Readonly<Record<string, string>> = {
  attivo: "Attivo",
  sciolto: "Sciolto",
  permanente: "Permanente",
};

/** Etichette brevi dei blocchi in Panoramica, per chiave (DESIGN §3.4). Il blocco dei dati sanitari non compare mai. */
export const BLOCKER_SHORT_LABEL: Readonly<Record<string, string>> = {
  a8: WORDS.schedaPrivacy,
  accesso_sistema: "Accesso al sistema",
  decisione_board: "Decisione dell'AI Board",
  costi_art_8_4: "Costi da approvare",
  fuori_foundation: WORDS.fuoriContratto,
};

/** La riga sotto l'etichetta breve (DESIGN §3.4); la scheda privacy dipende da chi deve ancora firmare. */
const BLOCKER_LINE: Readonly<Record<string, string>> = {
  accesso_sistema: "Lo sblocca Lateral Space quando è attivo.",
  decisione_board: "Serve il verbale o l'email dell'AI Board.",
  costi_art_8_4: "Serve l'approvazione scritta dei costi.",
  fuori_foundation: "Serve il verbale o l'email dell'AI Board.",
};

/** La prima frase di un testo, senza il punto finale. */
export function firstSentence(text: string): string {
  const t = text.trim();
  const m = /^(.+?[.!?])(?:\s|$)/.exec(t);
  return (m ? m[1] : t).replace(/[.!?]+$/, "").trim();
}

/** Etichetta breve di un blocco: quella della chiave, altrimenti l'etichetta senza articoli, alla prima frase. */
export function blockerShortLabel(key: string, label: string): string {
  return BLOCKER_SHORT_LABEL[key] ?? (firstSentence(stripLegalRefs(label)) || BLOCKER_SHORT_LABEL.a8);
}

export interface OverviewBlockerInput {
  id: string;
  key: string;
  label: string;
  status: string;
  /** Domande collegate (non cancellate). */
  items: number;
  /** Solo la scheda privacy: chi deve ancora firmare. */
  a8WaitingFor?: "lateral_space" | "cliente" | null;
}

export interface OverviewBlockerRow {
  id: string;
  key: string;
  label: string;
  line: string;
  /** L'etichetta intera senza articoli, per il pannello. */
  fullLabel: string;
  items: number;
}

/** Blocchi visibili prima di «Altri n ▾». */
export const BLOCKERS_VISIBLE = 2;

/**
 * I blocchi della Panoramica (DESIGN §3.4): solo quelli attivi con domande
 * collegate, più la scheda privacy; mai il blocco dei dati sanitari. Prima la
 * scheda privacy, poi chi ferma più domande.
 */
export function overviewBlockers(blockers: readonly OverviewBlockerInput[]): OverviewBlockerRow[] {
  return blockers
    .filter((b) => b.status === "attivo" && b.key !== "sanitario" && (b.items > 0 || b.key === "a8"))
    .map(overviewBlockerRow)
    .sort((a, b) => Number(b.key === "a8") - Number(a.key === "a8") || b.items - a.items);
}

/** Un blocco in parole: etichetta breve, la sua riga e l'etichetta intera senza articoli (per il pannello). */
export function overviewBlockerRow(b: OverviewBlockerInput): OverviewBlockerRow {
  return {
    id: b.id,
    key: b.key,
    label: blockerShortLabel(b.key, b.label),
    line:
      b.key === "a8"
        ? b.a8WaitingFor === "cliente"
          ? "Manca la firma del cliente."
          : "Manca la firma di Lateral Space."
        : (BLOCKER_LINE[b.key] ?? (b.items === 1 ? "Ferma 1 domanda." : `Ferma ${n(b.items)} domande.`)),
    fullLabel: stripLegalRefs(b.label) || blockerShortLabel(b.key, b.label),
    items: b.items,
  };
}

/** Valore di `?apri=` per il pannello di un blocco. */
export function blockerPanelParam(blockerId: string): string {
  return `blocco:${blockerId}`;
}

/** Il pannello aperto dall'URL in Panoramica: un blocco (`blocco:<id>`) o tutte le tappe. */
export function parseOverviewPanel(raw: string | string[] | undefined): { kind: "blocco"; blockerId: string } | { kind: "tappe" } | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v) return null;
  if (v === "tappe") return { kind: "tappe" };
  const m = /^blocco:(.+)$/.exec(v);
  return m && UUID.test(m[1]) ? { kind: "blocco", blockerId: m[1].toLowerCase() } : null;
}

/** Domande collegate mostrate nel pannello di un blocco, prima di «Vedi tutte». */
export const BLOCKER_PANEL_ITEMS = 10;

// ── Tappe ─────────────────────────────────────────────────────────────

export interface MilestoneLike {
  key: string;
  title: string;
  plannedDate: string | null;
  plannedLabel: string | null;
  isProposal: boolean;
  toConfirm: boolean;
  done: boolean;
}

export interface MilestoneView {
  key: string;
  title: string;
  /** «23 ott», l'etichetta libera («settimana 2») o null. */
  when: string | null;
  /** Suffissi grigi: «(proposta)», «da confermare». */
  suffix: string | null;
  done: boolean;
}

/** Una tappa in parole: quando e i suffissi grigi, senza ripetere quello che l'etichetta dice già. */
export function milestoneView(m: MilestoneLike, now: Date): MilestoneView {
  const label = m.plannedLabel?.trim() || null;
  const when = label ?? formatDayIt(m.plannedDate, { now });
  const parts: string[] = [];
  if (m.isProposal && !/\(proposta\)/i.test(label ?? "")) parts.push("(proposta)");
  if (m.toConfirm && !/da confermare/i.test(label ?? "")) parts.push("da confermare");
  return { key: m.key, title: m.title, when, suffix: parts.length ? parts.join(" · ") : null, done: m.done };
}

/** Le prossime tappe ancora da fare, nell'ordine del caso (2 in Panoramica). */
export function nextMilestones<T extends Pick<MilestoneLike, "done">>(milestones: readonly T[], max = 2): T[] {
  return milestones.filter((m) => !m.done).slice(0, max);
}

/** Fase della striscia delle tappe; null a caso chiuso (lo stato basta). */
export function phaseStripOf(status: CaseStatus, statusBeforeSuspension: CaseStatus | null): { phase: CasePhase; complete: boolean; paused: boolean } | null {
  const at = casePhaseOf(status, statusBeforeSuspension);
  return at ? { ...at, paused: status === "sospeso" } : null;
}

// ── Stati del caso ────────────────────────────────────────────────────

/** Cosa vuol dire ogni stato e quando si va avanti, nelle parole di §2.6. */
export const CASE_STATUS_HELP: Readonly<Record<CaseStatus, { meaning: string; next: string }>> = {
  bozza: { meaning: "Lateral Space prepara il caso: domande, descrizione, mappa e referenti.", next: "Parte la prima richiesta a un referente." },
  raccolta: { meaning: "I referenti rispondono e Lateral Space verifica le risposte.", next: "Il via allo sviluppo è approvato." },
  pronto_sviluppo: { meaning: "Via approvato: il catalogo è congelato e il team può partire.", next: "Lateral Space avvia lo sviluppo." },
  in_sviluppo: { meaning: "Il team costruisce la soluzione sul catalogo validato, all'inizio con dati inventati.", next: "La soluzione è pronta per la prova sul passato." },
  backtest: { meaning: "La soluzione rigioca i dati storici e si misura cosa avrebbe cambiato.", next: "Il cliente approva i risultati." },
  collaudo: { meaning: "Il cliente prova la soluzione con i criteri concordati.", next: "Collaudo positivo, con il verbale." },
  stabilizzazione: { meaning: "Per 14 giorni si correggono i difetti e si controlla che non ci siano anomalie bloccanti.", next: "Finiti i 14 giorni senza anomalie bloccanti." },
  in_esercizio: { meaning: "La soluzione è in uso; i KPI si misurano ogni mese.", next: "Arriva la revisione del valore in programma." },
  misura_roi: { meaning: "Si confronta il valore stimato con quello misurato e si decide come andare avanti.", next: "Decisione: continuare, evolvere o chiudere." },
  sospeso: { meaning: "Il caso è fermo per un motivo esterno, scritto nel caso.", next: "Il motivo è risolto: il caso torna allo stato di prima." },
  chiuso: { meaning: "Caso archiviato, respinto o dismesso.", next: "Non riparte: si può solo duplicare." },
};

export interface StepperStep {
  status: CaseStatus;
  label: string;
  meaning: string;
  next: string;
  /** Stato attuale. */
  current: boolean;
  /** Già superato nel ciclo del caso. */
  done: boolean;
  /** Per un caso sospeso: lo stato in cui era. */
  before: boolean;
}

/** Gli 11 stati nell'ordine dello stepper, con «adesso» e quelli superati. */
export function caseStepper(status: CaseStatus, statusBeforeSuspension: CaseStatus | null): StepperStep[] {
  const effective = status === "sospeso" && statusBeforeSuspension ? statusBeforeSuspension : status;
  const path: readonly CaseStatus[] = CASE_STEPPER_ORDER.filter((s) => s !== "sospeso" && s !== "chiuso");
  const reached = status === "chiuso" ? -1 : path.indexOf(effective);
  return CASE_STEPPER_ORDER.map((s) => {
    const idx = path.indexOf(s);
    return {
      status: s,
      label: CASE_STATUS_LABEL[s],
      meaning: CASE_STATUS_HELP[s].meaning,
      next: CASE_STATUS_HELP[s].next,
      current: s === status,
      done: idx >= 0 && reached >= 0 && idx < reached,
      before: status === "sospeso" && s === statusBeforeSuspension,
    };
  });
}

export interface PhaseGroup {
  phase: CasePhase;
  label: string;
  /** La fase in cui è il caso (anche in pausa: quella di prima). */
  current: boolean;
  done: boolean;
  steps: StepperStep[];
}

/** Le 5 fasi con gli stati che contengono, per «Come funziona» di `/via`. Pausa e chiusura sono stati, non fasi. */
export function casePhaseGroups(status: CaseStatus, statusBeforeSuspension: CaseStatus | null): PhaseGroup[] {
  const steps = caseStepper(status, statusBeforeSuspension);
  const strip = phaseStripOf(status, statusBeforeSuspension);
  const at = strip ? CASE_PHASES.indexOf(strip.phase) : -1;
  return CASE_PHASES.map((phase, i) => ({
    phase,
    label: CASE_PHASE_LABEL[phase],
    current: i === at,
    done: at >= 0 && (i < at || (i === at && strip!.complete)),
    steps: steps.filter((s) => CASE_STATUS_PHASE[s.status] === phase),
  }));
}

// ── Via allo sviluppo: stato, condizioni, firme, azione ───────────────

/** Il via è già stato approvato (il caso è oltre la preparazione, anche se in pausa). */
export function isPastVia(status: CaseStatus, statusBeforeSuspension: CaseStatus | null): boolean {
  return isCasePastG1(status, statusBeforeSuspension);
}

/**
 * Stato del via (DESIGN §2.6): «Non ancora» · «Si può proporre» · «In attesa
 * delle firme» · «Approvato il 3 ott» · «Da riconfermare».
 *
 * - A caso chiuso conta la storia: «Approvato» se il via è stato approvato
 *   (`approved`, da `viaEverApproved` o dallo storico), altrimenti «Non ancora».
 * - «Si può proporre» solo in preparazione: in bozza, in pausa o a caso chiuso
 *   il via non si propone (`caseAllowsGate`).
 */
export function viaState(i: { status: CaseStatus; statusBeforeSuspension: CaseStatus | null; gateReconfirm: boolean; ready: boolean; pending: boolean; approved: boolean }): GateState {
  if (i.status === "chiuso") return i.approved ? "approvato" : "non_ancora";
  if (i.gateReconfirm) return "da_riconfermare";
  if (isCasePastG1(i.status, i.statusBeforeSuspension)) return "approvato";
  if (i.pending) return "in_attesa_firme";
  if (i.ready && i.status === "raccolta") return "si_puo_proporre";
  return "non_ancora";
}

export const VIA_STATE_TONE: Readonly<Record<GateState, SemaforoColor>> = {
  non_ancora: "grigio",
  si_puo_proporre: "blu",
  in_attesa_firme: "giallo",
  approvato: "verde",
  da_riconfermare: "rosso",
};

/** Etichetta e colore dello stato del via, con la data dell'approvazione («Approvato il 3 ott»). */
export function viaStateView(state: GateState, approvedAt: Date | string | null, now: Date): { label: string; tone: SemaforoColor } {
  return { label: gateStateLabel(state, state === "approvato" ? formatDayIt(approvedAt, { now }) : null), tone: VIA_STATE_TONE[state] };
}

export interface ViaConditionView {
  key: string;
  label: string;
  /** «mancano 245», «3»: solo per le condizioni non a posto. */
  detail: string | null;
  ok: boolean;
  /** Segmento sotto il dossier dove si sistema, oppure null. */
  segment: string | null;
}

const CONDITION_TEXT: Readonly<Record<string, { label: string; segment: string | null }>> = {
  voci_a_posto: { label: "Tutte le domande indispensabili a posto", segment: "domande" },
  chiarimenti: { label: "Chiarimenti aperti chiusi", segment: "domande" },
  fonti_con_dataset: { label: "Fonti e dataset approvati", segment: "domande/documenti" },
  regole_confermate: { label: "Regole confermate da chi le possiede", segment: "soluzione/regole" },
  deroghe_entro_limite: { label: "Partenze senza risposta entro il limite", segment: null },
};

/** Il primo numero di un messaggio del calcolo («3 chiarimenti aperti.» → 3). */
function leadingCount(message: string): number | null {
  const m = /\d[\d.]*/.exec(message);
  return m ? Number(m[0].replace(/\./g, "")) : null;
}

/**
 * Le condizioni del via in parole semplici (DESIGN §3.5, «Cosa serve
 * ancora»): quelle da sistemare in vista, quelle a posto da chiudere sotto
 * «N condizioni già a posto ▾». La condizione sempre vera «disponibile» non
 * compare. I numeri vengono dal calcolo del via (`computeGate`).
 */
export function viaConditions(
  conditions: readonly GateCondition[],
  i: { required: number; ok: number; waivers: { used: number; cap: number }; audience: Audience },
): { open: ViaConditionView[]; done: ViaConditionView[] } {
  const views = conditions
    .filter((c) => c.key !== "disponibile")
    .map((c): ViaConditionView => {
      const known = CONDITION_TEXT[c.key];
      let detail: string | null = null;
      if (!c.ok) {
        // Senza domande indispensabili la regola va controllata: lo legge solo Lateral Space, che ha «Diagnostica».
        if (c.key === "voci_a_posto") detail = i.required === 0 ? (i.audience === "ls" ? "nessuna domanda indispensabile: controlla la regola in Diagnostica" : null) : `mancano ${n(Math.max(0, i.required - i.ok))}`;
        else if (c.key === "deroghe_entro_limite") detail = `${n(i.waivers.used)} su ${n(i.waivers.cap)}`;
        else {
          const count = leadingCount(c.message);
          detail = count === null ? null : n(count);
        }
      }
      return { key: c.key, label: known?.label ?? (stripLegalRefs(c.message).replace(/\.$/, "") || c.key), detail, ok: c.ok, segment: known?.segment ?? null };
    });
  return { open: views.filter((v) => !v.ok), done: views.filter((v) => v.ok) };
}

/** «4 condizioni già a posto», «Le 5 condizioni sono a posto» quando non manca nulla. */
export function doneConditionsText(done: number, open: number): string {
  if (open === 0) return done === 1 ? "La condizione è a posto" : `Le ${n(done)} condizioni sono a posto`;
  return done === 1 ? "1 condizione già a posto" : `${n(done)} condizioni già a posto`;
}

export interface ViaSignatureLine {
  side: "ls" | "cliente";
  label: string;
  /** «Firmato il 3 ott», «Firmato il 3 ott dal link» oppure «Da firmare». */
  text: string;
  signed: boolean;
}

/** Le firme del via per i due lati (DESIGN §3.5, «Firme»): Lateral Space e cliente, senza nomi. */
export function viaSignatures(signatures: readonly { ruolo: string; at: string; metodo: string }[], now: Date): ViaSignatureLine[] {
  const line = (side: "ls" | "cliente", label: string): ViaSignatureLine => {
    const sig = signatures.find((s) => signatureSideOf(s.ruolo as CaseRole) === side);
    if (!sig) return { side, label, text: "Da firmare", signed: false };
    const day = formatDayIt(sig.at, { now });
    return { side, label, text: `Firmato${day ? ` ${dayWithArticle("il", day)}` : ""}${sig.metodo === "link" ? " dal link" : ""}`, signed: true };
  };
  return [line("ls", "Lateral Space"), line("cliente", "Cliente")];
}

/**
 * Le firme che «Firme» mostra: quelle della proposta aperta; senza proposta,
 * quelle dell'ultima approvazione, anche quando il via è da riconfermare o il
 * caso è chiuso (le due parti hanno firmato davvero). Senza né l'una né
 * l'altra, nessuna.
 */
export function viaShownSignatures<S>(pending: { signatures: readonly S[] } | null, reviews: readonly { decision: string; decidedAt: string | null; signatures: readonly S[] }[]): readonly S[] {
  if (pending) return pending.signatures;
  return latestApprovedReview(reviews)?.signatures ?? [];
}

/** Sotto «Firme», sui casi a contratto con la proposta aperta senza la prova scritta (DESIGN §3.5, «Prova scritta»). */
export const VIA_EVIDENCE_MISSING = "Manca la prova scritta (email o verbale).";

/**
 * L'azione della pagina `/via` per chi guarda, dalla tabella «Primario per
 * stato» di DESIGN §3.5:
 * - `proponi`: il responsabile Lateral Space, in bozza o in preparazione,
 *   senza proposta; spenta finché il via non è pronto (in bozza sempre), con
 *   il motivo sotto;
 * - `firma_ls`: proposta aperta senza la firma di Lateral Space;
 * - `manda_link`: Lateral Space ha firmato, il cliente no (il pulsante solo
 *   se il link si può mandare, la riga sempre); `attachEvidence`: sui casi a
 *   contratto senza la prova scritta si può già allegarla, così la firma dal
 *   link chiude il via;
 * - `firma_cliente`: il responsabile del cliente deve firmare; c'è anche «Non
 *   approvo»;
 * - `allega_prova`: le due parti hanno firmato ma manca la prova scritta (caso
 *   a contratto); chi ha firmato la allega e il via si chiude;
 * - `nessuna`: approvato («Approvato il 3 ott · catalogo v1», con la riga per
 *   il via da riconfermare), oppure chi guarda non ha nulla da fare qui.
 */
export type ViaAction =
  | { kind: "proponi"; disabled: boolean; note: string | null }
  | { kind: "firma_ls"; note: null }
  | { kind: "manda_link"; canSend: boolean; attachEvidence: boolean; note: string }
  | { kind: "firma_cliente"; note: null }
  | { kind: "allega_prova"; note: string }
  | { kind: "nessuna"; note: string | null };

/** La riga del via da riconfermare, dopo «Approvato il 3 ott · catalogo v1». */
export const VIA_RECONFIRM_NOTE = "Si riconferma quando le domande indispensabili tornano a posto.";

export function viaAction(i: {
  roles: readonly CaseRole[];
  /** Può firmare e proporre adesso: non in sola lettura, caso non chiuso né in pausa. */
  signable: boolean;
  status: CaseStatus;
  statusBeforeSuspension: CaseStatus | null;
  ready: boolean;
  required: number;
  ok: number;
  pending: { signatures: readonly { ruolo: string; at: string }[] } | null;
  /** Caso a contratto con la proposta aperta senza la prova scritta: l'approvazione la aspetta (`checkGateSignature`). */
  evidenceMissing: boolean;
  /** Il via è oltre la preparazione ma le indispensabili non sono più tutte a posto. */
  reconfirm: boolean;
  /** Il link per firmare si può mandare (responsabile del cliente designato, email configurata). */
  canSendLink: boolean;
  /** L'ultima approvazione, dallo storico; null se il via non è mai stato approvato. */
  approved: { at: Date | string | null; catalogVersion: number | null } | null;
  now: Date;
}): ViaAction {
  const lead = i.roles.includes("ls_lead");
  const owner = i.roles.includes("owner_cliente");
  // Oltre il via, oppure chiuso dopo il via: la data e il catalogo, e per il via da riconfermare come tornare a posto.
  if (!i.pending && (isCasePastG1(i.status, i.statusBeforeSuspension) || (i.status === "chiuso" && i.approved))) {
    const day = i.approved ? formatDayIt(i.approved.at, { now: i.now }) : null;
    const parts = [day ? `Approvato ${dayWithArticle("il", day)}` : "Approvato", i.approved?.catalogVersion ? `catalogo v${i.approved.catalogVersion}` : null].filter(Boolean);
    const approvedText = parts.join(" · ");
    return { kind: "nessuna", note: i.reconfirm && i.status !== "chiuso" ? `${approvedText}. ${VIA_RECONFIRM_NOTE}` : approvedText };
  }
  if (!i.signable) return { kind: "nessuna", note: null };
  if (i.pending) {
    const ls = i.pending.signatures.find((s) => signatureSideOf(s.ruolo as CaseRole) === "ls");
    const client = i.pending.signatures.some((s) => signatureSideOf(s.ruolo as CaseRole) === "cliente");
    if (lead && !ls) return { kind: "firma_ls", note: null };
    if (lead && ls && !client) {
      const day = formatDayIt(ls.at, { now: i.now });
      return {
        kind: "manda_link",
        canSend: i.canSendLink,
        attachEvidence: i.evidenceMissing,
        note: `${day ? `Hai firmato ${dayWithArticle("il", day)}.` : "Hai firmato."} Manca il responsabile del cliente.`,
      };
    }
    if (owner && !client) return { kind: "firma_cliente", note: null };
    // Le due firme ci sono, la prova scritta no: chi ha firmato la allega (il server accetta la sola prova da chi ha già firmato).
    if (i.evidenceMissing && ls && client && (lead || owner)) return { kind: "allega_prova", note: "Hanno firmato tutti e due: allega la prova scritta per chiudere il via." };
    return { kind: "nessuna", note: null };
  }
  if (lead && (i.status === "raccolta" || i.status === "bozza")) {
    // In bozza il via non si propone (`caseAllowsGate`): il pulsante c'è, spento, con il motivo sotto.
    if (i.ready && i.status === "raccolta") return { kind: "proponi", disabled: false, note: null };
    const note =
      i.required > 0 && i.ok < i.required
        ? i.required === 1
          ? "Si accende quando la domanda indispensabile è a posto."
          : `Si accende quando tutte le ${n(i.required)} domande indispensabili sono a posto.`
        : i.status === "bozza"
          ? "Si accende con la prima richiesta a un referente."
          : "Si accende quando tutte le condizioni qui sopra sono a posto.";
    return { kind: "proponi", disabled: true, note };
  }
  return { kind: "nessuna", note: null };
}

/** I tre comandi del via che arrivano anche al responsabile del cliente. */
export type ViaCommand = "proponi" | "firma" | "rifiuta";

const SIGNERS_ONLY = "Firmano solo il responsabile Lateral Space e il responsabile del cliente.";
const PROPOSES_ONLY = "Solo il responsabile Lateral Space propone il via allo sviluppo.";

/** Messaggi degli errori del via, per codice: niente gate, G1 né «Owner». */
const VIA_FAILURE_MESSAGE: Readonly<Record<string, string | Readonly<Record<ViaCommand, string>>>> = {
  gate_non_pronto: "Il via allo sviluppo non è pronto: guarda cosa serve ancora.",
  testo_cambiato: "Le domande del via sono cambiate dalla proposta: va proposto di nuovo.",
  gate_gia_deciso: "Su questa proposta c'è già una decisione.",
  gate_non_disponibile: "Questo passaggio non è ancora disponibile.",
  regola_gate_da_confermare: "La regola del via va confermata prima di approvare.",
  stato_caso_non_ammesso: "In questo stato del caso il via allo sviluppo non si propone né si firma.",
  proposta_aperta: "C'è già una proposta in attesa delle firme.",
  firmatario_non_ammesso: SIGNERS_ONLY,
  attore_non_ammesso: { proponi: PROPOSES_ONLY, firma: SIGNERS_ONLY, rifiuta: "Rispondono alla proposta solo il responsabile Lateral Space e il responsabile del cliente." },
  ruolo_non_ammesso: { proponi: PROPOSES_ONLY, firma: SIGNERS_ONLY, rifiuta: SIGNERS_ONLY },
};

/**
 * Il messaggio di un errore di proposta, firma o «Non approvo» nelle parole di
 * §2.6. I codici senza un testo qui tengono il loro (conflitto, prova scritta,
 * firma già presente, stessa persona: già in italiano semplice).
 */
export function viaFailureMessage(command: ViaCommand, failure: { code: string; message: string }): string {
  const known = VIA_FAILURE_MESSAGE[failure.code];
  if (!known) return failure.message;
  return typeof known === "string" ? known : known[command];
}

/** Avviso solo per Lateral Space sui casi a contratto con la regola non ancora confermata (DESIGN §3.5). */
export const VIA_RULE_TO_CONFIRM = "Regola da confermare: è un caso a contratto, va confermata prima di proporre il via.";

/** Il suggerimento accanto al selettore della prova scritta (DESIGN §3.5). */
export const VIA_EVIDENCE_HINT = "Carica prima il file in Domande › Documenti.";

// ── Come funziona ─────────────────────────────────────────────────────

/** La regola del via in parole semplici, per regola del caso. */
export const VIA_RULE_TEXT: Readonly<Record<GatePolicyScope, string>> = {
  request_modules: "Si parte quando tutte le domande indispensabili degli argomenti, nel contratto, sono a posto: con una risposta verificata oppure con una delle tre eccezioni qui sotto.",
  letterale: "Si parte quando tutti gli elementi indispensabili del modello dati, nel contratto, sono a posto: con una risposta verificata oppure con una delle tre eccezioni qui sotto.",
  unione: "Si parte quando sono a posto sia le domande indispensabili degli argomenti sia gli elementi indispensabili del modello dati, nel contratto: con una risposta verificata oppure con una delle tre eccezioni qui sotto.",
};

/** Le tre eccezioni, ognuna con le due firme. */
export const VIA_EXCEPTIONS: readonly { label: string; text: string }[] = [
  { label: WORDS.nonSiApplica, text: "La domanda non vale per questo caso. Lo firmano Lateral Space e il cliente." },
  {
    label: WORDS.partireSenzaRisposta,
    text: "Si parte senza la risposta, con il motivo, il piano e la data per chiuderla. Al massimo una domanda su dieci, mai sui dati personali o sulle regole di legge.",
  },
  { label: WORDS.soluzioneProvvisoria, text: "Una domanda ferma per un blocco si sostituisce con un'alternativa, fino a una data stabilita. La firmano tutti e due." },
];

/** Chi firma il via (§2.6). */
export const VIA_SIGNERS_TEXT = SIGNERS_TEXT;

/** Che cosa succede con il via approvato. */
export const VIA_AFTER_TEXT = "Con le due firme il catalogo si congela in una versione: è quello su cui si sviluppa.";

// ── Storico ───────────────────────────────────────────────────────────

/**
 * Le decisioni sulle proposte. «Respinto» vale sia per «Non approvo» del
 * cliente sia per la proposta ritirata da Lateral Space: senza sapere chi ha
 * chiuso, una parola neutra (`REJECTED_BY_LABEL` quando si sa).
 */
export const GATE_DECISION_LABEL: Readonly<Record<string, string>> = {
  proposto: "In attesa delle firme",
  approvato: "Approvato",
  approvato_con_riserva: "Approvato con eccezioni",
  respinto: "Chiuso senza approvazione",
};

/** Chi ha chiuso la proposta senza approvarla (`ruolo` dell'evento `gate.respinto`). */
export const REJECTED_BY_LABEL: Readonly<Record<string, string>> = {
  ls_lead: "Proposta ritirata da Lateral Space",
  owner_cliente: "Non approvato dal cliente",
};

/** Ruoli di chi firma il via: sono quelli di §2.6 (`ROLE_LABEL`). */
export const SIGNATURE_ROLE_LABEL: Readonly<Record<string, string>> = {
  ls_lead: ROLE_LABEL.ls_lead,
  owner_cliente: ROLE_LABEL.owner_cliente,
  approvatore_privacy: ROLE_LABEL.approvatore_privacy,
};

export const CATALOG_VERSION_REASON_LABEL: Readonly<Record<string, string>> = {
  gate: "Via allo sviluppo approvato",
  correzione: "Correzione dopo il via",
};

export interface ReviewLike {
  id: string;
  decision: string;
  proposedAt: string | null;
  decidedAt: string | null;
  catalogVersion: number | null;
  signatures: readonly { ruolo: string; at: string; metodo: string }[];
  /** Per le proposte respinte: il ruolo di chi le ha chiuse (`ls_lead` le ritira, `owner_cliente` non approva). */
  rejectedBy?: string | null;
}

/** La decisione in parole: per una proposta respinta dice chi l'ha chiusa, quando si sa. */
export function reviewDecisionLabel(r: Pick<ReviewLike, "decision" | "rejectedBy">): string {
  if (r.decision === "respinto" && r.rejectedBy && REJECTED_BY_LABEL[r.rejectedBy]) return REJECTED_BY_LABEL[r.rejectedBy];
  return GATE_DECISION_LABEL[r.decision] ?? r.decision;
}

/**
 * Una riga dello storico: «Via allo sviluppo · Approvato · catalogo v1», poi
 * date e firme per ruolo, senza nomi. Una proposta ritirata da Lateral Space
 * non si legge come un rifiuto del cliente.
 */
export function reviewHistoryRow(r: ReviewLike, now: Date): { id: string; title: string; detail: string } {
  const title = [WORDS.via, reviewDecisionLabel(r), r.catalogVersion ? `catalogo v${r.catalogVersion}` : null].filter(Boolean).join(" · ");
  const proposed = formatDayIt(r.proposedAt, { now });
  const decided = formatDayIt(r.decidedAt, { now });
  const parts: string[] = [];
  if (proposed) parts.push(`Proposto ${dayWithArticle("il", proposed)}${decided ? `, deciso ${dayWithArticle("il", decided)}` : ""}`);
  else if (decided) parts.push(`Deciso ${dayWithArticle("il", decided)}`);
  if (r.signatures.length > 0) {
    parts.push(
      `firme: ${r.signatures
        .map((s) => {
          const day = formatDayIt(s.at, { now });
          const extra = [day, s.metodo === "link" ? "dal link" : null].filter(Boolean).join(", ");
          return `${SIGNATURE_ROLE_LABEL[s.ruolo] ?? "Firma"}${extra ? ` (${extra})` : ""}`;
        })
        .join(", ")}`,
    );
  }
  return { id: r.id, title, detail: parts.join(" · ") };
}

/** La proposta approvata più recente (per data della decisione), oppure null. */
export function latestApprovedReview<R extends { decision: string; decidedAt: string | null }>(reviews: readonly R[]): R | null {
  const approved = reviews.filter((r) => r.decision === "approvato" || r.decision === "approvato_con_riserva");
  if (approved.length === 0) return null;
  return [...approved].sort((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? ""))[0];
}

/** L'ultima approvazione del via: quando e su quale catalogo. */
export function latestApproval(reviews: readonly ReviewLike[]): { at: string | null; catalogVersion: number | null } | null {
  const last = latestApprovedReview(reviews);
  return last ? { at: last.decidedAt, catalogVersion: last.catalogVersion } : null;
}

/** «Catalogo v1 · Via allo sviluppo approvato» e «3 ott · 12 aggiunte, 0 cambiate, 0 tolte». */
export function catalogVersionRow(
  v: { version: number; reason: string; createdAt: string | null; changeNote: string | null; diff: { added: number; changed: number; removed: number } },
  now: Date,
): { title: string; detail: string } {
  const day = formatDayIt(v.createdAt, { now });
  const diff = `${n(v.diff.added)} ${v.diff.added === 1 ? "aggiunta" : "aggiunte"}, ${n(v.diff.changed)} ${v.diff.changed === 1 ? "cambiata" : "cambiate"}, ${n(v.diff.removed)} ${v.diff.removed === 1 ? "tolta" : "tolte"}`;
  return {
    title: `Catalogo v${v.version} · ${CATALOG_VERSION_REASON_LABEL[v.reason] ?? "Nuova versione"}`,
    detail: [day, diff, v.changeNote].filter(Boolean).join(" · "),
  };
}

// ── Diagnostica (solo Lateral Space) ──────────────────────────────────

/** La copertura del modello dati in una frase: un indicatore, il via non cambia. */
export function coverageText(c: { literalRequired: number; coveredByQuestions: number; ok: number }): string {
  return `Il modello dati chiede ${n(c.literalRequired)} elementi indispensabili. Le domande ne coprono ${n(c.coveredByQuestions)}; ${n(c.ok)} sono a posto.`;
}

/** Quali domande contano per il via, per regola del caso (Diagnostica). */
export const VIA_POLICY_TEXT: Readonly<Record<GatePolicyScope, string>> = {
  request_modules: "Le domande indispensabili degli argomenti, nel contratto e utili al modello.",
  letterale: "Tutti gli elementi indispensabili del modello dati, alla lettera della regola.",
  unione: "Le domande degli argomenti e gli elementi indispensabili del modello dati, insieme.",
};

/** «2 partenze senza risposta su un massimo di 24 · Utili e facoltative: 30 di 80 a posto.» */
export function exceptionsText(i: { waivers: { used: number; cap: number }; should: { total: number; ok: number } }): string {
  const used = i.waivers.used === 1 ? "1 partenza senza risposta" : `${n(i.waivers.used)} partenze senza risposta`;
  const should = i.should.total > 0 ? ` Utili e facoltative (non fermano il via): ${n(i.should.ok)} di ${n(i.should.total)} a posto.` : "";
  return `${used} su un massimo di ${n(i.waivers.cap)}.${should}`;
}
