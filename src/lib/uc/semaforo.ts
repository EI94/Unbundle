/**
 * Semaforo, conteggi e prontezza (PIANO §3.7).
 *
 * - Testata: si contano le voci dei moduli di richiesta (`request_module_key`
 *   non nullo), indipendentemente dalla regola del gate (sul primo caso: 477).
 * - `computeReadiness` produce la cache `uc_cases.readiness`; la pagina del caso
 *   la ricalcola sempre dal vivo con la stessa funzione.
 * - Per referente solo conteggi, in ordine alfabetico: nessuna classifica e
 *   nessun tempo (art. 15.4).
 *
 * Modulo puro e senza dipendenze di Node: colori ed etichette si usano anche nei
 * componenti client.
 */
import { MVP_AVAILABLE_GATES, isCasePastG1 } from "./case-state.ts";
import {
  computeGate,
  literalCoverage,
  type BlockerMeta,
  type CoverageLink,
  type DatasetMeta,
  type GateComputation,
  type GateItem,
  type GatePolicy,
  type LiteralCoverage,
} from "./gates.ts";
import { ITEM_STATUSES, type CaseStatus, type GateKey, type ItemStatus, type SemaforoColor } from "./vocab.ts";

/** Ordine della barra, come nel prototipo. */
export const SEMAFORO_ORDER = ["validata", "non_applicabile", "in_verifica", "parziale", "chiesta", "mancante", "bloccata", "da_chiedere"] as const satisfies readonly ItemStatus[];

/** Dal peggiore al migliore: colore di un nodo della mappa con più voci [D]. */
export const WORST_FIRST = ["mancante", "bloccata", "da_chiedere", "chiesta", "parziale", "in_verifica", "non_applicabile", "validata"] as const satisfies readonly ItemStatus[];

export const STATUS_COLOR: Readonly<Record<ItemStatus, SemaforoColor>> = {
  da_chiedere: "grigio",
  chiesta: "grigio",
  mancante: "rosso",
  parziale: "giallo",
  in_verifica: "giallo",
  validata: "verde",
  non_applicabile: "blu",
  bloccata: "lucchetto",
};

/**
 * Gli 8 stati di dettaglio, come li vede Lateral Space (DESIGN §2.6, «Stato
 * dettagliato»): la sotto-etichetta grigia dove c'è, altrimenti il gruppo. Il
 * cliente e il referente vedono i 4 gruppi di `views/status-groups.ts`.
 */
export const STATUS_LABEL: Readonly<Record<ItemStatus, string>> = {
  da_chiedere: "Non ancora chiesta",
  chiesta: "Chiesta, in attesa",
  mancante: "Manca il dato",
  parziale: "Risposta parziale",
  in_verifica: "Da verificare",
  validata: "A posto",
  non_applicabile: "Non si applica",
  bloccata: "Bloccata",
};

export interface SemaforoCounts {
  counts: Record<ItemStatus, number>;
  total: number;
  /** `round(100 · (validata + non_applicabile) / total)`, 0 senza voci. */
  greenPct: number;
}

export function semaforoCounts(statuses: readonly ItemStatus[]): SemaforoCounts {
  const counts = Object.fromEntries(ITEM_STATUSES.map((s) => [s, 0])) as Record<ItemStatus, number>;
  for (const s of statuses) counts[s]++;
  const total = statuses.length;
  const greenPct = total === 0 ? 0 : Math.round((100 * (counts.validata + counts.non_applicabile)) / total);
  return { counts, total, greenPct };
}

/** Stato peggiore tra quelli dati (colore del nodo della mappa), null senza voci. */
export function worstStatus(statuses: readonly ItemStatus[]): ItemStatus | null {
  for (const s of WORST_FIRST) if (statuses.includes(s)) return s;
  return null;
}

export const UNASSIGNED_LABEL = "Senza referente";

/**
 * Voci aperte per referente: solo conteggi, in ordine alfabetico (le voci senza
 * referente in fondo). Nessuna classifica, nessun tempo, nessuna voce chiusa.
 */
