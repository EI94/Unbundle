/**
 * Voci del modello dati, delle regole e dei KPI come le leggono le pagine
 * interne (PIANO §5.1): testi del template, classificazione, stato, campi di
 * `spec` e collegamenti in entrata e in uscita. Mai valori delle risposte.
 *
 * Modulo puro.
 */
import { STATUS_LABEL } from "../semaforo.ts";
import { rowBool, rowJson, rowNumber, rowObject, rowString, rowStringArray, rowVocab, type Row } from "../sql/readiness.ts";
import type { Json } from "../types.ts";
import {
  ITEM_KINDS,
  ITEM_STATUSES,
  LEVERS,
  LINK_RELATIONS,
  PERIMETERS,
  PHASES,
  PRIORITIES,
  PRIVACY_CLASSES,
  RESPONSE_TYPES,
  TEST_CASE_RESULTS,
  isVocab,
  type CaseRole,
  type ItemKind,
  type ItemStatus,
  type Lever,
  type LinkRelation,
  type Perimeter,
  type Phase,
  type Priority,
  type PrivacyClass,
  type ResponseType,
} from "../vocab.ts";
import { readableText, readableTitle } from "./description.ts";
import { specEntries, type LinkGroup, type LinkedItem, type SpecEntry } from "./item-detail.ts";
import { KIND_LABEL, MODEL_VARIABLE_KINDS, RELATION_LABEL, humanizeToken, sourceSystem } from "./labels.ts";
import { canOpenItem } from "./page-access.ts";
import { STATUS_GROUPS, STATUS_GROUP_OF, groupFromSlug, type Audience, type StatusGroup } from "./status-groups.ts";
import { UUID } from "../ids.ts";
import { formatCountIt } from "./format.ts";

export interface ModelItemView {
  id: string;
  key: string;
  kind: ItemKind;
  title: string;
  explanation: string | null;
  why: string | null;
  example: string | null;
  help: string | null;
  status: ItemStatus;
  statusReason: string | null;
  priority: Priority | null;
  perimeter: Perimeter | null;
  servesFor: Phase[];
  levers: Lever[];
  privacyClass: PrivacyClass;
  availability: string[];
  ownerRoleKey: string | null;
  ownerRoleLabel: string | null;
  responseType: ResponseType | null;
  sourceRefs: string[];
  activeBlockers: string[];
  /** Impronta del testo confermato (risposta validata della voce). */
  confirmedTextHash: string | null;
  /** Campi del template (`spec`) come testo, per chiave. */
  fields: Record<string, string>;
  /** Gli stessi, in ordine e con le etichette, per le schede. */
  specEntries: SpecEntry[];
  links: LinkGroup[];
  /** Note del template su privacy, disponibilità e perimetro. */
  notes: Record<string, string>;
  /** Chi guarda può aprire il dettaglio della voce. */
  canOpen: boolean;
}

/** Riga di un collegamento con le due voci (`linksTouchingKindsSql`). */
interface LinkRow {
  fromId: string;
  toId: string;
  relation: LinkRelation;
  cardinality: string | null;
  note: string | null;
  from: LinkedItem & { availability: string[]; responseType: ResponseType | null; confirmedHash: string | null };
  to: LinkedItem & { availability: string[]; responseType: ResponseType | null };
}

function linkedFrom(r: Row, p: "f" | "t") {
  return {
    id: String(p === "f" ? r.from_item_id : r.to_item_id),
    key: String(r[`${p}_key`]),
    title: String(r[`${p}_title`] ?? ""),
    kind: rowVocab(ITEM_KINDS, r[`${p}_kind`]) ?? "domanda",
    status: rowVocab(ITEM_STATUSES, r[`${p}_status`]) ?? "da_chiedere",
    cardinality: rowString(r.cardinality),
    note: rowString(r.note),
    availability: rowStringArray(rowJson(r[`${p}_availability`])),
    responseType: rowVocab(RESPONSE_TYPES, r[`${p}_response_type`]),
  };
}

