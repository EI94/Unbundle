/**
 * Il banco di prova e le evals nella CLI (rilascio 8.2a, docs/rilascio-8/BANCO-DI-PROVA.md §2): il corpo di
 * `POST /api/cli/evals`, controllato prima del database con le stesse regole dei CHECK della 0036, e quello che la CLI
 * riceve indietro, con le chiavi in italiano.
 *
 * - **Il controllo (`parseEvalRun`):** ogni campo con un messaggio chiaro, da mostrare così com'è.
 *   - La qualità si ricalcola qui (superate / totali). Quella che manda la CLI, se c'è, deve dire lo stesso (mezzo
 *     punto di tolleranza per l'arrotondamento).
 *   - Il banco ha il ruolo e da 1 a 12 modelli distinti, uno solo «attuale», che è il modello di oggi del ruolo in
 *     «modelli» (obbligatorio: la CLI lo prende da agent.yaml). Le evals hanno un solo risultato, «attuale», e nessun
 *     ruolo.
 *   - «modelliFinti» si dice sempre; «inCostruzione» sempre per le evals. Mancare non vale «no»: un banco finto preso
 *     per vero consiglierebbe un modello, evals in costruzione prese per finite avviserebbero il team.
 *   - Tempi e token medi si arrotondano all'intero, il costo a 6 decimali: quello che si salva è quello che si rilegge,
 *     e la raccomandazione è la stessa prima e dopo.
 * - **Le risposte:** la raccomandazione del banco (`analyzeBench`, la stessa regola della CLI), mai con i modelli finti;
 *   la panoramica di `GET /api/cli/evals`.
 *
 * Mai una persona: né chi lancia il banco, né chi manda le evals.
 * Modulo puro: import relativi `.ts`.
 */
import { EVAL_BRANCH_RE, EVAL_COMMIT_RE, EVAL_GROUP_RE, EVAL_LIMITS, EVAL_VERSION_RE } from "../../db/use-case-hub-evals-ddl.ts";
import {
  LEVEL_RE,
  MODEL_ID_RE,
  ROLE_RE,
  type BenchAnalysis,
  type BenchResult,
  type EvalGroup,
  type EvalOverview,
  type EvalRunKind,
  type EvalRunView,
} from "./benchmark.ts";

export type InputResult<T> = { ok: true; value: T } | { ok: false; message: string };

/** Un banco o delle evals, controllati: quello che si salva. */
export interface EvalRunInput {
  kind: EvalRunKind;
  /** Solo per il banco. */
  role: string | null;
  level: string;
  branch: string | null;
  commit: string | null;
  templateVersion: string | null;
  /** Ruolo → modello, i modelli di oggi. */
  models: Record<string, string>;
  fakeModels: boolean;
  inConstruction: boolean;
  /** Quante prove: il massimo delle totali dei risultati. */
  casesTotal: number;
  results: BenchResult[];
}

/** Quanto può discostarsi la qualità mandata dalla CLI da superate / totali (mezzo punto). */
export const QUALITY_TOLERANCE = 0.005;

const L = EVAL_LIMITS;
const bad = <T>(message: string): InputResult<T> => ({ ok: false, message });
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const absent = (v: unknown) => v === undefined || v === null;

/** Un intero da `min` a `max`. */
function integer(v: unknown, label: string, min: number, max: number): InputResult<number> {
  if (!isNumber(v) || !Number.isInteger(v) || v < min || v > max) return bad(`${label}: un numero intero da ${min} a ${max}.`);
  return { ok: true, value: v };
}

/** Una misura facoltativa (null se non c'è), da 0 a `max`, arrotondata a `decimals` cifre. */
function measure(v: unknown, label: string, max: number, decimals: number, what: string): InputResult<number | null> {
  if (absent(v)) return { ok: true, value: null };
  if (!isNumber(v) || v < 0 || v > max) return bad(`${label}: ${what} da 0 a ${max}, oppure null.`);
  const factor = 10 ** decimals;
  return { ok: true, value: Math.round(v * factor) / factor };
}

/** Un testo facoltativo con la sua regola. */
function optionalText(v: unknown, re: RegExp, message: string): InputResult<string | null> {
  if (absent(v)) return { ok: true, value: null };
  if (typeof v !== "string" || !re.test(v)) return bad(message);
  return { ok: true, value: v };
}

