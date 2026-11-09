/**
 * I KPI della pagina «Programma» (rilascio 7b, RILASCIO-7-PROGETTO.md §5; il modello è quello del «OKR &
 * ROI Monitor» di Nativa): un catalogo di KPI pronti, da attivare con un clic, e KPI personalizzati con
 * una formula.
 *
 * - **Le metriche** (`ProgramMetrics`): i numeri aggregati che la pagina calcola da sola (valore, use
 *   case, formazione, indice…). Le stesse chiavi stanno nelle fotografie (`program_snapshots.metrics`):
 *   l'andamento di un KPI automatico si legge da lì.
 * - **Il catalogo** (`KPI_CATALOG`): KPI «automatici» (una metrica) e KPI «a mano» (un valore al mese,
 *   scritto da una persona o dal Brain). Ognuno ha il suo tipo: «Risultato» o «Iniziativa». Gli obiettivi
 *   si fissano sui risultati; le iniziative li spiegano.
 * - **Le formule** (`parseFormula`, `evaluateFormula`): numeri, metriche, chiavi di altri KPI, `+ - * /`
 *   e parentesi. Niente `eval`, niente funzioni. Una divisione per zero o una chiave senza valore danno
 *   «nessun valore», mai un numero inventato.
 *
 * Il Brain (contratto del Monitor di Nativa) scrive solo i valori dei KPI a mano, mai formule né obiettivi.
 * Nessuna metrica per persona. Modulo puro: import relativi `.ts`.
 */
import type { ProgramKpiDirection, ProgramKpiKind, ProgramKpiSource } from "../db/use-case-hub-program-ddl.ts";

// ─── Metriche ────────────────────────────────────────────────────────

/** Le metriche che la pagina calcola, con la loro unità. */
export const PROGRAM_METRICS = Object.freeze({
  valore_stimato: { label: "Valore stimato all'anno", unit: "€" },
  valore_in_uso: { label: "Valore già in uso all'anno", unit: "€" },
  valore_per_dipendente: { label: "Valore in uso per dipendente", unit: "€" },
  valore_misurato_pct: { label: "Valore misurato sul totale", unit: "%" },
  indice_ai_native: { label: "Indice AI-native", unit: "/100" },
  dipendenti: { label: "Dipendenti", unit: "" },
  persone_formate: { label: "Persone formate", unit: "" },
  persone_formate_pct: { label: "Persone formate sui dipendenti", unit: "%" },
  ore_formazione: { label: "Ore di formazione", unit: "h" },
  use_case_in_uso: { label: "Use case in uso", unit: "" },
  use_case_in_realizzazione: { label: "Use case in realizzazione", unit: "" },
  use_case_da_avviare: { label: "Use case da avviare", unit: "" },
  agenti_da_rivedere: { label: "Use case in uso da rivedere", unit: "" },
  costo_cumulato: { label: "Costo cumulato fino a oggi", unit: "€" },
  valore_cumulato: { label: "Valore cumulato fino a oggi", unit: "€" },
});
export type ProgramMetricKey = keyof typeof PROGRAM_METRICS;
export const PROGRAM_METRIC_KEYS = Object.freeze(Object.keys(PROGRAM_METRICS) as ProgramMetricKey[]);

/** Le metriche di un momento: un numero, o null se non c'è (per esempio senza dipendenti). */
export type ProgramMetrics = Readonly<Record<ProgramMetricKey, number | null>>;

export function isMetricKey(key: string): key is ProgramMetricKey {
  return Object.prototype.hasOwnProperty.call(PROGRAM_METRICS, key);
}

// ─── Catalogo ────────────────────────────────────────────────────────

export interface CatalogKpi {
  key: string;
  label: string;
  unit: string;
  kind: ProgramKpiKind;
  source: Exclude<ProgramKpiSource, "formula">;
  direction: ProgramKpiDirection;
  /** Per i KPI automatici, la metrica. */
  metric?: ProgramMetricKey;
  /** Una riga: che cosa misura. */
  hint: string;
}

/** Il KPI a mano dell'uso settimanale dell'AI: quando ha un valore, il pilastro «Adozione» dell'indice lo usa. */
export const WEEKLY_USE_KPI = "uso_settimanale_ai";

