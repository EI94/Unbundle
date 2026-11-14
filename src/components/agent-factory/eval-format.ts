/**
 * La sezione «Evals e banco di prova» del progetto dell'agente (rilascio 8.2a, docs/rilascio-8/BANCO-DI-PROVA.md
 * §4.2): i testi brevi, le scale del grafico qualità contro costo, dove scrivere le etichette dei punti senza che si
 * coprano, e la lettura prudente di quello che arriva dal database.
 *
 * - **Costo stimato per 1.000 esecuzioni (x):** una stima (il listino del modello, senza la cache; il gateway può
 *   differire, BANCO-DI-PROVA.md §1.2), e la pagina lo dice sull'asse, nella tabella e nei punti. Scala logaritmica
 *   quando il più caro costa almeno 10 volte il più economico (e tutti costano più di zero), altrimenti lineare da
 *   zero, così una differenza del 10 % resta del 10 %. Tacche tonde: 1, 2, 2,5, 5 per potenza di dieci sulla lineare;
 *   1, 2, 5 per decade sulla logaritmica, poi 1 e 3, poi solo le decadi, se non stanno. Etichette brevi all'italiana
 *   («0,05», «2,5», «1.000»); l'unità è nel titolo dell'asse.
 * - **Qualità (y):** da 5 punti sotto il modello peggiore (mai sotto zero), arrotondato in giù alla tacca, fino al
 *   100 %.
 * - **Etichette dei punti** (`placePointLabels`): il nome del modello accanto al suo punto, e sotto i segni (oggi, il
 *   più bravo, il più efficiente, il più economico). Si prova una forma alla volta, dalla più lunga, in otto posizioni
 *   intorno al punto e poi un po' più lontano; un'etichetta non esce dal riquadro, non copre nessun punto né
 *   un'altra etichetta. Se nessuna forma sta, il punto resta senza etichetta: il riquadro al passaggio del mouse (o
 *   con il fuoco) e la tabella sotto il grafico lo dicono comunque. Chi viene prima sceglie prima: il modello di oggi,
 *   poi quelli con i segni, poi per qualità.
 * - **Il banco superato** (`benchSupersededBy`): quando le evals di `main` arrivate dopo il banco usano un altro modello
 *   per il ruolo, o non lo hanno più, il banco resta come storia (grafico e tabella, senza «oggi») e una riga neutra
 *   prende il posto della raccomandazione, che non vale più.
 * - Le regole del banco (il più bravo, il più economico, il più efficiente, la frontiera, la raccomandazione,
 *   l'avviso delle evals, il banco superato) restano in `lib/use-cases/factory/benchmark.ts`: qui solo come si leggono
 *   e si mostrano.
 *
 * Per caso e per ruolo, mai per persona: niente qui sa chi ha lanciato il banco o le evals (art. 15.4).
 * Modulo puro: solo import relativi `.ts`, lo usano il server e il browser con gli stessi testi.
 */
import {
  analyzeBench,
  benchSuperseded,
  EVALS_DROP,
  evalsAlert,
  formatCost,
  formatQuality,
  LEVEL_RE,
  MODEL_ID_RE,
  modelLabel,
  ROLE_RE,
  type BenchAnalysis,
  type BenchResult,
  type BenchVerdict,
  type EvalGroup,
  type EvalOverview,
  type EvalRunKind,
  type EvalRunView,
  type EvalsAlert,
} from "../../lib/use-cases/factory/benchmark.ts";
import { labelWidthPx } from "../../lib/use-cases/matrix-labels.ts";

// ─── Testi ───────────────────────────────────────────────────────────

/** I testi della sezione. Nella dashboard si dice «use case», mai «caso d'uso». */
export const EVAL_TEXT = Object.freeze({
  title: "Evals e banco di prova",
  description: "Quanto rende l'agente con i modelli di oggi, e quale modello conviene per ogni ruolo.",
  descriptionEmpty: "Ancora nessuna misura: si lanciano dal repository del caso, con la CLI.",
  unavailable: "Adesso le misure non si leggono: riprova tra qualche minuto.",
  evalsHeading: "Stato delle evals",
  evalsNone: "Le evals con i modelli di oggi non sono ancora arrivate.",
  evalsRerun: "Per rifarle:",
  benchRerun: "Per rifarlo:",
  benchHeading: "Banco di prova",
  benchNone: "Ancora nessun banco di prova.",
  thresholdsMet: "soglie rispettate",
  thresholdsMissed: "sotto soglia",
  fakeModels: "modelli finti: misurano il codice, non i modelli",
  inConstruction: "In costruzione (versione 0.x): sotto soglia non dà avvisi.",
  unknownCost: "costo non noto",
  noPrices: "Nessun modello ha il costo noto: niente grafico. La qualità è nella tabella.",
  emptyIntro: "Ancora nessuna misura per questo use case. Si lanciano dal repository del caso:",
  emptyIntroUnavailable: "Le misure si lanciano dal repository del caso:",
  emptyEvals: "Le evals con i modelli di oggi: la qualità e come cambia nel tempo.",
  emptyBench: "Il banco di prova di un ruolo: le stesse evals con ogni modello approvato, per vedere qualità, costo e il modello che conviene.",
  benchStart: "Per lanciarlo:",
  evalsStart: "Per lanciarle:",
  models: "Modelli",
  trendFrom: "dalla più vecchia",
  axisQuality: "Qualità",
  axisCost: "Costo stimato per 1.000 esecuzioni (USD)",
  axisLog: "scala logaritmica",
  legendPassing: "rispetta le soglie",
  legendFailing: "sotto soglia",
  legendCurrent: "oggi",
  legendFrontier: "frontiera: nessun altro li batte su qualità e costo",
  columnModel: "Modello",
  columnQuality: "Qualità",
  columnThresholds: "Soglie",
  columnCost: "Costo stimato per 1.000",
  columnP95: "Tempo p95",
  columnMarks: "Segni",
  notMeasured: "non misurato",
});

/** I segni di un modello nel banco, in quest'ordine. */
export const BENCH_MARKS = ["oggi", "più bravo", "più efficiente", "più economico"] as const;
export type BenchMark = (typeof BENCH_MARKS)[number];

/** Il livello di default delle evals (`eval.mjs`): nei comandi non si scrive. */
export const DEFAULT_LEVEL = "pull_request";

const LEVEL_LABEL: Readonly<Record<string, string>> = { pull_request: "pull request", veloce: "veloce" };

/** «pull request», «veloce»; un altro livello con gli spazi al posto dei trattini bassi. */
export function levelText(level: string): string {
  return LEVEL_LABEL[level] ?? level.replace(/_/g, " ");
}

const DAY = new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Rome" });