export function parseLinkRows(rows: readonly Row[]): LinkRow[] {
  return rows.flatMap((r) => {
    const relation = rowVocab(LINK_RELATIONS, r.relation);
    if (!relation) return [];
    return [
      {
        fromId: String(r.from_item_id),
        toId: String(r.to_item_id),
        relation,
        cardinality: rowString(r.cardinality),
        note: rowString(r.note),
        from: { ...linkedFrom(r, "f"), confirmedHash: rowString(r.f_confirmed_hash) },
        to: linkedFrom(r, "t"),
      },
    ];
  });
}

/** Collegamenti di ogni voce, raggruppati per relazione e verso. */
export function linkGroupsByItem(links: readonly LinkRow[]): Map<string, LinkGroup[]> {
  const byItem = new Map<string, Map<string, LinkGroup>>();
  const add = (itemId: string, direction: "out" | "in", relation: LinkRelation, other: LinkedItem) => {
    const groups = byItem.get(itemId) ?? new Map<string, LinkGroup>();
    const id = `${direction}:${relation}`;
    const g = groups.get(id) ?? { relation, direction, label: RELATION_LABEL[relation][direction], items: [] };
    g.items.push(other);
    groups.set(id, g);
    byItem.set(itemId, groups);
  };
  for (const l of links) {
    const strip = (x: LinkRow["from"] | LinkRow["to"]): LinkedItem => ({ id: x.id, key: x.key, title: x.title, kind: x.kind, status: x.status, cardinality: l.cardinality, note: l.note });
    add(l.fromId, "out", l.relation, strip(l.to));
    add(l.toId, "in", l.relation, strip(l.from));
  }
  const order = (g: LinkGroup) => (g.direction === "out" ? 0 : 100) + LINK_RELATIONS.indexOf(g.relation);
  const out = new Map<string, LinkGroup[]>();
  for (const [id, groups] of byItem) {
    out.set(
      id,
      [...groups.values()].sort((a, b) => order(a) - order(b)).map((g) => ({ ...g, items: g.items.sort((a, b) => a.key.localeCompare(b.key)) })),
    );
  }
  return out;
}

function vocabList<const T extends readonly string[]>(vocab: T, v: unknown): T[number][] {
  return rowStringArray(rowJson(v)).filter((x): x is T[number] => isVocab(vocab, x));
}

function textFields(spec: Readonly<Record<string, Json>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of specEntries(spec)) out[e.key] = e.value;
  return out;
}

export function buildModelItems(
  itemRows: readonly Row[],
  linkRows: readonly Row[],
  ctx: { roles: readonly CaseRole[]; roleLabels: Readonly<Record<string, string>> },
): ModelItemView[] {
  const groups = linkGroupsByItem(parseLinkRows(linkRows));
  return itemRows.map((r) => {
    const spec = rowObject(r.spec);
    const id = String(r.id);
    const status = rowVocab(ITEM_STATUSES, r.status) ?? "da_chiedere";
    const ownerRoleKey = rowString(r.owner_role_key);
    const notesRaw = rowObject(spec.notes);
    const notes: Record<string, string> = {};
    for (const [k, v] of Object.entries(notesRaw)) if (typeof v === "string" && v.trim()) notes[k] = v.trim();
    return {
      id,
      key: String(r.key),
      kind: rowVocab(ITEM_KINDS, r.kind) ?? "domanda",
      title: String(r.title ?? ""),
      explanation: rowString(r.explanation),
      why: rowString(r.why),
      example: rowString(r.example),
      help: rowString(r.help),
      status,
      statusReason: rowString(r.status_reason),
      priority: rowVocab(PRIORITIES, r.priority),
      perimeter: rowVocab(PERIMETERS, r.perimeter),
      servesFor: vocabList(PHASES, r.serves_for),
      levers: vocabList(LEVERS, r.levers),
      privacyClass: rowVocab(PRIVACY_CLASSES, r.privacy_class) ?? "riservato_azienda",
      availability: rowStringArray(rowJson(r.availability)),
      ownerRoleKey,
      ownerRoleLabel: ownerRoleKey ? (ctx.roleLabels[ownerRoleKey] ?? ownerRoleKey) : null,
      responseType: rowVocab(RESPONSE_TYPES, r.response_type),
      sourceRefs: rowStringArray(rowJson(r.source_refs)),
      activeBlockers: rowStringArray(rowJson(r.active_blockers)),
      confirmedTextHash: rowString(r.confirmed_text_hash),
      fields: textFields(spec),
      specEntries: specEntries(spec),
      links: groups.get(id) ?? [],
      notes,
      canOpen: canOpenItem(ctx.roles, status),
    };
  });
}

