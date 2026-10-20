/**
 * Viste in sola lettura per gli strumenti MCP dei casi (PIANO §5.8).
 *
 * - `validatedCatalogView`: solo voci verdi o blu di una versione congelata, mai
 *   la bozza; più l'elenco `excluded` (chiave e stato).
 * - `openItemsView`, `dataDictionaryView`, `gateStatusView`, `caseListView`.
 *
 * Regole sui valori: personali mai; `riservato_azienda` nascosti finché
 * l'ambiente AI del caso non è approvato (`value_hidden`).
 * Regole sui testi: con ambiente non approvato e testi del cliente
 * (`settings.client_text`), ogni vista passa da `redactTexts`, che toglie titoli,
 * spiegazioni, esempi, aiuto, descrizioni, testi delle regole e la parte
 * testuale di `spec` (`text_hidden: "ambiente_non_approvato"`).
 *
 * Nessuna vista porta nomi, email, telefoni, token o tempi per persona.
 * Modulo puro.
 */
import type { Json } from "./types.ts";
import {
  excludedItems,
  isFrozen,
  isPersonalClass,
  validatedItems,
  type CatalogSnapshot,
  type SnapshotAnswer,
  type SnapshotItem,
} from "./snapshot.ts";
import type {
  CaseStatus,
  GateDecision,
  GateKey,
  ItemKind,
  ItemStatus,
  LinkRelation,
  Priority,
  PrivacyClass,
  ResponseType,
} from "./vocab.ts";

export const TEXT_HIDDEN = "ambiente_non_approvato" as const;

export interface McpViewOptions {
  /** `uc_cases.ai_environment_approved`: cambia solo con lo script operatore. */
  aiEnvironmentApproved: boolean;
  /** `uc_cases.settings.client_text` (default true): il caso contiene testi del cliente. */
  clientText: boolean;
}

/** I testi del cliente si nascondono? */
export function textsHidden(o: McpViewOptions): boolean {
  return !o.aiEnvironmentApproved && o.clientText;
}

// ── Redazione dei testi ───────────────────────────────────────────────

/** Campi testuali tolti quando i testi sono nascosti. */
export const TEXT_FIELDS: ReadonlySet<string> = new Set([
  "title",
  "explanation",
  "why",
  "example",
  "help",
  "description",
  "one_liner",
  "perimeter_label",
  "status_reason",
  "reason",
  "motivo",
  "piano",
  "descrizione",
  "note",
  "notes",
  "rule_text",
  "role_label",
  "change_note",
  "label",
]);

/**
 * Tipi di risposta il cui valore normalizzato è un dato tipizzato (numeri,
 * importi, durate, date, intervalli, sì/no, codici), non prosa. Con i testi del
 * cliente nascosti esce solo il valore normalizzato di questi tipi: testi,
 * tabelle, scelte e conferme di regole restano fuori (`value_hidden`).
 */
export const TYPED_VALUE_TYPES: ReadonlySet<ResponseType> = new Set([
  "numero",
  "valuta",
  "percentuale",
  "durata",
  "data",
  "data_ora",
  "intervallo",
  "si_no",
  "codice",
]);

/** Parti di `spec` che sono struttura e non prosa: restano anche con i testi nascosti. */
export const SPEC_STRUCTURAL_FIELDS: ReadonlySet<string> = new Set([
  "tipo_dato",
  "unita",
  "unit",
  "obbligatorio",
  "gravita",
  "tipo_regola",
  "direzione",
]);

function redactValue(value: unknown, inSpec: boolean): unknown {
  if (Array.isArray(value)) return value.map((v) => redactValue(v, false));
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (inSpec) {
      if (SPEC_STRUCTURAL_FIELDS.has(k) && (v === null || typeof v !== "object")) out[k] = v;
      continue;
    }
    if (TEXT_FIELDS.has(k) && (typeof v === "string" || v === null)) continue;
    out[k] = redactValue(v, k === "spec");
  }
  return out;
}

/**
 * Toglie i testi del cliente da una vista quando l'ambiente AI non è approvato
 * e il caso ha testi del cliente. Altrimenti restituisce la vista così com'è.
 */
export function redactTexts<T extends object>(view: T, o: McpViewOptions): T & { text_hidden?: typeof TEXT_HIDDEN } {
  if (!textsHidden(o)) return view;
  return { ...(redactValue(view, false) as T), text_hidden: TEXT_HIDDEN };
}

// ── Catalogo validato ─────────────────────────────────────────────────