/** «14/11/2026» (a Roma), come le altre date della pagina; null per una data illeggibile. */
export function dayText(iso: string | null | undefined): string | null {
  if (typeof iso !== "string" || !iso.trim()) return null;
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? null : DAY.format(at);
}

const NUMBER_1 = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 });
const COUNT = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0, useGrouping: "always" });

/** «850 ms», «4,1 s», «12 s»; «—» se non misurato. */
export function formatLatency(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 999.5) return `${COUNT.format(Math.round(ms))} ms`;
  const seconds = ms / 1000;
  return `${seconds < 10 ? NUMBER_1.format(seconds) : COUNT.format(Math.round(seconds))} s`;
}

/** Un calo di qualità in punti: «6 punti», «5,5 punti», «1 punto». */
export function formatPoints(drop: number): string {
  const points = Math.round(Math.abs(drop) * 1000) / 10;
  return `${NUMBER_1.format(points)} ${points === 1 ? "punto" : "punti"}`;
}

/** «27 di 28 prove». */
export function testsText(passed: number, total: number): string {
  return `${COUNT.format(passed)} di ${COUNT.format(total)} ${total === 1 ? "prova" : "prove"}`;
}

const CASE_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,39}$/;
const codeOf = (caseCode: string) => (CASE_CODE_RE.test(caseCode) ? caseCode : "<ID>");
const levelFlag = (level?: string | null) => (level && level !== DEFAULT_LEVEL && LEVEL_RE.test(level) ? ` --livello ${level}` : "");

/** «npm run unbundle -- eval TJ-0049 --invia»; con un livello diverso da quello di default, anche il livello. */
export function evalsCommand(caseCode: string, level?: string | null): string {
  return `npm run unbundle -- eval ${codeOf(caseCode)}${levelFlag(level)} --invia`;
}

/** `--modelli a,b`; un id fuori dalla regola dei modelli non finisce in un comando da copiare: «<modelli>». */
const modelsFlag = (models?: readonly string[] | null) => {
  const list = [...new Set(models ?? [])];
  if (!list.length) return "";
  return ` --modelli ${list.every((m) => MODEL_ID_RE.test(m)) ? list.join(",") : "<modelli>"}`;
};

/**
 * «npm run unbundle -- banco TJ-0049 --ruolo lettura --invia»; senza un ruolo valido, «<ruolo>». Con `models` (i
 * modelli del banco, {@link benchRerunModels}) anche `--modelli`, come nel comando della CLI.
 */
export function benchCommand(caseCode: string, role: string | null, level?: string | null, models?: readonly string[] | null): string {
  return `npm run unbundle -- banco ${codeOf(caseCode)} --ruolo ${role && ROLE_RE.test(role) ? role : "<ruolo>"}${modelsFlag(models)}${levelFlag(level)} --invia`;
}

/**
 * I modelli da ripetere con `--modelli` per rifare un banco con gli stessi modelli: tutti i suoi, quello «attuale»
 * compreso, una volta sola. La CLI mette per primo il modello di oggi del ruolo, da agent.yaml del ramo dove si lancia,
 * e non lo ripete: così il confronto resta lo stesso anche se nel frattempo il ruolo ha cambiato modello. Senza
 * `--modelli` il banco rifatto proverebbe tutti i modelli approvati: un altro banco, più lungo e più caro.
 */
export function benchRerunModels(results: readonly BenchResult[]): string[] {
  const seen = new Set<string>();
  return results.map((r) => r.model).filter((model) => !seen.has(model.toLowerCase()) && Boolean(seen.add(model.toLowerCase())));
}

/** Dove si cambia il modello di un ruolo: la riga di `agent.yaml`. */
export function changeHintParts(role: string, model: string): { file: string; line: string } {
  return { file: "agent.yaml", line: `modelli.${role}.modello: ${model}` };
}

/** «Per cambiarlo: in agent.yaml, modelli.lettura.modello: anthropic/claude-haiku-5-5, poi la pull request.» */
export function changeHint(role: string, model: string): string {
  const { file, line } = changeHintParts(role, model);
  return `Per cambiarlo: in ${file}, ${line}, poi la pull request.`;
}

/** «Banco di prova · ruolo «lettura»». */
export function benchHeading(role: string): string {
  return `${EVAL_TEXT.benchHeading} · ruolo «${role}»`;
}

/** «Ancora nessun banco per il ruolo «scrittura»:», prima del comando. */
export function benchMissingText(role: string): string {
  return `Ancora nessun banco per il ruolo «${role}»:`;
}

/**
 * La descrizione della sezione: con almeno una misura, cosa c'è; senza, come si comincia. Se la lettura non è riuscita
 * non si sa se ci sono misure: la descrizione di sempre, mai «ancora nessuna misura».
 */
export function evalSectionDescription(overview: EvalOverview | null, unavailable = false): string {
  return hasMeasures(overview) || unavailable ? EVAL_TEXT.description : EVAL_TEXT.descriptionEmpty;
}

/** Vero se ci sono le evals o almeno un banco. */
export function hasMeasures(overview: EvalOverview | null): overview is EvalOverview {
  return overview !== null && (overview.evals.latest !== null || overview.benches.length > 0);
}

// ─── Le evals ────────────────────────────────────────────────────────

/** Il risultato delle evals: quello dei modelli di oggi (l'unico, per l'API). */
export function evalsResult(run: EvalRunView): BenchResult | null {
  return run.results.find((r) => r.current) ?? run.results[0] ?? null;
}

/** «96,4% · 27 di 28 prove · soglie rispettate»; con `", "` la stessa riga per i lettori di schermo. */
export function evalsStatusLine(run: EvalRunView, separator = " · "): string {
  const result = evalsResult(run);
  if (!result) return "Nessun risultato in queste evals.";
  return [formatQuality(result.quality), result.total > 0 ? testsText(result.passed, result.total) : null, result.thresholdsMet ? EVAL_TEXT.thresholdsMet : EVAL_TEXT.thresholdsMissed]
    .filter(Boolean)
    .join(separator);
}

/** «14/11/2026 · ramo main · livello pull request · commit a1b2c3d». */
export function evalsMetaLine(run: EvalRunView): string {
  return [dayText(run.createdAt), run.branch ? `ramo ${run.branch}` : null, `livello ${levelText(run.level)}`, run.commit ? `commit ${run.commit.slice(0, 7)}` : null].filter(Boolean).join(" · ");
}

/** «14/11/2026 · livello pull request · 4 modelli · ramo main». */
export function benchMetaLine(run: EvalRunView): string {
  const n = run.results.length;
  return [dayText(run.createdAt), `livello ${levelText(run.level)}`, `${COUNT.format(n)} ${n === 1 ? "modello" : "modelli"}`, run.branch ? `ramo ${run.branch}` : null].filter(Boolean).join(" · ");
}