/** Un sì o no: obbligatorio, oppure con il valore di quando manca. */
function flag(v: unknown, label: string, fallback: boolean | null): InputResult<boolean> {
  if (absent(v) && fallback !== null) return { ok: true, value: fallback };
  if (typeof v !== "boolean") return bad(`${label}: true o false.`);
  return { ok: true, value: v };
}

function parseGroups(v: unknown, at: string): InputResult<Record<string, EvalGroup>> {
  if (absent(v)) return { ok: true, value: {} };
  if (!isObject(v)) return bad(`${at}.gruppi: un oggetto, un gruppo di prove per chiave (come «regole»).`);
  const entries = Object.entries(v);
  if (entries.length > L.groupsMax) return bad(`${at}.gruppi: al massimo ${L.groupsMax} gruppi.`);
  const out: Record<string, EvalGroup> = {};
  for (const [name, g] of entries) {
    const label = `${at}.gruppi.${name.slice(0, 40)}`;
    if (!EVAL_GROUP_RE.test(name)) return bad(`${at}.gruppi: il nome di un gruppo è come «regole» o «avversari» (minuscole, cifre, - e _).`);
    if (!isObject(g)) return bad(`${label}: {passati, totali, soglia, ok}.`);
    const passed = integer(g.passati, `${label}.passati`, 0, L.casesMax);
    if (!passed.ok) return passed;
    const total = integer(g.totali, `${label}.totali`, 0, L.casesMax);
    if (!total.ok) return total;
    if (passed.value > total.value) return bad(`${label}: le passate non possono essere più delle totali.`);
    if (!isNumber(g.soglia) || g.soglia < 0 || g.soglia > 1) return bad(`${label}.soglia: la quota da passare, da 0 a 1.`);
    if (typeof g.ok !== "boolean") return bad(`${label}.ok: true o false.`);
    out[name] = { passati: passed.value, totali: total.value, soglia: g.soglia, ok: g.ok };
  }
  return { ok: true, value: out };
}

function parseResult(v: unknown, i: number): InputResult<BenchResult> {
  const at = `risultati[${i}]`;
  if (!isObject(v)) return bad(`${at}: un oggetto con modello, superati, totali e soglie.`);
  if (typeof v.modello !== "string" || !MODEL_ID_RE.test(v.modello)) return bad(`${at}.modello: l'id di un modello, come anthropic/claude-haiku-5-5 (al massimo ${L.model} caratteri).`);
  const current = flag(v.attuale, `${at}.attuale`, false);
  if (!current.ok) return current;
  const passed = integer(v.superati, `${at}.superati`, 0, L.casesMax);
  if (!passed.ok) return passed;
  const total = integer(v.totali, `${at}.totali`, 1, L.casesMax);
  if (!total.ok) return total;
  if (passed.value > total.value) return bad(`${at}: le prove superate non possono essere più delle totali.`);
  const quality = passed.value / total.value;
  if (!absent(v.qualita)) {
    if (!isNumber(v.qualita) || v.qualita < 0 || v.qualita > 1) return bad(`${at}.qualita: da 0 a 1, superate / totali.`);
    if (Math.abs(v.qualita - quality) > QUALITY_TOLERANCE) return bad(`${at}.qualita: deve essere superate / totali (${passed.value}/${total.value}).`);
  }
  const thresholds = flag(v.soglieRispettate, `${at}.soglieRispettate`, null);
  if (!thresholds.ok) return thresholds;
  const groups = parseGroups(v.gruppi, at);
  if (!groups.ok) return groups;
  const cost = measure(v.costoPer1000Usd, `${at}.costoPer1000Usd`, L.costPer1000UsdMax, 6, "il costo stimato in USD");
  if (!cost.ok) return cost;
  const p50 = measure(v.latenzaP50Ms, `${at}.latenzaP50Ms`, L.latencyMsMax, 0, "i millisecondi");
  if (!p50.ok) return p50;
  const p95 = measure(v.latenzaP95Ms, `${at}.latenzaP95Ms`, L.latencyMsMax, 0, "i millisecondi");
  if (!p95.ok) return p95;
  if (p50.value !== null && p95.value !== null && p50.value > p95.value) return bad(`${at}: la latenza p50 non può superare la p95.`);
  const tokensIn = measure(v.tokenIngressoMedi, `${at}.tokenIngressoMedi`, L.tokensAvgMax, 0, "i token medi");
  if (!tokensIn.ok) return tokensIn;
  const tokensOut = measure(v.tokenUscitaMedi, `${at}.tokenUscitaMedi`, L.tokensAvgMax, 0, "i token medi");
  if (!tokensOut.ok) return tokensOut;
  const errors = absent(v.errori) ? ({ ok: true, value: 0 } as const) : integer(v.errori, `${at}.errori`, 0, L.errorsMax);
  if (!errors.ok) return errors;
  return {
    ok: true,
    value: {
      model: v.modello,
      current: current.value,
      quality,
      passed: passed.value,
      total: total.value,
      thresholdsMet: thresholds.value,
      groups: groups.value,
      costPer1000Usd: cost.value,
      latencyP50Ms: p50.value,
      latencyP95Ms: p95.value,
      tokensInAvg: tokensIn.value,
      tokensOutAvg: tokensOut.value,
      errors: errors.value,
    },
  };
}

