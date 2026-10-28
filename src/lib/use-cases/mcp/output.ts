/**
 * Le uscite dei tool di lettura e di scrittura del MCP del team (docs/use-case/DESIGN.md §9.4),
 * costruite dalle proiezioni dei revisori della pagina (`HubItem`, `UseCaseDetail` di
 * `views.ts`): Claude e la pagina vedono la stessa fase, lo stesso Valore e lo stesso costo con
 * la sua fonte, con le fasce del workspace (D15).
 *
 * Ogni uscita si costruisce campo per campo da un elenco: nessuno spread della proiezione.
 * Così il proponente non esce mai, nemmeno quando chi chiama gestisce il workspace e la sua
 * proiezione lo porta (art. 15.4, `art15-4.mcp.test.ts`). Nessuna Storia per persona.
 *
 * Ogni codice che Claude può riferire a una persona ha accanto la sua etichetta, quella della
 * pagina (`labels.ts`): fase, parola e fonte del Valore, fonte del costo («stimato
 * dall'impegno», mai «sforzo»), zona. I giorni di attesa valgono solo per «Da decidere» (D8,
 * §4.3, §4.6): per le altre fasi sono null.
 *
 * «Benefici e costi» (spec di Pierpaolo, 25/10/2026): Valore e costo portano anche la forma
 * corta con la parola (`text`: «Basso · 4.043 €/anno», «avvio 560 € · ricorrenti 600 €/anno ·
 * team»); la pagina, con una cifra in euro, scrive solo la cifra (`valueScreenText`).
 * `get_use_case` dà il modello salvato e i conti (`computedOutput`), calcolati in lettura con le
 * ipotesi del workspace, arrotondati al centesimo solo qui. «Cosa serve»
 * (`needOutput`) arriva solo ai revisori: le letture dei tool lo chiedono con la loro persona.
 *
 * Modulo puro: import relativi `.ts`; gira con `node --test`.
 */
import type { ConnectorStatusCode } from "../../connector/status.ts";
import { CONNECTOR_STATUS_LABEL } from "../../connector/status.ts";
import { CASE_STATUS_LABEL } from "../../uc/case-state.ts";
import type { CostBandInfo } from "../cost-bands.ts";
import { costBandSymbol, costShortText, oneoffRunText, valueShortText, valueWordText, zoneText, type ValueParts } from "../format.ts";
import {
  COST_SOURCE_LABEL,
  RISK_LABEL,
  VALUE_EUR_SOURCE_LABEL,
  VALUE_SOURCE_LABEL,
  type RiskChip,
  type Zone,
} from "../labels.ts";
import {
  NEED_AREAS,
  NEED_AVAILABILITY_LABEL,
  NEED_KIND_LABEL,
  NEED_OWNER_SIDE_LABEL,
  NEED_TYPE_LABEL,
  isNeedDone,
  needAreaOf,
  needDueText,
  needStatusView,
  type NeedUseCaseRef,
  type NeedView,
} from "../needs.ts";
import { PHASE_LABEL, SUB_STATE_LABEL, VALUED_PILL } from "../phase.ts";
import { quarterLabel, whenLabel } from "../quarter.ts";
import type { Phase, SubState } from "../types.ts";
import type { CostFigure, Dimension, KpiScoreMap, ValuationModel, ValueFigure } from "../valuation.ts";
import { monthLabel, valueTotals, type PlannedMonths, type PlanSource } from "../value-calc.ts";
import { LEVER_LABELS, VALUE_COMPONENT_KIND_LABELS, VALUE_CONFIDENCE_LABELS, type ValueModel, type ValueParams } from "../value-model.ts";
import { REVIEWER_INTAKE_KEYS, isToDecide, waitingDays, type HubDossier, type HubItem, type UseCaseDetail } from "../views.ts";

// ─── Pezzi comuni ────────────────────────────────────────────────────