/** I modelli di oggi per ruolo, in ordine di ruolo: «lettura · Claude Haiku 5.5». */
export function modelsByRole(models: Readonly<Record<string, string>>): { role: string; model: string; label: string }[] {
  return Object.entries(models)
    .filter(([role, model]) => typeof role === "string" && typeof model === "string" && model.length > 0)
    .sort(([a], [b]) => a.localeCompare(b, "it"))
    .map(([role, model]) => ({ role, model, label: modelLabel(model) }));
}

const GROUP_ORDER = ["regole", "avversari", "casi"];

/** I gruppi di prove: «regole 9 di 9 · avversari 5 di 6, sotto soglia · casi 13 di 13»; null senza gruppi. */
export function groupsLine(groups: Readonly<Record<string, EvalGroup>>): string | null {
  const rank = (name: string) => (GROUP_ORDER.includes(name) ? GROUP_ORDER.indexOf(name) : GROUP_ORDER.length);
  const parts = Object.entries(groups)
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b, "it"))
    .map(([name, g]) => `${name} ${COUNT.format(g.passati)} di ${COUNT.format(g.totali)}${g.ok ? "" : `, ${EVAL_TEXT.thresholdsMissed}`}`);
  return parts.length ? parts.join(" · ") : null;
}

/** Un punto dell'andamento delle evals. */
export interface TrendPoint {
  at: string;
  quality: number;
  thresholdsMet: boolean;
}

/** Quanti punti al massimo nella linea dell'andamento. */
export const TREND_MAX = 12;

/**
 * L'andamento da mostrare: le evals dello stesso ramo dell'ultima e con lo stesso tipo di modelli (veri con veri,
 * finti con finti: i finti misurano il codice), dalla più vecchia, al massimo 12, l'ultima compresa anche se la
 * lettura non l'ha messa nell'elenco.
 */
export function trendPoints(evals: EvalOverview["evals"]): TrendPoint[] {
  const latest = evals.latest;
  if (!latest) return [];
  const time = (at: string) => new Date(at).getTime();
  const points = evals.trend
    .filter((p) => p.fakeModels === latest.fakeModels && Number.isFinite(time(p.at)) && Number.isFinite(p.quality))
    .map((p) => ({ at: p.at, quality: clamp01(p.quality), thresholdsMet: p.thresholdsMet }))
    .sort((a, b) => time(a.at) - time(b.at));
  const result = evalsResult(latest);
  const latestAt = time(latest.createdAt);
  if (result && Number.isFinite(latestAt) && !points.some((p) => time(p.at) === latestAt)) {
    points.push({ at: latest.createdAt, quality: clamp01(result.quality), thresholdsMet: result.thresholdsMet });
    points.sort((a, b) => time(a.at) - time(b.at));
  }
  return points.slice(-TREND_MAX);
}

/** L'avviso sulle ultime evals rispetto alle precedenti dell'andamento (la regola è `evalsAlert` del banco). */
export function latestEvalsAlert(evals: EvalOverview["evals"]): EvalsAlert {
  const latest = evals.latest;
  const result = latest ? evalsResult(latest) : null;
  if (!latest || !result) return null;
  const points = trendPoints(evals);
  const latestAt = new Date(latest.createdAt).getTime();
  const before = points.filter((p) => new Date(p.at).getTime() < latestAt);
  const previous = before.length ? before[before.length - 1] : null;
  return evalsAlert(
    previous ? { quality: previous.quality, thresholdsMet: previous.thresholdsMet, fakeModels: latest.fakeModels, inConstruction: latest.inConstruction, branch: latest.branch } : null,
    { quality: result.quality, thresholdsMet: result.thresholdsMet, fakeModels: latest.fakeModels, inConstruction: latest.inConstruction, branch: latest.branch },
  );
}

/** «In calo: 6 punti sotto le evals precedenti.»; null senza avviso. */
export function evalsAlertText(alert: EvalsAlert): string | null {
  if (!alert) return null;
  if (alert.kind === "in_calo") return `In calo: ${formatPoints(alert.drop)} sotto le evals precedenti.`;
  const drop = alert.drop !== null && alert.drop >= EVALS_DROP - 1e-9 ? ` E sono ${formatPoints(alert.drop)} sotto le precedenti.` : "";
  return `Sotto soglia: le evals di oggi non rispettano le soglie.${drop}`;
}

/**
 * «Ultime 5: da 93,1% a 96,4%» accanto alla linea, con il massimo e il minimo quando stanno in mezzo («Ultime 4: da
 * 89,5% a 89,5% · massimo 100%»), così due estremi uguali non nascondono la salita e la discesa; null con meno di due
 * punti.
 */
export function trendCaption(points: readonly TrendPoint[]): string | null {
  if (points.length < 2) return null;
  const first = points[0].quality;
  const last = points[points.length - 1].quality;
  const qualities = points.map((p) => p.quality);
  const max = Math.max(...qualities);
  const min = Math.min(...qualities);
  const extra = [
    max > Math.max(first, last) + 1e-9 ? `massimo ${formatQuality(max)}` : null,
    min < Math.min(first, last) - 1e-9 ? `minimo ${formatQuality(min)}` : null,
  ].filter(Boolean);
  return `Ultime ${points.length}: da ${formatQuality(first)} a ${formatQuality(last)}${extra.length ? ` · ${extra.join(" · ")}` : ""}`;
}

/** Per i lettori di schermo: tutti i valori dell'andamento, dal più vecchio. */
export function trendSentence(points: readonly TrendPoint[], branch: string | null): string | null {
  if (points.length < 2) return null;
  return `Andamento delle ultime ${points.length} evals${branch ? ` sul ramo ${branch}` : ""}, ${EVAL_TEXT.trendFrom}: ${points.map((p) => formatQuality(p.quality)).join(", ")}.`;
}

