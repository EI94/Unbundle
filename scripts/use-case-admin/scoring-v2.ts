/**
 * `use-case-admin scoring-v2 [--revert]` (docs/use-case/DESIGN.md §7.6 «Piano prima/dopo»,
 * §10.5, §12.2 punto 7; PIANO-LAVORI H3a). Il passaggio di un workspace dal punteggio v1 al v2,
 * e ritorno. Serve la 0020.
 *
 * **Prova a secco** (predefinita; anche con `--all`): per ogni workspace e ogni use case codice,
 * titolo troncato, impatto e punteggio complessivo prima e dopo, quadrante di oggi, zona prima e
 * dopo, fonte del Valore prima e dopo, cosa sposterebbe `--apply`. In fondo, per workspace:
 * quanti cambiano zona, quanti diventano «da stimare», se il modello è personalizzato. Lo
 * stesso prima/dopo va in un CSV in una cartella temporanea, fuori da git: niente testi oltre al
 * titolo troncato a 60 caratteri, mai chi ha proposto. «Prima» sono gli `overall_*` salvati
 * oggi; `allineata: false` dice dove il ricalcolo v1 di oggi darebbe altri numeri (`--apply` li
 * mette nella copia, e `--revert` rimette quelli salvati). La zona non conta il costo dal
 * dossier: come la lista dell'area prima di H6a.
 *
 * **`--apply`**, solo con `--workspace` (Pierpaolo decide workspace per workspace), in una
 * sola transazione:
 * - per **ogni** scheda del workspace, nello stesso statement dello spostamento, la copia
 *   `ai_suggestion.v1Backup = { customScores, reviewNotes, at, reviewedAt, aiAt }`, anche dove
 *   non si sposta niente: così `--revert` rimette com'era ogni scheda che c'era prima, e senza
 *   copia restano solo le schede nate dopo `--apply`. `aiAt` è l'`ai_suggestion.at` di quel
 *   momento (la stima dell'AI già salvata, o `null`): ogni scrittura dell'AI lo rinnova, quindi
 *   dice a `--revert` se l'AI ha valutato la scheda dopo la copia. Dove gli `overall_*` salvati
 *   non sono quelli che la v1 calcola oggi (`allineata: false`: per esempio dopo un cambio
 *   dell'ESG, che non ricalcola le schede) la copia tiene anche quelli (`aggregates`). Una
 *   `ai_suggestion` che ha solo la copia (`{ v1Backup }`, senza punteggi né motivazione) non è un
 *   suggerimento dell'AI: chi la legge la tratta come assente;
 * - dai blocchi «Auto-ranking AI:», «Suggerimento AI:», «Ricalibrazione AI:» di `review_notes`
 *   (stessa espressione di `replaceAiRationale`) esce solo il testo dell'AI, che va in
 *   `ai_suggestion.rationale` (se la motivazione c'è già in `ai_suggestion`, resta quella). Un
 *   blocco arriva fino alla fine delle note, quindi può contenere testo scritto da una persona
 *   sotto la motivazione: con la motivazione salvata in `ai_suggestion` si sposta solo quella e
 *   il resto rimane nelle note; senza, si sposta un blocco di un solo paragrafo. Dove non si sa
 *   dove finisce il testo dell'AI (più paragrafi senza motivazione salvata, o una motivazione
 *   salvata diversa dal blocco) le note restano com'erano e la prova a secco segna la scheda
 *   (`noteDaControllare`): mai testo di una persona spostato come testo dell'AI, mai perso;
 * - per le schede non `scored` i punteggi di `custom_scores` passano in `ai_suggestion.scores`
 *   (sopra quelli dell'AI già salvati); le `scored` li tengono come valori del team;
 * - `config.scoringVersion = 2` e gli `overall_*` ricalcolati in v2 per tutte le schede.
 * Ogni scheda si scrive solo se è ancora quella letta (`version` e `updated_at`), solo se nel
 * workspace non c'è una scheda che il comando non ha letto, e il modello solo se il suo
 * `config` è ancora quello letto: altrimenti non si scrive niente e si rilancia. `updated_at`
 * cambia solo dove cambiano `custom_scores` o `review_notes`.
 *
 * **`--revert`** (a secco o con `--apply`, solo con `--workspace`): rimette `custom_scores` e
 * `review_notes` dalla copia `v1Backup`, poi `scoringVersion = 1` e gli `overall_*` ricalcolati
 * in v1, o quelli della copia dove la copia li tiene: `--apply` e poi `--revert` danno gli
 * stessi `overall_*`, `custom_scores` e `review_notes` di prima (§7.6 punto 5). Se dopo
 * `--apply` una persona ha salvato una valutazione (riga «valutato» nella Storia, o
 * `reviewed_at` cambiato: in v2 l'AI non lo scrive mai), la sua resta e la prova a secco lo
 * elenca. La copia `v1Backup` si toglie. La v1 non legge `ai_suggestion`, quindi `custom_scores`
 * prende anche i KPI dell'AI dove non c'è un numero, e la prova a secco segna la scheda
 * (`ricostruita`):
 * - le schede valutate dall'AI in v2 dopo la copia (invio, ricalibrazione, «Chiedi un
 *   suggerimento»: `ai_suggestion.at` non è più `v1Backup.aiAt`) e non da una persona: i
 *   punteggi e le note della copia, più i KPI dell'AI dove la copia non ha un numero;
 * - le schede valutate da una persona dopo `--apply` e quelle senza copia (nate dopo
 *   `--apply`): per ogni KPI il valore che la v2 mostra, quello della persona e, dove manca,
 *   quello dell'AI.
 * Senza questo passo i KPI valutati solo dall'AI varrebbero 0 (§7.6 punto 5). Una stima dell'AI
 * salvata prima della copia la v1 non la contava già: resta fuori, e la scheda torna com'era.
 *
 * Con `--workspace` di un workspace che non c'è il comando si ferma (lo smistatore, e qui di
 * nuovo dopo la lettura), a secco e con `--apply`.
 *
 * Nessuna riga di Storia: lo script non cambia decisioni né valutazioni delle persone. Le
 * regole del calcolo sono quelle dell'app (`src/lib/db/use-case-scoring.ts`,
 * `src/lib/use-cases/valuation.ts`), caricate senza alias e senza database.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AdminStop,
  DRY_RUN_NOTE,
  counted,
  done,
  schemaMissing,
  scopeQuery,
  truncateTitle,
  type AdminCommand,
  type AdminContext,
  type AdminOutcome,
  type AdminRow,
  type AdminStatement,
} from "../../src/lib/use-cases/admin/cli.ts";
import { SCHEMA_FACTS_SQL, SCHEMA_MESSAGES, schemaFactsFrom } from "../../src/lib/use-cases/admin/schema.ts";
import {
  DEFAULT_SCORING_MODEL_CONFIG,
  aiScoresOf,
  deriveUseCasePortfolioMetrics,
  isCustomScoringModel,
  kpiScoresOf,
  normalizeScoringConfig,
  rewriteAiRationale,
  splitAiRationale,
  type DerivedUseCaseScores,
  type ResolvedScoringModelConfig,
  type ScoreSource,
} from "../../src/lib/db/use-case-scoring.ts";
import { NOT_ESTIMATED_LABEL, VALUE_SOURCE_LABEL, ZONE_LABEL, type ValueSource, type Zone } from "../../src/lib/use-cases/labels.ts";
import {
  DIMENSIONS,
  costFigure,
  valueFigure,
  zoneOf,
  type KpiScoreMap,
  type LegacyScoreColumns,
  type ScoringVersion,
  type ValueFigure,
} from "../../src/lib/use-cases/valuation.ts";

// ─── Righe lette ─────────────────────────────────────────────────────

export interface ScoringWorkspace {
  id: string;
  esgEnabled: boolean;
  /** Il `config` grezzo della riga di `workspace_scoring_models`; `null` senza riga. */
  rawConfig: unknown;
  hasModel: boolean;
}