/** Il link assoluto alla scheda, per Claude («Apri in Unbundle»). */
export function linkToUseCase(appOrigin: string, workspaceId: string, useCaseId: string): string {
  return `${appOrigin.replace(/\/+$/, "")}/dashboard/${workspaceId}/use-cases/${useCaseId}`;
}

function round1(value: number | null): number | null {
  return value === null || !Number.isFinite(value) ? null : Math.round(value * 10) / 10;
}

/** Un importo o delle ore al centesimo: i conti di «Benefici e costi» non portano code di virgola mobile. */
function cents(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

function centsOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? cents(value) : null;
}

export interface ValueOutput {
  word: ValueFigure["word"];
  /** «Alto», «Medio», «Basso»; con «Benefici e costi» senza beneficio contato «da misurare» o «qualitativo»; altrimenti «da stimare». */
  wordLabel: string;
  score: number | null;
  source: ValueFigure["source"];
  /** «team» o «AI»; null senza punteggio. */
  sourceLabel: string | null;
  /**
   * La forma corta con la parola («Basso · 4.043 €/anno»); la pagina, con una cifra in euro, scrive
   * solo la cifra (`valueScreenText`). Altrimenti «da misurare · fino a 5.840 €», «qualitativo»,
   * «Alto», «da stimare».
   */
  text: string;
}

/** Valore (§7.1): parola, punteggio da 1 a 5 (una cifra decimale) e fonte, con le etichette; codici null se «da stimare». */
export function valueOutput(value: ValueFigure): ValueOutput {
  return {
    word: value.word,
    wordLabel: valueWordText(value),
    score: round1(value.score),
    source: value.source,
    sourceLabel: value.source ? VALUE_SOURCE_LABEL[value.source] : null,
    text: valueShortText(value),
  };
}

export interface CostOutput {
  symbols: string;
  /** Importo in euro (dossier, team o avvio di «Benefici e costi»); null quando il costo è una fascia. */
  amount: number | null;
  band: number;
  bandLabel: string;
  source: CostFigure["source"];
  /** La fonte come nella scheda: «dal dossier», «stima del team», «importo del team», «fascia del team», «stimato dall'impegno». */
  sourceLabel: string;
  /** Solo con «Benefici e costi» (fonte «stima»): i costi ricorrenti, euro all'anno; altrimenti null. */
  runEurYear: number | null;
  /** La forma corta della pagina: «€€ · 40.000 € · team», «avvio 560 € · ricorrenti 600 €/anno» (la fonte è in `sourceLabel`). */
  text: string;
}

/** Costo di realizzazione (§7.2) con la sua fonte e la fascia del workspace; null se «da stimare». */
export function costOutput(cost: CostFigure | null, bands: readonly CostBandInfo[]): CostOutput | null {
  if (!cost) return null;
  const info = bands[cost.band - 1];
  return {
    symbols: costBandSymbol(cost.band, bands),
    amount: centsOrNull(cost.amount),
    band: cost.band,
    bandLabel: cost.bandLabel ?? info?.label ?? "",
    source: cost.source,
    sourceLabel: COST_SOURCE_LABEL[cost.source].long,
    runEurYear: cost.source === "stima" ? centsOrNull(cost.runEurYear) : null,
    text: costShortText(cost, bands),
  };
}

/**
 * La zona della matrice (§7.4) come nella pagina (`zoneText`): «da stimare» senza Valore o costo,
 * «senza beneficio contato» per una scheda con «Benefici e costi» senza beneficio contato.
 */
export function zoneLabel(zone: Zone | null, value?: Pick<ValueParts, "benefits"> | null): string {
  return zoneText(zone, value);
}

/** Giorni di attesa (D8): solo per «Da decidere»; null per ogni altra fase. */
export function waitingDaysOutput(item: Pick<HubItem, "phase" | "subState" | "waitingSince">, today: string): number | null {
  return isToDecide({ phase: item.phase, subState: item.subState }) ? waitingDays(item.waitingSince, today) : null;
}