/** La linea dell'andamento in un riquadro 0–100 (y in giù), sulla scala della qualità; l'ultimo punto a parte. */
export function sparkline(points: readonly TrendPoint[]): { path: string; last: { x: number; y: number } } | null {
  if (points.length < 2) return null;
  const scale = qualityScale(points.map((p) => p.quality));
  const coords = points.map((p, i) => ({ x: (i / (points.length - 1)) * 100, y: (1 - scale.at(p.quality)) * 100 }));
  return {
    path: coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(2)} ${c.y.toFixed(2)}`).join(" "),
    last: coords[coords.length - 1],
  };
}

// ─── Il banco ────────────────────────────────────────────────────────

/** Un modello del banco come lo mostrano il grafico e la tabella. */
export interface BenchRow {
  model: string;
  /** «Claude Haiku 5.5»; l'id intero se due modelli avrebbero lo stesso nome. */
  label: string;
  /** Il nome senza la parola che hanno in comune tutti («Haiku 5.5»), per il grafico stretto. */
  short: string;
  /** Da 0 a 1. */
  quality: number;
  passed: number | null;
  total: number | null;
  thresholdsMet: boolean;
  /** Il modello di oggi del ruolo, «attuale» nel banco; mai in un banco superato. */
  current: boolean;
  /** «Attuale» nel banco, anche se superato: sceglie per primo il posto dell'etichetta (il confronto parte da lui). */
  benchCurrent: boolean;
  /** Per 1.000 esecuzioni, in USD (una stima); null: costo non noto. */
  cost: number | null;
  latencyP95Ms: number | null;
  marks: BenchMark[];
  /** Sulla frontiera disegnata: almeno due modelli con il costo ci stanno (con uno solo non c'è la linea). */
  frontier: boolean;
}

/** Il nome di ogni modello e la forma corta: due modelli con lo stesso nome tengono l'id intero. */
export function modelNames(models: readonly string[]): Map<string, { label: string; short: string }> {
  const labels = models.map((m) => modelLabel(m));
  const dup = new Set(labels.filter((l, i) => labels.indexOf(l) !== i));
  const shown = models.map((m, i) => (dup.has(labels[i]) ? m : labels[i]));
  const words = shown.map((l) => l.split(" "));
  const first = words[0]?.[0];
  const common = shown.length > 1 && words.every((w) => w.length > 1 && w[0] === first);
  const shorts = shown.map((l, i) => (common ? words[i].slice(1).join(" ") : l));
  const unique = new Set(shorts).size === shorts.length;
  return new Map(models.map((m, i) => [m, { label: shown[i], short: unique ? shorts[i] : shown[i] }]));
}

/**
 * I modelli di un banco con i loro segni, dal più bravo: qualità, poi costo (i costi non noti in fondo), poi il nome.
 * Un modello ripetuto conta una volta (la prima). La frontiera solo quando ci stanno almeno due modelli: è una linea.
 * `superseded`: dopo il banco il ruolo usa un altro modello, o non c'è più (`benchSupersededBy`): le righe restano
 * come storia, ma nessun modello è più «oggi».
 */
export function benchRows(results: readonly BenchResult[], analysis: BenchAnalysis, o: { superseded?: boolean } = {}): BenchRow[] {
  const seen = new Set<string>();
  const unique = results.filter((r) => !seen.has(r.model) && seen.add(r.model));
  const names = modelNames(unique.map((r) => r.model));
  const frontierSet = new Set(analysis.frontier);
  const onFrontier = (r: BenchResult) => frontierSet.has(r.model) && r.costPer1000Usd !== null;
  const frontierDrawn = unique.filter(onFrontier).length >= 2;
  const rows = unique.map((r): BenchRow => {
    const today = r.current && !o.superseded;
    const marks: BenchMark[] = [];
    if (today) marks.push("oggi");
    if (analysis.best === r.model) marks.push("più bravo");
    if (analysis.efficient === r.model) marks.push("più efficiente");
    if (analysis.cheapest === r.model) marks.push("più economico");
    const name = names.get(r.model) ?? { label: r.model, short: r.model };
    return {
      model: r.model,
      label: name.label,
      short: name.short,
      quality: clamp01(r.quality),
      passed: r.total > 0 ? r.passed : null,
      total: r.total > 0 ? r.total : null,
      thresholdsMet: r.thresholdsMet,
      current: today,
      benchCurrent: r.current,
      cost: r.costPer1000Usd,
      latencyP95Ms: r.latencyP95Ms,
      marks,
      frontier: frontierDrawn && onFrontier(r),
    };
  });
  return rows.sort((a, b) => b.quality - a.quality || (a.cost ?? Infinity) - (b.cost ?? Infinity) || a.label.localeCompare(b.label, "it"));
}

/** I segni senza «oggi» (la tabella scrive «oggi» accanto al nome). */
export function rowSigns(row: Pick<BenchRow, "marks">): BenchMark[] {
  return row.marks.filter((m) => m !== "oggi");
}

/** «oggi · più efficiente · più economico». */
export function marksText(marks: readonly BenchMark[]): string {
  return marks.join(" · ");
}

/** «0,42 USD per 1.000 esecuzioni (stimato)»: il costo del banco è sempre una stima. */
export function costPer1000Text(cost: number): string {
  return `${formatCost(cost)} per 1.000 esecuzioni (stimato)`;
}

/** Il riquadro di un punto: «96,4% · 27 di 28 prove · 0,42 USD per 1.000 esecuzioni (stimato) · tempo p95 4,1 s». */
export function pointDetails(row: BenchRow): string[] {
  return [
    `${formatQuality(row.quality)}${row.passed !== null && row.total !== null ? ` · ${testsText(row.passed, row.total)}` : ""}`,
    row.cost !== null ? costPer1000Text(row.cost) : EVAL_TEXT.unknownCost,
    `tempo p95 ${row.latencyP95Ms !== null ? formatLatency(row.latencyP95Ms) : EVAL_TEXT.notMeasured}`,
    ...(row.thresholdsMet ? [] : [EVAL_TEXT.thresholdsMissed]),
  ];
}

/**
 * Il nome accessibile di un punto, in una frase: «Claude Sonnet 5.5, oggi e più bravo, sulla frontiera: qualità 96%,
 * 27 di 28 prove, …». La frontiera è solo una linea nel grafico: qui la dicono le parole.
 */
export function pointLabel(row: BenchRow): string {
  const marks = `${row.marks.length ? `, ${row.marks.join(" e ")}` : ""}${row.frontier ? ", sulla frontiera" : ""}`;
  const parts = [
    `qualità ${formatQuality(row.quality)}`,
    row.passed !== null && row.total !== null ? testsText(row.passed, row.total) : null,
    row.cost !== null ? costPer1000Text(row.cost) : EVAL_TEXT.unknownCost,
    `tempo p95 ${row.latencyP95Ms !== null ? formatLatency(row.latencyP95Ms) : EVAL_TEXT.notMeasured}`,
    row.thresholdsMet ? null : EVAL_TEXT.thresholdsMissed,
  ];
  return `${row.label}${marks}: ${parts.filter(Boolean).join(", ")}.`;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** I modelli sulla frontiera, dal più economico (come la linea, da sinistra); nessuno se non sono almeno due. */
export function frontierRows(rows: readonly BenchRow[]): BenchRow[] {
  const on = rows
    .filter((r) => r.frontier && r.cost !== null)
    .sort((a, b) => (a.cost as number) - (b.cost as number) || b.quality - a.quality || a.label.localeCompare(b.label, "it"));
  return on.length >= 2 ? on : [];
}

/**
 * La frase per i lettori di schermo: chi ha i segni, chi è sulla frontiera, chi è sotto soglia, chi non ha il costo.
 * La tabella ha il resto.
 */
export function benchSummary(role: string, rows: readonly BenchRow[]): string {
  const brief = (r: BenchRow) => `${r.label} (${formatQuality(r.quality)}${r.cost !== null ? `, ${formatCost(r.cost)}` : ""})`;
  const parts = [`Qualità e costo stimato per 1.000 esecuzioni di ${rows.length === 1 ? "un modello" : `${rows.length} modelli`} per il ruolo «${role}».`];
  for (const r of rows) if (r.marks.length) parts.push(`${capitalize(r.marks.join(" e "))}: ${brief(r)}.`);
  const frontier = frontierRows(rows);
  if (frontier.length) parts.push(`Frontiera: ${frontier.map((r) => r.label).join(", ")}.`);
  const failing = rows.filter((r) => !r.thresholdsMet);
  if (failing.length) parts.push(`${capitalize(EVAL_TEXT.thresholdsMissed)}: ${failing.map((r) => r.label).join(", ")}.`);
  const unknown = rows.filter((r) => r.cost === null);
  if (unknown.length) parts.push(`${capitalize(EVAL_TEXT.unknownCost)}: ${unknown.map((r) => r.label).join(", ")}.`);
  return parts.join(" ");
}

/**
 * Il banco superato: dopo di lui sono arrivate le evals vere di `main` (quelle della pagina, `latest`) e lì il ruolo usa
 * un altro modello (il consiglio è stato seguito) o non c'è più. È la regola dell'Agent Factory e di «Da fare per te»
 * (`benchSuperseded`). `now`: il modello del ruolo in quelle evals, null se il ruolo non c'è più. Null se il banco vale
 * ancora: evals più vecchie del banco, di un altro ramo, con i modelli finti, senza `modelli`, o con lo stesso modello.
 */
export function benchSupersededBy(bench: Pick<EvalOverview["benches"][number], "role" | "run">, latest: EvalRunView | null): { now: string | null } | null {
  if (!latest) return null;
  const currentModel = bench.run.results.find((r) => r.current)?.model ?? null;
  const evals = { at: latest.createdAt, branch: latest.branch, fakeModels: latest.fakeModels, models: latest.models };
  if (!benchSuperseded({ role: bench.role, at: bench.run.createdAt, currentModel }, evals)) return null;
  return { now: Object.hasOwn(latest.models, bench.role) ? latest.models[bench.role] : null };
}

/**
 * La riga di un banco superato, al posto della raccomandazione: «Dopo questo banco il ruolo «lettura» usa Claude Haiku
 * 5.5: rifallo per un consiglio aggiornato.»; senza il ruolo in `agent.yaml` non si rifà, resta il confronto.
 */
export function benchSupersededText(role: string, now: string | null): string {
  return now
    ? `Dopo questo banco il ruolo «${role}» usa ${modelLabel(now)}: rifallo per un consiglio aggiornato.`
    : `Dopo questo banco il ruolo «${role}» non c'è più in agent.yaml: resta il confronto di allora.`;
}