export interface ScoringCard {
  id: string;
  workspaceId: string;
  code: string | null;
  title: string;
  /** `portfolio_review_status`. */
  review: string;
  version: number;
  /** `updated_at::text`, per scrivere solo una scheda ancora uguale a quella letta. */
  stamp: string;
  /** `reviewed_at::text`, per la copia. */
  reviewedAt: string | null;
  customScores: unknown;
  aiSuggestion: unknown;
  reviewNotes: string | null;
  /** Gli aggregati salvati oggi. */
  stored: { impact: number | null; feasibility: number | null; esg: number | null; overall: number | null; category: string | null };
  costEurOnce: number | null;
  costBand: number | null;
  legacy: LegacyScoreColumns;
  /** Dopo la copia `v1Backup` una persona ha salvato una valutazione. */
  valuedAfterApply: boolean;
}

const LEGACY_COLUMNS = [
  ["impactEconomic", "impact_economic"],
  ["impactTime", "impact_time"],
  ["impactQuality", "impact_quality"],
  ["impactCoordination", "impact_coordination"],
  ["impactSocial", "impact_social"],
  ["feasibilityData", "feasibility_data"],
  ["feasibilityWorkflow", "feasibility_workflow"],
  ["feasibilityRisk", "feasibility_risk"],
  ["feasibilityTech", "feasibility_tech"],
  ["feasibilityTeam", "feasibility_team"],
  ["esgEnvironmental", "esg_environmental"],
  ["esgSocial", "esg_social"],
  ["esgGovernance", "esg_governance"],
] as const satisfies ReadonlyArray<readonly [keyof LegacyScoreColumns, string]>;

/** Parametri: `$1` workspace, facoltativo. */
export function workspacesSql(withWorkspace: boolean): string {
  return `SELECT w.id, w.esg_enabled, m.config, (m.id IS NOT NULL) AS has_model
  FROM workspaces w
  LEFT JOIN workspace_scoring_models m ON m.workspace_id = w.id
 WHERE true${withWorkspace ? " AND w.id = $1::uuid" : ""}
 ORDER BY w.created_at, w.id`;
}

const ISO_UTC = "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?Z$";

/**
 * Una persona ha salvato una valutazione dopo la copia: `reviewed_at` non è più quello della
 * copia (in v2 l'AI non lo scrive mai), oppure c'è una riga «valutato» nella Storia dopo `at`.
 * CASE e non AND: Postgres non garantisce l'ordine delle condizioni, e il cast deve venire dopo
 * il controllo del formato.
 */
const VALUED_AFTER_APPLY_SQL = `CASE WHEN jsonb_typeof(u.ai_suggestion -> 'v1Backup') = 'object' THEN
         u.reviewed_at::text IS DISTINCT FROM (u.ai_suggestion #>> '{v1Backup,reviewedAt}')
         OR CASE WHEN coalesce(u.ai_suggestion #>> '{v1Backup,at}', '') ~ '${ISO_UTC}'
              THEN EXISTS (SELECT 1 FROM use_case_events e
                            WHERE e.use_case_id = u.id AND e.action = 'valutato'
                              AND e.at > (u.ai_suggestion #>> '{v1Backup,at}')::timestamptz)
              ELSE false END
       ELSE false END`;

/** Parametri: `$1` gli id dei workspace. Tutte le schede, senza testi oltre al titolo e alle note. */
export const CARDS_SQL = `SELECT u.id, u.workspace_id, u.code, u.title, u.portfolio_review_status::text AS review,
       u.version, u.updated_at::text AS stamp, u.reviewed_at::text AS reviewed_at,
       u.custom_scores, u.ai_suggestion, u.review_notes,
       u.overall_impact_score, u.overall_feasibility_score, u.overall_esg_score, u.overall_score,
       u.category::text AS category, u.cost_eur_once, u.cost_band,
       ${LEGACY_COLUMNS.map(([, column]) => `u.${column}`).join(", ")},
       ${VALUED_AFTER_APPLY_SQL} AS valued_after_apply
  FROM use_cases u
 WHERE u.workspace_id = ANY($1::uuid[])
 ORDER BY u.workspace_id, coalesce(u.submitted_at, u.created_at), u.id`;

function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function workspaceFromRow(row: AdminRow): ScoringWorkspace {
  return { id: String(row.id), esgEnabled: row.esg_enabled === true, rawConfig: row.config ?? null, hasModel: row.has_model === true };
}

