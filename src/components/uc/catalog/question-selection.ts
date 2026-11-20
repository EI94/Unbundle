/**
 * La selezione di Domande (rilascio 10, §3.5), come stato puro: le righe scelte una per una, gli argomenti scelti
 * interi quando sono chiusi, il gruppo «In attesa» e «Seleziona tutte (N)». I passaggi sono funzioni da applicare allo
 * stato di adesso (`setSel((prev) => …)`): una lettura del server che arriva dopo un'altra non cancella quello che
 * l'altra ha aggiunto.
 *
 * - «Seleziona tutte (N)» vale per la vista: in «Da fare» non comprende «In attesa» (le bloccate), che si sceglie a
 *   parte e resta scelto insieme a «tutte».
 * - Con «tutte» gli argomenti risultano scelti; togliere un argomento lo sottrae (con le sue domande lette dal
 *   server), rimetterlo lo riaggiunge.
 * - Una riga tolta da «tutte» torna alla selezione della pagina, come prima.
 *
 * Modulo puro, senza React.
 */
import type { ItemStatus } from "../../../lib/uc/vocab.ts";

/** La chiave del gruppo «In attesa» tra gli argomenti scelti. */
export const WAITING_GROUP = "__attesa";

/** Le domande di una parte della vista, lette dal server: per stato, quante e se erano troppe. */
export interface SelectionPart {
  byStatus: Partial<Record<ItemStatus, string[]>>;
  count: number;
  truncated: boolean;
}

/** La forma che legge la barra della selezione (`BulkSelection` di `bulk-actions.tsx`). */
export interface SelectionSummary {
  scope: "pagina" | "risultati";
  byStatus: Partial<Record<ItemStatus, string[]>>;
  count: number;
  truncated: boolean;
}

export interface SelectionState {
  /** La vista in cui la selezione è nata (la query della lista): cambiando vista si svuota. */
  key: string;
  /** Le righe scelte una per una. */
  picked: ReadonlyMap<string, ItemStatus>;
  /** Gli argomenti (e «In attesa») scelti interi. */
  topics: ReadonlyMap<string, SelectionPart>;
  /** «Seleziona tutte (N)»: tutta la vista. */
  all: SelectionPart | null;
  /** Gli argomenti tolti da «tutte», con le loro domande da sottrarre. */
  excluded: ReadonlyMap<string, SelectionPart>;
}

export function emptySelection(key: string): SelectionState {
  return { key, picked: new Map(), topics: new Map(), all: null, excluded: new Map() };
}

/** Lo stato della vista di adesso: quello di un'altra vista non vale più. */
export function selectionFor(state: SelectionState, key: string): SelectionState {
  return state.key === key ? state : emptySelection(key);
}

/** Una riga della pagina: scelta una per una, oppure (con «tutte») perché «tutte» la comprende. */
export function rowPicked(state: SelectionState, id: string): boolean {
  return state.all !== null || state.picked.has(id);
}

/** Un gruppo chiuso: «In attesa» solo se scelto; un argomento se scelto o se «tutte» lo comprende e non è stato tolto. */
export function groupPicked(state: SelectionState, key: string): boolean {
  if (key === WAITING_GROUP) return state.topics.has(WAITING_GROUP);
  return state.all !== null ? !state.excluded.has(key) : state.topics.has(key);
}

/**
 * Un clic sulla casella di un gruppo serve una lettura del server? Sì per sceglierlo, tranne quando si rimette un
 * argomento tolto da «tutte» (le sue domande sono già note); sì per togliere un argomento da «tutte».
 */
export function groupNeedsRead(state: SelectionState, key: string, on: boolean): boolean {
  if (key === WAITING_GROUP || state.all === null) return on;
  return on ? !state.excluded.has(key) : true;
}

/** Una riga scelta o tolta. Con «tutte», toglierne una torna alla selezione della pagina (`pageRows`) meno quella. */
export function toggleRow(state: SelectionState, row: { id: string; status: ItemStatus }, on: boolean, pageRows: readonly { id: string; status: ItemStatus }[]): SelectionState {
  const picked = new Map(state.all ? pageRows.map((r) => [r.id, r.status] as const) : state.picked);
  if (on) picked.set(row.id, row.status);
  else picked.delete(row.id);
  const waiting = state.topics.get(WAITING_GROUP);
  return { key: state.key, picked, topics: waiting ? new Map([[WAITING_GROUP, waiting]]) : new Map(), all: null, excluded: new Map() };
}

/**
 * Un gruppo scelto o tolto, con le sue domande se servivano (`groupNeedsRead`). Si applica allo stato di quando la
 * lettura è arrivata: due gruppi scelti di fila restano scelti tutti e due, in qualunque ordine arrivino le letture.
 */
export function toggleGroup(state: SelectionState, key: string, on: boolean, part: SelectionPart | null): SelectionState {
  if (key === WAITING_GROUP || state.all === null) {
    const topics = new Map(state.topics);
    if (!on) topics.delete(key);
    else if (part) topics.set(key, part);
    else return state;
    return { ...state, picked: key === WAITING_GROUP ? state.picked : new Map(), topics };
  }
  const excluded = new Map(state.excluded);
  if (on) excluded.delete(key);
  else if (part) excluded.set(key, part);
  else return state;
  return { ...state, excluded };
}

/** «Seleziona tutte (N)»: la vista intera; restano le righe scelte e «In attesa», che «tutte» non comprende. */
export function selectAll(state: SelectionState, all: SelectionPart): SelectionState {
  const waiting = state.topics.get(WAITING_GROUP);
  return { key: state.key, picked: state.picked, topics: waiting ? new Map([[WAITING_GROUP, waiting]]) : new Map(), all, excluded: new Map() };
}

/** Le domande scelte, per la barra: «tutte» meno gli argomenti tolti, più i gruppi scelti, più le righe. */
export function selectionOf(state: SelectionState): SelectionSummary {
  const byStatus: Partial<Record<ItemStatus, string[]>> = {};
  const seen = new Set<string>();
  const add = (status: ItemStatus, id: string) => {
    if (seen.has(id)) return false;
    seen.add(id);
    (byStatus[status] ??= []).push(id);
    return true;
  };
  let count = 0;
  let truncated = false;
  if (state.all) {
    const out = new Set<string>();
    for (const part of state.excluded.values()) for (const ids of Object.values(part.byStatus)) for (const id of ids ?? []) out.add(id);
    let removed = 0;
    for (const [status, ids] of Object.entries(state.all.byStatus) as [ItemStatus, string[]][]) {
      for (const id of ids) {
        if (out.has(id)) removed++;
        else add(status, id);
      }
    }
    count += Math.max(0, state.all.count - removed);
    truncated ||= state.all.truncated;
  }
  for (const part of state.topics.values()) {
    for (const [status, ids] of Object.entries(part.byStatus) as [ItemStatus, string[]][]) for (const id of ids) add(status, id);
    count += part.count;
    truncated ||= part.truncated;
  }
  for (const [id, status] of state.picked) if (add(status, id)) count++;
  return { scope: state.all || state.topics.size > 0 ? "risultati" : "pagina", byStatus, count, truncated };
}