export interface McpCatalogAnswer {
  version: number;
  kind: SnapshotAnswer["kind"];
  source_kind: SnapshotAnswer["source_kind"];
  source_ref: string | null;
  valid_from: string | null;
  valid_to: string | null;
  text_hash: string | null;
  value?: Json | null;
  value_normalized?: Json | null;
  value_hidden?: "personale" | "visibilita" | "ambiente_non_approvato";
}

export interface McpCatalogItem {
  key: string;
  kind: ItemKind;
  section: SnapshotItem["section"];
  parent_key: string | null;
  priority: Priority | null;
  serves_for: SnapshotItem["serves_for"];
  privacy_class: PrivacyClass;
  perimeter: SnapshotItem["perimeter"];
  response_type: ResponseType | null;
  unit: string | null;
  request_module_key: string | null;
  owner_role_key: string | null;
  status: ItemStatus;
  title?: string;
  explanation?: string | null;
  why?: string | null;
  example?: string | null;
  help?: string | null;
  spec: { [key: string]: Json };
  answer: McpCatalogAnswer | null;
  na: { reason?: string | null; approved_at: string } | null;
  waiver: { scadenza: string; approved_at: string } | null;
  links: { to: string; relation: LinkRelation }[];
}

export type ValidatedCatalogView =
  | {
      ok: true;
      version: number;
      frozen_at: string;
      case_code: string;
      template: { key: string; version: string };
      items: McpCatalogItem[];
      excluded: { key: string; status: ItemStatus }[];
      text_hidden?: typeof TEXT_HIDDEN;
    }
  | { ok: false; error: "nessuna_versione_congelata" };

function catalogAnswer(item: SnapshotItem, o: McpViewOptions): McpCatalogAnswer | null {
  const a = item.answer;
  if (!a) return null;
  const base: McpCatalogAnswer = {
    version: a.version,
    kind: a.kind,
    source_kind: a.source_kind,
    source_ref: a.source_ref,
    valid_from: a.valid_from,
    valid_to: a.valid_to,
    text_hash: a.text_hash,
  };
  if (isPersonalClass(item.privacy_class) || a.value_hidden === "personale") return { ...base, value: null, value_normalized: null, value_hidden: "personale" };
  if (a.value_hidden) return { ...base, value: null, value_normalized: null, value_hidden: a.value_hidden };
  if (item.privacy_class === "riservato_azienda" && !o.aiEnvironmentApproved) {
    return { ...base, value: null, value_normalized: null, value_hidden: TEXT_HIDDEN };
  }
  if (textsHidden(o)) {
    // Con i testi nascosti esce solo il valore tipizzato, mai la prosa.
    const typed = item.response_type !== null && TYPED_VALUE_TYPES.has(item.response_type);
    if (a.value_normalized === null || !typed) return { ...base, value: null, value_normalized: null, value_hidden: TEXT_HIDDEN };
    return { ...base, value_normalized: a.value_normalized };
  }
  return { ...base, value: a.value, value_normalized: a.value_normalized };
}

/**
 * `get_validated_catalog`: solo l'ultima versione congelata (o quella chiesta),
 * mai la bozza; solo voci validate o non applicabili firmate.
 */
export function validatedCatalogView(
  snapshot: CatalogSnapshot | null,
  o: McpViewOptions & { kinds?: readonly ItemKind[] },
): ValidatedCatalogView {
  if (!snapshot || !isFrozen(snapshot)) return { ok: false, error: "nessuna_versione_congelata" };
  const kinds = o.kinds && o.kinds.length > 0 ? new Set(o.kinds) : null;
  const inKinds = (kind: ItemKind) => !kinds || kinds.has(kind);
  const links = new Map<string, { to: string; relation: LinkRelation }[]>();
  for (const l of snapshot.links) {
    const list = links.get(l.from) ?? [];
    list.push({ to: l.to, relation: l.relation });
    links.set(l.from, list);
  }
  const items: McpCatalogItem[] = validatedItems(snapshot)
    .filter((i) => inKinds(i.kind))
    .map((i) => ({
      key: i.key,
      kind: i.kind,
      section: i.section,
      parent_key: i.parent_key,
      priority: i.priority,
      serves_for: i.serves_for,
      privacy_class: i.privacy_class,
      perimeter: i.perimeter,
      response_type: i.response_type,
      unit: i.unit,
      request_module_key: i.request_module_key,
      owner_role_key: i.owner_role_key,
      status: i.status,
      title: i.title,
      explanation: i.explanation,
      why: i.why,
      example: i.example,
      help: i.help,
      spec: i.spec,
      answer: catalogAnswer(i, o),
      na: i.na,
      waiver: i.waiver ? { scadenza: i.waiver.scadenza, approved_at: i.waiver.approved_at } : null,
      links: links.get(i.key) ?? [],
    }));
  const snapshotKinds = new Map(snapshot.items.map((i) => [i.key, i.kind]));
  const view: ValidatedCatalogView = {
    ok: true,
    version: snapshot.version,
    frozen_at: snapshot.frozen_at as string,
    case_code: snapshot.case.code,
    template: { key: snapshot.template.key, version: snapshot.template.version },
    items,
    excluded: excludedItems(snapshot).filter((e) => inKinds(snapshotKinds.get(e.key) as ItemKind)),
  };
  return redactTexts(view, o);
}

