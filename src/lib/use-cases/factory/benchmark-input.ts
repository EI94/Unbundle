/**
 * Il banco di prova e le evals nella CLI (rilascio 8.2a, docs/rilascio-8/BANCO-DI-PROVA.md §2): il corpo di
 * `POST /api/cli/evals`, controllato prima del database con le stesse regole dei CHECK della 0036, e quello che la CLI
 * riceve indietro, con le chiavi in italiano.
 *
 * - **Il controllo (`parseEvalRun`):** ogni campo con un messaggio chiaro, da mostrare così com'è.
 *   - La qualità si ricalcola qui (superate / totali). Quella che manda la CLI, se c'è, deve dire lo stesso (mezzo
 *     punto di tolleranza per l'arrotondamento).
 *   - Il banco ha il ruolo e da 1 a 12 modelli distinti, uno solo «attuale», che è il modello di oggi del ruolo in
 *     «modelli» (obbligatorio: la CLI lo prende da agent.yaml). Le evals hanno un solo risultato, «attuale», nessun
 *     ruolo e «modelli» con almeno un ruolo (obbligatorio: la CLI li prende da agent.yaml; dicono se un banco è stato
 *     seguito).
 *   - «modelliFinti» si dice sempre; «inCostruzione» sempre per le evals. Mancare non vale «no»: un banco finto preso
 *     per vero consiglierebbe un modello, evals in costruzione prese per finite avviserebbero il team.
 *   - Tempi e token medi si arrotondano all'intero, il costo a 6 decimali: quello che si salva è quello che si rilegge,
 *     e la raccomandazione è la stessa prima e dopo.
 * - **Le risposte:** la raccomandazione del banco (`analyzeBench`, la stessa regola della CLI), mai con i modelli finti;
 *   la panoramica di `GET /api/cli/evals`, (8.2b) con la fonte di ogni esecuzione (`fonte`, `ci`).
 * - **(Casi senza AI, docs/rilascio-8/CASI-SENZA-AI.md §4)** `senzaAi: true` (facoltativo; se manca, no): solo evals,
 *   `modelli` assente o {}, `modelliFinti: false`, un solo risultato «attuale» senza modello, costi né token. Si salva
 *   con l'id riservato `senza-ai` (`NO_AI_MODEL`), che senza `senzaAi` non si può usare, né nei modelli né nei risultati.
 *   Le letture dicono `senzaAi` di ogni esecuzione; la risposta a un invio lo dice solo per un caso senza AI, e
 *   l'impronta dell'idempotenza degli altri invii resta quella di prima (`evalRunFingerprint`).
 *
 * Mai una persona: né chi lancia il banco, né chi manda le evals.
 * Modulo puro: import relativi `.ts`.
 */
import { EVAL_BRANCH_RE, EVAL_COMMIT_RE, EVAL_GROUP_RE, EVAL_LIMITS, EVAL_VERSION_RE } from "../../db/use-case-hub-evals-ddl.ts";
import {
  LEVEL_RE,
  MODEL_ID_RE,
  NO_AI_MODEL,
  ROLE_RE,
  type BenchAnalysis,
  type BenchResult,
  type EvalGroup,
  type EvalOverview,
  type EvalRunKind,
  type EvalRunView,
  type EvalsAlert,
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
  /**
   * (Casi senza AI) Le evals di un caso senza AI (`senzaAi: true`): `models` vuoto, `fakeModels` falso, un solo risultato
   * con il modello `senza-ai` e senza costi né token.
   */
  withoutAi: boolean;
  /** Quante prove: il massimo delle totali dei risultati. */
  casesTotal: number;
  results: BenchResult[];
}

/** Quanto può discostarsi la qualità mandata dalla CLI da superate / totali (mezzo punto). */
export const QUALITY_TOLERANCE = 0.005;

/**
 * (Casi senza AI, §4) I messaggi di un corpo con `senzaAi: true` sbagliato, e quello dell'id riservato in un corpo senza
 * (nei modelli o nei risultati, anche del banco). Quelli di un risultato dicono il campo (`noAiModelMessage`,
 * `noAiMeasureMessage`).
 */
