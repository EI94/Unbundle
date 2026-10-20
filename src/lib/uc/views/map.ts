/**
 * Mappe del caso (PIANO §5.1; Soluzione › Mappa, DESIGN §3.7.2): la soluzione
 * disegnata dal grafo dello schema (o del seed), i due processi a passi e
 * l'esempio dall'inizio alla fine. Ogni passo porta le domande collegate con
 * stato e referente; il suo tono è quello della domanda messa peggio, in tre
 * toni (`stepTone`), tratteggiato se non ha domande collegate. I testi dei
 * passi e degli archi arrivano già puliti per chi guarda (`readableText`), così
 * l'elenco e la vista di analisi dicono le stesse cose.
 *
 * Modulo puro.
 */
import { worstStatus } from "../semaforo.ts";
import { rowJson, rowNumber, rowString, rowVocab, type Row } from "../sql/readiness.ts";
import { ITEM_KINDS, ITEM_STATUSES, MAP_KINDS, type CaseRole, type ItemKind, type ItemStatus, type MapKind, type SemaforoColor } from "../vocab.ts";
import { readableText, readableTitle } from "./description.ts";
import { KIND_LABEL } from "./labels.ts";
import { canOpenItem } from "./page-access.ts";
import type { ContactOption } from "./rows.ts";
import { STATUS_GROUPS, STATUS_GROUP_LABEL, STATUS_GROUP_OF, audienceFor, type Audience, type StatusGroup } from "./status-groups.ts";
import { formatCountIt } from "./format.ts";

export interface MapItemRef {
  key: string;
  id: string | null;
  /** Il titolo per chi guarda (`readableTitle`); per un riferimento fuori catalogo, la chiave. */
  title: string;
  kind: ItemKind | null;
  status: ItemStatus | null;
  /**
   * Chi risponde: il referente assegnato se chi guarda ne vede il nome (solo
   * Lateral Space), altrimenti il ruolo titolare; «Referente» se non c'è ruolo.
   */
  owner: string | null;
  canOpen: boolean;
}

export interface SolutionNodeView {
  id: string;
  label: string;
  description: string | null;
  who: string | null;
  input: string[];
  output: string[];
  items: MapItemRef[];
  worst: ItemStatus | null;
}

export interface MapEdgeView {
  from: string;
  to: string;
  label: string | null;
}

export interface SolutionMapView {
  title: string;
  version: number;
  nodes: SolutionNodeView[];
  edges: MapEdgeView[];
}

export interface ProcessStepView {
  id: string;
  label: string;
  phase: string | null;
  who: string | null;
  tool: string | null;
  time: string | null;
  friction: string | null;
  input: string[];
  output: string[];
  humanDecision: string | null;
  items: MapItemRef[];
  /** Dati citati che non sono voci del catalogo. */
  otherData: string[];
}

export interface ProcessMapView {
  kind: MapKind;
  title: string;
  steps: ProcessStepView[];
}

export interface MapsView {
  solution: SolutionMapView | null;
  toBe: ProcessMapView | null;
  asIs: ProcessMapView | null;
  example: ProcessMapView | null;
  /** Altre mappe (flusso dati, sistemi, incastri) se il caso le ha. */
  others: ProcessMapView[];
}

type Obj = Record<string, unknown>;

function obj(v: unknown): Obj | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null;
}

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function texts(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()) : [];
}

export interface MapRowParsed {
  kind: MapKind;
  title: string;
  version: number;
  nodes: Obj[];
  edges: Obj[];
}

export function parseMapRows(rows: readonly Row[]): MapRowParsed[] {
  return rows.flatMap((r) => {
    const kind = rowVocab(MAP_KINDS, r.kind);
    const graph = obj(rowJson(r.graph));
    if (!kind || !graph) return [];
    const nodes = Array.isArray(graph.nodes) ? graph.nodes.map(obj).filter((n): n is Obj => n !== null && typeof n.id === "string") : [];
    const edges = Array.isArray(graph.edges) ? graph.edges.map(obj).filter((e): e is Obj => e !== null && typeof e.from === "string" && typeof e.to === "string") : [];
    return [{ kind, title: rowString(r.title) ?? "Mappa", version: rowNumber(r.version) ?? 1, nodes, edges }];
  });
}

/** Chiavi delle voci citate dalle mappe (per leggerne stato e referente). */
export function mapItemKeys(maps: readonly MapRowParsed[]): string[] {
  const keys = new Set<string>();
  for (const m of maps) for (const n of m.nodes) for (const k of texts(n.items)) keys.add(k);
  return [...keys].slice(0, 5000);
}