/** I ruoli delle evals di oggi che non hanno ancora un banco. */
export function rolesWithoutBench(overview: EvalOverview): string[] {
  const benched = new Set(overview.benches.map((b) => b.role));
  return modelsByRole(overview.evals.latest?.models ?? {})
    .map((m) => m.role)
    .filter((role) => !benched.has(role) && ROLE_RE.test(role));
}

/** Il tono della raccomandazione: in evidenza per «cambia», attenzione per «nessuno», altrimenti testo. */
export function verdictTone(verdict: BenchVerdict): "cambia" | "attenzione" | "neutro" {
  return verdict.kind === "cambia" ? "cambia" : verdict.kind === "nessuno" ? "attenzione" : "neutro";
}

// ─── Le scale ────────────────────────────────────────────────────────

export interface AxisTick {
  value: number;
  label: string;
  /** Da 0 a 1 lungo l'asse (da sinistra, o dal basso). */
  at: number;
}

export interface AxisScale {
  kind: "lineare" | "logaritmica";
  min: number;
  max: number;
  ticks: AxisTick[];
  /** Da 0 a 1 lungo l'asse, dentro i bordi. */
  at: (value: number) => number;
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

/** Senza il rumore della virgola mobile: 0.15000000000000002 → 0.15. */
const clean = (n: number) => Number(n.toPrecision(12));

/** Quanti decimali servono per scrivere un passo («0,25»: 2). */
function decimalsOf(step: number): number {
  const text = String(clean(step));
  const dot = text.indexOf(".");
  return dot < 0 ? 0 : text.length - dot - 1;
}

function tickLabel(value: number, digits: number): string {
  return new Intl.NumberFormat("it-IT", { maximumFractionDigits: Math.min(20, digits), useGrouping: "always" }).format(value);
}

/** Quando il più caro costa almeno tante volte il più economico, la scala del costo è logaritmica. */
export const LOG_RATIO = 10;

const LINEAR_MANTISSAS = [1, 2, 2.5, 5, 10];

/** Da zero a un tondo sopra il più caro, con al massimo `maxTicks` tacche. Senza costi: da 0 a 1. */
function linearScale(hi: number, maxTicks: number): AxisScale {
  const top = Number.isFinite(hi) && hi > 0 ? hi : 1;
  const raw = top / Math.max(1, maxTicks - 1);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  // Il passo 10 × la potenza di dieci sta sempre: (maxTicks − 1) intervalli bastano.
  const step = clean(LINEAR_MANTISSAS.map((m) => m * magnitude).find((s) => Math.ceil(top / s - 1e-9) + 1 <= maxTicks) ?? 10 * magnitude);
  const n = Math.ceil(top / step - 1e-9);
  const max = clean(n * step);
  const digits = decimalsOf(step);
  const at = (v: number) => clamp01(v / max);
  const ticks = Array.from({ length: n + 1 }, (_, k) => {
    const value = clean(k * step);
    return { value, label: tickLabel(value, digits), at: at(value) };
  });
  return { kind: "lineare", min: 0, max, ticks, at };
}

const LOG_SETS: readonly (readonly number[])[] = [[1, 2, 5], [1, 3], [1]];

/** Il più grande 1, 2 o 5 per una potenza di dieci che non supera `v` (`up`: il più piccolo che non è sotto). */
function snap125(v: number, dir: "down" | "up"): number {
  const k = Math.floor(Math.log10(v));
  const candidates = [k - 1, k, k + 1].flatMap((e) => [1, 2, 5].map((m) => clean(m * 10 ** e))).sort((a, b) => a - b);
  return dir === "down" ? candidates.filter((c) => c <= v * (1 + 1e-9)).pop()! : candidates.find((c) => c >= v * (1 - 1e-9))!;
}

/** Le tacche tra `min` e `max`: le mantisse per decade, una decade ogni `stride` a partire da quella di `min`. */
function logTicks(min: number, max: number, mantissas: readonly number[], stride: number): number[] {
  const out: number[] = [];
  const first = Math.floor(Math.log10(min));
  for (let e = first; e <= Math.ceil(Math.log10(max)); e++) {
    if ((e - first) % stride !== 0) continue;
    for (const m of mantissas) {
      const value = clean(m * 10 ** e);
      if (value >= min * (1 - 1e-9) && value <= max * (1 + 1e-9)) out.push(value);
    }
  }
  return out;
}

/** Dal tondo sotto il più economico al tondo sopra il più caro (1, 2, 5 per decade); tacche finché stanno. */
function logScale(lo: number, hi: number, maxTicks: number): AxisScale {
  const min = snap125(lo, "down");
  const max = snap125(hi, "up");
  const span = Math.log10(max) - Math.log10(min);
  const at = (v: number) => (v > 0 ? clamp01((Math.log10(v) - Math.log10(min)) / span) : 0);
  let values: number[] = [];
  for (const set of LOG_SETS) {
    values = logTicks(min, max, set, 1);
    if (values.length <= maxTicks) break;
  }
  for (let stride = 2; values.length > maxTicks && stride <= 12; stride++) values = logTicks(min, max, [1], stride);
  const ticks = values.map((value) => ({ value, label: new Intl.NumberFormat("it-IT", { maximumSignificantDigits: 2, useGrouping: "always" }).format(value), at: at(value) }));
  return { kind: "logaritmica", min, max, ticks, at };
}

/**
 * La scala del costo per 1.000 esecuzioni: logaritmica quando il più caro costa almeno `LOG_RATIO` volte il più
 * economico e tutti costano più di zero (il logaritmo di zero non c'è), altrimenti lineare da zero.
 */
export function costScale(values: readonly number[], maxTicks = 6): AxisScale {
  const costs = values.filter((v) => Number.isFinite(v) && v >= 0);
  if (!costs.length) return linearScale(0, maxTicks);
  const lo = Math.min(...costs);
  const hi = Math.max(...costs);
  if (lo > 0 && hi >= lo * LOG_RATIO * (1 - 1e-12)) return logScale(lo, hi, maxTicks);
  return linearScale(hi, maxTicks);
}

/** Quanti punti di qualità sotto il modello peggiore comincia l'asse. */
export const QUALITY_MARGIN = 0.05;
const QUALITY_STEPS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.25];
const PERCENT = new Intl.NumberFormat("it-IT", { style: "percent", maximumFractionDigits: 0 });