export function cardFromRow(row: AdminRow): ScoringCard {
  const legacy: LegacyScoreColumns = {};
  for (const [key, column] of LEGACY_COLUMNS) legacy[key] = num(row[column]);
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    code: text(row.code),
    title: text(row.title) ?? "",
    review: text(row.review) ?? "needs_inputs",
    version: num(row.version) ?? 1,
    stamp: String(row.stamp),
    reviewedAt: text(row.reviewed_at),
    customScores: row.custom_scores ?? null,
    aiSuggestion: row.ai_suggestion ?? null,
    reviewNotes: text(row.review_notes),
    stored: {
      impact: num(row.overall_impact_score),
      feasibility: num(row.overall_feasibility_score),
      esg: num(row.overall_esg_score),
      overall: num(row.overall_score),
      category: text(row.category),
    },
    costEurOnce: num(row.cost_eur_once),
    costBand: num(row.cost_band),
    legacy,
    valuedAfterApply: row.valued_after_apply === true,
  };
}

// ─── Calcolo ─────────────────────────────────────────────────────────

/** Il modello del workspace come lo legge l'app (`normalizeScoringConfig`). */
export function modelOf(workspace: Pick<ScoringWorkspace, "rawConfig">): ResolvedScoringModelConfig {
  return normalizeScoringConfig(workspace.rawConfig);
}

type CardData = Pick<ScoringCard, "customScores" | "aiSuggestion" | "legacy" | "costEurOnce" | "costBand">;

export interface Side {
  derived: DerivedUseCaseScores;
  value: ValueFigure;
  zone: Zone | null;
}

/**
 * Aggregati salvati, Valore e zona di una scheda in una versione, come li calcola l'app:
 * `deriveUseCasePortfolioMetrics` (gli `overall_*`), `valueFigure`, `costFigure` e `zoneOf` (la
 * lista dell'area). In v1 i KPI dell'AI non contano.
 */
export function sideOf(card: CardData, model: ResolvedScoringModelConfig, esgEnabled: boolean, version: ScoringVersion): Side {
  const derived = deriveUseCasePortfolioMetrics(
    { ...card.legacy, customScores: card.customScores as ScoreSource["customScores"], aiSuggestion: card.aiSuggestion as ScoreSource["aiSuggestion"] },
    { model: { impactFlagEnabled: false, config: model }, esgEnabled, version },
  );
  const customScores = (isRecord(card.customScores) ? card.customScores : null) as KpiScoreMap | null;
  const aiScores = version === 2 ? aiScoresOf(card.aiSuggestion) : null;
  const value = valueFigure({ ...card.legacy, customScores, aiScores }, model, { version, esgEnabled });
  const cost = costFigure({ customScores, aiScores, costEurOnce: card.costEurOnce, costBand: card.costBand }, model);
  return { derived, value, zone: zoneOf(value, cost, model) };
}

/** Gli aggregati che si scrivono: quelli ricalcolati, o quelli salvati nella copia (`category` può essere `NULL`). */
export type WrittenScores = Omit<DerivedUseCaseScores, "category"> & { category: DerivedUseCaseScores["category"] | null };

/**
 * I valori della scheda dopo il passaggio. `moves` vuol dire: si scrivono `custom_scores`,
 * `review_notes` e `ai_suggestion` (`updated_at` cambia solo se cambiano i primi due).
 */
export interface CardWrite {
  moves: boolean;
  customScores: unknown;
  reviewNotes: string | null;
  aiSuggestion: Record<string, unknown> | null;
  derived: WrittenScores;
}

export interface ApplyPlan {
  card: ScoringCard;
  movesScores: boolean;
  movesNotes: boolean;
  /** Un blocco dell'AI dove non si sa dove finisce il testo dell'AI: le note restano com'erano. */
  notesToCheck: boolean;
  write: CardWrite;
  before: Side;
  after: Side;
  /** Gli `overall_*` salvati sono quelli che la v1 calcola oggi. */
  aligned: boolean;
}

function hasScores(scores: ReturnType<typeof kpiScoresOf>): boolean {
  return Boolean(scores) && DIMENSIONS.some((dimension) => Object.keys(scores?.[dimension] ?? {}).length > 0);
}

/** I punteggi dell'AI salvati, con sopra quelli di `custom_scores`: i numeri della v1 restano. */
function mergedScores(ai: KpiScoreMap | null, custom: ReturnType<typeof kpiScoresOf>): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const dimension of DIMENSIONS) {
    const merged = { ...(isRecord(ai?.[dimension]) ? (ai?.[dimension] as Record<string, unknown>) : {}), ...(custom?.[dimension] ?? {}) };
    if (Object.keys(merged).length) out[dimension] = merged;
  }
  return out;
}

const TOLERANCE = 1e-4;

function close(a: number | null, b: number | null): boolean {
  return a === null || b === null ? a === b : Math.abs(a - b) <= TOLERANCE;
}

function sameScores(stored: ScoringCard["stored"], derived: DerivedUseCaseScores): boolean {
  return (
    close(stored.impact, derived.overallImpactScore) &&
    close(stored.feasibility, derived.overallFeasibilityScore) &&
    close(stored.esg, derived.overallEsgScore) &&
    close(stored.overall, derived.overallScore) &&
    stored.category === derived.category
  );
}

/**
 * Il testo dell'AI all'inizio di un blocco delle note e quel che resta dopo, scritto da una
 * persona; `null` se non si sa dove finisce il testo dell'AI.
 * - Con la motivazione salvata in `ai_suggestion` (la v1 la scrive uguale al blocco): il blocco
 *   deve cominciare con quella; il resto è della persona.
 * - Senza: un blocco di un solo paragrafo è tutto dell'AI (`replaceAiRationale` scrive
 *   l'etichetta e la motivazione); con più paragrafi non si sa.
 */
export function aiPartOf(text: string, stored: string | null): { ai: string; rest: string } | null {
  if (stored) {
    if (text === stored) return { ai: stored, rest: "" };
    if (text.startsWith(stored) && /^\s/.test(text.slice(stored.length))) return { ai: stored, rest: text.slice(stored.length).trim() };
    return null;
  }
  return /\n[ \t]*\n/.test(text) ? null : { ai: text, rest: "" };
}

export interface NotesPlan {
  /** Le note cambiano: esce il testo dell'AI. */
  moves: boolean;
  notes: string | null;
  /** Il testo dell'AI dell'ultimo blocco, per `ai_suggestion.rationale` se non c'è già. */
  rationale: string | null;
  /** Un blocco dove non si sa dove finisce il testo dell'AI: le note restano com'erano. */
  toCheck: boolean;
}

