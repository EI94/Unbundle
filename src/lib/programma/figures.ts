/**
 * I numeri della prima vista della pagina «Programma» (rilascio 7, RILASCIO-7-PROGETTO.md §3-§4):
 * i quattro risultati, le iniziative, gli agenti da rivedere, le persone e l'indice AI-native.
 * Qui solo numeri; i testi in `text.ts`, i componenti disegnano.
 *
 * - **Risultati** (`programResults`): valore stimato all'anno (approvati, in realizzazione e
 *   realizzati), valore già in uso (realizzati), valore per dipendente (in uso ÷ dipendenti),
 *   indice AI-native. Le cifre sono le somme delle cifre delle card, ognuna arrotondata all'euro,
 *   come la Panoramica.
 * - **Iniziative** (`programInitiatives`): «In uso», «In realizzazione», «Da avviare», con valore
 *   all'anno, costo di avvio e mantenimento all'anno su colonne separate; il canone di Lateral Space
 *   su una riga sua, così i totali tornano. Mai un netto.
 * - **Da rivedere** (`agentsToReview`): uno use case in uso che rende meno di `REVIEW_RATIO` euro
 *   per ogni euro di mantenimento («150 agenti per 1.000 € di incremento: domani quanto costa
 *   mantenerli?», titolare 04/11/2026).
 * - **Indice** (`aiNativeIndex`): la media pesata dei pilastri che hanno dati (§4); un pilastro senza
 *   dati non conta e dice perché.
 * - **Livelli** (`levelDistribution`): quante risposte all'AI Readiness per livello, solo sopra la
 *   soglia del questionario e mai con un gruppo sotto `PEOPLE_THRESHOLD` (i livelli si uniscono a
 *   coppie, oppure la distribuzione non c'è).
 *
 * Art. 15.4: conteggi di use case e di risposte aggregate, mai di una persona.
 * Modulo puro: import relativi `.ts`.
 */
import { roundAmount } from "../use-cases/format.ts";
import type { ProgramCard, ProgramStage } from "./curve.ts";

// ─── Risultati ───────────────────────────────────────────────────────

export interface ProgramResults {
  /** Valore stimato all'anno: approvati, in realizzazione e realizzati. */
  estimated: number;
  /** Su quanti use case con un valore. */
  estimatedCount: number;
  /** Valore già in uso all'anno: i realizzati. */
  inUse: number;
  inUseCount: number;
  /** Il primo mese di entrata in uso previsto, se nessuno è in uso. */
  firstGoLive: ProgramCard["goLiveMonth"] | null;
  /** Valore in uso per dipendente, euro all'anno; null senza dipendenti. */
  perEmployee: number | null;
  /** `perEmployee` sul ricavo per dipendente, in percentuale; null senza ricavo. */
  perEmployeeOfRevenuePct: number | null;
}

/** I risultati dalle schede del programma (`programCards`). */
export function programResults(cards: readonly ProgramCard[], company: { employees: number | null; revenueEur: number | null }): ProgramResults {
  let estimated = 0;
  let estimatedCount = 0;
  let inUse = 0;
  let inUseCount = 0;
  let firstGoLive: ProgramCard["goLiveMonth"] | null = null;
  for (const card of cards) {
    const value = roundAmount(card.value);
    if (value > 0) {
      estimated += value;
      estimatedCount += 1;
    }
    if (card.stage === "in_uso") {
      if (value > 0) {
        inUse += value;
        inUseCount += 1;
      }
    } else if (value > 0 && (firstGoLive === null || card.goLiveMonth < firstGoLive)) {
      firstGoLive = card.goLiveMonth;
    }
  }
  const employees = company.employees && company.employees > 0 ? company.employees : null;
  const perEmployee = employees ? inUse / employees : null;
  const revenuePerEmployee = employees && company.revenueEur && company.revenueEur > 0 ? company.revenueEur / employees : null;
  return {
    estimated,
    estimatedCount,
    inUse,
    inUseCount,
    firstGoLive: inUseCount > 0 ? null : firstGoLive,
    perEmployee,
    perEmployeeOfRevenuePct: perEmployee !== null && revenuePerEmployee ? (perEmployee / revenuePerEmployee) * 100 : null,
  };
}

// ─── Iniziative ──────────────────────────────────────────────────────

export const INITIATIVE_STAGES: readonly ProgramStage[] = Object.freeze(["in_uso", "in_realizzazione", "da_avviare"]);

export interface InitiativeRow {
  stage: ProgramStage;
  count: number;
  /** Somme delle cifre arrotondate una a una. */
  value: number;
  oneoff: number;
  run: number;
  /** Di cui sviluppo di Lateral Space, nel costo di avvio. */
  lsDev: number;
  /** Le schede, dalla più grande per valore. */
  cards: ProgramCard[];
}