/** Voci collegate di una relazione e un verso (es. le fonti che alimentano un KPI). */
export function linkedItems(item: Pick<ModelItemView, "links">, relation: LinkRelation, direction: "out" | "in"): LinkedItem[] {
  return item.links.find((g) => g.relation === relation && g.direction === direction)?.items ?? [];
}

// ── Regole ────────────────────────────────────────────────────────────

export interface RuleConfirmation {
  /** Domanda del modulo che chiede la conferma (collegamento `precisa`). */
  question: { id: string; key: string; title: string; status: ItemStatus; statusLabel: string } | null;
  /** Impronta del testo confermato: della regola o della sua domanda. */
  textHash: string | null;
}

/** Domanda di conferma di una regola e impronta del testo confermato. */
export function ruleConfirmations(linkRows: readonly Row[], rules: readonly Pick<ModelItemView, "id" | "confirmedTextHash">[]): Map<string, RuleConfirmation> {
  const links = parseLinkRows(linkRows);
  const out = new Map<string, RuleConfirmation>();
  for (const rule of rules) {
    const q = links.find((l) => l.toId === rule.id && l.relation === "precisa" && l.from.kind === "domanda");
    out.set(rule.id, {
      question: q ? { id: q.from.id, key: q.from.key, title: q.from.title, status: q.from.status, statusLabel: STATUS_LABEL[q.from.status] } : null,
      textHash: rule.confirmedTextHash ?? q?.from.confirmedHash ?? null,
    });
  }
  return out;
}

// ── Entità ────────────────────────────────────────────────────────────

export interface EntityView {
  id: string;
  key: string;
  title: string;
  explanation: string | null;
  why: string | null;
  domain: string;
  status: ItemStatus;
  priority: Priority | null;
  perimeter: Perimeter | null;
  privacyClass: PrivacyClass;
  fields: Record<string, string>;
  fieldCounts: Partial<Record<ItemStatus, number>>;
  fieldTotal: number;
}

export const NO_DOMAIN = "Altro";

export function rowsToEntities(rows: readonly Row[]): EntityView[] {
  return rows.map((r) => {
    const spec = rowObject(r.spec);
    const counts: Partial<Record<ItemStatus, number>> = {};
    let total = 0;
    for (const [k, v] of Object.entries(rowObject(r.field_statuses))) {
      const n = rowNumber(v) ?? 0;
      if (isVocab(ITEM_STATUSES, k)) {
        counts[k] = n;
        total += n;
      }
    }
    return {
      id: String(r.id),
      key: String(r.key),
      title: String(r.title ?? ""),
      explanation: rowString(r.explanation),
      why: rowString(r.why),
      domain: typeof spec.dominio === "string" && spec.dominio.trim() ? spec.dominio.trim() : NO_DOMAIN,
      status: rowVocab(ITEM_STATUSES, r.status) ?? "da_chiedere",
      priority: rowVocab(PRIORITIES, r.priority),
      perimeter: rowVocab(PERIMETERS, r.perimeter),
      privacyClass: rowVocab(PRIVACY_CLASSES, r.privacy_class) ?? "riservato_azienda",
      fields: textFields(spec),
      fieldCounts: counts,
      fieldTotal: total,
    };
  });
}

/** Entità raggruppate per dominio, domini in ordine alfabetico («Altro» in fondo). */
export function entitiesByDomain(entities: readonly EntityView[]): { domain: string; entities: EntityView[] }[] {
  const by = new Map<string, EntityView[]>();
  for (const e of entities) by.set(e.domain, [...(by.get(e.domain) ?? []), e]);
  return [...by.entries()]
    .sort(([a], [b]) => (a === NO_DOMAIN ? 1 : b === NO_DOMAIN ? -1 : a.localeCompare(b, "it")))
    .map(([domain, list]) => ({ domain, entities: list }));
}