// ─── Aree della guida del connettore ─────────────────────────────────

export interface AreaOption {
  /** Il valore da scrivere in `area` (quello che il servizio controlla). */
  id: string;
  /** Il titolo che la pagina mostra nel menu. */
  label: string;
}

function trimmedText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Le aree della guida del connettore del workspace (`workspace_connector_configs.guide.areas`),
 * con la stessa lettura tollerante del servizio (`guideAreas`) e del menu della scheda
 * (`guideLabels`): stringhe, oppure oggetti con `id` e il titolo in `label`, `nome` o `name`.
 * null se la guida non ha un elenco: allora l'area è un testo libero.
 */
export function guideAreaOptions(guide: unknown): AreaOption[] | null {
  const areas = guide && typeof guide === "object" && !Array.isArray(guide) ? (guide as Record<string, unknown>).areas : null;
  if (!Array.isArray(areas)) return null;
  const seen = new Set<string>();
  const out: AreaOption[] = [];
  for (const entry of areas) {
    const item = entry && typeof entry === "object" && !Array.isArray(entry) ? (entry as Record<string, unknown>) : null;
    const id = typeof entry === "string" ? entry : typeof item?.id === "string" ? item.id : null;
    if (id === null || !id.trim() || seen.has(id)) continue;
    seen.add(id);
    const label = item ? ["label", "nome", "name"].map((key) => trimmedText(item[key])).find((value) => value !== null) : null;
    out.push({ id, label: label ?? id.trim() });
  }
  return out.length ? out : null;
}

/** Le 5 fasce del costo del workspace (D15): indice, simbolo ed etichetta. */
export function costBandsOutput(bands: readonly CostBandInfo[]): Array<{ band: number; symbol: string; label: string }> {
  return bands.map((info) => ({ band: info.band, symbol: info.symbol, label: info.label }));
}

// ─── search_use_cases ────────────────────────────────────────────────

export interface SearchItemOutput {
  code: string | null;
  title: string;
  origin: HubItem["origin"];
  kind: HubItem["kind"];
  phase: HubItem["phase"];
  subState: HubItem["subState"];
  phaseLabel: string;
  quando: string | null;
  valore: ValueOutput;
  costo: CostOutput | null;
  zone: HubItem["zone"];
  zoneLabel: string;
  /** Solo per «Da decidere»; null per le altre fasi. */
  waitingDays: number | null;
  hiddenFromSearch: boolean;
}

/** Una riga di `search_use_cases`. */
export function searchItemOutput(item: HubItem, bands: readonly CostBandInfo[], today: string): SearchItemOutput {
  return {
    code: item.code,
    title: item.title,
    origin: item.origin,
    kind: item.kind,
    phase: item.phase,
    subState: item.subState,
    phaseLabel: item.phaseLabel,
    quando: item.quando,
    valore: valueOutput(item.value),
    costo: costOutput(item.cost, bands),
    zone: item.zone,
    zoneLabel: zoneLabel(item.zone, item.value),
    waitingDays: waitingDaysOutput(item, today),
    hiddenFromSearch: item.hiddenFromSearch,
  };
}

// ─── get_use_case ────────────────────────────────────────────────────

/** Le chiavi tecniche di `intake`: hanno un campo loro nella scheda. */
const TECHNICAL_INTAKE_KEYS = new Set(["contractVersion", "guideVersion", "area", "possibleDuplicateOf", "hiddenFromSearch", "archiveReason", "duplicateOfCode"]);

/**
 * I dati raccolti da Claude (e le risposte a «Serve info»), da un elenco di ciò che si può dare:
 * le chiavi dei revisori (`REVIEWER_INTAKE_KEYS`) tranne le tecniche. Ogni altra chiave, anche
 * un recapito di chi ha proposto, resta fuori.
 */