/** Il catalogo dei KPI pronti, nell'ordine del pannello. */
export const KPI_CATALOG: readonly CatalogKpi[] = Object.freeze([
  { key: "valore_in_uso", label: "Valore in uso all'anno", unit: "€", kind: "risultato", source: "automatico", direction: "su", metric: "valore_in_uso", hint: "Dagli use case realizzati." },
  { key: "valore_per_dipendente", label: "Valore per dipendente", unit: "€", kind: "risultato", source: "automatico", direction: "su", metric: "valore_per_dipendente", hint: "Valore in uso diviso per i dipendenti." },
  { key: "valore_misurato_pct", label: "Valore misurato sul totale", unit: "%", kind: "risultato", source: "automatico", direction: "su", metric: "valore_misurato_pct", hint: "Quanta parte del valore stimato viene dal dossier del caso." },
  { key: "indice_ai_native", label: "Indice AI-native", unit: "/100", kind: "risultato", source: "automatico", direction: "su", metric: "indice_ai_native", hint: "Persone, use case, valore e adozione." },
  { key: "agenti_da_rivedere", label: "Use case in uso da rivedere", unit: "", kind: "risultato", source: "automatico", direction: "giu", metric: "agenti_da_rivedere", hint: "Rendono meno di 2 € per ogni euro di mantenimento." },
  { key: WEEKLY_USE_KPI, label: "Uso settimanale dell'AI", unit: "%", kind: "risultato", source: "manuale", direction: "su", hint: "Persone che usano l'AI ogni settimana, da un sondaggio." },
  { key: "tempo_ciclo", label: "Tempo di ciclo di un processo", unit: "giorni", kind: "risultato", source: "manuale", direction: "giu", hint: "Dal via alla fine di una pratica tipo." },
  { key: "errori_100_pratiche", label: "Errori per 100 pratiche", unit: "", kind: "risultato", source: "manuale", direction: "giu", hint: "Pratiche da rifare, su 100." },
  { key: "costo_pratica", label: "Costo per pratica", unit: "€", kind: "risultato", source: "manuale", direction: "giu", hint: "Costo pieno di una pratica tipo." },
  { key: "margine_incrementale", label: "Margine incrementale", unit: "€", kind: "risultato", source: "manuale", direction: "su", hint: "Dal controllo di gestione." },
  { key: "soddisfazione", label: "Soddisfazione delle persone", unit: "/10", kind: "risultato", source: "manuale", direction: "su", hint: "Da un sondaggio interno." },
  { key: "persone_formate_pct", label: "Persone formate", unit: "%", kind: "iniziativa", source: "automatico", direction: "su", metric: "persone_formate_pct", hint: "Sui dipendenti, dal registro della formazione." },
  { key: "ore_formazione", label: "Ore di formazione", unit: "h", kind: "iniziativa", source: "automatico", direction: "su", metric: "ore_formazione", hint: "Ore d'aula erogate, dal registro." },
  { key: "use_case_in_uso", label: "Use case in uso", unit: "", kind: "iniziativa", source: "automatico", direction: "su", metric: "use_case_in_uso", hint: "Realizzati." },
  { key: "use_case_in_realizzazione", label: "Use case in realizzazione", unit: "", kind: "iniziativa", source: "automatico", direction: "su", metric: "use_case_in_realizzazione", hint: "Partiti e non ancora in uso." },
] satisfies CatalogKpi[]);

export function catalogKpi(key: string): CatalogKpi | null {
  return KPI_CATALOG.find((kpi) => kpi.key === key) ?? null;
}

// ─── Formule ─────────────────────────────────────────────────────────

export type FormulaNode =
  | { t: "num"; v: number }
  | { t: "ref"; key: string }
  | { t: "neg"; a: FormulaNode }
  | { t: "op"; op: "+" | "-" | "*" | "/"; a: FormulaNode; b: FormulaNode };

export type FormulaParse = { ok: true; node: FormulaNode; refs: string[] } | { ok: false; error: string };

export const FORMULA_ERRORS = Object.freeze({
  empty: "Scrivi una formula.",
  tooLong: "La formula è troppo lunga.",
  syntax: "La formula non si legge: usa numeri, nomi, + - * / e parentesi.",
  unknown: "Non conosco «{k}».",
  self: "Una formula non può usare il suo stesso KPI.",
});

const FORMULA_MAX = 300;

/**
 * Legge una formula: `valore_in_uso / dipendenti`, `(a + b) * 0,5`. La virgola decimale va bene come il
 * punto. `known` dice quali nomi esistono (metriche e chiavi degli altri KPI).
 */