export interface FieldView {
  id: string;
  key: string;
  title: string;
  explanation: string | null;
  example: string | null;
  status: ItemStatus;
  priority: Priority | null;
  privacyClass: PrivacyClass;
  availability: string[];
  perimeter: Perimeter | null;
  type: string | null;
  unit: string | null;
  quality: string | null;
  sources: string[];
  canOpen: boolean;
  /** Si apre dopo la scheda privacy (`locked` della lettura di Soluzione › Dati). */
  locked?: boolean;
}

export function rowsToFields(rows: readonly Row[], roles: readonly CaseRole[]): FieldView[] {
  return rows.map((r) => {
    const spec = rowObject(r.spec);
    const status = rowVocab(ITEM_STATUSES, r.status) ?? "da_chiedere";
    const config = rowObject(r.response_config);
    const unit = typeof spec.unita === "string" && spec.unita.trim() ? spec.unita.trim() : typeof config.unit === "string" ? config.unit : null;
    return {
      id: String(r.id),
      key: String(r.key),
      title: String(r.title ?? ""),
      explanation: rowString(r.explanation),
      example: rowString(r.example),
      status,
      priority: rowVocab(PRIORITIES, r.priority),
      privacyClass: rowVocab(PRIVACY_CLASSES, r.privacy_class) ?? "riservato_azienda",
      availability: rowStringArray(rowJson(r.availability)),
      perimeter: rowVocab(PERIMETERS, r.perimeter),
      type: typeof spec.tipo_dato === "string" && spec.tipo_dato.trim() ? spec.tipo_dato.trim() : rowString(r.response_type),
      unit,
      quality: typeof spec.qualita === "string" && spec.qualita.trim() ? spec.qualita.trim() : null,
      sources: rowStringArray(rowJson(r.sources)),
      canOpen: canOpenItem(roles, status),
      ...(r.locked === undefined ? {} : { locked: rowBool(r.locked) }),
    };
  });
}

// ── Casi di prova ─────────────────────────────────────────────────────

export interface TestCaseView {
  id: string;
  key: string;
  kind: "sintetico" | "pseudonimizzato";
  covers: number;
  servePer: string[];
  result: (typeof TEST_CASE_RESULTS)[number];
  approved: boolean;
}

export function rowsToTestCases(rows: readonly Row[]): TestCaseView[] {
  return rows.map((r) => ({
    id: String(r.id),
    key: String(r.key),
    kind: rowString(r.kind) === "pseudonimizzato" ? "pseudonimizzato" : "sintetico",
    covers: rowStringArray(rowJson(r.covers)).length,
    servePer: rowStringArray(rowJson(r.serve_per)),
    result: rowVocab(TEST_CASE_RESULTS, r.last_result) ?? "non_eseguito",
    approved: r.approved === true || r.approved === "t",
  }));
}

// ── Riepilogo per tipo ────────────────────────────────────────────────

export function rowsToKindCounts(rows: readonly Row[]): Map<ItemKind, Record<ItemStatus, number>> {
  const out = new Map<ItemKind, Record<ItemStatus, number>>();
  for (const r of rows) {
    const kind = rowVocab(ITEM_KINDS, r.kind);
    const status = rowVocab(ITEM_STATUSES, r.status);
    if (!kind || !status) continue;
    const counts = out.get(kind) ?? (Object.fromEntries(ITEM_STATUSES.map((s) => [s, 0])) as Record<ItemStatus, number>);
    counts[status] += rowNumber(r.n) ?? 0;
    out.set(kind, counts);
  }
  return out;
}

// ── Soluzione › Regole e Dati: righe cercate e paginate sul server ────

/**
 * Regole e Dati (DESIGN §3.7.3, §3.7.4; P0-5 d): ricerca, filtri e pagine
 * stanno nel database; al client arrivano solo le righe di una pagina (titolo,
 * stato, una riga di testo, il lucchetto), mai gli array dei collegamenti. I
 * collegamenti arrivano solo per la voce aperta nel pannello (`?apri=`).
 */
export const SOLUTION_PAGE_SIZE = 100;

/** Lunghezza massima della ricerca. */
export const SOLUTION_Q_MAX = 100;

