/**
 * Il banco di prova e le evals di un caso (rilascio 8.2a, docs/rilascio-8/BANCO-DI-PROVA.md).
 *
 * - **Il banco:** le evals del caso rifatte con ogni modello approvato per un ruolo. Tra i modelli che rispettano le
 *   soglie e hanno il costo noto: il più bravo (qualità più alta), il più economico (costo per 1.000 esecuzioni più
 *   basso), il più efficiente (il più economico a non più di 2 punti dal più bravo), la frontiera (nessun altro li batte
 *   insieme su qualità e costo). Poi la raccomandazione: resta, cambia, nessuno rispetta le soglie, costi non noti.
 * - **Le evals:** l'esito delle evals con i modelli di oggi; l'avviso quando sono sotto soglia o scendono di 5 punti
 *   rispetto alle precedenti dello stesso ramo e degli stessi modelli (veri o finti).
 *
 * Per caso e per ruolo, mai per persona. La stessa regola sta nella CLI del modello (`unbundle banco`).
 * Modulo puro: niente database, niente rete.
 */

/** Quanti punti di qualità (0..1) separano ancora due modelli «alla pari». */
export const BENCH_TOLERANCE = 0.02;
/** Il risparmio minimo perché convenga cambiare modello (10 %). */
export const BENCH_MIN_SAVING = 0.1;
/** Di quanto devono scendere le evals perché sia un calo (5 punti). */
export const EVALS_DROP = 0.05;
/** Quanti risultati al massimo in un banco. */
export const BENCH_MAX_RESULTS = 12;

/** La regola di un id di modello: la stessa di `use_case_build_sessions.model`. */
export const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,79}$/;
/** Un ruolo di `agent.yaml` («lettura», «scrittura»…). */
export const ROLE_RE = /^[a-z][a-z0-9_-]{0,39}$/;
/** Un livello delle evals («pull_request», «veloce»…). */
export const LEVEL_RE = /^[a-z_]{1,20}$/;

export type EvalRunKind = "banco" | "evals";

/** Un gruppo di prove (regole, avversari, casi) con la sua soglia. */
export interface EvalGroup {
  passati: number;
  totali: number;
  soglia: number;
  ok: boolean;
}

/** L'esito di un modello in un banco, o dei modelli di oggi nelle evals. */
export interface BenchResult {
  model: string;
  current: boolean;
  /** Superate / totali, da 0 a 1. */
  quality: number;
  passed: number;
  total: number;
  thresholdsMet: boolean;
  groups: Record<string, EvalGroup>;
  /** Costo stimato per 1.000 esecuzioni, in USD; null se non noto. */
  costPer1000Usd: number | null;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  tokensInAvg: number | null;
  tokensOutAvg: number | null;
  errors: number;
}

export type BenchVerdict =
  | { kind: "resta"; model: string; text: string }
  | { kind: "cambia"; model: string; from: string; saving: number | null; text: string }
  | { kind: "nessuno"; text: string }
  | { kind: "senza_costi"; model: string | null; text: string }
  | { kind: "finti"; text: string };

export interface BenchAnalysis {
  best: string | null;
  cheapest: string | null;
  efficient: string | null;
  /** I modelli che nessun altro batte insieme su qualità e costo, dal più economico. */
  frontier: string[];
  verdict: BenchVerdict;
}

const NAMES: Record<string, string> = {
  "claude-fable-5-2": "Claude Fable 5.2",
  "claude-fable-5-1": "Claude Fable 5.1",
  "claude-fable-5": "Claude Fable 5",
  "claude-opus-5-5": "Claude Opus 5.5",
  "claude-opus-5": "Claude Opus 5",
  "claude-opus-4-8": "Claude Opus 4.8",
  "claude-opus-4-7": "Claude Opus 4.7",
  "claude-opus-4-6": "Claude Opus 4.6",
  "claude-sonnet-5-5": "Claude Sonnet 5.5",
  "claude-sonnet-5": "Claude Sonnet 5",
  "claude-sonnet-4-6": "Claude Sonnet 4.6",
  "claude-haiku-5-5": "Claude Haiku 5.5",
  "claude-haiku-4-5": "Claude Haiku 4.5",
};

