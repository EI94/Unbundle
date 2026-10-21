import type { UseCase } from "@/lib/db/schema";

/**
 * Righe della pagina «Raccolta & ranking» che arrivano al browser (props di
 * `RankingMatrix` e `WavePlanner`, quindi payload RSC di chiunque apra la pagina).
 *
 * La riga di `use_cases` contiene chi propone (`proposedBy`, `submittedByUserId`),
 * l'intake del connettore (`submitterEmail`, `sourceConversation`, `promptSnippet`…)
 * e altri campi interni: ai colleghi non si mostra mai chi ha proposto. Per questo la
 * riga per il client si costruisce campo per campo da un'allowlist, mai con uno spread
 * della riga del database. Il brand di tipo impedisce di passare ai componenti una
 * riga `UseCase` intera: si ottiene solo da `toPortfolioClientItems`.
 */

declare const portfolioItemBrand: unique symbol;

/** Colonne storiche dei KPI: le legge `readUseCaseRawKpiScore` (waves e valori iniziali della review). */
export const PORTFOLIO_SCORE_COLUMNS = [
  "impactEconomic",
  "impactTime",
  "impactQuality",
  "impactCoordination",
  "impactSocial",
  "feasibilityData",
  "feasibilityWorkflow",
  "feasibilityRisk",
  "feasibilityTech",
  "feasibilityTeam",
  "esgEnvironmental",
  "esgSocial",
  "esgGovernance",
] as const;

const OVERALL_SCORE_COLUMNS = [
  "overallImpactScore",
  "overallFeasibilityScore",
  "overallEsgScore",
  "overallScore",
] as const;

const TEXT_COLUMNS = [
  "title",
  "description",
  "businessCase",
  "flowDescription",
  "humanInTheLoop",
  "guardrails",
  "dataRequirements",
  "sustainabilityImpact",
] as const;

/** Campi per chiunque apra la pagina: contenuto del contributo, tipo, stato e punteggi. */
export const PORTFOLIO_CLIENT_ITEM_KEYS = [
  "id",
  ...TEXT_COLUMNS,
  "portfolioKind",
  "portfolioReviewStatus",
  ...OVERALL_SCORE_COLUMNS,
  ...PORTFOLIO_SCORE_COLUMNS,
  "customScores",
] as const;

/** In più solo per chi valuta (`canReviewWorkspacePortfolio`): note della review e versione della riga. */
export const PORTFOLIO_REVIEWER_EXTRA_KEYS = ["reviewNotes", "updatedAt"] as const;

type ClientKey = (typeof PORTFOLIO_CLIENT_ITEM_KEYS)[number];
type ReviewerKey = (typeof PORTFOLIO_REVIEWER_EXTRA_KEYS)[number];

type ClientFields = Pick<UseCase, ClientKey>;

/** Riga per chi non valuta: niente note della review, niente `updatedAt`. */
export type PortfolioClientItem = ClientFields & {
  readonly reviewNotes?: undefined;
  readonly updatedAt?: undefined;
  readonly [portfolioItemBrand]: "client";
};

/**
 * Riga per chi valuta: in più `reviewNotes` (modulo di review) e `updatedAt` (override
 * ottimistici; null se la data non è valida, come arriverebbe comunque al browser).
 */
export type PortfolioReviewerItem = ClientFields &
  Pick<UseCase, "reviewNotes"> & {
    readonly updatedAt: Date | null;
    readonly [portfolioItemBrand]: "reviewer";
  };

export type PortfolioItem = PortfolioClientItem | PortfolioReviewerItem;

/** Il minimo che la proiezione legge: la riga di `use_cases` (o un suo sovrainsieme). */
export type PortfolioSourceRow = Pick<UseCase, ClientKey | ReviewerKey>;