/** La scala della qualità: da 5 punti sotto il peggiore (mai sotto zero), arrotondato alla tacca, fino al 100%. */
export function qualityScale(values: readonly number[], maxTicks = 5): AxisScale {
  const qualities = values.filter((v) => Number.isFinite(v)).map(clamp01);
  const floor = Math.max(0, (qualities.length ? Math.min(...qualities) : 0) - QUALITY_MARGIN);
  let min = 0;
  let step = 0.25;
  for (const s of QUALITY_STEPS) {
    const m = clean(Math.max(0, Math.floor(floor / s + 1e-9) * s));
    if (Math.round((1 - m) / s) + 1 <= maxTicks) {
      min = m;
      step = s;
      break;
    }
  }
  const at = (v: number) => clamp01((clamp01(v) - min) / (1 - min));
  const n = Math.round((1 - min) / step);
  const ticks = Array.from({ length: n + 1 }, (_, k) => {
    const value = clean(min + k * step);
    return { value, label: PERCENT.format(value), at: at(value) };
  });
  return { kind: "lineare", min, max: 1, ticks, at };
}

// ─── Le etichette dei punti ──────────────────────────────────────────

/** Le etichette accanto ai punti: monospazio a 10 px (6 px a carattere, come quelle della matrice), 12 px a riga. */
export const LABEL_FONT = Object.freeze({ charPx: 6, linePx: 12 });

export interface LabelPoint {
  id: string;
  /** Il centro del punto nel riquadro, in pixel. */
  x: number;
  y: number;
  /** Il raggio del segno, anello compreso, in pixel. */
  r: number;
  /** Le forme dell'etichetta, dalla preferita: una o due righe ciascuna. Nessuna forma: il punto resta un ostacolo. */
  variants: readonly (readonly string[])[];
}

export interface PlacedLabel {
  /** L'angolo in alto a sinistra, in pixel nel riquadro. */
  x: number;
  y: number;
  w: number;
  h: number;
  lines: readonly string[];
  /** Le righe si allineano verso il punto: a sinistra se l'etichetta è a destra del punto, e così via. */
  align: "start" | "end" | "middle";
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlaps = (a: Rect, b: Rect, pad = 0) => a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

/** La distanza tra il centro di un cerchio e un rettangolo (zero se il centro è dentro). */
function distanceToRect(cx: number, cy: number, rect: Rect): number {
  const dx = Math.max(rect.x - cx, 0, cx - (rect.x + rect.w));
  const dy = Math.max(rect.y - cy, 0, cy - (rect.y + rect.h));
  return Math.hypot(dx, dy);
}

/** Un tratto di linea nel riquadro, in pixel (la frontiera). */
export interface LabelSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Vero se il tratto passa dentro il rettangolo (Liang–Barsky). */
export function segmentCrossesRect(s: LabelSegment, rect: Rect): boolean {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  let t0 = 0;
  let t1 = 1;
  const edges: Array<[number, number]> = [
    [-dx, s.x1 - rect.x],
    [dx, rect.x + rect.w - s.x1],
    [-dy, s.y1 - rect.y],
    [dy, rect.y + rect.h - s.y1],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      t0 = Math.max(t0, t);
    } else {
      if (t < t0) return false;
      t1 = Math.min(t1, t);
    }
  }
  return t0 <= t1;
}