/** Le tre righe delle iniziative; una riga senza use case non c'è. */
export function programInitiatives(cards: readonly ProgramCard[]): InitiativeRow[] {
  return INITIATIVE_STAGES.flatMap((stage) => {
    const own = cards.filter((card) => card.stage === stage).sort((a, b) => b.value - a.value || (a.code ?? "").localeCompare(b.code ?? "") || a.id.localeCompare(b.id));
    if (!own.length) return [];
    return [
      {
        stage,
        count: own.length,
        value: own.reduce((sum, card) => sum + roundAmount(card.value), 0),
        oneoff: own.reduce((sum, card) => sum + roundAmount(card.oneoff), 0),
        run: own.reduce((sum, card) => sum + roundAmount(card.run), 0),
        lsDev: own.reduce((sum, card) => sum + roundAmount(card.lsDev), 0),
        cards: own,
      },
    ];
  });
}

// ─── Da rivedere ─────────────────────────────────────────────────────

/** Sotto quanti euro di valore per euro di mantenimento uno use case in uso è da rivedere. */
export const REVIEW_RATIO = 2;

export interface ReviewItem {
  card: ProgramCard;
  /** Euro di valore per ogni euro di mantenimento. */
  ratio: number;
}

/** Gli use case in uso con mantenimento che rendono meno di `REVIEW_RATIO` volte quanto costa tenerli accesi, dal peggiore. */
export function agentsToReview(cards: readonly ProgramCard[]): ReviewItem[] {
  return cards
    .filter((card) => card.stage === "in_uso" && card.run > 0)
    .map((card) => ({ card, ratio: card.value / card.run }))
    .filter((entry) => entry.ratio < REVIEW_RATIO)
    .sort((a, b) => a.ratio - b.ratio || a.card.id.localeCompare(b.card.id));
}

// ─── Indice AI-native ────────────────────────────────────────────────

export const INDEX_PILLARS = ["persone", "use_case", "valore", "adozione"] as const;
export type IndexPillar = (typeof INDEX_PILLARS)[number];
export type IndexWeights = Record<IndexPillar, number>;

export const DEFAULT_INDEX_WEIGHTS: Readonly<IndexWeights> = Object.freeze({ persone: 25, use_case: 25, valore: 25, adozione: 25 });

/** Perché un pilastro non conta. */
export type PillarGap = "dipendenti" | "formazione" | "use_case" | "valore" | "adozione";

/** Da dove viene il numero dell'adozione. */
export type AdoptionSource = "kpi" | "ai_readiness";

export interface PillarScore {
  pillar: IndexPillar;
  /** Da 0 a 100; null se non conta. */
  score: number | null;
  weight: number;
  gap: PillarGap | null;
  /** Solo per l'adozione: la fonte. */
  source?: AdoptionSource;
}

export interface AiNativeIndex {
  /** Da 0 a 100, arrotondato; null se nessun pilastro conta. */
  value: number | null;
  pillars: PillarScore[];
}

/** Il peso di una fase nel pilastro «Use case». */
const PHASE_PROGRESS: Readonly<Record<ProgramStage, number>> = Object.freeze({ da_avviare: 1 / 3, in_realizzazione: 2 / 3, in_uso: 1 });

export interface IndexInput {
  cards: readonly ProgramCard[];
  results: Pick<ProgramResults, "estimated" | "inUse">;
  /** Persone formate (distinte, presenti ad almeno una sessione); null senza formazione. */
  trained: number | null;
  employees: number | null;
  /** Uso settimanale dell'AI, percentuale scritta a mano (KPI); null senza. */
  weeklyUsePct: number | null;
  /** Pilastro «Adozione» dell'AI Readiness da 0 a 5, solo sopra soglia; null senza. */
  readinessAdoption: number | null;
  weights?: Partial<IndexWeights> | null;
}

const clamp100 = (n: number) => Math.max(0, Math.min(100, n));

/** Pesi validi: numeri da 0 a 100; quelli che mancano prendono il predefinito. */
export function indexWeightsOf(weights: Partial<IndexWeights> | null | undefined): IndexWeights {
  const out = { ...DEFAULT_INDEX_WEIGHTS };
  for (const pillar of INDEX_PILLARS) {
    const w = weights?.[pillar];
    if (typeof w === "number" && Number.isFinite(w) && w >= 0 && w <= 100) out[pillar] = w;
  }
  return out;
}