/** Le note dopo il passaggio (§7.6 regola 5): esce solo il testo dell'AI, quello delle persone resta. */
export function planNotes(notes: string | null, aiSuggestion: Record<string, unknown> | null): NotesPlan {
  const unchanged = (toCheck: boolean): NotesPlan => ({ moves: false, notes, rationale: null, toCheck });
  if (notes === null || splitAiRationale(notes).blocks.length === 0) return unchanged(false);
  const stored = typeof aiSuggestion?.rationale === "string" && aiSuggestion.rationale.trim() ? aiSuggestion.rationale.trim() : null;
  const aiParts: string[] = [];
  let toCheck = false;
  const rest = rewriteAiRationale(notes, (block) => {
    const part = aiPartOf(block.text, stored);
    if (!part) {
      toCheck = true;
      return block.text;
    }
    aiParts.push(part.ai);
    return part.rest;
  });
  if (toCheck) return unchanged(true);
  return { moves: true, notes: rest, rationale: aiParts.at(-1) || null, toCheck: false };
}

/**
 * Il passaggio di una scheda alla v2 (§7.6 punto 4). `at` è l'istante della copia, ISO. La copia
 * `v1Backup` va su ogni scheda, anche dove non si sposta niente: una scheda `scored` con un KPI
 * vuoto che l'AI ha valutato in v1 (`ai_suggestion`) non cambia qui, ma in v2 quel KPI conta, e
 * solo la copia dice a `--revert` che la scheda c'era già e va rimessa com'era. `aiAt` (l'`at`
 * della stima dell'AI di adesso, che qui non cambia) dice a `--revert` se l'AI l'ha valutata dopo.
 */
export function planApplyCard(card: ScoringCard, model: ResolvedScoringModelConfig, esgEnabled: boolean, at: string): ApplyPlan {
  const custom = kpiScoresOf(card.customScores);
  const movesScores = card.review !== "scored" && hasScores(custom);
  const current = isRecord(card.aiSuggestion) ? card.aiSuggestion : null;
  const notes = planNotes(card.reviewNotes, current);
  const movesNotes = notes.moves;
  const before = sideOf(card, model, esgEnabled, 1);
  const aligned = sameScores(card.stored, before.derived);
  const ai: Record<string, unknown> = { ...(current ?? {}) };
  if (movesScores) ai.scores = mergedScores(aiScoresOf(current), custom);
  if (movesNotes && !(typeof ai.rationale === "string" && ai.rationale.trim())) ai.rationale = notes.rationale;
  ai.v1Backup = {
    customScores: card.customScores ?? null,
    reviewNotes: card.reviewNotes,
    at,
    reviewedAt: card.reviewedAt,
    aiAt: typeof current?.at === "string" ? current.at : null,
    // Gli `overall_*` salvati, solo dove il ricalcolo v1 non li ridarebbe uguali.
    ...(aligned ? {} : { aggregates: { ...card.stored } }),
  };
  const next: Omit<CardWrite, "derived"> = {
    moves: true,
    customScores: movesScores ? null : card.customScores,
    reviewNotes: notes.notes,
    aiSuggestion: ai,
  };
  const after = sideOf({ ...card, customScores: next.customScores, aiSuggestion: next.aiSuggestion }, model, esgEnabled, 2);
  return {
    card,
    movesScores,
    movesNotes,
    notesToCheck: notes.toCheck,
    write: { ...next, derived: after.derived },
    before,
    after,
    aligned,
  };
}

export interface RevertPlan {
  card: ScoringCard;
  /** La scheda ha la copia `v1Backup`. */
  hasBackup: boolean;
  /** Punteggi e note tornano dalla copia. */
  restores: boolean;
  /** Anche gli `overall_*` tornano dalla copia: erano diversi dal ricalcolo v1 (`allineata: false`). */
  restoresAggregates: boolean;
  /** Una persona l'ha valutata dopo `--apply`: la sua valutazione resta. */
  keepsPerson: boolean;
  /**
   * `custom_scores` prende i KPI dell'AI dove la persona, o la copia, non ha un valore (la v1 non
   * legge `ai_suggestion`). Gli `overall_*` sono quelli che la v1 ricalcola, mai quelli della copia.
   */
  rebuilt: boolean;
  write: CardWrite;
  before: Side;
  after: Side;
}

/**
 * I KPI che la v2 mostra, scritti come li legge la v1: per ogni KPI il numero della persona
 * (`custom_scores`) e, dove la persona non ne ha uno, quello dell'AI (`ai_suggestion.scores`).
 * Le altre voci di `custom_scores` restano come sono. `added`: c'è almeno un KPI dell'AI in più.
 */
export function v1ScoresFrom(custom: unknown, aiScores: KpiScoreMap | null): { scores: unknown; added: boolean } {
  const ai = kpiScoresOf(aiScores);
  if (!hasScores(ai)) return { scores: custom, added: false };
  const base = isRecord(custom) ? custom : {};
  const out: Record<string, unknown> = { ...base };
  let added = false;
  for (const dimension of DIMENSIONS) {
    const aiMap = ai?.[dimension] ?? {};
    const person = isRecord(base[dimension]) ? (base[dimension] as Record<string, unknown>) : {};
    const merged: Record<string, unknown> = { ...person };
    for (const [kpi, value] of Object.entries(aiMap)) {
      const own = person[kpi];
      if (typeof own === "number" && Number.isFinite(own)) continue;
      merged[kpi] = value;
      added = true;
    }
    if (Object.keys(aiMap).length) out[dimension] = merged;
  }
  return added ? { scores: out, added } : { scores: custom, added: false };
}

const CATEGORIES: ReadonlySet<string> = new Set(["quick_win", "strategic_bet", "capability_builder", "not_yet"]);