function parseModels(v: unknown): InputResult<Record<string, string>> {
  if (absent(v)) return { ok: true, value: {} };
  if (!isObject(v)) return bad("modelli: un oggetto, il ruolo e il suo modello di oggi.");
  const entries = Object.entries(v);
  if (entries.length > L.modelsMax) return bad(`modelli: al massimo ${L.modelsMax} ruoli.`);
  const out: Record<string, string> = {};
  for (const [role, model] of entries) {
    if (!ROLE_RE.test(role)) return bad("modelli: ogni chiave è un ruolo di agent.yaml, come «lettura» (minuscole, cifre, - e _).");
    if (typeof model !== "string" || !MODEL_ID_RE.test(model)) return bad(`modelli.${role}: l'id di un modello, come anthropic/claude-haiku-5-5.`);
    out[role] = model;
  }
  return { ok: true, value: out };
}

/** Il corpo di `POST /api/cli/evals` (nomi italiani, come la CLI li manda), controllato. */
export function parseEvalRun(body: Record<string, unknown>): InputResult<EvalRunInput> {
  const kind = body.tipo;
  if (kind !== "banco" && kind !== "evals") return bad("tipo: «banco» oppure «evals».");
  let role: string | null = null;
  if (kind === "banco") {
    if (typeof body.ruolo !== "string" || !ROLE_RE.test(body.ruolo)) return bad("ruolo: il ruolo di agent.yaml che il banco ha provato, come «lettura» (minuscole, cifre, - e _).");
    role = body.ruolo;
  } else if (!absent(body.ruolo)) return bad("ruolo: solo per il banco, non per le evals.");
  if (typeof body.livello !== "string" || !LEVEL_RE.test(body.livello)) return bad(`livello: come «pull_request» o «veloce» (minuscole e _, al massimo ${L.level}).`);
  const level = body.livello;
  const branch = optionalText(body.ramo, EVAL_BRANCH_RE, `ramo: il nome di un ramo git (lettere, cifre, . _ / -), al massimo ${L.branch} caratteri, oppure niente.`);
  if (!branch.ok) return branch;
  const commit = optionalText(body.commit, EVAL_COMMIT_RE, "commit: da 7 a 40 cifre esadecimali in minuscolo, oppure niente.");
  if (!commit.ok) return commit;
  const version = optionalText(body.versioneModello, EVAL_VERSION_RE, "versioneModello: come 1.4.0, oppure niente.");
  if (!version.ok) return version;
  const fake = flag(body.modelliFinti, "modelliFinti", null);
  if (!fake.ok) return fake;
  // Per il banco non conta (non avvisa mai): se manca, no. Per le evals decide l'avviso: si dice sempre.
  const construction = flag(body.inCostruzione, "inCostruzione", kind === "banco" ? false : null);
  if (!construction.ok) return construction;
  const models = parseModels(body.modelli);
  if (!models.ok) return models;

  const raw = body.risultati;
  const max = kind === "banco" ? L.resultsMax : 1;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > max) {
    return bad(kind === "banco" ? `risultati: da 1 a ${L.resultsMax} modelli per il banco.` : "risultati: le evals hanno un solo risultato, quello dei modelli di oggi.");
  }
  const results: BenchResult[] = [];
  const seen = new Set<string>();
  for (const [i, item] of raw.entries()) {
    const parsed = parseResult(item, i);
    if (!parsed.ok) return parsed;
    const key = parsed.value.model.toLowerCase();
    if (seen.has(key)) return bad(`risultati: ogni modello una volta sola (${parsed.value.model} è ripetuto).`);
    seen.add(key);
    results.push(parsed.value);
  }
  const current = results.filter((r) => r.current);
  if (current.length !== 1) {
    return bad(kind === "banco" ? "risultati: esattamente un modello «attuale», quello di oggi del ruolo." : "risultati: il risultato delle evals è quello dei modelli di oggi, «attuale»: true.");
  }
  if (role !== null) {
    // Il banco dice sempre il modello di oggi del suo ruolo (la CLI lo prende da agent.yaml): senza, un ruolo inventato.
    const today = Object.hasOwn(models.value, role) ? models.value[role] : null;
    if (today === null) return bad(`modelli.${role}: il modello di oggi del ruolo del banco, da agent.yaml (${current[0].model}).`);
    if (today !== current[0].model) return bad(`modelli.${role}: il modello di oggi del ruolo è quello «attuale» del banco (${current[0].model}).`);
  }
  return {
    ok: true,
    value: {
      kind,
      role,
      level,
      branch: branch.value,
      commit: commit.value,
      templateVersion: version.value,
      models: models.value,
      fakeModels: fake.value,
      inConstruction: construction.value,
      casesTotal: Math.max(...results.map((r) => r.total)),
      results,
    },
  };
}