/** L'indice AI-native e i suoi quattro pilastri (§4). */
export function aiNativeIndex(input: IndexInput): AiNativeIndex {
  const weights = indexWeightsOf(input.weights);
  const pillars: PillarScore[] = [];

  if (!input.employees || input.employees <= 0) pillars.push({ pillar: "persone", score: null, weight: weights.persone, gap: "dipendenti" });
  else if (input.trained === null) pillars.push({ pillar: "persone", score: null, weight: weights.persone, gap: "formazione" });
  else pillars.push({ pillar: "persone", score: clamp100((input.trained / input.employees) * 100), weight: weights.persone, gap: null });

  if (!input.cards.length) pillars.push({ pillar: "use_case", score: null, weight: weights.use_case, gap: "use_case" });
  else {
    const progress = input.cards.reduce((sum, card) => sum + PHASE_PROGRESS[card.stage], 0) / input.cards.length;
    pillars.push({ pillar: "use_case", score: clamp100(progress * 100), weight: weights.use_case, gap: null });
  }

  if (!(input.results.estimated > 0)) pillars.push({ pillar: "valore", score: null, weight: weights.valore, gap: "valore" });
  else pillars.push({ pillar: "valore", score: clamp100((input.results.inUse / input.results.estimated) * 100), weight: weights.valore, gap: null });

  if (input.weeklyUsePct !== null) pillars.push({ pillar: "adozione", score: clamp100(input.weeklyUsePct), weight: weights.adozione, gap: null, source: "kpi" });
  else if (input.readinessAdoption !== null) pillars.push({ pillar: "adozione", score: clamp100((input.readinessAdoption / 5) * 100), weight: weights.adozione, gap: null, source: "ai_readiness" });
  else pillars.push({ pillar: "adozione", score: null, weight: weights.adozione, gap: "adozione" });

  const counted = pillars.filter((p) => p.score !== null && p.weight > 0);
  const total = counted.reduce((sum, p) => sum + p.weight, 0);
  const value = total > 0 ? Math.round(counted.reduce((sum, p) => sum + (p.score as number) * p.weight, 0) / total) : null;
  return { value, pillars };
}

// ─── Persone ─────────────────────────────────────────────────────────

/** Sotto quante persone un numero non si scrive: «meno di 5» (art. 15.4, la regola dei 5). */
export const PEOPLE_THRESHOLD = 5;

export interface LevelBar {
  /** «Livello 2», «Livelli 0–1». */
  label: string;
  /** I livelli del gruppo, da 0 a 5. */
  levels: number[];
  count: number;
  /** Quota sul totale, da 0 a 1, per la larghezza della barra. */
  share: number;
}

export interface LevelDistribution {
  total: number;
  bars: LevelBar[];
  /** Vero se i sei livelli sono stati uniti a coppie perché un livello aveva meno di 5 risposte. */
  grouped: boolean;
}

/** I tre gruppi quando un livello da solo ha meno di 5 risposte: 0–1, 2–3, 4–5. */
const LEVEL_GROUPS: readonly (readonly number[])[] = [
  [0, 1],
  [2, 3],
  [4, 5],
];

/**
 * Quante risposte per livello di maturità (0-5), dai livelli delle risposte inviate. Mai un gruppo con
 * meno di `PEOPLE_THRESHOLD` risposte, nemmeno per sottrazione (art. 15.4):
 * - se ogni livello con risposte ne ha almeno 5, i sei livelli;
 * - altrimenti i livelli uniti a coppie (0–1, 2–3, 4–5), se ogni coppia con risposte ne ha almeno 5;
 * - altrimenti nessuna distribuzione (null).
 * Anche null sotto la soglia del questionario (o sotto 5, se è più bassa).
 */
export function levelDistribution(levels: readonly number[], threshold: number): LevelDistribution | null {
  const min = Math.max(PEOPLE_THRESHOLD, threshold);
  if (levels.length < min) return null;
  const counts = [0, 0, 0, 0, 0, 0];
  for (const level of levels) counts[Math.max(0, Math.min(5, Math.round(level)))] += 1;
  const safe = (groups: readonly (readonly number[])[]) => groups.every((g) => {
    const n = g.reduce((sum, l) => sum + counts[l], 0);
    return n === 0 || n >= PEOPLE_THRESHOLD;
  });
  const single = counts.map((_, l) => [l]);
  const groups = safe(single) ? single : safe(LEVEL_GROUPS) ? LEVEL_GROUPS : null;
  if (!groups) return null;
  return {
    total: levels.length,
    grouped: groups === LEVEL_GROUPS,
    bars: groups.map((g) => {
      const count = g.reduce((sum, l) => sum + counts[l], 0);
      return { label: g.length === 1 ? `Livello ${g[0]}` : `Livelli ${g[0]}–${g[g.length - 1]}`, levels: [...g], count, share: count / levels.length };
    }),
  };
}