export const NO_AI_MESSAGES = Object.freeze({
  bench: "Un caso senza AI non ha un banco di prova: non ci sono modelli da confrontare.",
  models: "modelli: un caso senza AI non ha ruoli né modelli (senza_ai: true e modelli: {} in agent.yaml).",
  fakeModels: "modelliFinti: un caso senza AI non ha modelli da sostituire, quindi false.",
  reserved: "senza-ai è riservato ai casi senza AI: dichiaralo con senzaAi: true.",
});

/** (Casi senza AI) «risultati[0].modello: …»: un caso senza AI non ha modello. */
export const noAiModelMessage = (at: string) => `${at}.modello: un caso senza AI non ha modello (lascialo vuoto).`;
/** (Casi senza AI) «risultati[0].costoPer1000Usd: …»: un caso senza AI non ha costi né token dei modelli. */
export const noAiMeasureMessage = (label: string) => `${label}: un caso senza AI non ha costi né token dei modelli.`;

/**
 * Le evals senza i modelli di oggi, con il suggerimento per un caso senza AI (§4): la CLI fino alla 1.7.0 non manda
 * `senzaAi`.
 */
export const EVALS_MODELS_MESSAGE =
  "modelli: per le evals, ogni ruolo di agent.yaml con il suo modello di oggi (almeno uno). Se il caso non usa modelli, manda senzaAi: true (senza_ai: true in agent.yaml, modello 1.7.0 o successivo).";

/** L'id riservato dei casi senza AI, scritto in qualunque modo: senza `senzaAi` non è un modello. */
const isNoAiModel = (model: string) => model.toLowerCase() === NO_AI_MODEL;

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

/**
 * Il modello di un risultato: l'id di un modello, mai quello riservato. (Casi senza AI) Per un caso senza AI manca, o è
 * l'id riservato: si salva sempre quello.
 */
function resultModel(v: unknown, at: string, withoutAi: boolean): InputResult<string> {
  if (withoutAi) return absent(v) || v === NO_AI_MODEL ? { ok: true, value: NO_AI_MODEL } : bad(noAiModelMessage(at));
  if (typeof v !== "string" || !MODEL_ID_RE.test(v)) return bad(`${at}.modello: l'id di un modello, come anthropic/claude-haiku-5-5 (al massimo ${L.model} caratteri).`);
  if (isNoAiModel(v)) return bad(NO_AI_MESSAGES.reserved);
  return { ok: true, value: v };
}

/** Una misura dei modelli (il costo, i token). (Casi senza AI) Per un caso senza AI non c'è: manca, o è null. */
function modelMeasure(v: unknown, label: string, max: number, decimals: number, what: string, withoutAi: boolean): InputResult<number | null> {
  if (!withoutAi) return measure(v, label, max, decimals, what);
  return absent(v) ? { ok: true, value: null } : bad(noAiMeasureMessage(label));
}