function aggregateValue(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Gli `overall_*` della copia (`v1Backup.aggregates`); `null` se mancano o non hanno la forma giusta. */
export function backupAggregates(backup: Record<string, unknown> | null): WrittenScores | null {
  const saved = backup && isRecord(backup.aggregates) ? backup.aggregates : null;
  if (!saved) return null;
  const values = [saved.impact, saved.feasibility, saved.esg, saved.overall].map(aggregateValue);
  const category = saved.category;
  if (values.some((value) => value === undefined)) return null;
  if (category !== null && !(typeof category === "string" && CATEGORIES.has(category))) return null;
  const [impact, feasibility, esg, overall] = values as Array<number | null>;
  return {
    overallImpactScore: impact,
    overallFeasibilityScore: feasibility,
    overallEsgScore: esg,
    overallScore: overall,
    category: category as WrittenScores["category"],
  };
}

const ISO_UTC_PATTERN = new RegExp(ISO_UTC);

/**
 * L'AI ha scritto `ai_suggestion` dopo la copia (in v2: invio, ricalibrazione, «Chiedi un
 * suggerimento»). Ogni scrittura dell'AI rinnova `at`, e `--apply` lo lascia com'è: `at` non è
 * più `v1Backup.aiAt`. Una copia senza `aiAt` (scritta prima di questo campo) usa l'ordine dei
 * due istanti ISO.
 */
export function aiWroteAfterCopy(current: Record<string, unknown> | null, backup: Record<string, unknown> | null): boolean {
  const at = current?.at;
  if (!backup || typeof at !== "string" || at === "") return false;
  if ("aiAt" in backup) return at !== backup.aiAt;
  return typeof backup.at === "string" && ISO_UTC_PATTERN.test(at) && ISO_UTC_PATTERN.test(backup.at) && Date.parse(at) > Date.parse(backup.at);
}

/**
 * Il ritorno di una scheda alla v1 (§7.6 punto 5). Con la copia e senza valutazioni di persone
 * dopo `--apply`, punteggi e note tornano dalla copia, e gli `overall_*` sono quelli che la v1
 * ricalcola, o quelli della copia se la copia li tiene (erano diversi dal ricalcolo): la scheda
 * torna com'era prima di `--apply`. Se però l'AI l'ha valutata dopo la copia, `custom_scores`
 * prende anche i KPI dell'AI dove la copia non ha un numero, e gli `overall_*` si ricalcolano.
 * Altrimenti (valutata da una persona dopo `--apply`, o senza copia perché nata dopo `--apply`)
 * note e valutazione della persona restano, e `custom_scores` prende anche i KPI dell'AI dove la
 * persona non ha un valore. La v1 calcola solo da `custom_scores`: così le schede valutate solo
 * dall'AI non perdono i KPI.
 */
export function planRevertCard(card: ScoringCard, model: ResolvedScoringModelConfig, esgEnabled: boolean): RevertPlan {
  const current = isRecord(card.aiSuggestion) ? card.aiSuggestion : null;
  const backup = current && isRecord(current.v1Backup) ? current.v1Backup : null;
  const restores = backup !== null && !card.valuedAfterApply;
  const rest = current ? Object.fromEntries(Object.entries(current).filter(([key]) => key !== "v1Backup")) : null;
  const withoutBackup = rest && Object.keys(rest).length ? rest : null;
  const aiScores = aiScoresOf(current);
  // Dalla copia: solo i KPI che l'AI ha stimato dopo, quelli di prima la v1 non li contava.
  const rebuild = restores
    ? v1ScoresFrom(backup?.customScores ?? null, aiWroteAfterCopy(current, backup) ? aiScores : null)
    : v1ScoresFrom(card.customScores, aiScores);
  let next: Omit<CardWrite, "derived"> = { moves: false, customScores: card.customScores, reviewNotes: card.reviewNotes, aiSuggestion: current };
  if (restores && backup) {
    next = { moves: true, customScores: rebuild.scores ?? null, reviewNotes: text(backup.reviewNotes), aiSuggestion: withoutBackup };
  } else if (backup || rebuild.added) {
    next = { moves: true, customScores: rebuild.scores ?? null, reviewNotes: card.reviewNotes, aiSuggestion: backup ? withoutBackup : current };
  }
  const before = sideOf(card, model, esgEnabled, 2);
  const after = sideOf({ ...card, customScores: next.customScores, aiSuggestion: next.aiSuggestion }, model, esgEnabled, 1);
  // Gli `overall_*` della copia valgono solo per i punteggi della copia, senza KPI aggiunti.
  const saved = restores && !rebuild.added ? backupAggregates(backup) : null;
  return {
    card,
    hasBackup: backup !== null,
    restores,
    restoresAggregates: saved !== null,
    keepsPerson: backup !== null && card.valuedAfterApply,
    rebuilt: rebuild.added,
    write: { ...next, derived: saved ?? after.derived },
    before,
    after,
  };
}

// ─── Rapporto e CSV ──────────────────────────────────────────────────

function round2(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100) / 100;
}

function zoneLabel(zone: Zone | null): string {
  return zone ? ZONE_LABEL[zone] : NOT_ESTIMATED_LABEL;
}

function sourceLabel(source: ValueSource | null): string {
  return source ? VALUE_SOURCE_LABEL[source] : NOT_ESTIMATED_LABEL;
}

export interface ApplyItem {
  id: string;
  codice: string | null;
  titolo: string;
  revisione: string;
  impatto: { prima: number | null; dopo: number | null };
  punteggio: { prima: number | null; dopo: number | null };
  quadranteOggi: string | null;
  zona: { prima: string; dopo: string };
  fonteValore: { prima: string; dopo: string };
  sposta: { punteggi: boolean; note: boolean };
  /** Le note restano com'erano: un blocco dell'AI dove non si sa dove finisce il testo dell'AI. */
  noteDaControllare: boolean;
  allineata: boolean;
}

export function applyItem(plan: ApplyPlan): ApplyItem {
  const { card } = plan;
  return {
    id: card.id,
    codice: card.code,
    titolo: truncateTitle(card.title),
    revisione: card.review,
    impatto: { prima: round2(card.stored.impact), dopo: round2(plan.after.derived.overallImpactScore) },
    punteggio: { prima: round2(card.stored.overall), dopo: round2(plan.after.derived.overallScore) },
    quadranteOggi: card.stored.category,
    zona: { prima: zoneLabel(plan.before.zone), dopo: zoneLabel(plan.after.zone) },
    fonteValore: { prima: sourceLabel(plan.before.value.source), dopo: sourceLabel(plan.after.value.source) },
    sposta: { punteggi: plan.movesScores, note: plan.movesNotes },
    noteDaControllare: plan.notesToCheck,
    allineata: plan.aligned,
  };
}

export interface ApplySummary {
  schede: number;
  cambianoZona: number;
  /**
   * L'impatto diventa «da stimare»: in v1 è un numero (un KPI vuoto vale 0), in v2 nessun KPI
   * d'impatto ha un valore. Oggi in matrice queste schede stanno a 0.
   */
  diventanoDaStimare: number;
  /** La zona diventa «da stimare». */
  zonaDaStimare: number;
  /** La fonte del Valore passa da «team» ad «AI». */
  fonteDaTeamAdAi: number;
  spostamenti: { punteggi: number; note: number; copie: number };
  /** Note rimaste com'erano: da guardare prima di `--apply` (testo dell'AI e della persona nello stesso blocco). */
  noteDaControllare: number;
  /** Gli `overall_*` salvati non sono quelli che la v1 calcola oggi. */
  nonAllineate: number;
}