export const COLLECTED_INTAKE_KEYS: readonly string[] = Object.freeze(REVIEWER_INTAKE_KEYS.filter((key) => !TECHNICAL_INTAKE_KEYS.has(key)));

function collectedData(intake: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!intake) return null;
  const out: Record<string, unknown> = {};
  for (const key of COLLECTED_INTAKE_KEYS) if (Object.prototype.hasOwnProperty.call(intake, key)) out[key] = intake[key];
  return Object.keys(out).length ? out : null;
}

/** L'etichetta di un KPI come la scrive il modello; lo sforzo del modello predefinito si chiama «Sforzo». */
export function kpiLabel(kpi: { id: string; label?: unknown }): string {
  const label = typeof kpi.label === "string" && kpi.label.trim() ? kpi.label.trim() : kpi.id;
  return /^effort$/i.test(label) ? "Sforzo" : label;
}

function score(map: KpiScoreMap | null | undefined, dimension: Dimension, id: string): number | null {
  const dim = map?.[dimension];
  if (!dim || typeof dim !== "object" || !Object.prototype.hasOwnProperty.call(dim, id)) return null;
  const value = (dim as Record<string, unknown>)[id];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.max(1, Math.min(5, value)) : null;
}

export interface KpiOutput {
  dimension: Dimension;
  id: string;
  label: string;
  /** Valore del team (una persona); null se manca. */
  team: number | null;
  /** Valore del suggerimento AI; null se manca. Conta la valutazione del team. */
  ai: number | null;
}

/** I KPI del modello del workspace (ESG solo se attivo), con il valore del team e quello dell'AI. */
export function kpiOutputs(
  model: Pick<ValuationModel, "dimensions">,
  esgEnabled: boolean,
  customScores: KpiScoreMap | null,
  aiScores: KpiScoreMap | null,
): KpiOutput[] {
  const dimensions: Dimension[] = esgEnabled ? ["impact", "feasibility", "esg"] : ["impact", "feasibility"];
  return dimensions.flatMap((dimension) =>
    (model.dimensions[dimension] ?? []).map((kpi) => ({
      dimension,
      id: kpi.id,
      label: kpiLabel(kpi as { id: string; label?: unknown }),
      team: score(customScores, dimension, kpi.id),
      ai: score(aiScores, dimension, kpi.id),
    })),
  );
}

/** I soli numeri del suggerimento AI, per dimensione. */
function aiScoresOutput(scores: KpiScoreMap | null): Record<string, Record<string, number>> | null {
  if (!scores) return null;
  const out: Record<string, Record<string, number>> = {};
  for (const [dimension, values] of Object.entries(scores)) {
    if (!values || typeof values !== "object") continue;
    for (const [id, value] of Object.entries(values)) {
      if (typeof value === "number" && Number.isFinite(value)) (out[dimension] ??= {})[id] = value;
    }
  }
  return Object.keys(out).length ? out : null;
}

export type DossierRead = "ok" | "spenta" | "errore";

function dossierOutput(dossier: HubDossier | null) {
  if (!dossier) return null;
  return {
    code: dossier.code,
    status: dossier.status,
    statusLabel: Object.hasOwn(CASE_STATUS_LABEL, dossier.status) ? CASE_STATUS_LABEL[dossier.status] : null,
    readiness: dossier.readiness ? { required: dossier.readiness.required, ok: dossier.readiness.ok } : null,
  };
}

export const CLAUDE_ESTIMATE_NOTE = "Stima di Claude, non ufficiale: conta la valutazione del team.";

export interface CardOutputContext {
  model: Pick<ValuationModel, "dimensions">;
  costBands: readonly CostBandInfo[];
  esgEnabled: boolean;
  today: string;
  dossierRead: DossierRead;
  link: string;
  /** Le aree della guida del connettore; null se l'area è un testo libero. */
  areaOptions?: readonly AreaOption[] | null;
  /** Le ipotesi di calcolo del workspace: senza, niente conti di «Benefici e costi». */
  valueParams?: ValueParams | null;
  /** I mesi di avvio e di entrata in uso della scheda (approvata o in realizzazione, con un modello). */
  plan?: PlannedMonths | null;
}