/** Le posizioni intorno al punto, in ordine: destra, sinistra, sopra, sotto, le diagonali; poi le stesse più lontano. */
function candidates(p: LabelPoint, w: number, h: number): Array<{ x: number; y: number; align: PlacedLabel["align"] }> {
  const out: Array<{ x: number; y: number; align: PlacedLabel["align"] }> = [];
  for (const gap of [p.r + 3, p.r + 10]) {
    const d = gap * 0.75;
    out.push(
      { x: p.x + gap, y: p.y - h / 2, align: "start" },
      { x: p.x - gap - w, y: p.y - h / 2, align: "end" },
      { x: p.x - w / 2, y: p.y - gap - h, align: "middle" },
      { x: p.x - w / 2, y: p.y + gap, align: "middle" },
      { x: p.x + d, y: p.y - d - h, align: "start" },
      { x: p.x + d, y: p.y + d, align: "start" },
      { x: p.x - d - w, y: p.y - d - h, align: "end" },
      { x: p.x - d - w, y: p.y + d, align: "end" },
    );
  }
  return out;
}

/**
 * Dove scrivere le etichette dei punti in un riquadro di `box` pixel. Per ogni punto, nell'ordine dato, la prima forma
 * e la prima posizione libere: dentro il riquadro, fuori dal suo punto, ad almeno `clearancePx` dagli altri punti e
 * comunque più vicina al suo punto che a ogni altro (così si capisce di chi è), senza toccare le etichette già messe.
 * Per ogni forma si cerca prima un posto che non attraversi la frontiera
 * (`segments`), poi uno qualsiasi: l'alone tiene leggibile il nome sopra la linea, accorciarlo costa di più.
 * Un punto senza posto resta senza etichetta.
 */
export function placePointLabels(
  points: readonly LabelPoint[],
  box: { w: number; h: number },
  o: { charPx?: number; linePx?: number; clearancePx?: number; segments?: readonly LabelSegment[] } = {},
): Map<string, PlacedLabel> {
  const charPx = o.charPx ?? LABEL_FONT.charPx;
  const linePx = o.linePx ?? LABEL_FONT.linePx;
  const clearance = o.clearancePx ?? 3;
  const segments = o.segments ?? [];
  const placed: Rect[] = [];
  const out = new Map<string, PlacedLabel>();
  for (const point of points) {
    let chosen: PlacedLabel | null = null;
    for (const lines of point.variants) {
      if (!lines.length) continue;
      const w = Math.max(...lines.map((line) => labelWidthPx(line, charPx)));
      const h = lines.length * linePx + 1;
      const free = candidates(point, w, h)
        .map((c) => ({ rect: { x: c.x, y: c.y, w, h }, align: c.align }))
        .filter(({ rect }) => rect.x >= 0 && rect.y >= 0 && rect.x + w <= box.w && rect.y + h <= box.h)
        .filter(({ rect }) => {
          // Fuori dal suo punto, lontana dagli altri, e più vicina al suo che a ogni altro: si legge di chi è.
          const own = distanceToRect(point.x, point.y, rect);
          if (own < point.r + 1) return false;
          return !points.some((q) => q !== point && distanceToRect(q.x, q.y, rect) < Math.max(q.r + clearance, own + 3));
        })
        .filter(({ rect }) => !placed.some((other) => overlaps(rect, other, 2)));
      const best = free.find(({ rect }) => !segments.some((s) => segmentCrossesRect(s, rect))) ?? free[0];
      if (best) {
        chosen = { ...best.rect, lines, align: best.align };
        break;
      }
    }
    if (!chosen) continue;
    placed.push(chosen);
    out.set(point.id, chosen);
  }
  return out;
}

/**
 * Le forme dell'etichetta di un modello, dalla preferita: il nome con tutti i segni sotto in una riga, poi un segno per
 * riga (più stretta, più alta), poi con solo «oggi», poi il solo nome. `name`: il nome intero («Claude Haiku 5.5») o
 * quello corto («Haiku 5.5»).
 */
export function labelVariants(row: Pick<BenchRow, "label" | "short" | "marks">, name: "label" | "short" = "label"): string[][] {
  const text = name === "short" && row.short ? row.short : row.label;
  const forms = [[text, marksText(row.marks)], [text, ...row.marks], [text, row.marks.includes("oggi") ? "oggi" : ""], [text]].map((lines) => lines.filter(Boolean));
  return forms.filter((lines, i) => forms.findIndex((other) => other.join("\n") === lines.join("\n")) === i);
}

/**
 * Chi sceglie prima il posto dell'etichetta: il modello «attuale» del banco (anche superato), chi ha più segni, chi
 * rispetta le soglie, poi per qualità e costo.
 */
export function labelPriority(a: BenchRow, b: BenchRow): number {
  return (
    Number(b.benchCurrent) - Number(a.benchCurrent) ||
    b.marks.length - a.marks.length ||
    Number(b.thresholdsMet) - Number(a.thresholdsMet) ||
    b.quality - a.quality ||
    (a.cost ?? Infinity) - (b.cost ?? Infinity) ||
    a.label.localeCompare(b.label, "it")
  );
}

/**
 * Le etichette dei punti del banco: con il nome intero, o con quello corto se così se ne scrivono di più (o, a pari
 * etichette, con più segni). Mai i due nomi mescolati nello stesso grafico. I punti vanno passati in ordine di
 * `labelPriority`; `segments`, i tratti della frontiera, da non attraversare se c'è un altro posto.
 */
export function benchLabels(
  points: readonly (Omit<LabelPoint, "variants"> & { row: Pick<BenchRow, "label" | "short" | "marks"> })[],
  box: { w: number; h: number },
  segments: readonly LabelSegment[] = [],
): Map<string, PlacedLabel> {
  const place = (name: "label" | "short") => placePointLabels(points.map((p) => ({ id: p.id, x: p.x, y: p.y, r: p.r, variants: labelVariants(p.row, name) })), box, { segments });
  // Prima quante etichette, poi quanti segni si leggono (nelle righe dopo il nome).
  const score = (labels: Map<string, PlacedLabel>) => labels.size * 1000 + [...labels.values()].reduce((n, l) => n + l.lines.slice(1).flatMap((line) => line.split(" · ")).length, 0);
  const full = place("label");
  const complete = points.every((p) => full.get(p.id)?.lines.join("\n") === labelVariants(p.row)[0].join("\n"));
  if (complete || points.every((p) => p.row.short === p.row.label)) return full;
  const short = place("short");
  return score(short) > score(full) ? short : full;
}

/** Il punto più vicino al puntatore, entro `maxPx`; null se nessuno. */
export function nearestPoint(points: readonly { id: string; x: number; y: number }[], x: number, y: number, maxPx: number): string | null {
  let best: string | null = null;
  let bestDistance = maxPx;
  for (const p of points) {
    const distance = Math.hypot(p.x - x, p.y - y);
    if (distance <= bestDistance) {
      if (distance === bestDistance && best !== null) continue;
      best = p.id;
      bestDistance = distance;
    }
  }
  return best;
}