// ── Voci aperte del gate ──────────────────────────────────────────────

export interface OpenItemInput {
  key: string;
  title: string | null;
  status: ItemStatus;
  moduleKey: string | null;
  roleKey: string | null;
  dueAt: Date | string | null;
  dueIsProposal?: boolean;
}

export interface OpenItemsView {
  gate: GateKey;
  count: number;
  items: {
    key: string;
    title?: string | null;
    status: ItemStatus;
    module_key: string | null;
    role_key: string | null;
    role_label?: string | null;
    due_at: string | null;
    due_is_proposal: boolean;
  }[];
  text_hidden?: typeof TEXT_HIDDEN;
}

function isoOrNull(v: Date | string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * `get_open_items`: voci del gate non ancora a posto, con l'etichetta del ruolo
 * che le deve dare. Nessun nome, nessuna email, nessun tempo per persona.
 * Ordine: modulo, poi chiave (mai per tempi).
 */
export function openItemsView(
  input: { gate?: GateKey; items: readonly OpenItemInput[]; roleLabels?: Readonly<Record<string, string>> },
  o: McpViewOptions,
): OpenItemsView {
  const items = [...input.items]
    .sort((a, b) => (a.moduleKey ?? "~").localeCompare(b.moduleKey ?? "~") || a.key.localeCompare(b.key))
    .map((i) => ({
      key: i.key,
      title: i.title,
      status: i.status,
      module_key: i.moduleKey,
      role_key: i.roleKey,
      role_label: i.roleKey ? (input.roleLabels?.[i.roleKey] ?? null) : null,
      due_at: isoOrNull(i.dueAt),
      due_is_proposal: Boolean(i.dueIsProposal),
    }));
  return redactTexts({ gate: input.gate ?? "G1", count: items.length, items }, o);
}

// ── Dizionario dati ───────────────────────────────────────────────────

export interface DictionaryItemInput {
  key: string;
  kind: ItemKind;
  parentKey: string | null;
  title: string;
  explanation: string | null;
  spec: { [key: string]: Json } | null;
  privacyClass: PrivacyClass;
  priority: Priority | null;
  status: ItemStatus;
}

export interface DataDictionaryView {
  entities: {
    key: string;
    title?: string;
    explanation?: string | null;
    privacy_class: PrivacyClass;
    status: ItemStatus;
    spec: { [key: string]: Json };
    fields: {
      key: string;
      title?: string;
      explanation?: string | null;
      data_type: string | null;
      unit: string | null;
      required: boolean | null;
      privacy_class: PrivacyClass;
      priority: Priority | null;
      status: ItemStatus;
    }[];
  }[];
  /** Campi il cui padre non è un'entità del caso. */
  orphan_fields: string[];
  text_hidden?: typeof TEXT_HIDDEN;
}

const str = (v: Json | undefined): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** `get_data_dictionary`: entità e campi con tipi, unità e classi. Struttura, mai valori. */
export function dataDictionaryView(items: readonly DictionaryItemInput[], o: McpViewOptions): DataDictionaryView {
  const entities = items
    .filter((i) => i.kind === "entita")
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((e) => ({
      key: e.key,
      title: e.title,
      explanation: e.explanation,
      privacy_class: e.privacyClass,
      status: e.status,
      spec: { ...(e.spec ?? {}) },
      fields: [] as DataDictionaryView["entities"][number]["fields"],
    }));
  const byKey = new Map(entities.map((e) => [e.key, e]));
  const orphan: string[] = [];
  for (const f of [...items].filter((i) => i.kind === "campo").sort((a, b) => a.key.localeCompare(b.key))) {
    const parent = f.parentKey ? byKey.get(f.parentKey) : undefined;
    if (!parent) {
      orphan.push(f.key);
      continue;
    }
    const spec = f.spec ?? {};
    parent.fields.push({
      key: f.key,
      title: f.title,
      explanation: f.explanation,
      data_type: str(spec.tipo_dato),
      unit: str(spec.unita) ?? str(spec.unit),
      required: typeof spec.obbligatorio === "boolean" ? spec.obbligatorio : null,
      privacy_class: f.privacyClass,
      priority: f.priority,
      status: f.status,
    });
  }
  return redactTexts({ entities, orphan_fields: orphan }, o);
}

// ── Stato del gate ────────────────────────────────────────────────────

/** Forma minima del calcolo del gate (`GateComputation` di `gates.ts`). */
export interface GateComputationLike {
  gate: GateKey;
  available: boolean;
  required: number;
  ok: number;
  ready: boolean;
  byStatus: Partial<Record<ItemStatus, number>>;
  should: { total: number; ok: number };
  waivers: { used: number; cap: number };
  conditions: readonly { key: string; ok: boolean; message: string }[];
  missing: readonly { key: string; status: ItemStatus; reason?: string; moduleKey: string | null; roleKey: string | null }[];
}

export interface GateReviewInput {
  gateKey: GateKey;
  decision: GateDecision;
  proposedAt: Date | string | null;
  decidedAt: Date | string | null;
  catalogVersion: number | null;
  approvals: readonly { ruolo: string; at: string; metodo?: string }[];
}

export interface GateStatusView {
  gate: GateKey;
  available: boolean;
  ready: boolean;
  required: number;
  ok: number;
  by_status: Partial<Record<ItemStatus, number>>;
  should: { total: number; ok: number };
  waivers: { used: number; cap: number };
  conditions: { key: string; ok: boolean; message: string }[];
  missing: { key: string; status: ItemStatus; module_key: string | null; role_key: string | null }[];
  history: {
    gate: GateKey;
    decision: GateDecision;
    proposed_at: string | null;
    decided_at: string | null;
    catalog_version: number | null;
    approvals: { ruolo: string; at: string; metodo: string | null }[];
  }[];
  text_hidden?: typeof TEXT_HIDDEN;
}

/** `get_gate_status`: il calcolo e lo storico delle decisioni (solo date e ruoli). */
export function gateStatusView(
  input: { computation: GateComputationLike; reviews: readonly GateReviewInput[] },
  o: McpViewOptions,
): GateStatusView {
  const c = input.computation;
  const history = [...input.reviews]
    .sort((a, b) => (isoOrNull(a.proposedAt) ?? "").localeCompare(isoOrNull(b.proposedAt) ?? ""))
    .map((r) => ({
      gate: r.gateKey,
      decision: r.decision,
      proposed_at: isoOrNull(r.proposedAt),
      decided_at: isoOrNull(r.decidedAt),
      catalog_version: r.catalogVersion,
      approvals: r.approvals.map((a) => ({ ruolo: a.ruolo, at: a.at, metodo: a.metodo ?? null })),
    }));
  return redactTexts(
    {
      gate: c.gate,
      available: c.available,
      ready: c.ready,
      required: c.required,
      ok: c.ok,
      by_status: { ...c.byStatus },
      should: { ...c.should },
      waivers: { ...c.waivers },
      conditions: c.conditions.map((k) => ({ key: k.key, ok: k.ok, message: k.message })),
      missing: c.missing.map((m) => ({ key: m.key, status: m.status, module_key: m.moduleKey, role_key: m.roleKey })),
      history,
    },
    o,
  );
}

// ── Elenco dei casi ───────────────────────────────────────────────────

export interface CaseListInput {
  id: string;
  code: string;
  title: string;
  status: CaseStatus;
  catalogVersion: number;
  /** Cache `uc_cases.readiness`, se c'è. */
  readiness: { green_pct?: number; scope_total?: number; G1?: { required?: number; ok?: number; ready?: boolean } } | null;
  options: McpViewOptions;
}

/** `list_use_cases`: casi con stato e prontezza; il titolo segue le regole dei testi di ogni caso. */
export function caseListView(cases: readonly CaseListInput[]): { cases: Record<string, Json>[] } {
  return {
    cases: [...cases]
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((c) => {
        const g1 = c.readiness?.G1;
        const row = {
          id: c.id,
          code: c.code,
          title: c.title,
          status: c.status,
          catalog_version: c.catalogVersion > 0 ? c.catalogVersion : null,
          green_pct: typeof c.readiness?.green_pct === "number" ? c.readiness.green_pct : null,
          scope_total: typeof c.readiness?.scope_total === "number" ? c.readiness.scope_total : null,
          g1: g1 ? { required: g1.required ?? null, ok: g1.ok ?? null, ready: g1.ready ?? null } : null,
        };
        return redactTexts(row, c.options) as Record<string, Json>;
      }),
  };
}