/** Il nome da mostrare: «Claude Haiku 5.5» per `anthropic/claude-haiku-5-5`, altrimenti l'id senza il fornitore. */
export function modelLabel(id: string): string {
  const bare = id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id;
  return NAMES[bare] ?? bare;
}

const PCT = new Intl.NumberFormat("it-IT", { style: "percent", maximumFractionDigits: 1 });
const USD = new Intl.NumberFormat("it-IT", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });

/** «96,4%». */
export function formatQuality(q: number): string {
  return PCT.format(q);
}

/** «0,42 USD»; sotto il centesimo con più cifre («0,0035 USD»). */
export function formatCost(usd: number): string {
  return USD.format(usd);
}

const priced = (r: BenchResult) => r.costPer1000Usd !== null && Number.isFinite(r.costPer1000Usd);
const byQualityThenCost = (a: BenchResult, b: BenchResult) => b.quality - a.quality || (a.costPer1000Usd ?? Infinity) - (b.costPer1000Usd ?? Infinity) || a.model.localeCompare(b.model);
const byCostThenQuality = (a: BenchResult, b: BenchResult) => (a.costPer1000Usd ?? Infinity) - (b.costPer1000Usd ?? Infinity) || b.quality - a.quality || a.model.localeCompare(b.model);

/** La frontiera: i modelli che nessun altro batte insieme (qualità ≥ e costo ≤, con almeno una delle due migliore). */
function frontierOf(rows: readonly BenchResult[]): BenchResult[] {
  return rows
    .filter((r) => !rows.some((o) => o !== r && o.quality >= r.quality && (o.costPer1000Usd as number) <= (r.costPer1000Usd as number) && (o.quality > r.quality || (o.costPer1000Usd as number) < (r.costPer1000Usd as number))))
    .sort(byCostThenQuality);
}

/**
 * La lettura di un banco e la raccomandazione per il ruolo. `fakeModels`: il banco è girato con i modelli finti, che
 * misurano il codice e non il modello: nessuna raccomandazione.
 */
export function analyzeBench(results: readonly BenchResult[], o: { role: string; fakeModels: boolean; tolerance?: number; minSaving?: number }): BenchAnalysis {
  const tolerance = o.tolerance ?? BENCH_TOLERANCE;
  const minSaving = o.minSaving ?? BENCH_MIN_SAVING;
  const role = `«${o.role}»`;
  const current = results.find((r) => r.current) ?? null;
  const passing = results.filter((r) => r.thresholdsMet);
  const pricedPassing = passing.filter(priced);
  const best = [...passing].sort(byQualityThenCost)[0] ?? null;
  const cheapest = [...pricedPassing].sort(byCostThenQuality)[0] ?? null;
  const bestPriced = [...pricedPassing].sort(byQualityThenCost)[0] ?? null;
  const efficient = bestPriced ? ([...pricedPassing].filter((r) => r.quality >= bestPriced.quality - tolerance - 1e-9).sort(byCostThenQuality)[0] ?? null) : null;
  const frontier = frontierOf(pricedPassing).map((r) => r.model);
  const base = { best: best?.model ?? null, cheapest: cheapest?.model ?? null, efficient: efficient?.model ?? null, frontier };

  if (o.fakeModels) return { ...base, best: null, cheapest: null, efficient: null, frontier: [], verdict: { kind: "finti", text: "Modelli finti: il banco ha misurato il codice, non i modelli. Per scegliere un modello serve il banco con i modelli veri." } };
  if (!passing.length) return { ...base, verdict: { kind: "nessuno", text: `Nessun modello rispetta le soglie per ${role}: prima le evals, poi il modello.` } };
  if (!pricedPassing.length || !efficient) {
    const top = best;
    return {
      ...base,
      verdict: { kind: "senza_costi", model: top?.model ?? null, text: top ? `Costi non noti: per qualità il migliore per ${role} è ${modelLabel(top.model)} (${formatQuality(top.quality)}). Aggiungi i prezzi in agent-factory.yaml per il confronto dei costi.` : `Costi non noti per ${role}.` },
    };
  }
  if (!current) return { ...base, verdict: { kind: "cambia", model: efficient.model, from: "", saving: null, text: `Per ${role} il più conveniente che rispetta le soglie è ${modelLabel(efficient.model)}.` } };

  const describe = (r: BenchResult) => `${formatQuality(r.quality)}${priced(r) ? `, ${formatCost(r.costPer1000Usd as number)} per 1.000 esecuzioni` : ""}`;
  if (!current.thresholdsMet) {
    return {
      ...base,
      verdict: {
        kind: "cambia",
        model: efficient.model,
        from: current.model,
        saving: priced(current) ? 1 - (efficient.costPer1000Usd as number) / (current.costPer1000Usd as number) : null,
        text: `${modelLabel(current.model)} non rispetta le soglie per ${role} (${formatQuality(current.quality)}): conviene ${modelLabel(efficient.model)} (${describe(efficient)}).`,
      },
    };
  }
  if (!priced(current)) {
    return {
      ...base,
      verdict: {
        kind: "senza_costi",
        model: efficient.model,
        text: `Il costo di ${modelLabel(current.model)} non è noto: tra i modelli con il prezzo, per ${role} il più conveniente è ${modelLabel(efficient.model)} (${describe(efficient)}). Aggiungi il prezzo in agent-factory.yaml per confrontarli.`,
      },
    };
  }
  if (efficient.model === current.model) {
    return { ...base, verdict: { kind: "resta", model: current.model, text: `Resta ${modelLabel(current.model)} per ${role}: è già il più conveniente che rispetta le soglie (${describe(current)}).` } };
  }
  const saving = 1 - (efficient.costPer1000Usd as number) / (current.costPer1000Usd as number);
  if (efficient.quality >= current.quality - tolerance - 1e-9 && saving >= minSaving - 1e-9) {
    return {
      ...base,
      verdict: {
        kind: "cambia",
        model: efficient.model,
        from: current.model,
        saving,
        text: `Conviene ${modelLabel(efficient.model)} per ${role}: ${describe(efficient)}, contro ${describe(current)} di ${modelLabel(current.model)} (${PCT.format(-saving)} di costo).`,
      },
    };
  }
  return { ...base, verdict: { kind: "resta", model: current.model, text: `Resta ${modelLabel(current.model)} per ${role}: nessun altro modello costa almeno il 10% in meno con la stessa qualità (${describe(current)}).` } };
}