// ─── Le risposte alla CLI ────────────────────────────────────────────

/** La raccomandazione per la CLI. Null senza banco o con i modelli finti (il banco ha misurato il codice, non i modelli). */
export interface CliRecommendation {
  tipo: "resta" | "cambia" | "nessuno" | "senza_costi";
  modello?: string;
  testo: string;
}

export function recommendationOf(analysis: BenchAnalysis | null): CliRecommendation | null {
  if (!analysis) return null;
  const v = analysis.verdict;
  if (v.kind === "finti") return null;
  const model = v.kind === "nessuno" ? null : v.model;
  return { tipo: v.kind, ...(model ? { modello: model } : {}), testo: v.text };
}

/** Un risultato con le chiavi della CLI, le stesse del corpo del POST. */
export function resultForCli(r: BenchResult) {
  return {
    modello: r.model,
    attuale: r.current,
    qualita: r.quality,
    superati: r.passed,
    totali: r.total,
    soglieRispettate: r.thresholdsMet,
    gruppi: r.groups,
    costoPer1000Usd: r.costPer1000Usd,
    latenzaP50Ms: r.latencyP50Ms,
    latenzaP95Ms: r.latencyP95Ms,
    tokenIngressoMedi: r.tokensInAvg,
    tokenUscitaMedi: r.tokensOutAvg,
    errori: r.errors,
  };
}

/** Un banco o delle evals con le chiavi della CLI. */
export function runForCli(run: EvalRunView) {
  return {
    id: run.id,
    tipo: run.kind,
    ruolo: run.role,
    livello: run.level,
    ramo: run.branch,
    commit: run.commit,
    versioneModello: run.templateVersion,
    modelli: run.models,
    modelliFinti: run.fakeModels,
    inCostruzione: run.inConstruction,
    prove: run.casesTotal,
    quando: run.createdAt,
    risultati: run.results.map(resultForCli),
  };
}

/**
 * La panoramica per la CLI (`GET /api/cli/evals?caso=<ID>`): le ultime evals con l'andamento (dalla più vecchia) e
 * l'ultimo banco di ogni ruolo, con i tre segni, la frontiera e la raccomandazione.
 */
export function evalOverviewForCli(code: string, o: EvalOverview) {
  return {
    caso: code,
    evals: {
      ultime: o.evals.latest ? runForCli(o.evals.latest) : null,
      andamento: o.evals.trend.map((t) => ({ quando: t.at, qualita: t.quality, soglieRispettate: t.thresholdsMet, modelliFinti: t.fakeModels })),
    },
    banchi: o.benches.map((b) => ({
      ...runForCli(b.run),
      piuBravo: b.analysis.best,
      piuEconomico: b.analysis.cheapest,
      piuEfficiente: b.analysis.efficient,
      frontiera: b.analysis.frontier,
      raccomandazione: recommendationOf(b.analysis),
    })),
  };
}