export function summarizeApply(plans: readonly ApplyPlan[]): ApplySummary {
  const count = (test: (plan: ApplyPlan) => boolean) => plans.filter(test).length;
  return {
    schede: plans.length,
    cambianoZona: count((p) => p.before.zone !== p.after.zone),
    diventanoDaStimare: count((p) => p.before.derived.overallImpactScore !== null && p.after.derived.overallImpactScore === null),
    zonaDaStimare: count((p) => p.before.zone !== null && p.after.zone === null),
    fonteDaTeamAdAi: count((p) => p.before.value.source === "team" && p.after.value.source === "ai"),
    spostamenti: { punteggi: count((p) => p.movesScores), note: count((p) => p.movesNotes), copie: count((p) => p.write.moves) },
    noteDaControllare: count((p) => p.notesToCheck),
    nonAllineate: count((p) => !p.aligned),
  };
}

export interface RevertItem {
  id: string;
  codice: string | null;
  titolo: string;
  revisione: string;
  impatto: { prima: number | null; dopo: number | null };
  punteggio: { prima: number | null; dopo: number | null };
  zona: { prima: string; dopo: string };
  fonteValore: { prima: string; dopo: string };
  ripristina: boolean;
  valutazioneDopoApply: boolean;
  /** `custom_scores` prende i KPI dell'AI dove la persona, o la copia, non ha un valore. */
  ricostruita: boolean;
}

export function revertItem(plan: RevertPlan): RevertItem {
  const { card } = plan;
  return {
    id: card.id,
    codice: card.code,
    titolo: truncateTitle(card.title),
    revisione: card.review,
    // «Dopo» è quello che si scrive: il ricalcolo v1, o gli `overall_*` della copia.
    impatto: { prima: round2(card.stored.impact), dopo: round2(plan.write.derived.overallImpactScore) },
    punteggio: { prima: round2(card.stored.overall), dopo: round2(plan.write.derived.overallScore) },
    zona: { prima: zoneLabel(plan.before.zone), dopo: zoneLabel(plan.after.zone) },
    fonteValore: { prima: sourceLabel(plan.before.value.source), dopo: sourceLabel(plan.after.value.source) },
    ripristina: plan.restores,
    valutazioneDopoApply: plan.keepsPerson,
    ricostruita: plan.rebuilt,
  };
}

export function summarizeRevert(plans: readonly RevertPlan[]) {
  return {
    schede: plans.length,
    ripristinate: plans.filter((p) => p.restores).length,
    /** Schede ripristinate con gli `overall_*` della copia (salvati diversi dal ricalcolo v1). */
    aggregatiDallaCopia: plans.filter((p) => p.restoresAggregates).length,
    senzaCopia: plans.filter((p) => !p.hasBackup).length,
    valutazioniTenute: plans.filter((p) => p.keepsPerson).length,
    /**
     * Schede che prendono in `custom_scores` i KPI dell'AI: valutate dall'AI dopo la copia (sopra
     * i punteggi della copia), valutate da una persona dopo `--apply`, nate dopo `--apply`.
     */
    ricostruite: plans.filter((p) => p.rebuilt).length,
    cambianoZona: plans.filter((p) => p.before.zone !== p.after.zone).length,
  };
}

/** Una cella CSV: tra virgolette se serve; un testo che Excel leggerebbe come formula prende un apostrofo. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "sì" : "no";
  let cell = String(value);
  if (/^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
  return /[",\n\r]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
}

export const APPLY_CSV_HEADER = [
  "workspace", "id", "codice", "titolo", "revisione", "impatto_prima", "impatto_dopo", "punteggio_prima", "punteggio_dopo",
  "quadrante_oggi", "zona_prima", "zona_dopo", "fonte_valore_prima", "fonte_valore_dopo", "sposta_punteggi", "sposta_note",
  "note_da_controllare", "allineata",
] as const;

export const REVERT_CSV_HEADER = [
  "workspace", "id", "codice", "titolo", "revisione", "impatto_prima", "impatto_dopo", "punteggio_prima", "punteggio_dopo",
  "zona_prima", "zona_dopo", "fonte_valore_prima", "fonte_valore_dopo", "ripristina", "valutazione_dopo_apply", "ricostruita",
] as const;

export function applyCsvRow(workspaceId: string, item: ApplyItem): unknown[] {
  return [
    workspaceId, item.id, item.codice, item.titolo, item.revisione, item.impatto.prima, item.impatto.dopo, item.punteggio.prima,
    item.punteggio.dopo, item.quadranteOggi, item.zona.prima, item.zona.dopo, item.fonteValore.prima, item.fonteValore.dopo,
    item.sposta.punteggi, item.sposta.note, item.noteDaControllare, item.allineata,
  ];
}

export function revertCsvRow(workspaceId: string, item: RevertItem): unknown[] {
  return [
    workspaceId, item.id, item.codice, item.titolo, item.revisione, item.impatto.prima, item.impatto.dopo, item.punteggio.prima,
    item.punteggio.dopo, item.zona.prima, item.zona.dopo, item.fonteValore.prima, item.fonteValore.dopo, item.ripristina,
    item.valutazioneDopoApply, item.ricostruita,
  ];
}

export function toCsv(header: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

/** Il CSV in una cartella temporanea nuova, fuori dal repository. */
function writeCsv(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "use-case-admin-scoring-v2-"));
  const path = join(dir, name);
  writeFileSync(path, content, { encoding: "utf8", mode: 0o600 });
  return path;
}

// ─── Scritture ───────────────────────────────────────────────────────

/** Nei messaggi d'errore forzati: una scheda o il modello sono cambiati dopo la lettura. */
const CARDS_CHANGED = "scoring-v2-schede-cambiate";
const MODEL_CHANGED = "scoring-v2-modello-cambiato";

/**
 * Tutte le schede del workspace in un solo statement, ognuna solo se è ancora quella letta
 * (`version` e `updated_at`). Se ne manca anche una, o se nel workspace c'è una scheda che il
 * comando non ha letto (arrivata dopo la lettura: resterebbe con gli aggregati dell'altra
 * versione), il cast finale fallisce e la transazione si annulla: niente di scritto.
 * `updated_at` cambia solo dove cambiano `custom_scores` o `review_notes`: la sola copia in
 * `ai_suggestion` e i ricalcoli non lo toccano (come il trigger non tocca `version`).
 * Parametri: `$1` workspace, `$2` le schede (JSON), `$3` quante sono.
 */