function parseResult(v: unknown, i: number, withoutAi: boolean): InputResult<BenchResult> {
  const at = `risultati[${i}]`;
  if (!isObject(v)) return bad(`${at}: un oggetto con modello, superati, totali e soglie.`);
  const model = resultModel(v.modello, at, withoutAi);
  if (!model.ok) return model;
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
  const cost = modelMeasure(v.costoPer1000Usd, `${at}.costoPer1000Usd`, L.costPer1000UsdMax, 6, "il costo stimato in USD", withoutAi);
  if (!cost.ok) return cost;
  const p50 = measure(v.latenzaP50Ms, `${at}.latenzaP50Ms`, L.latencyMsMax, 0, "i millisecondi");
  if (!p50.ok) return p50;
  const p95 = measure(v.latenzaP95Ms, `${at}.latenzaP95Ms`, L.latencyMsMax, 0, "i millisecondi");
  if (!p95.ok) return p95;
  if (p50.value !== null && p95.value !== null && p50.value > p95.value) return bad(`${at}: la latenza p50 non può superare la p95.`);
  const tokensIn = modelMeasure(v.tokenIngressoMedi, `${at}.tokenIngressoMedi`, L.tokensAvgMax, 0, "i token medi", withoutAi);
  if (!tokensIn.ok) return tokensIn;
  const tokensOut = modelMeasure(v.tokenUscitaMedi, `${at}.tokenUscitaMedi`, L.tokensAvgMax, 0, "i token medi", withoutAi);
  if (!tokensOut.ok) return tokensOut;
  const errors = absent(v.errori) ? ({ ok: true, value: 0 } as const) : integer(v.errori, `${at}.errori`, 0, L.errorsMax);
  if (!errors.ok) return errors;
  return {
    ok: true,
    value: {
      model: model.value,
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

function parseModels(v: unknown, withoutAi: boolean): InputResult<Record<string, string>> {
  if (absent(v)) return { ok: true, value: {} };
  // (Casi senza AI) Nessun ruolo e nessun modello: `modelli` manca, o è {}.
  if (withoutAi) return isObject(v) && Object.keys(v).length === 0 ? { ok: true, value: {} } : bad(NO_AI_MESSAGES.models);
  if (!isObject(v)) return bad("modelli: un oggetto, il ruolo e il suo modello di oggi.");
  const entries = Object.entries(v);
  if (entries.length > L.modelsMax) return bad(`modelli: al massimo ${L.modelsMax} ruoli.`);
  const out: Record<string, string> = {};
  for (const [role, model] of entries) {
    if (!ROLE_RE.test(role)) return bad("modelli: ogni chiave è un ruolo di agent.yaml, come «lettura» (minuscole, cifre, - e _).");
    if (typeof model !== "string" || !MODEL_ID_RE.test(model)) return bad(`modelli.${role}: l'id di un modello, come anthropic/claude-haiku-5-5.`);
    if (isNoAiModel(model)) return bad(NO_AI_MESSAGES.reserved);
    out[role] = model;
  }
  return { ok: true, value: out };
}

/** Il corpo di `POST /api/cli/evals` (nomi italiani, come la CLI li manda), controllato. */
export function parseEvalRun(body: Record<string, unknown>): InputResult<EvalRunInput> {
  const kind = body.tipo;
  if (kind !== "banco" && kind !== "evals") return bad("tipo: «banco» oppure «evals».");
  // (Casi senza AI) Facoltativo: se manca, no, e tutto resta come prima. Un caso senza AI manda solo le evals.
  const noAi = flag(body.senzaAi, "senzaAi", false);
  if (!noAi.ok) return noAi;
  const withoutAi = noAi.value;
  if (withoutAi && kind === "banco") return bad(NO_AI_MESSAGES.bench);
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
  if (withoutAi && fake.value) return bad(NO_AI_MESSAGES.fakeModels);
  // Per il banco non conta (non avvisa mai): se manca, no. Per le evals decide l'avviso: si dice sempre.
  const construction = flag(body.inCostruzione, "inCostruzione", kind === "banco" ? false : null);
  if (!construction.ok) return construction;
  const models = parseModels(body.modelli, withoutAi);
  if (!models.ok) return models;

  const raw = body.risultati;
  const max = kind === "banco" ? L.resultsMax : 1;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > max) {
    return bad(kind === "banco" ? `risultati: da 1 a ${L.resultsMax} modelli per il banco.` : "risultati: le evals hanno un solo risultato, quello dei modelli di oggi.");
  }
  const results: BenchResult[] = [];
  const seen = new Set<string>();
  for (const [i, item] of raw.entries()) {
    const parsed = parseResult(item, i, withoutAi);
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
  // Le evals dicono i modelli di oggi di agent.yaml, come la CLI li manda sempre: senza, un banco già seguito non si
  // riconosce più (benchSuperseded), e il consiglio sparirebbe o resterebbe a caso. Un caso senza AI non ne ha.
  if (kind === "evals" && !withoutAi && Object.keys(models.value).length === 0) return bad(EVALS_MODELS_MESSAGE);
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
      withoutAi,
      casesTotal: Math.max(...results.map((r) => r.total)),
      results,
    },
  };
}

/**
 * (Casi senza AI) Vero se un invio rispetta il segno dei casi senza AI, come lo lascia `parseEvalRun`: le evals di un
 * caso senza AI (`withoutAi`) hanno solo il risultato `senza-ai`, senza modelli, costi né token; gli altri invii non
 * usano mai `senza-ai`. Lo ricontrolla chi scrive (`recordEvalRun`): un invio che non lo rispetta si leggerebbe per
 * quello che non è.
 */
export function noAiMarkConsistent(input: EvalRunInput): boolean {
  if (!input.withoutAi) return !input.results.some((r) => isNoAiModel(r.model)) && !Object.values(input.models).some(isNoAiModel);
  return (
    input.kind === "evals" &&
    !input.fakeModels &&
    Object.keys(input.models).length === 0 &&
    input.results.every((r) => r.model === NO_AI_MODEL && r.costPer1000Usd === null && r.tokensInAvg === null && r.tokensOutAvg === null)
  );
}

/**
 * (Casi senza AI) L'invio controllato di cui si fa l'impronta per l'idempotenza (`runCliWrite`, `ciEvalsWriteBody`):
 * `withoutAi` solo quando è vero. Così l'impronta degli invii di prima resta la stessa, e una ripresa a cavallo del
 * rilascio risponde ancora «ripetuta».
 */
export function evalRunFingerprint(input: EvalRunInput): Record<string, unknown> {
  const { withoutAi, ...before } = input;
  return withoutAi ? { ...before, withoutAi } : before;
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

/**
 * La risposta a un invio (`POST /api/cli/evals` e, dalla 8.2b, `POST /api/ci/evals`): `{ id, raccomandazione, avviso,
 * link }`. (Casi senza AI) Solo per le evals di un caso senza AI anche `senzaAi: true` (la raccomandazione è null, non
 * c'è un banco): le risposte agli altri invii restano parola per parola quelle di prima.
 */
export function evalRunReply(recorded: { id: string; analysis: BenchAnalysis | null; alert: EvalsAlert }, input: Pick<EvalRunInput, "withoutAi">, link: string) {
  return {
    id: recorded.id,
    raccomandazione: recommendationOf(recorded.analysis),
    avviso: recorded.alert?.kind ?? null,
    link,
    ...(input.withoutAi ? { senzaAi: true as const } : {}),
  };
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

/**
 * Come la CLI legge un banco o delle evals. (8.2b) `ciLinks`: chi chiede vede il link all'esecuzione su GitHub delle
 * esecuzioni arrivate dalla CI (chi costruisce il caso o è di Lateral Space, `ciLinkVisible`); per gli altri `ci` è null.
 */
export interface CliRunReadOptions {
  ciLinks?: boolean;
}

/**
 * Un banco o delle evals con le chiavi della CLI. (8.2b) `fonte`: `cli` (una persona, con la sua CLI) o `ci` (la CI di
 * main, con la chiave del repository); `ci`: l'indirizzo dell'esecuzione su GitHub, solo per la fonte `ci` e solo a chi
 * può vederlo, altrimenti null. Una lettura senza la 0042 dice `cli`, come le righe di prima. (Casi senza AI) `senzaAi`:
 * le evals di un caso senza AI (`modelli` {}, il risultato `senza-ai` senza costi né token); un campo in più, che la CLI
 * di prima ignora.
 */
export function runForCli(run: EvalRunView, opts: CliRunReadOptions = {}) {
  const fonte: "cli" | "ci" = run.source === "ci" ? "ci" : "cli";
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
    senzaAi: run.withoutAi === true,
    inCostruzione: run.inConstruction,
    prove: run.casesTotal,
    quando: run.createdAt,
    risultati: run.results.map(resultForCli),
    fonte,
    ci: fonte === "ci" && opts.ciLinks === true ? (run.ciRunUrl ?? null) : null,
  };
}

/**
 * La panoramica per la CLI (`GET /api/cli/evals?caso=<ID>`): le evals che fanno lo stato del caso (`main` prima, poi i
 * modelli veri, poi il livello completo) con il loro andamento (stesso ramo, stessi modelli veri o finti, stesso livello,
 * senza AI con senza AI, dalla più vecchia) e l'ultimo banco di ogni ruolo, con i tre segni, la frontiera e la
 * raccomandazione. (8.2b) Ogni
 * esecuzione dice la sua fonte, e il link all'esecuzione della CI a chi può vederlo (`opts.ciLinks`).
 */
export function evalOverviewForCli(code: string, o: EvalOverview, opts: CliRunReadOptions = {}) {
  return {
    caso: code,
    evals: {
      ultime: o.evals.latest ? runForCli(o.evals.latest, opts) : null,
      andamento: o.evals.trend.map((t) => ({ quando: t.at, qualita: t.quality, soglieRispettate: t.thresholdsMet, modelliFinti: t.fakeModels })),
    },
    banchi: o.benches.map((b) => ({
      ...runForCli(b.run, opts),
      piuBravo: b.analysis.best,
      piuEconomico: b.analysis.cheapest,
      piuEfficiente: b.analysis.efficient,
      frontiera: b.analysis.frontier,
      raccomandazione: recommendationOf(b.analysis),
    })),
  };
}