export interface MapItemsContext {
  items: ReadonlyMap<string, Row>;
  contacts: ReadonlyMap<string, ContactOption>;
  roleLabels: Readonly<Record<string, string>>;
  roles: readonly CaseRole[];
}

function itemRefs(keys: readonly string[], ctx: MapItemsContext): MapItemRef[] {
  const audience = audienceFor(ctx.roles);
  return keys.map((key) => {
    const r = ctx.items.get(key);
    if (!r) return { key, id: null, title: key, kind: null, status: null, owner: null, canOpen: false };
    const status = rowVocab(ITEM_STATUSES, r.status) ?? "da_chiedere";
    const kind = rowVocab(ITEM_KINDS, r.kind);
    const assignee = rowString(r.assignee_contact_id);
    const contact = assignee ? ctx.contacts.get(assignee) : undefined;
    const role = rowString(r.owner_role_key);
    return {
      key,
      id: String(r.id),
      title: readableTitle(rowString(r.title), audience, kind ? KIND_LABEL[kind].one : KIND_LABEL.domanda.one),
      kind,
      status,
      owner: contact ? contact.name : role ? (ctx.roleLabels[role] ?? role) : assignee ? "Referente" : null,
      canOpen: canOpenItem(ctx.roles, status),
    };
  });
}

/** Un testo della mappa per chi guarda (`readableText`: niente codici dei fatti; per il cliente niente articoli né chiavi). */
function readable(v: unknown, audience: Audience): string | null {
  const t = text(v);
  return t ? readableText(t, audience) || null : null;
}

function worstOf(items: readonly MapItemRef[]): ItemStatus | null {
  return worstStatus(items.map((i) => i.status).filter((s): s is ItemStatus => s !== null));
}

function solutionView(m: MapRowParsed, ctx: MapItemsContext): SolutionMapView {
  const audience = audienceFor(ctx.roles);
  const ids = new Set(m.nodes.map((n) => String(n.id)));
  const nodes = m.nodes.map((n) => {
    const items = itemRefs(texts(n.items), ctx);
    return {
      id: String(n.id),
      label: readable(n.label, audience) ?? String(n.id),
      description: readable(n.description, audience),
      who: readable(n.chi, audience),
      input: texts(n.input),
      output: texts(n.output),
      items,
      worst: worstOf(items),
    };
  });
  const edges = m.edges.filter((e) => ids.has(String(e.from)) && ids.has(String(e.to))).map((e) => ({ from: String(e.from), to: String(e.to), label: readable(e.label, audience) }));
  return { title: m.title, version: m.version, nodes, edges };
}

function processView(m: MapRowParsed, ctx: MapItemsContext): ProcessMapView {
  const audience = audienceFor(ctx.roles);
  const known = new Set(ctx.items.keys());
  return {
    kind: m.kind,
    title: m.title,
    steps: m.nodes.map((n) => {
      const keys = texts(n.items);
      return {
        id: String(n.id),
        label: readable(n.label, audience) ?? String(n.id),
        phase: readable(n.fase, audience),
        who: readable(n.chi, audience),
        tool: readable(n.strumento, audience),
        time: readable(n.tempo, audience),
        friction: readable(n.attrito, audience),
        input: texts(n.input),
        output: texts(n.output),
        humanDecision: readable(n.decisione_umana, audience),
        items: itemRefs(keys, ctx),
        otherData: texts(n.dati).filter((d) => !keys.includes(d) && !known.has(d)),
      };
    }),
  };
}

export function buildMaps(maps: readonly MapRowParsed[], ctx: MapItemsContext): MapsView {
  const by = (k: MapKind) => maps.find((m) => m.kind === k);
  const solution = by("soluzione");
  const toBe = by("processo_to_be");
  const asIs = by("processo_as_is");
  const example = by("esempio");
  return {
    solution: solution ? solutionView(solution, ctx) : null,
    toBe: toBe ? processView(toBe, ctx) : null,
    asIs: asIs ? processView(asIs, ctx) : null,
    example: example ? processView(example, ctx) : null,
    others: maps.filter((m) => !["soluzione", "processo_to_be", "processo_as_is", "esempio"].includes(m.kind)).map((m) => processView(m, ctx)),
  };
}

// ── Soluzione › Mappa (DESIGN §3.7.2) ─────────────────────────────────

/**
 * Le viste della Mappa: «Con l'agente» (il processo con l'agente, oppure i
 * passi della mappa della soluzione se il processo non c'è), «Oggi» (il
 * processo di oggi) ed «esempio» (dall'inizio alla fine). Le viste che non
 * esistono non compaiono.
 */