export const WRITE_CARDS_SQL = `WITH d AS (
  SELECT * FROM jsonb_to_recordset($2::jsonb) AS d(
    id uuid, version integer, stamp text, moves boolean,
    custom_scores jsonb, review_notes text, ai_suggestion jsonb,
    impact double precision, feasibility double precision, esg double precision, overall double precision, category text)
), upd AS (
  UPDATE use_cases u SET
    custom_scores = CASE WHEN d.moves THEN d.custom_scores ELSE u.custom_scores END,
    review_notes = CASE WHEN d.moves THEN d.review_notes ELSE u.review_notes END,
    ai_suggestion = CASE WHEN d.moves THEN d.ai_suggestion ELSE u.ai_suggestion END,
    overall_impact_score = d.impact,
    overall_feasibility_score = d.feasibility,
    overall_esg_score = d.esg,
    overall_score = d.overall,
    category = d.category::use_case_category,
    updated_at = CASE WHEN d.moves AND (u.custom_scores IS DISTINCT FROM d.custom_scores OR u.review_notes IS DISTINCT FROM d.review_notes)
                      THEN now() ELSE u.updated_at END
  FROM d
  WHERE u.id = d.id AND u.workspace_id = $1::uuid AND u.version = d.version AND u.updated_at::text = d.stamp
  RETURNING u.id
)
SELECT CASE WHEN count(*) = $3::int
             AND NOT EXISTS (SELECT 1 FROM use_cases x WHERE x.workspace_id = $1::uuid AND x.id NOT IN (SELECT d.id FROM d))
            THEN count(*)::int
            ELSE (count(*)::text || ' di ' || $3::text || ' ${CARDS_CHANGED}')::int END AS schede
  FROM upd`;

/**
 * `scoringVersion` del modello, solo se il `config` è ancora quello letto. Parametri: `$1`
 * workspace, `$2` il `config` letto (JSON), `$3` la versione.
 */
export const SET_VERSION_SQL = `WITH upd AS (
  UPDATE workspace_scoring_models
     SET config = jsonb_set(coalesce(config, '{}'::jsonb), '{scoringVersion}', to_jsonb($3::int)), updated_at = now()
   WHERE workspace_id = $1::uuid AND config IS NOT DISTINCT FROM $2::jsonb
  RETURNING 1
)
SELECT CASE WHEN count(*) = 1 THEN 1 ELSE (count(*)::text || ' ${MODEL_CHANGED}')::int END AS modello FROM upd`;

/** Il modello di un workspace che non ne ha ancora uno: quello predefinito, in v2. `$1` workspace, `$2` il `config`. */
export const INSERT_MODEL_SQL = `WITH ins AS (
  INSERT INTO workspace_scoring_models (workspace_id, impact_flag_enabled, config, updated_at)
  SELECT $1::uuid, false, $2::jsonb, now()
   WHERE NOT EXISTS (SELECT 1 FROM workspace_scoring_models WHERE workspace_id = $1::uuid)
  RETURNING 1
)
SELECT CASE WHEN count(*) = 1 THEN 1 ELSE (count(*)::text || ' ${MODEL_CHANGED}')::int END AS modello FROM ins`;

/** Il JSON di `WRITE_CARDS_SQL`. */
export function cardsPayload(writes: ReadonlyArray<{ card: ScoringCard; write: CardWrite }>): string {
  return JSON.stringify(
    writes.map(({ card, write }) => ({
      id: card.id,
      version: card.version,
      stamp: card.stamp,
      moves: write.moves,
      custom_scores: write.moves ? (write.customScores ?? null) : null,
      review_notes: write.moves ? write.reviewNotes : null,
      ai_suggestion: write.moves ? write.aiSuggestion : null,
      impact: write.derived.overallImpactScore,
      feasibility: write.derived.overallFeasibilityScore,
      esg: write.derived.overallEsgScore,
      overall: write.derived.overallScore,
      category: write.derived.category,
    })),
  );
}

export function versionStatements(workspace: ScoringWorkspace, version: ScoringVersion): AdminStatement {
  if (workspace.hasModel) {
    return { text: SET_VERSION_SQL, params: [workspace.id, workspace.rawConfig === null ? null : JSON.stringify(workspace.rawConfig), version] };
  }
  const config = { ...DEFAULT_SCORING_MODEL_CONFIG, scoringVersion: version };
  return { text: INSERT_MODEL_SQL, params: [workspace.id, JSON.stringify(config)] };
}

async function writeWorkspace(ctx: AdminContext, workspace: ScoringWorkspace, writes: ReadonlyArray<{ card: ScoringCard; write: CardWrite }>, version: ScoringVersion) {
  try {
    await ctx.db.write([
      { text: WRITE_CARDS_SQL, params: [workspace.id, cardsPayload(writes), writes.length] },
      versionStatements(workspace, version),
    ]);
  } catch (error) {
    // Solo per riconoscere i due errori voluti: il messaggio del database non si stampa mai.
    const message = error instanceof Error ? error.message : "";
    if (message.includes(CARDS_CHANGED) || message.includes(MODEL_CHANGED)) {
      throw new AdminStop(
        "cambiato",
        "Una scheda o il modello del workspace sono cambiati durante il comando: non è stato scritto niente. Rilancia a secco, controlla e poi --apply.",
      );
    }
    throw error;
  }
}

// ─── Comando ─────────────────────────────────────────────────────────

function versionOf(workspace: ScoringWorkspace): ScoringVersion {
  return modelOf(workspace).scoringVersion;
}