/** Ciò che la pagina legge sul server per scegliere le righe: in più `intake`, mai copiato. */
export type PortfolioPageRow = PortfolioSourceRow & Pick<UseCase, "intake">;

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function score(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function validDate(value: unknown): Date | null {
  const date =
    value instanceof Date
      ? value
      : typeof value === "string" || typeof value === "number"
        ? new Date(value)
        : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `customScores` ricostruito: solo le tre dimensioni e solo valori numerici finiti. */
export function sanitizeCustomScores(value: unknown): UseCase["customScores"] {
  if (!isRecord(value)) return null;
  const out: NonNullable<UseCase["customScores"]> = {};
  for (const dimension of ["impact", "feasibility", "esg"] as const) {
    const scores = value[dimension];
    if (!isRecord(scores)) continue;
    const clean: Record<string, number> = {};
    for (const [kpiId, raw] of Object.entries(scores)) {
      const n = score(raw);
      if (n !== null) clean[kpiId] = n;
    }
    out[dimension] = clean;
  }
  return out;
}

function clientFields(row: PortfolioSourceRow): ClientFields {
  return {
    id: String(row.id),
    title: text(row.title) ?? "",
    description: text(row.description),
    businessCase: text(row.businessCase),
    flowDescription: text(row.flowDescription),
    humanInTheLoop: text(row.humanInTheLoop),
    guardrails: text(row.guardrails),
    dataRequirements: text(row.dataRequirements),
    sustainabilityImpact: text(row.sustainabilityImpact),
    portfolioKind: text(row.portfolioKind),
    portfolioReviewStatus: row.portfolioReviewStatus,
    overallImpactScore: score(row.overallImpactScore),
    overallFeasibilityScore: score(row.overallFeasibilityScore),
    overallEsgScore: score(row.overallEsgScore),
    overallScore: score(row.overallScore),
    impactEconomic: score(row.impactEconomic),
    impactTime: score(row.impactTime),
    impactQuality: score(row.impactQuality),
    impactCoordination: score(row.impactCoordination),
    impactSocial: score(row.impactSocial),
    feasibilityData: score(row.feasibilityData),
    feasibilityWorkflow: score(row.feasibilityWorkflow),
    feasibilityRisk: score(row.feasibilityRisk),
    feasibilityTech: score(row.feasibilityTech),
    feasibilityTeam: score(row.feasibilityTeam),
    esgEnvironmental: score(row.esgEnvironmental),
    esgSocial: score(row.esgSocial),
    esgGovernance: score(row.esgGovernance),
    customScores: sanitizeCustomScores(row.customScores),
  };
}

export function toPortfolioClientItem(row: PortfolioSourceRow): PortfolioClientItem {
  return clientFields(row) as PortfolioClientItem;
}

export function toPortfolioReviewerItem(row: PortfolioSourceRow): PortfolioReviewerItem {
  return {
    ...clientFields(row),
    reviewNotes: text(row.reviewNotes),
    updatedAt: validDate(row.updatedAt),
  } as PortfolioReviewerItem;
}

/** Il filtro dei punti di `RankingMatrix`: entrambi i punteggi complessivi numerici e non entrambi 0. */
export function isPlacedOnMatrix(
  item: Pick<ClientFields, "overallImpactScore" | "overallFeasibilityScore">
): boolean {
  return (
    typeof item.overallImpactScore === "number" &&
    typeof item.overallFeasibilityScore === "number" &&
    (item.overallImpactScore !== 0 || item.overallFeasibilityScore !== 0)
  );
}

/** Il filtro di `buildPortfolioWavePlan`: tipo valorizzato, non archiviato, punteggio complessivo > 0. */
export function isWavePlanCandidate(
  item: Pick<ClientFields, "portfolioKind" | "portfolioReviewStatus" | "overallScore">
): boolean {
  return (
    !!item.portfolioKind &&
    item.portfolioReviewStatus !== "archived" &&
    typeof item.overallScore === "number" &&
    item.overallScore > 0
  );
}

/**
 * Proposta nascosta ai colleghi (`intake.hiddenFromSearch`): come la ricerca del connettore
 * e la scheda «Partecipazione per area», vale il testo `'true'` di `intake ->> 'hiddenFromSearch'`.
 */
export function isHiddenFromColleagues(row: Pick<UseCase, "intake">): boolean {
  const intake: unknown = row.intake;
  if (!isRecord(intake)) return false;
  const flag = intake.hiddenFromSearch;
  return flag === true || flag === "true";
}

/**
 * Le righe che la pagina passa a `RankingMatrix` e `WavePlanner`, secondo chi guarda:
 * solo quelle che la matrice colloca o il piano a wave accetta (le altre non si vedono, quindi
 * non partono) e, per chi non valuta, nessuna proposta nascosta ai colleghi.
 */
export function toPortfolioClientItems(
  rows: readonly PortfolioPageRow[],
  opts: { canReview: boolean }
): PortfolioItem[] {
  const items: PortfolioItem[] = [];
  for (const row of rows) {
    if (!opts.canReview && isHiddenFromColleagues(row)) continue;
    const item = opts.canReview ? toPortfolioReviewerItem(row) : toPortfolioClientItem(row);
    if (isPlacedOnMatrix(item) || isWavePlanCandidate(item)) items.push(item);
  }
  return items;
}