export function parseFormula(text: string, known: (key: string) => boolean, self?: string): FormulaParse {
  const source = text.trim();
  if (!source) return { ok: false, error: FORMULA_ERRORS.empty };
  if (source.length > FORMULA_MAX) return { ok: false, error: FORMULA_ERRORS.tooLong };
  const tokens = source.match(/\d+(?:[.,]\d+)?|[a-z][a-z0-9_]*|[-+*/()]|\S/g) ?? [];
  let i = 0;
  const refs = new Set<string>();
  const peek = () => tokens[i];
  const fail = (): never => {
    throw new SyntaxError("formula");
  };
  function primary(): FormulaNode {
    const tok = tokens[i++];
    if (tok === undefined) return fail();
    if (tok === "(") {
      const node = expr();
      if (tokens[i++] !== ")") fail();
      return node;
    }
    if (tok === "-") return { t: "neg", a: primary() };
    if (/^\d/.test(tok)) return { t: "num", v: Number(tok.replace(",", ".")) };
    if (/^[a-z]/.test(tok)) {
      refs.add(tok);
      return { t: "ref", key: tok };
    }
    return fail();
  }
  function term(): FormulaNode {
    let node = primary();
    while (peek() === "*" || peek() === "/") {
      const op = tokens[i++] as "*" | "/";
      node = { t: "op", op, a: node, b: primary() };
    }
    return node;
  }
  function expr(): FormulaNode {
    let node = term();
    while (peek() === "+" || peek() === "-") {
      const op = tokens[i++] as "+" | "-";
      node = { t: "op", op, a: node, b: term() };
    }
    return node;
  }
  let node: FormulaNode;
  try {
    node = expr();
    if (i !== tokens.length) fail();
  } catch {
    return { ok: false, error: FORMULA_ERRORS.syntax };
  }
  if (self && refs.has(self)) return { ok: false, error: FORMULA_ERRORS.self };
  for (const ref of refs) if (!known(ref)) return { ok: false, error: FORMULA_ERRORS.unknown.replace("{k}", ref) };
  return { ok: true, node, refs: [...refs] };
}

/** Il valore di una formula; null se un nome non ha valore o c'è una divisione per zero. */
export function evaluateFormula(node: FormulaNode, value: (key: string) => number | null): number | null {
  switch (node.t) {
    case "num":
      return node.v;
    case "ref": {
      const v = value(node.key);
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    }
    case "neg": {
      const a = evaluateFormula(node.a, value);
      return a === null ? null : -a;
    }
    case "op": {
      const a = evaluateFormula(node.a, value);
      const b = evaluateFormula(node.b, value);
      if (a === null || b === null) return null;
      if (node.op === "+") return a + b;
      if (node.op === "-") return a - b;
      if (node.op === "*") return a * b;
      if (b === 0) return null;
      const r = a / b;
      return Number.isFinite(r) ? r : null;
    }
  }
}

// ─── I KPI del workspace ─────────────────────────────────────────────

/** Un KPI attivato (`program_kpis`). */
export interface StoredKpi {
  id: string;
  key: string;
  label: string;
  unit: string;
  kind: ProgramKpiKind;
  source: ProgramKpiSource;
  formula: string | null;
  base: number | null;
  target: number | null;
  direction: ProgramKpiDirection;
  keyResultId: string | null;
  position: number;
}

/** Un valore scritto a mano o dal Brain (`program_kpi_values`). */
export interface StoredKpiValue {
  kpiId: string;
  period: string;
  value: number;
  source: "manuale" | "brain";
}

export interface KpiPoint {
  period: string;
  value: number;
}

export interface KpiRow {
  id: string;
  key: string;
  label: string;
  unit: string;
  kind: ProgramKpiKind;
  source: ProgramKpiSource;
  formula: string | null;
  direction: ProgramKpiDirection;
  base: number | null;
  target: number | null;
  /** Il valore di adesso; null senza. */
  now: number | null;
  /** Per i KPI a mano: il mese dell'ultimo valore e chi l'ha scritto. */
  lastPeriod: string | null;
  lastSource: "manuale" | "brain" | null;
  /** Da 0 a 100 verso l'obiettivo; null senza base, obiettivo o valore. */
  progress: number | null;
  /** L'andamento, mese per mese, dalle fotografie (automatici e formule) o dai valori (a mano). */
  history: KpiPoint[];
  keyResultId: string | null;
  /** La formula non si legge più (un KPI che usava è stato tolto). */
  broken: boolean;
}

/** Da 0 a 100 verso l'obiettivo, nel verso giusto; null senza i tre numeri o con base uguale all'obiettivo. */
export function kpiProgress(base: number | null, now: number | null, target: number | null, direction: ProgramKpiDirection): number | null {
  if (base === null || now === null || target === null || base === target) return null;
  const raw = direction === "giu" ? (base - now) / (base - target) : (now - base) / (target - base);
  if (!Number.isFinite(raw)) return null;
  return Math.max(0, Math.min(100, raw * 100));
}