export function openCountsByAssignee(items: readonly { assigneeLabel: string | null; ok: boolean }[]): { label: string; open: number }[] {
  const by = new Map<string, number>();
  let unassigned = 0;
  for (const i of items) {
    if (i.ok) continue;
    const label = i.assigneeLabel?.trim();
    if (!label) unassigned++;
    else by.set(label, (by.get(label) ?? 0) + 1);
  }
  const out = [...by.entries()].sort(([a], [b]) => a.localeCompare(b, "it")).map(([label, open]) => ({ label, open }));
  if (unassigned > 0) out.push({ label: UNASSIGNED_LABEL, open: unassigned });
  return out;
}

/** Riga del gate sotto la barra, come nel prototipo. */
export function gateLineText(g: Pick<GateComputation, "required" | "ok" | "ready" | "available">): string {
  if (!g.available) return "Gate non disponibile in questa versione.";
  if (g.ready) return "Tutte le voci obbligatorie sono verdi. Il team Lateral Space può avviare lo sviluppo.";
  if (g.required > 0 && g.ok === g.required) return "Tutte le voci obbligatorie sono a posto: restano da chiudere le altre condizioni del gate.";
  return `Per avviare lo sviluppo servono verdi le ${g.required} voci obbligatorie: ora ${g.ok}.`;
}

/** Cache `uc_cases.readiness` (chiavi snake_case, solo conteggi). */
export interface Readiness {
  computed_at: string;
  catalog_revision: number;
  scope_total: number;
  per_stato: Record<ItemStatus, number>;
  green_pct: number;
  G1: { required: number; ok: number; ready: boolean; should: { total: number; ok: number }; waivers: { used: number; cap: number } };
  coverage_model: { literal_required: number; covered_by_questions: number; ok: number };
  /** Il caso è oltre G1 ma G1 non è più pronto: «Gate da riconfermare». Lo stato del caso non cambia da solo. */
  gate_reconfirm: boolean;
}

/**
 * Prontezza del caso: testata (voci dei moduli), G1 e copertura del modello
 * dati. Restituisce anche il calcolo completo del gate per la pagina.
 */
export function computeReadiness(i: {
  items: readonly GateItem[];
  links: readonly CoverageLink[];
  datasets: readonly DatasetMeta[];
  blockers: readonly BlockerMeta[];
  now: Date;
  catalogRevision: number;
  caseCode: string;
  caseStatus: CaseStatus;
  statusBeforeSuspension: CaseStatus | null;
  policy: Pick<GatePolicy, "scope">;
  available?: readonly GateKey[];
}): { readiness: Readiness; g1: GateComputation; coverage: LiteralCoverage } {
  const scope = i.items.filter((x) => !x.deleted && x.requestModuleKey !== null);
  const sem = semaforoCounts(scope.map((x) => x.status));
  const g1 = computeGate({
    gate: "G1",
    items: i.items,
    datasets: i.datasets,
    blockers: i.blockers,
    now: i.now,
    available: i.available ?? MVP_AVAILABLE_GATES,
    caseCode: i.caseCode,
    policyScope: i.policy.scope,
  });
  const coverage = literalCoverage({ items: i.items, links: i.links, gate: "G1", now: i.now });
  return {
    g1,
    coverage,
    readiness: {
      computed_at: i.now.toISOString(),
      catalog_revision: i.catalogRevision,
      scope_total: sem.total,
      per_stato: sem.counts,
      green_pct: sem.greenPct,
      G1: { required: g1.required, ok: g1.ok, ready: g1.ready, should: g1.should, waivers: { used: g1.waivers.used, cap: g1.waivers.cap } },
      coverage_model: { literal_required: coverage.literalRequired, covered_by_questions: coverage.coveredByQuestions, ok: coverage.ok },
      gate_reconfirm: isCasePastG1(i.caseStatus, i.statusBeforeSuspension) && !g1.ready,
    },
  };
}