export const MAP_PAGE_VIEWS = ["con-agente", "oggi", "esempio"] as const;
export type MapPageView = (typeof MAP_PAGE_VIEWS)[number];

export const MAP_PAGE_VIEW_LABEL: Readonly<Record<Exclude<MapPageView, "esempio">, string>> = { "con-agente": "Con l'agente", oggi: "Oggi" };

/** Testo del link all'esempio (era «Esempio completo»). */
export const MAP_EXAMPLE_LINK = "Segui un esempio dall'inizio alla fine";

/** Il processo con l'agente ha passi: allora «Con l'agente» lo mostra al posto della mappa della soluzione. */
export function hasAgentProcess(maps: Pick<MapsView, "toBe">): boolean {
  return (maps.toBe?.steps.length ?? 0) > 0;
}

/**
 * Le viste che il caso ha: solo le mappe con dei passi. Una mappa vuota (il
 * caso nasce sempre con una mappa della soluzione, anche senza nodi) non conta,
 * così la pagina dice «Questo caso non ha ancora una mappa.».
 */
export function mapPageViews(maps: Pick<MapsView, "solution" | "toBe" | "asIs" | "example">): MapPageView[] {
  const out: MapPageView[] = [];
  if (hasAgentProcess(maps) || (maps.solution?.nodes.length ?? 0) > 0) out.push("con-agente");
  if ((maps.asIs?.steps.length ?? 0) > 0) out.push("oggi");
  if ((maps.example?.steps.length ?? 0) > 0) out.push("esempio");
  return out;
}

/** Valori di `?vista=` di ieri (`soluzione`, `to_be`, `as_is`): i vecchi link restano buoni. */
const LEGACY_VIEW: Readonly<Record<string, MapPageView>> = { soluzione: "con-agente", to_be: "con-agente", as_is: "oggi" };

/** La vista da mostrare: quella chiesta se esiste, altrimenti la prima («Con l'agente»). Null se il caso non ha mappe. */
export function resolveMapPageView(raw: string | null | undefined, available: readonly MapPageView[]): MapPageView | null {
  const asked = raw ? ((MAP_PAGE_VIEWS as readonly string[]).includes(raw) ? (raw as MapPageView) : (LEGACY_VIEW[raw] ?? null)) : null;
  if (asked && available.includes(asked)) return asked;
  return available.find((v) => v !== "esempio") ?? available[0] ?? null;
}

/**
 * I tre toni della mappa (DESIGN §3.7.2): verde «A posto», giallo «Da
 * verificare», grigio «Da fare» (domande da fare e bloccate). Senza domande
 * collegate il passo è tratteggiato (`null`).
 */
export const MAP_TONES = ["a_posto", "da_verificare", "da_fare"] as const;
export type MapTone = (typeof MAP_TONES)[number];

export const MAP_TONE_COLOR: Readonly<Record<MapTone, SemaforoColor>> = { a_posto: "verde", da_verificare: "giallo", da_fare: "grigio" };

const TONE_LABEL: Readonly<Record<Audience, Readonly<Record<MapTone, string>>>> = {
  ls: { a_posto: STATUS_GROUP_LABEL.ls.a_posto, da_verificare: STATUS_GROUP_LABEL.ls.da_verificare, da_fare: STATUS_GROUP_LABEL.ls.da_fare },
  cliente: { a_posto: STATUS_GROUP_LABEL.cliente.a_posto, da_verificare: STATUS_GROUP_LABEL.cliente.da_verificare, da_fare: STATUS_GROUP_LABEL.cliente.da_fare },
};

export const MAP_NO_ITEMS = "Nessuna domanda collegata";

export function mapToneLabel(tone: MapTone, audience: Audience): string {
  return TONE_LABEL[audience][tone];
}

/** Il tono di una domanda; null se il riferimento non è una domanda del catalogo. */
export function mapTone(status: ItemStatus | null): MapTone | null {
  if (!status) return null;
  const group = STATUS_GROUP_OF[status];
  return group === "a_posto" ? "a_posto" : group === "da_verificare" ? "da_verificare" : "da_fare";
}

/** Il tono di un passo: quello della domanda messa peggio; null senza domande del catalogo. */
export function stepTone(items: readonly Pick<MapItemRef, "status">[]): MapTone | null {
  const tones = items.map((i) => mapTone(i.status)).filter((t): t is MapTone => t !== null);
  if (tones.length === 0) return null;
  if (tones.includes("da_fare")) return "da_fare";
  return tones.includes("da_verificare") ? "da_verificare" : "a_posto";
}