/** Le regole; i vincoli solo con «Mostra anche i vincoli». */
export const RULE_KINDS: readonly ItemKind[] = ["regola"];
export const CONSTRAINT_KINDS: readonly ItemKind[] = ["vincolo_rigido", "vincolo_morbido"];

type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

function firstParam(sp: SearchParams, key: string): string | null {
  const v = sp[key];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && s.trim() ? s : null;
}

/** Chiave di una voce (`ent.richiesta`): la accetta `?apri=` dai vecchi indirizzi (`?entita=`). */
const ITEM_KEY = /^[a-z][a-z0-9_]{0,40}(?:\.[a-z0-9_]{1,80}){1,4}$/;

/** Testo cercato: spazi compattati, al massimo 100 caratteri; null se vuoto. */
export function searchText(raw: string | null | undefined): string | null {
  const t = (raw ?? "").replace(/\s+/g, " ").trim().slice(0, SOLUTION_Q_MAX).trim();
  return t ? t : null;
}

/** Pagina chiesta (`?pagina=`), dalla prima. */
export function parsePage(raw: string | null | undefined): number {
  return raw && /^\d{1,5}$/.test(raw) ? Math.max(1, Number(raw)) : 1;
}

/** Numero di pagine di un elenco: almeno una. */
export function pageCount(total: number, size = SOLUTION_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / size));
}

/** Righe da saltare per arrivare alla pagina. */
export function pageOffset(page: number, size = SOLUTION_PAGE_SIZE): number {
  return (Math.max(1, Math.floor(page)) - 1) * size;
}

/** Gli stati di un gruppo (§2.6), per filtrare nel database. */
export function statusesOfGroup(group: StatusGroup): ItemStatus[] {
  return ITEM_STATUSES.filter((s) => STATUS_GROUP_OF[s] === group);
}

/** `?perimetro=` di Regole, come in Domande. */
export const PERIMETER_PARAM: Readonly<Record<Perimeter, string>> = { in_contratto: "dentro", evoluzione: "fuori" };

export interface RulesQuery {
  q: string | null;
  stato: StatusGroup | null;
  perimetro: Perimeter | null;
  /** «Mostra anche i vincoli». */
  vincoli: boolean;
  pagina: number;
  /** Regola aperta nel pannello. */
  apri: string | null;
}

/** I parametri di Regole (`?q=&stato=&perimetro=&vincoli=1&pagina=&apri=`). */
export function parseRulesQuery(sp: SearchParams): RulesQuery {
  const perimetro = firstParam(sp, "perimetro");
  const apri = firstParam(sp, "apri");
  return {
    q: searchText(firstParam(sp, "q")),
    stato: groupFromSlug(firstParam(sp, "stato")),
    perimetro: perimetro === PERIMETER_PARAM.in_contratto ? "in_contratto" : perimetro === PERIMETER_PARAM.evoluzione ? "evoluzione" : null,
    vincoli: firstParam(sp, "vincoli") === "1",
    pagina: parsePage(firstParam(sp, "pagina")),
    apri: apri && UUID.test(apri) ? apri.toLowerCase() : null,
  };
}

/** I tipi di voce che Regole mostra. */
export function ruleKindsFor(q: Pick<RulesQuery, "vincoli">): ItemKind[] {
  return q.vincoli ? [...RULE_KINDS, ...CONSTRAINT_KINDS] : [...RULE_KINDS];
}

/** Ricerca o filtri attivi: allora tutti i gruppi si aprono. */
export function rulesFiltered(q: Pick<RulesQuery, "q" | "stato" | "perimetro">): boolean {
  return q.q !== null || q.stato !== null || q.perimetro !== null;
}

export interface RuleRow {
  id: string;
  title: string;
  status: ItemStatus;
  kind: ItemKind;
  /** Chi la conferma (ruolo dello schema). */
  roleKey: string | null;
}

/**
 * Le righe di Regole: il titolo passa da `readableTitle` per chi guarda (mai
 * codici dei fatti; per il cliente nemmeno articoli e chiavi).
 */
