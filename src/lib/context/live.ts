/**
 * I dati della Discovery come righe della Memoria (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §7.2): tesi
 * del valore, perimetro, unità con le attività mappate, obiettivi; dipendenti e ricavo solo ai revisori. Si leggono dal
 * vivo dove sono già (fonte «Discovery», senza azioni): non si copiano mai tra i fatti.
 * Modulo puro: i dati arrivano da fuori (`loadLiveDiscovery` in src/lib/db/queries/context-discovery.ts).
 */
import { formatEuro, formatInteger } from "../use-cases/format.ts";
import { cut, oneLine } from "./normalize.ts";
import { CONTEXT_TEXT } from "./text.ts";
import type { ContextSection } from "./vocab.ts";

/** Un dato della Discovery, letto dal vivo: mai salvato tra i fatti. */
export interface LiveRow {
  key: string;
  section: ContextSection;
  text: string;
  /** Un'etichetta breve davanti alla riga («Obiettivo», «Risultato chiave», «Goal»), o null. */
  tag: string | null;
}

export interface LiveDiscoveryData {
  thesis: unknown;
  boundary: unknown;
  departments: ReadonlyArray<{ id: string; name: string; description: string | null; teamSize: number | null }>;
  /** Attività mappate per unità (`departments.id`). */
  activityCounts: ReadonlyMap<string, number>;
  goals: ReadonlyArray<{ id: string; type: string; title: string }>;
  /** Dipendenti e ricavo dell'ultimo anno: null per chi non è un revisore, o se non ci sono. */
  employees: number | null;
  revenueEur: number | null;
}

/** Quante righe della Discovery entrano in una sezione, al massimo. */
export const LIVE_ROWS_PER_SECTION = 40;
const LINE_MAX = 400;

const line = (value: unknown): string => (typeof value === "string" ? cut(oneLine(value), LINE_MAX) : "");
const list = (value: unknown): string =>
  Array.isArray(value)
    ? cut(
        value
          .map(line)
          .filter(Boolean)
          .slice(0, 20)
          .join(", "),
        LINE_MAX,
      )
    : "";
const field = (object: unknown, key: string): unknown => (object !== null && typeof object === "object" && !Array.isArray(object) ? (object as Record<string, unknown>)[key] : undefined);

/** «12 mln €» per i milioni tondi (al decimo), altrimenti «1.250.000 €». */
export function compactEuro(amount: number): string {
  if (Number.isFinite(amount) && amount >= 1_000_000 && Math.round(amount) % 100_000 === 0) {
    return `${(amount / 1_000_000).toLocaleString("it-IT", { maximumFractionDigits: 1 })} mln €`;
  }
  return formatEuro(amount);
}

/** Le etichette delle righe della Discovery. */
export type LiveLabels = typeof CONTEXT_TEXT.live;

/**
 * Le etichette con cui i dati della Discovery entrano nell'impronta di «In breve» (`briefFactsHash`, `facts_hash`):
 * quelle del rilascio 9a, ferme. Le parole a schermo possono cambiare (il rilascio 10 dice «Dove fa la differenza» al
 * posto di «Nodi strategici»); l'impronta no, finché i dati sono gli stessi: «In breve» non si riscrive, e il modello non
 * si chiama, solo perché è cambiata un'etichetta. Non si toccano: cambiarle riscrive «In breve» di ogni workspace.
 */
export const LIVE_HASH_LABELS: LiveLabels = Object.freeze({
  strategicNodes: (items: string) => `Nodi strategici: ${items}`,
  commodityNodes: (items: string) => `Nodi commodity: ${items}`,
  marginDrivers: (items: string) => `Motori di margine: ${items}`,
  risks: (items: string) => `Rischi: ${items}`,
  aiReadiness: (level: string) => `Maturità AI: ${level}`,
  employees: (count: string) => `Dipendenti: ${count}`,
  revenue: (amount: string) => `Ricavo dell'ultimo anno: ${amount}`,
  people: (n: number) => (n === 1 ? "1 persona" : `${n} persone`),
  activities: (n: number) => (n === 1 ? "1 attività mappata" : `${n} attività mappate`),
  boundaryIncluded: (items: string) => `incluse ${items}`,
  boundaryExcluded: (items: string) => `escluse ${items}`,
  boundary: (parts: string) => `Perimetro: ${parts}`,
  horizon: (value: string) => `Orizzonte: ${value}`,
  goalTag: Object.freeze({ goal: "Obiettivo", objective: "Obiettivo", key_result: "Risultato chiave" }),
});