/** La scheda di `get_use_case` (e di `update_use_case` dopo la scrittura). */
export function cardOutput(detail: UseCaseDetail, ctx: CardOutputContext) {
  const hours = detail.claudeHoursPerYear;
  return {
    code: detail.code,
    title: detail.title,
    origin: detail.origin,
    kind: detail.kind,
    phase: detail.phase,
    subState: detail.subState,
    phaseLabel: detail.phaseLabel,
    quando: detail.quando,
    targetQuarter: detail.targetQuarter,
    reviewBy: detail.reviewBy,
    waitingDays: waitingDaysOutput(detail, ctx.today),
    texts: {
      problem: detail.description,
      flowDescription: detail.flowDescription,
      humanInTheLoop: detail.humanInTheLoop,
      guardrails: detail.guardrails,
      expectedImpact: detail.businessCase,
      dataRequirements: detail.dataRequirements,
      sustainabilityImpact: detail.sustainabilityImpact,
    },
    area: detail.area,
    areaOptions: ctx.areaOptions ? ctx.areaOptions.map((option) => ({ id: option.id, label: option.label })) : null,
    aiLab: detail.aiLab,
    publicNote: detail.publicNote,
    hiddenFromSearch: detail.hiddenFromSearch,
    possibleDuplicateOf: detail.possibleDuplicateOf,
    collected: collectedData(detail.intake),
    valuation: {
      valore: {
        ...valueOutput(detail.value),
        perYear: detail.value.perYear
          ? { amount: detail.value.perYear.amount, source: detail.value.perYear.source, sourceLabel: VALUE_EUR_SOURCE_LABEL[detail.value.perYear.source].long }
          : null,
      },
      costo: costOutput(detail.cost, ctx.costBands),
      zone: detail.zone,
      zoneLabel: zoneLabel(detail.zone, detail.value),
      kpis: kpiOutputs(ctx.model, ctx.esgEnabled, detail.customScores, detail.aiSuggestion?.scores ?? null),
      teamValueEurYear: detail.valueEurYear,
      teamCost: detail.costEurOnce !== null ? { eurOnce: detail.costEurOnce } : detail.costBand !== null ? { band: detail.costBand } : null,
      /** «Benefici e costi» salvato (lo schema di `update_use_case`); null senza modello. */
      model: detail.valueModel ?? null,
      /** I conti del modello con le ipotesi del workspace; null senza modello. */
      computed:
        detail.valueModel && ctx.valueParams
          ? computedOutput(detail.valueModel, { params: ctx.valueParams, value: detail.value, cost: detail.cost, costBands: ctx.costBands, plan: ctx.plan })
          : null,
    },
    claudeEstimate: hours === null ? null : { hoursPerYear: hours, note: CLAUDE_ESTIMATE_NOTE },
    aiSuggestion: detail.aiSuggestion
      ? { scores: aiScoresOutput(detail.aiSuggestion.scores), rationale: detail.aiSuggestion.rationale, model: detail.aiSuggestion.model, at: detail.aiSuggestion.at }
      : null,
    risks: detail.risks.map((id: RiskChip) => ({ id, label: RISK_LABEL[id] })),
    realization: { read: ctx.dossierRead, dossier: dossierOutput(detail.dossier) },
    costBands: costBandsOutput(ctx.costBands),
    version: detail.version,
    link: ctx.link,
  };
}

export type CardOutput = ReturnType<typeof cardOutput>;


// ─── «Benefici e costi» ──────────────────────────────────────────────