export function rowsToRuleRows(rows: readonly Row[], audience: Audience): RuleRow[] {
  return rows.map((r) => {
    const kind = rowVocab(ITEM_KINDS, r.kind) ?? "regola";
    return {
      id: String(r.id),
      title: readableTitle(rowString(r.title), audience, KIND_LABEL[kind].one),
      status: rowVocab(ITEM_STATUSES, r.status) ?? "da_chiedere",
      kind,
      roleKey: rowString(r.owner_role_key),
    };
  });
}

export interface RuleGroupCount {
  roleKey: string | null;
  total: number;
  /** Regole confermate: risposta validata. */
  confirmed: number;
}

export function rowsToRuleGroupCounts(rows: readonly Row[]): RuleGroupCount[] {
  return rows.map((r) => ({ roleKey: rowString(r.owner_role_key), total: rowNumber(r.total) ?? 0, confirmed: rowNumber(r.confirmed) ?? 0 }));
}

export interface RuleGroup {
  roleKey: string | null;
  /** «Commerciale»; «da indicare» se la regola non dice chi la conferma. */
  label: string;
  total: number;
  confirmed: number;
  rows: RuleRow[];
}

export const NO_CONFIRMER = "da indicare";

/**
 * Le regole della pagina raggruppate per «Chi la conferma», nell'ordine in cui
 * arrivano dal database (l'ordine dei ruoli dello schema). I conteggi sono di
 * tutte le pagine, con gli stessi filtri.
 */
export function ruleGroups(rows: readonly RuleRow[], counts: readonly RuleGroupCount[], roleLabels: Readonly<Record<string, string>>): RuleGroup[] {
  const byRole = new Map(counts.map((c) => [c.roleKey ?? "", c]));
  const out: RuleGroup[] = [];
  for (const row of rows) {
    const last = out[out.length - 1];
    if (last && last.roleKey === row.roleKey) {
      last.rows.push(row);
      continue;
    }
    const c = byRole.get(row.roleKey ?? "");
    out.push({
      roleKey: row.roleKey,
      label: row.roleKey ? (roleLabels[row.roleKey] ?? humanizeToken(row.roleKey)) : NO_CONFIRMER,
      total: c?.total ?? 0,
      confirmed: c?.confirmed ?? 0,
      rows: [row],
    });
  }
  return out;
}


/** «La conferma: Commerciale · 12 di 40 confermate». */
export function ruleGroupHeading(g: Pick<RuleGroup, "label" | "total" | "confirmed">): string {
  return `La conferma: ${g.label} · ${formatCountIt(g.confirmed)} di ${formatCountIt(g.total)} ${g.total === 1 ? "confermata" : "confermate"}`;
}

export const DATA_VIEWS = ["entita", "variabili", "formule", "fonti", "qualita", "prova"] as const;
export type DataView = (typeof DATA_VIEWS)[number];

/** Le voci del `Select` «Vista» (DESIGN §3.7.4). */
export const DATA_VIEW_LABEL: Readonly<Record<DataView, string>> = {
  entita: "Entità",
  variabili: "Variabili",
  formule: "Formule",
  fonti: "Fonti",
  qualita: "Qualità dei dati",
  prova: "Prova sul passato",
};

/** I tipi di voce di ogni vista (la prova sul passato legge i casi di prova). */
export const DATA_VIEW_KINDS: Readonly<Record<Exclude<DataView, "prova">, readonly ItemKind[]>> = {
  entita: ["entita"],
  variabili: MODEL_VARIABLE_KINDS,
  formule: ["formula"],
  fonti: ["fonte"],
  qualita: ["controllo_qualita"],
};

export type ItemRef = { id: string } | { key: string };

export interface DataQuery {
  vista: DataView;
  q: string | null;
  pagina: number;
  /** Voce aperta nel pannello: per id, o per chiave dai vecchi indirizzi (`?entita=`). */
  apri: ItemRef | null;
}

export function parseItemRef(raw: string | null): ItemRef | null {
  if (!raw) return null;
  if (UUID.test(raw)) return { id: raw.toLowerCase() };
  return ITEM_KEY.test(raw) ? { key: raw } : null;
}