/** Le righe della Discovery, nell'ordine delle sezioni della pagina. `labels`: le parole a schermo, se non è detto altro. */
export function buildLiveRows(data: LiveDiscoveryData, labels: LiveLabels = CONTEXT_TEXT.live): LiveRow[] {
  const rows: LiveRow[] = [];
  const push = (key: string, section: ContextSection, text: string, tag: string | null = null) => {
    if (text) rows.push({ key, section, text, tag });
  };
  const t = labels;

  // Azienda: la tesi del valore, e per i revisori dipendenti e ricavo.
  push("tesi:proposta", "azienda", line(field(data.thesis, "coreValueProposition")));
  const strategic = list(field(data.thesis, "strategicNodes"));
  if (strategic) push("tesi:strategici", "azienda", t.strategicNodes(strategic));
  const commodity = list(field(data.thesis, "commodityNodes"));
  if (commodity) push("tesi:commodity", "azienda", t.commodityNodes(commodity));
  const margin = list(field(data.thesis, "marginDrivers"));
  if (margin) push("tesi:margine", "azienda", t.marginDrivers(margin));
  const risks = list(field(data.thesis, "keyRisks"));
  if (risks) push("tesi:rischi", "azienda", t.risks(risks));
  const readiness = line(field(data.thesis, "aiReadiness"));
  if (readiness) push("tesi:maturita", "azienda", t.aiReadiness(readiness));
  if (typeof data.employees === "number" && data.employees > 0) push("azienda:dipendenti", "azienda", t.employees(formatInteger(data.employees)));
  if (typeof data.revenueEur === "number" && data.revenueEur > 0) push("azienda:ricavo", "azienda", t.revenue(compactEuro(data.revenueEur)));

  // Come lavorano: una riga per unità; i pezzi che mancano si saltano.
  for (const unit of data.departments.slice(0, LIVE_ROWS_PER_SECTION)) {
    const name = line(unit.name);
    if (!name) continue;
    const description = line(unit.description);
    const pieces = [description ? `${name}: ${description}` : name];
    if (typeof unit.teamSize === "number" && unit.teamSize > 0) pieces.push(t.people(unit.teamSize));
    const activities = data.activityCounts.get(unit.id) ?? 0;
    if (activities > 0) pieces.push(t.activities(activities));
    push(`unita:${unit.id}`, "lavoro", pieces.join(" · "));
  }

  // Obiettivi e priorità: una riga per obiettivo, con la sua etichetta.
  for (const goal of data.goals.slice(0, LIVE_ROWS_PER_SECTION)) {
    const tag = goal.type === "objective" ? t.goalTag.objective : goal.type === "key_result" ? t.goalTag.key_result : t.goalTag.goal;
    push(`obiettivo:${goal.id}`, "obiettivi", line(goal.title), tag);
  }

  // Regole e vincoli: il perimetro, il motivo, l'orizzonte.
  const included = list(field(data.boundary, "includedFunctions"));
  const excluded = list(field(data.boundary, "excludedFunctions"));
  const scope = [included ? t.boundaryIncluded(included) : "", excluded ? t.boundaryExcluded(excluded) : ""].filter(Boolean).join("; ");
  if (scope) push("perimetro:funzioni", "regole", t.boundary(scope));
  push("perimetro:motivo", "regole", line(field(data.boundary, "rationale")));
  const horizon = line(field(data.boundary, "timeHorizon"));
  if (horizon) push("perimetro:orizzonte", "regole", t.horizon(horizon));

  return rows;
}

/** Le righe come le riceve il modello: una riga l'una, con l'etichetta davanti. */
export function liveLines(rows: readonly LiveRow[]): string[] {
  return rows.map((row) => (row.tag ? `${row.tag}: ${row.text}` : row.text));
}

/** Le righe come entrano nell'impronta di «In breve»: gli stessi dati, con le etichette ferme (`LIVE_HASH_LABELS`). */
export function liveHashLines(data: LiveDiscoveryData): string[] {
  return liveLines(buildLiveRows(data, LIVE_HASH_LABELS));
}