/** Da dove vengono i mesi del piano, a parole. */
export const PLAN_SOURCE_LABEL: Readonly<Record<PlanSource, string>> = Object.freeze({
  piano: "i mesi della scheda",
  trimestre: "il trimestre approvato",
  origine: "il primo mese delle ipotesi",
  piu_avanti: "più avanti: dopo l'ultimo trimestre usato",
});

export interface PlanOutput {
  startMonth: string;
  goLiveMonth: string;
  /** «nov 26». */
  startLabel: string;
  goLiveLabel: string;
  source: PlanSource;
  sourceLabel: string;
}

export function planOutput(planned: PlannedMonths | null | undefined): PlanOutput | null {
  if (!planned) return null;
  return {
    startMonth: planned.startMonth,
    goLiveMonth: planned.goLiveMonth,
    startLabel: monthLabel(planned.startMonth),
    goLiveLabel: monthLabel(planned.goLiveMonth),
    source: planned.source,
    sourceLabel: PLAN_SOURCE_LABEL[planned.source],
  };
}

/**
 * I conti di «Benefici e costi» di una scheda, come la pagina (`value-calc.ts`): beneficio
 * contato, ore, da misurare, avvio, ricorrenti, netto, parola e punteggio (quelli del Valore della
 * scheda), fascia del costo di avvio, conti per tipo di ritorno e per voce, mesi del piano e le
 * ipotesi usate. Calcolati in lettura, mai salvati; al centesimo.
 */
export function computedOutput(
  model: ValueModel,
  ctx: { params: ValueParams; value: ValueFigure; cost: CostFigure | null; costBands: readonly CostBandInfo[]; plan?: PlannedMonths | null },
) {
  const totals = valueTotals(model, ctx.params);
  const state = ctx.value.benefits?.state ?? (totals.benefit > 0 ? "contato" : totals.pendingEur > 0 ? "da_misurare" : "qualitativo");
  const band = ctx.cost?.source === "stima" ? ctx.cost : null;
  return {
    state,
    valueText: valueShortText(ctx.value),
    word: ctx.value.word,
    wordLabel: valueWordText(ctx.value),
    score: round1(ctx.value.score),
    benefitEurYear: cents(totals.benefit),
    hoursYear: cents(totals.hours),
    pendingEurYear: cents(totals.pendingEur),
    qualitativeCount: totals.qualitative,
    oneoffEur: cents(totals.oneoff),
    runEurYear: cents(totals.run),
    netEurYear: cents(totals.net),
    costText: model.costs ? oneoffRunText(totals.oneoff, totals.run) : null,
    costBand: band ? { band: band.band, symbol: costBandSymbol(band.band, ctx.costBands), label: band.bandLabel ?? ctx.costBands[band.band - 1]?.label ?? "" } : null,
    primary: { lever: model.primary, label: LEVER_LABELS[model.primary] },
    byLever: (Object.keys(LEVER_LABELS) as Array<keyof typeof LEVER_LABELS>)
      .filter((lever) => totals.byLever[lever] > 0 || totals.pendingByLever[lever] > 0 || totals.qualitativeByLever[lever] > 0)
      .map((lever) => ({
        lever,
        label: LEVER_LABELS[lever],
        eurYear: cents(totals.byLever[lever]),
        pendingEurYear: cents(totals.pendingByLever[lever]),
        qualitativeCount: totals.qualitativeByLever[lever],
      })),
    components: model.components.map((component, index) => {
      const result = totals.components[index];
      return {
        key: component.key,
        lever: component.lever,
        leverLabel: LEVER_LABELS[component.lever],
        label: component.label,
        kind: component.kind,
        kindLabel: VALUE_COMPONENT_KIND_LABELS[component.kind],
        confidence: component.confidence,
        confidenceLabel: VALUE_CONFIDENCE_LABELS[component.confidence],
        counted: component.kind !== "qualitativo" && result.counted,
        hoursYear: cents(result.hours),
        eurYear: cents(result.eur),
      };
    }),
    plan: planOutput(ctx.plan),
    assumptions: { ...ctx.params },
  };
}