/** I parametri di Dati (`?vista=&q=&pagina=&apri=`); `entita=<chiave>` vale come `apri`. */
export function parseDataQuery(sp: SearchParams): DataQuery {
  const raw = firstParam(sp, "vista");
  const vista: DataView = raw && (DATA_VIEWS as readonly string[]).includes(raw) ? (raw as DataView) : "entita";
  return {
    vista,
    q: searchText(firstParam(sp, "q")),
    pagina: parsePage(firstParam(sp, "pagina")),
    apri: vista === "prova" ? null : parseItemRef(firstParam(sp, "apri") ?? firstParam(sp, "entita")),
  };
}

export interface DataRow {
  id: string;
  kind: ItemKind;
  title: string;
  /** Una riga di spiegazione: il testo semplice, oppure la formula o il controllo. */
  line: string | null;
  status: ItemStatus;
  /** Si apre dopo la scheda privacy. */
  locked: boolean;
  /** Etichetta del gruppo: il dominio delle entità, il tipo delle variabili. */
  group: string | null;
}

function oneLine(v: unknown, audience: Audience): string | null {
  const s = rowString(v);
  if (!s) return null;
  const t = readableText(s.replace(/\s+/g, " ").trim(), audience);
  return t || null;
}

/**
 * Le righe di una vista di Dati, dalla lettura paginata. Titolo e riga di
 * testo passano da `readableText` per chi guarda.
 */
export function rowsToDataRows(rows: readonly Row[], view: Exclude<DataView, "prova">, audience: Audience): DataRow[] {
  return rows.map((r) => {
    const kind = rowVocab(ITEM_KINDS, r.kind) ?? DATA_VIEW_KINDS[view][0];
    const key = String(r.key ?? "");
    const system = view === "fonti" ? sourceSystem(key) : null;
    const title = readableTitle(rowString(r.title), audience, KIND_LABEL[kind].one);
    const domain = rowString(r.domain);
    return {
      id: String(r.id),
      kind,
      title: system ? `${humanizeToken(system)} · ${title}` : title,
      line: oneLine(r.explanation, audience) ?? oneLine(r.formula, audience) ?? oneLine(r.controllo, audience),
      status: rowVocab(ITEM_STATUSES, r.status) ?? "da_chiedere",
      locked: rowBool(r.locked),
      group: view === "entita" ? (domain ? humanizeToken(domain) : NO_DOMAIN) : view === "variabili" ? KIND_LABEL[kind].many : null,
    };
  });
}

/** Righe in gruppi consecutivi con la stessa etichetta (nessuna etichetta: un gruppo solo). */
export function groupRows<T extends { group: string | null }>(rows: readonly T[]): { label: string | null; rows: T[] }[] {
  const out: { label: string | null; rows: T[] }[] = [];
  for (const row of rows) {
    const last = out[out.length - 1];
    if (last && last.label === row.group) last.rows.push(row);
    else out.push({ label: row.group, rows: [row] });
  }
  return out;
}

/** I gruppi di stato nell'ordine dei filtri, per «Stato» nei filtri di Regole. */
export const RULE_STATUS_GROUPS: readonly StatusGroup[] = STATUS_GROUPS;

/**
 * L'indirizzo di una pagina di Soluzione con i parametri di oggi cambiati
 * (`null` toglie il parametro): una riga apre il suo pannello (`apri`) senza
 * perdere ricerca, filtri e pagina.
 */
export function solutionHref(base: string, sp: SearchParams, patch: Readonly<Record<string, string | null>>): string {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    const v = Array.isArray(value) ? value[0] : value;
    if (typeof v === "string" && v !== "") next.set(key, v);
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) next.delete(key);
    else next.set(key, value);
  }
  const query = next.toString();
  return query ? `${base}?${query}` : base;
}

/** «Precedenti» e «Successive»: senza il pannello aperto; la prima pagina senza `pagina`. */
export function solutionPageHrefs(base: string, sp: SearchParams, page: number, pages: number): { prevHref: string | null; nextHref: string | null } {
  const at = (p: number) => solutionHref(base, sp, { pagina: p <= 1 ? null : String(p), apri: null });
  return { prevHref: page > 1 ? at(Math.min(page - 1, pages)) : null, nextHref: page < pages ? at(page + 1) : null };
}