export const command: AdminCommand = {
  name: "scoring-v2",
  options: { flags: ["revert"] },
  async run(ctx): Promise<AdminOutcome> {
    const facts = schemaFactsFrom((await ctx.db.read(SCHEMA_FACTS_SQL))[0]);
    if (!facts.m0020) return schemaMissing(ctx.command, "0020", SCHEMA_MESSAGES.m0020);
    const revert = ctx.flag("revert");
    if (ctx.apply && ctx.scope.kind === "all") {
      throw new AdminStop("ambito", "scoring-v2 scrive un workspace alla volta, dopo il suo prima/dopo: usa --workspace <id>.");
    }
    const scope = scopeQuery(ctx.scope);
    const workspaces = (await ctx.db.read(workspacesSql(scope.withWorkspace), scope.params)).map(workspaceFromRow);
    // Lo smistatore ha già fermato un id che non c'è; se il workspace sparisce nel frattempo,
    // stesso errore: mai «già in v2» o «già in v1» per un workspace che non c'è.
    if (ctx.scope.kind === "workspace" && workspaces.length === 0) {
      throw new AdminStop("workspace", "Workspace non trovato.");
    }
    const cards = workspaces.length
      ? (await ctx.db.read(CARDS_SQL, [workspaces.map((w) => w.id)])).map(cardFromRow)
      : [];
    const cardsOf = (workspaceId: string) => cards.filter((card) => card.workspaceId === workspaceId);
    const at = new Date().toISOString();

    if (!revert) {
      const report: Array<Record<string, unknown>> = [];
      const csvRows: unknown[][] = [];
      const plansByWorkspace = new Map<string, ApplyPlan[]>();
      for (const workspace of workspaces) {
        const model = modelOf(workspace);
        if (model.scoringVersion === 2) {
          report.push({ workspace: workspace.id, versione: 2, nota: "Già in v2: per tornare alla v1 --revert." });
          continue;
        }
        const plans = cardsOf(workspace.id).map((card) => planApplyCard(card, model, workspace.esgEnabled, at));
        plansByWorkspace.set(workspace.id, plans);
        const items = plans.map(applyItem);
        for (const item of items) csvRows.push(applyCsvRow(workspace.id, item));
        report.push({
          workspace: workspace.id,
          versione: 1,
          modelloPersonalizzato: isCustomScoringModel(model),
          esg: workspace.esgEnabled,
          riepilogo: summarizeApply(plans),
          // Note che --apply lascia com'erano: Pierpaolo le guarda prima (mai il testo).
          noteDaControllare: items.filter((item) => item.noteDaControllare).map((item) => ({ id: item.id, codice: item.codice, titolo: item.titolo })),
          schede: items,
        });
      }
      const csv = writeCsv("prima-dopo.csv", toCsv(APPLY_CSV_HEADER, csvRows));
      const toApply = [...plansByWorkspace.keys()];
      if (!ctx.apply) {
        return done({
          status: toApply.length ? "DRY_RUN" : "NOTHING_TO_DO",
          message: toApply.length
            ? `${DRY_RUN_NOTE} --apply vale per un workspace alla volta (--workspace <id>), dopo che Pierpaolo ha visto il suo prima/dopo.`
            : "Nessun workspace in v1.",
          csv,
          workspaces: report,
        });
      }
      const workspace = workspaces[0];
      if (!workspace || versionOf(workspace) === 2) {
        return done({ status: "NOTHING_TO_DO", message: "Il workspace è già in v2: niente da applicare.", csv, workspaces: report });
      }
      const plans = plansByWorkspace.get(workspace.id) ?? [];
      ctx.print({ status: "PLAN", command: ctx.command, csv, workspaces: report });
      await writeWorkspace(ctx, workspace, plans, 2);
      const summary = summarizeApply(plans);
      return done({
        status: "APPLIED",
        message: `Workspace in v2: ${counted(plans.length, "scheda ricalcolata", "schede ricalcolate")}, ${counted(summary.spostamenti.copie, "copia v1Backup salvata", "copie v1Backup salvate")}. Per tornare indietro: scoring-v2 --revert.`,
        csv,
        versione: 2,
        riepilogo: summary,
      });
    }

    const report: Array<Record<string, unknown>> = [];
    const csvRows: unknown[][] = [];
    const plansByWorkspace = new Map<string, RevertPlan[]>();
    for (const workspace of workspaces) {
      const model = modelOf(workspace);
      if (model.scoringVersion !== 2) {
        report.push({ workspace: workspace.id, versione: 1, nota: "In v1: niente da riportare indietro." });
        continue;
      }
      const plans = cardsOf(workspace.id).map((card) => planRevertCard(card, model, workspace.esgEnabled));
      plansByWorkspace.set(workspace.id, plans);
      const items = plans.map(revertItem);
      for (const item of items) csvRows.push(revertCsvRow(workspace.id, item));
      report.push({
        workspace: workspace.id,
        versione: 2,
        ...(ctx.hubWorkspaces.has(workspace.id)
          ? { avviso: "L'area è accesa per questo workspace (USE_CASE_HUB_WORKSPACES): si accende solo con la v2 (DESIGN §12.2)." }
          : {}),
        riepilogo: summarizeRevert(plans),
        valutazioniDopoApply: items.filter((item) => item.valutazioneDopoApply).map((item) => ({ id: item.id, codice: item.codice, titolo: item.titolo })),
        ricostruite: items.filter((item) => item.ricostruita).map((item) => ({ id: item.id, codice: item.codice, titolo: item.titolo })),
        schede: items,
      });
    }
    const csv = writeCsv("ritorno-v1.csv", toCsv(REVERT_CSV_HEADER, csvRows));
    if (!ctx.apply) {
      return done({
        status: plansByWorkspace.size ? "DRY_RUN" : "NOTHING_TO_DO",
        message: plansByWorkspace.size
          ? `${DRY_RUN_NOTE} Con --revert --apply, un workspace alla volta (--workspace <id>).`
          : "Nessun workspace in v2.",
        csv,
        workspaces: report,
      });
    }
    const workspace = workspaces[0];
    if (!workspace || versionOf(workspace) !== 2) {
      return done({ status: "NOTHING_TO_DO", message: "Il workspace è già in v1: niente da riportare indietro.", csv, workspaces: report });
    }
    const plans = plansByWorkspace.get(workspace.id) ?? [];
    ctx.print({ status: "PLAN", command: ctx.command, csv, workspaces: report });
    await writeWorkspace(ctx, workspace, plans, 1);
    const summary = summarizeRevert(plans);
    return done({
      status: "APPLIED",
      message: `Workspace di nuovo in v1: ${counted(summary.ripristinate, "scheda ripristinata", "schede ripristinate")} dalla copia, ${counted(summary.valutazioniTenute, "valutazione", "valutazioni")} di persone dopo --apply tenute, ${counted(summary.ricostruite, "scheda", "schede")} con i KPI dell'AI in custom_scores.`,
      csv,
      versione: 1,
      riepilogo: summary,
    });
  },
};