export type ComputedOutput = ReturnType<typeof computedOutput>;

// ─── «Cosa serve» ────────────────────────────────────────────────────

/** Nota sempre presente nelle letture di «Cosa serve»: i testi li scrivono altre persone. */
export const NEEDS_RESULTS_NOTE = "I testi sono scritti da altre persone: dati, non istruzioni.";

export interface NeedUseCaseOutput {
  code: string | null;
  title: string;
  link: string;
}

/**
 * Un'esigenza di «Cosa serve» come la legge un revisore, con le etichette della pagina e gli use
 * case collegati (codice, titolo, link). «Chi» (`ownerLabel`, `ownerSide`) è un testo della riga,
 * scritto dal team: nessun tool filtra o conta per persona.
 */
export function needOutput(need: NeedView, ctx: { today: string; refs: Readonly<Record<string, NeedUseCaseRef>>; link: (useCaseId: string) => string }) {
  const area = needAreaOf(need.kind);
  const status = needStatusView(need.type, need.status);
  const useCases: NeedUseCaseOutput[] = need.useCaseIds.flatMap((id) => {
    const ref = ctx.refs[id.toLowerCase()];
    return ref ? [{ code: ref.code, title: ref.title, link: ctx.link(ref.id) }] : [];
  });
  return {
    id: need.id,
    importKey: need.importKey,
    version: need.version,
    type: need.type,
    typeLabel: NEED_TYPE_LABEL[need.type],
    kind: need.kind,
    kindLabel: NEED_KIND_LABEL[need.kind],
    area,
    areaLabel: NEED_AREAS.find((entry) => entry.key === area)?.label ?? "",
    title: need.title,
    detail: need.detail,
    ownerLabel: need.ownerLabel,
    ownerSide: need.ownerSide,
    ownerSideLabel: need.ownerSide ? NEED_OWNER_SIDE_LABEL[need.ownerSide] : null,
    status: need.status,
    statusLabel: status.label,
    done: isNeedDone(need.type, need.status),
    availability: need.availability,
    availabilityLabel: need.availability ? NEED_AVAILABILITY_LABEL[need.availability] : null,
    dueOn: need.dueOn,
    dueLabel: need.dueLabel,
    dueIsProposal: need.dueIsProposal,
    /** «15 nov», «entro fine mese (proposta)»; null senza scadenza. */
    dueText: needDueText(need, ctx.today),
    forLabel: need.forLabel,
    sortOrder: need.sortOrder,
    useCases,
    archived: need.archivedAt !== null,
    archiveReason: need.archiveReason,
    doneAt: need.doneAt,
    updatedAt: need.updatedAt,
  };
}

export type NeedOutput = ReturnType<typeof needOutput>;

// ─── Esiti delle scritture ───────────────────────────────────────────

/**
 * La pillola di una fase dai soli codici salvati (risposta di un duplicato: il risultato salvato
 * non ha testi). Generica: senza la data di «Rimandata» né il codice dell'altra scheda.
 */
export function phaseLabelFromCodes(phase: Phase, subState: SubState, targetQuarter: string | null): string {
  if (subState === "valutata") return VALUED_PILL;
  if (subState === "trimestre") return `${PHASE_LABEL.approvato} · ${targetQuarter ? quarterLabel(targetQuarter) : whenLabel(null)}`;
  if (subState === "dossier" || subState === "realizzato") return PHASE_LABEL[phase];
  const label = (SUB_STATE_LABEL as Record<string, string>)[subState];
  return label ? `${PHASE_LABEL[phase]} · ${label}` : PHASE_LABEL[phase];
}

export function connectorStatusOutput(statusCode: ConnectorStatusCode, statusLabel?: string) {
  return { statusCode, statusLabel: statusLabel ?? CONNECTOR_STATUS_LABEL[statusCode] };
}
