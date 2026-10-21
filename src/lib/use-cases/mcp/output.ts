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
 * Modulo puro: import relativi `.ts`; gira con `node --test`.
 */
import type { ConnectorStatusCode } from "../../connector/status.ts";
import { CONNECTOR_STATUS_LABEL } from "../../connector/status.ts";
import { CASE_STATUS_LABEL } from "../../uc/case-state.ts";
import type { CostBandInfo } from "../cost-bands.ts";
import { costBandSymbol } from "../format.ts";
import {
  COST_SOURCE_LABEL,
  NOT_ESTIMATED_LABEL,
  RISK_LABEL,
  VALUE_EUR_SOURCE_LABEL,
  VALUE_SOURCE_LABEL,
  VALUE_WORD_LABEL,
  ZONE_LABEL,
  type RiskChip,
  type Zone,
} from "../labels.ts";
import { PHASE_LABEL, SUB_STATE_LABEL, VALUED_PILL } from "../phase.ts";
import { quarterLabel, whenLabel } from "../quarter.ts";
import type { Phase, SubState } from "../types.ts";
import type { CostFigure, Dimension, KpiScoreMap, ValuationModel, ValueFigure } from "../valuation.ts";
import { REVIEWER_INTAKE_KEYS, isToDecide, waitingDays, type HubDossier, type HubItem, type UseCaseDetail } from "../views.ts";

// ─── Pezzi comuni ────────────────────────────────────────────────────

/** Il link assoluto alla scheda, per Claude («Apri in Unbundle»). */
export function linkToUseCase(appOrigin: string, workspaceId: string, useCaseId: string): string {
  return `${appOrigin.replace(/\/+$/, "")}/dashboard/${workspaceId}/use-cases/${useCaseId}`;
}

function round1(value: number | null): number | null {
  return value === null || !Number.isFinite(value) ? null : Math.round(value * 10) / 10;
}

export interface ValueOutput {
  word: ValueFigure["word"];
  /** «Alto», «Medio», «Basso»; «da stimare» senza punteggio. */
  wordLabel: string;
  score: number | null;
  source: ValueFigure["source"];
  /** «team» o «AI»; null senza punteggio. */
  sourceLabel: string | null;
}

/** Valore (§7.1): parola, punteggio da 1 a 5 (una cifra decimale) e fonte, con le etichette; codici null se «da stimare». */
export function valueOutput(value: ValueFigure): ValueOutput {
  return {
    word: value.word,
    wordLabel: value.word ? VALUE_WORD_LABEL[value.word] : NOT_ESTIMATED_LABEL,
    score: round1(value.score),
    source: value.source,
    sourceLabel: value.source ? VALUE_SOURCE_LABEL[value.source] : null,
  };
}

export interface CostOutput {
  symbols: string;
  /** Importo in euro (dossier o team); null quando il costo è una fascia. */
  amount: number | null;
  band: number;
  bandLabel: string;
  source: CostFigure["source"];
  /** La fonte come nella scheda: «dal dossier», «importo del team», «fascia del team», «stimato dall'impegno». */
  sourceLabel: string;
}

/** Costo di realizzazione (§7.2) con la sua fonte e la fascia del workspace; null se «da stimare». */
export function costOutput(cost: CostFigure | null, bands: readonly CostBandInfo[]): CostOutput | null {
  if (!cost) return null;
  const info = bands[cost.band - 1];
  return {
    symbols: costBandSymbol(cost.band, bands),
    amount: cost.amount,
    band: cost.band,
    bandLabel: cost.bandLabel ?? info?.label ?? "",
    source: cost.source,
    sourceLabel: COST_SOURCE_LABEL[cost.source].long,
  };
}

/** La zona della matrice (§7.4) come nella pagina; «da stimare» senza Valore o costo. */
export function zoneLabel(zone: Zone | null): string {
  return zone ? ZONE_LABEL[zone] : NOT_ESTIMATED_LABEL;
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
    zoneLabel: zoneLabel(item.zone),
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
      zoneLabel: zoneLabel(detail.zone),
      kpis: kpiOutputs(ctx.model, ctx.esgEnabled, detail.customScores, detail.aiSuggestion?.scores ?? null),
      teamValueEurYear: detail.valueEurYear,
      teamCost: detail.costEurOnce !== null ? { eurOnce: detail.costEurOnce } : detail.costBand !== null ? { band: detail.costBand } : null,
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