/** Un punto delle evals con i modelli di oggi. */
export interface EvalPoint {
  quality: number;
  thresholdsMet: boolean;
  fakeModels: boolean;
  inConstruction: boolean;
  branch: string | null;
}

export type EvalsAlert = { kind: "sotto_soglia"; drop: number | null } | { kind: "in_calo"; drop: number } | null;

/**
 * L'avviso delle evals: sotto soglia (mai per un caso in costruzione, versione 0.x), oppure giù di almeno 5 punti
 * rispetto alle precedenti dello stesso ramo con gli stessi modelli (veri con veri, finti con finti).
 */
export function evalsAlert(previous: EvalPoint | null, current: EvalPoint): EvalsAlert {
  const comparable = previous && previous.fakeModels === current.fakeModels && previous.branch === current.branch ? previous : null;
  const drop = comparable ? comparable.quality - current.quality : null;
  if (!current.thresholdsMet && !current.inConstruction) return { kind: "sotto_soglia", drop };
  if (drop !== null && drop >= EVALS_DROP - 1e-9) return { kind: "in_calo", drop };
  return null;
}

/** Un banco o delle evals come li mostra la pagina. */
export interface EvalRunView {
  id: string;
  kind: EvalRunKind;
  role: string | null;
  level: string;
  branch: string | null;
  commit: string | null;
  templateVersion: string | null;
  models: Record<string, string>;
  fakeModels: boolean;
  inConstruction: boolean;
  casesTotal: number;
  createdAt: string;
  results: BenchResult[];
}

/** Quello che la pagina mostra di un caso: le evals di oggi con l'andamento, e l'ultimo banco per ogni ruolo. */
export interface EvalOverview {
  evals: {
    latest: EvalRunView | null;
    /** Le ultime evals dello stesso ramo dell'ultima, dalla più vecchia. */
    trend: { at: string; quality: number; thresholdsMet: boolean; fakeModels: boolean }[];
  };
  benches: { role: string; run: EvalRunView; analysis: BenchAnalysis }[];
}