/** La legenda: i tre toni nell'ordine, poi «nessuna domanda collegata» tratteggiato. */
export function mapLegend(audience: Audience): { tone: MapTone | null; color: SemaforoColor | null; label: string }[] {
  return [...MAP_TONES.map((tone) => ({ tone, color: MAP_TONE_COLOR[tone], label: mapToneLabel(tone, audience) })), { tone: null, color: null, label: MAP_NO_ITEMS }];
}

/** Domande del catalogo collegate a un passo (i riferimenti fuori catalogo non contano). */
export function catalogItems(items: readonly MapItemRef[]): MapItemRef[] {
  return items.filter((i) => i.id !== null && i.status !== null);
}

/**
 * Il pannello di un passo nella vista di analisi: le domande del catalogo
 * raggruppate per stato (§2.6), i gruppi vuoti tolti. I riferimenti fuori dal
 * catalogo sono chiavi: stanno nei «Dettagli tecnici» (`stepTechKeys`).
 */
export function stepItemsByStatus(items: readonly MapItemRef[], audience: Audience): { group: StatusGroup; label: string; items: MapItemRef[] }[] {
  return STATUS_GROUPS.map((group) => ({
    group,
    label: STATUS_GROUP_LABEL[audience][group],
    items: items.filter((i) => i.status !== null && STATUS_GROUP_OF[i.status] === group),
  })).filter((g) => g.items.length > 0);
}

/** «54 domande», «1 domanda». */
export function questionCountText(n: number): string {
  return `${formatCountIt(n)} ${n === 1 ? "domanda" : "domande"}`;
}

/** Ha la forma di una chiave (`richiesta.canale`), non di un testo. */
const KEY_LIKE = /^[a-z0-9_]+(?:\.[a-z0-9_]+)+$/i;

function isKeyLike(d: string): boolean {
  return KEY_LIKE.test(d.trim());
}

/**
 * I dati citati da un passo che non sono domande, nella riga: solo quelli
 * scritti in parole, mai le chiavi, per nessuno (DESIGN §1, principi 3 e 5).
 * Per Lateral Space le chiavi stanno nei «Dettagli tecnici» (`stepTechKeys`).
 */
export function readableOtherData(data: readonly string[], audience: Audience): string[] {
  return data
    .filter((d) => !isKeyLike(d))
    .map((d) => readableText(d.trim(), audience))
    .filter((d) => d !== "");
}

/**
 * Le chiavi citate da un passo senza un titolo da mostrare: i riferimenti
 * fuori dal catalogo e i dati scritti come chiave. Solo per i «Dettagli
 * tecnici» di Lateral Space.
 */
export function stepTechKeys(items: readonly MapItemRef[], data: readonly string[], titles: ReadonlyMap<string, string>): string[] {
  const out = new Set<string>();
  for (const i of items) if (i.status === null) out.add(i.key);
  for (const d of data) if (isKeyLike(d) && !titles.has(d.trim())) out.add(d.trim());
  return [...out];
}

/** Titolo di ogni domanda citata dalla mappa, per chiave (le domande di tutti i passi). */
export function mapItemTitles(maps: Pick<MapsView, "solution" | "toBe" | "asIs" | "example">): Map<string, string> {
  const out = new Map<string, string>();
  const add = (items: readonly MapItemRef[]) => {
    for (const i of items) if (i.status !== null && i.title && i.title !== i.key) out.set(i.key, i.title);
  };
  for (const n of maps.solution?.nodes ?? []) add(n.items);
  for (const p of [maps.toBe, maps.asIs, maps.example]) for (const s of p?.steps ?? []) add(s.items);
  return out;
}

/**
 * Ciò che entra in un passo e ciò che ne esce (DESIGN §1, principio 3): una
 * chiave che è una domanda del catalogo diventa il suo titolo, per tutti; le
 * altre chiavi non sono nella riga (per Lateral Space, nei «Dettagli tecnici»).
 */
export function readableFlowData(data: readonly string[], titles: ReadonlyMap<string, string>, audience: Audience): string[] {
  const out = data.map((d) => titles.get(d.trim()) ?? d);
  return readableOtherData([...new Set(out)], audience);
}

/**
 * Un arco mostra la sua etichetta solo al passaggio o al focus (DESIGN
 * §3.7.2): quando uno dei due passi è quello sotto il puntatore o con il
 * focus. Il passo scelto non conta: dopo il clic l'etichetta sparisce quando il
 * puntatore e il focus se ne vanno.
 */
export function edgeLabelShown(edge: Pick<MapEdgeView, "from" | "to" | "label">, at: { hover: string | null; focus: string | null }): boolean {
  if (!edge.label) return false;
  return [at.hover, at.focus].some((id) => id !== null && (id === edge.from || id === edge.to));
}