// ─── La lettura prudente ─────────────────────────────────────────────

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
/** Il testo di un numero, come lo dà Postgres per una colonna `numeric` («0.42»): nient'altro. */
const NUMERIC_TEXT = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const finite = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && NUMERIC_TEXT.test(v.trim()) ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};
/** Un istante come testo: una stringa, o un `Date` del driver (in ISO). `strict`: solo se si legge come data. */
const instant = (v: unknown, strict = false): string | null => {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  const text = str(v);
  return text && (!strict || !Number.isNaN(new Date(text).getTime())) ? text : null;
};
const nonNegative = (v: unknown): number | null => {
  const n = finite(v);
  return n !== null && n >= 0 ? n : null;
};
const count = (v: unknown): number | null => {
  const n = nonNegative(v);
  return n !== null && Number.isInteger(n) ? n : null;
};

function readGroups(raw: unknown): Record<string, EvalGroup> {
  if (!isObject(raw)) return {};
  const out: Record<string, EvalGroup> = {};
  for (const [name, g] of Object.entries(raw)) {
    if (!isObject(g)) continue;
    const passati = count(g.passati);
    const totali = count(g.totali);
    if (passati === null || totali === null || passati > totali || typeof g.ok !== "boolean") continue;
    out[name] = { passati, totali, soglia: finite(g.soglia) ?? 0, ok: g.ok };
  }
  return out;
}

function readResult(raw: unknown): BenchResult | null {
  if (!isObject(raw)) return null;
  const model = str(raw.model);
  if (!model || typeof raw.current !== "boolean" || typeof raw.thresholdsMet !== "boolean") return null;
  const passed = count(raw.passed);
  const total = count(raw.total);
  const valid = passed !== null && total !== null && passed <= total;
  const quality = finite(raw.quality) ?? (valid && total > 0 ? passed / total : null);
  if (quality === null) return null;
  return {
    model,
    current: raw.current,
    quality: clamp01(quality),
    passed: valid ? passed : 0,
    total: valid ? total : 0,
    thresholdsMet: raw.thresholdsMet,
    groups: readGroups(raw.groups),
    costPer1000Usd: nonNegative(raw.costPer1000Usd),
    latencyP50Ms: nonNegative(raw.latencyP50Ms),
    latencyP95Ms: nonNegative(raw.latencyP95Ms),
    tokensInAvg: nonNegative(raw.tokensInAvg),
    tokensOutAvg: nonNegative(raw.tokensOutAvg),
    errors: count(raw.errors) ?? 0,
  };
}

function readRun(raw: unknown, kind: EvalRunKind): { run: EvalRunView; dropped: number } | null {
  if (!isObject(raw) || raw.kind !== kind) return null;
  const id = str(raw.id);
  const level = str(raw.level);
  const createdAt = instant(raw.createdAt);
  if (!id || !level || !createdAt || !Array.isArray(raw.results)) return null;
  const results = raw.results.map(readResult).filter((r): r is BenchResult => r !== null);
  if (!results.length) return null;
  const models: Record<string, string> = {};
  if (isObject(raw.models)) for (const [role, model] of Object.entries(raw.models)) if (str(model)) models[role] = model as string;
  return {
    run: {
      id,
      kind,
      role: str(raw.role),
      level,
      branch: str(raw.branch),
      commit: str(raw.commit),
      templateVersion: str(raw.templateVersion),
      models,
      fakeModels: raw.fakeModels === true,
      inConstruction: raw.inConstruction === true,
      casesTotal: count(raw.casesTotal) ?? 0,
      createdAt,
      results,
    },
    dropped: raw.results.length - results.length,
  };
}

const VERDICT_KINDS = new Set(["resta", "cambia", "nessuno", "senza_costi", "finti"]);

function readAnalysis(raw: unknown): BenchAnalysis | null {
  if (!isObject(raw) || !isObject(raw.verdict)) return null;
  const nullable = (v: unknown) => v === null || typeof v === "string";
  if (!nullable(raw.best) || !nullable(raw.cheapest) || !nullable(raw.efficient)) return null;
  if (!Array.isArray(raw.frontier) || !raw.frontier.every((m) => typeof m === "string")) return null;
  const verdict = raw.verdict;
  if (typeof verdict.kind !== "string" || !VERDICT_KINDS.has(verdict.kind) || !str(verdict.text)) return null;
  if ((verdict.kind === "resta" || verdict.kind === "cambia") && !str(verdict.model)) return null;
  return raw as unknown as BenchAnalysis;
}

/**
 * Quello che arriva dalla lettura, controllato prima di mostrarlo: le righe che non si leggono si tolgono (e si
 * contano, perché chi chiama lo scriva nel log), una lettura del banco che manca si rifà con la regola comune.
 * Dal database si accettano anche i numeri come testo di una colonna `numeric` («0.42») e le date come `Date`;
 * nessun altro testo diventa un numero. null se non è una panoramica.
 */
export function normalizeEvalOverview(raw: unknown): { overview: EvalOverview; dropped: number } | null {
  if (!isObject(raw) || !isObject(raw.evals)) return null;
  let dropped = 0;
  let latest: EvalRunView | null = null;
  if (raw.evals.latest !== null && raw.evals.latest !== undefined) {
    const read = readRun(raw.evals.latest, "evals");
    if (read) {
      latest = read.run;
      dropped += read.dropped;
    } else dropped += 1;
  }
  const rawTrend = Array.isArray(raw.evals.trend) ? raw.evals.trend : [];
  const trend = rawTrend.flatMap((p) => {
    const at = isObject(p) ? instant(p.at, true) : null;
    const quality = isObject(p) ? finite(p.quality) : null;
    if (!isObject(p) || at === null || quality === null || typeof p.thresholdsMet !== "boolean") return [];
    return [{ at, quality: clamp01(quality), thresholdsMet: p.thresholdsMet, fakeModels: p.fakeModels === true }];
  });
  dropped += rawTrend.length - trend.length;
  const rawBenches = Array.isArray(raw.benches) ? raw.benches : [];
  const roles = new Set<string>();
  const benches: EvalOverview["benches"] = [];
  for (const b of rawBenches) {
    const role = isObject(b) ? str(b.role) : null;
    const read = isObject(b) ? readRun(b.run, "banco") : null;
    if (!role || !ROLE_RE.test(role) || roles.has(role) || !read) {
      dropped += 1;
      continue;
    }
    roles.add(role);
    dropped += read.dropped;
    const analysis = (read.dropped === 0 ? readAnalysis(b.analysis) : null) ?? analyzeBench(read.run.results, { role, fakeModels: read.run.fakeModels });
    benches.push({ role, run: read.run, analysis });
  }
  benches.sort((a, b) => a.role.localeCompare(b.role, "it"));
  return { overview: { evals: { latest, trend }, benches }, dropped };
}