/**
 * I KPI del workspace con il loro valore di adesso e l'andamento. `metrics` sono le metriche di adesso;
 * `history` le fotografie mensili (le metriche e i valori dei KPI di ogni mese), dalla più vecchia.
 */
export function kpiRows(
  kpis: readonly StoredKpi[],
  values: readonly StoredKpiValue[],
  metrics: ProgramMetrics,
  history: ReadonlyArray<{ period: string; metrics: Partial<Record<string, number | null>>; kpis?: Partial<Record<string, number | null>> }>,
): KpiRow[] {
  const byKpi = new Map<string, StoredKpiValue[]>();
  for (const v of values) byKpi.set(v.kpiId, [...(byKpi.get(v.kpiId) ?? []), v]);
  for (const list of byKpi.values()) list.sort((a, b) => a.period.localeCompare(b.period));
  const sorted = [...kpis].sort((a, b) => a.position - b.position || a.label.localeCompare(b.label, "it-IT"));
  const now = new Map<string, number | null>();
  // Prima i KPI senza formula, poi le formule (che possono usare gli altri): due giri bastano per una catena corta.
  for (const kpi of sorted) {
    if (kpi.source === "manuale") now.set(kpi.key, byKpi.get(kpi.id)?.at(-1)?.value ?? null);
    if (kpi.source === "automatico") {
      const metric = catalogKpi(kpi.key)?.metric;
      now.set(kpi.key, metric ? metrics[metric] : null);
    }
  }
  const lookup = (key: string) => (isMetricKey(key) ? metrics[key] : (now.get(key) ?? null));
  const known = (key: string) => isMetricKey(key) || kpis.some((k) => k.key === key);
  const parsed = new Map<string, FormulaParse>();
  for (let round = 0; round < 3; round++) {
    for (const kpi of sorted) {
      if (kpi.source !== "formula" || !kpi.formula) continue;
      const p = parsed.get(kpi.id) ?? parseFormula(kpi.formula, known, kpi.key);
      parsed.set(kpi.id, p);
      now.set(kpi.key, p.ok ? evaluateFormula(p.node, lookup) : null);
    }
  }
  return sorted.map((kpi) => {
    const own = byKpi.get(kpi.id) ?? [];
    const last = own.at(-1) ?? null;
    let points: KpiPoint[];
    if (kpi.source === "manuale") points = own.map((v) => ({ period: v.period, value: v.value }));
    else {
      const metric = kpi.source === "automatico" ? catalogKpi(kpi.key)?.metric : undefined;
      points = history.flatMap((snap) => {
        const v = metric ? snap.metrics[metric] : snap.kpis?.[kpi.key];
        return typeof v === "number" && Number.isFinite(v) ? [{ period: snap.period, value: v }] : [];
      });
    }
    const value = now.get(kpi.key) ?? null;
    const broken = kpi.source === "formula" && !(parsed.get(kpi.id)?.ok ?? false);
    return {
      id: kpi.id,
      key: kpi.key,
      label: kpi.label,
      unit: kpi.unit,
      kind: kpi.kind,
      source: kpi.source,
      formula: kpi.formula,
      direction: kpi.direction,
      base: kpi.base,
      target: kpi.target,
      now: value,
      lastPeriod: kpi.source === "manuale" ? (last?.period ?? null) : null,
      lastSource: kpi.source === "manuale" ? (last?.source ?? null) : null,
      progress: kpiProgress(kpi.base, value, kpi.target, kpi.direction),
      history: points,
      keyResultId: kpi.keyResultId,
      broken,
    };
  });
}

/** I valori dei KPI di adesso, per la fotografia del mese: chiave → valore. */
export function kpiSnapshotValues(rows: readonly KpiRow[]): Record<string, number | null> {
  return Object.fromEntries(rows.map((row) => [row.key, row.now]));
}

/** Una chiave nuova per un KPI personalizzato dal suo nome: «Costo per ticket» → `costo_per_ticket`. */
export function kpiKeyOf(label: string, taken: ReadonlySet<string>): string {
  const base =
    label
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/^(\d)/, "k_$1")
      .slice(0, 34) || "kpi";
  // La CHECK vuole almeno due caratteri; mai la chiave di una metrica o di un KPI del catalogo.
  const start = /^[a-z][a-z0-9_]/.test(base) ? base : `kpi_${base}`;
  const used = (key: string) => taken.has(key) || isMetricKey(key) || catalogKpi(key) !== null;
  let key = start;
  for (let n = 2; used(key); n++) key = `${start}_${n}`;
  return key;
}
