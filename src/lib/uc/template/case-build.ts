/**
 * Righe di un caso nuovo, calcolate dal template (PIANO §4.6). Puro: gli id
 * arrivano da `newId` (iniettato), le istruzioni SQL stanno in
 * `src/lib/uc/sql/case-create.ts`.
 *
 * Per ogni voce:
 * - `key = template_item_key = item.key`; i campi canonici vanno nelle colonne,
 *   tutto il resto in `spec`;
 * - `in_gate_scope`: voci dei moduli di richiesta (`request_modules`), tutte le
 *   voci (`letterale`) o entrambe (`unione`);
 * - default per le voci raccolte (moduli di richiesta, regole `request_modules`
 *   e `unione`): `serves_for` vuoto → `default_serves_for`, `perimeter` assente →
 *   `default_perimeter`, annotati in `spec.defaults_applied`;
 * - stato iniziale `bloccata` se la voce ha almeno un blocco (esplicito o per
 *   scope, §3.5), altrimenti `da_chiedere`;
 * - `requires_validity_period` vero per il tipo `valuta` se il template non dice altro;
 * - `parent_item_id` risolto con gli id generati; le righe sono ordinate con i
 *   parent prima dei figli (la FK si controlla a ogni istruzione).
 */
import { blockerLinksForItem, ensureMandatoryBlockers, isPermanentBlocker, parseBlockerScope, type BlockerDef } from "../blockers.ts";
import type { Json } from "../types.ts";
import {
  PERIMETERS,
  type GatePolicyScope,
  type ItemKind,
  type ItemSection,
  type ItemStatus,
  type Lever,
  type LinkRelation,
  type MapKind,
  type Perimeter,
  type Phase,
  type Priority,
  type PrivacyClass,
  type ResponseType,
} from "../vocab.ts";
import type { CanonicalDefinition } from "./load.ts";
import type { TemplateBlocker, TemplateItem } from "./schema.ts";

// ── Regola del gate ───────────────────────────────────────────────────

export interface CaseGatePolicy {
  scope: GatePolicyScope;
  default_serves_for: Phase[];
  default_perimeter: Perimeter;
}

/** Fase del gate G1 (§3.6). */
const G1_PHASE: Phase = "modello";
/** Quota massima di deroghe sulle voci richieste (§3.6). */
const WAIVER_SHARE = 0.1;

/** Regola del caso: quella indicata, altrimenti quella del template. */
export function resolveGatePolicy(def: Pick<CanonicalDefinition, "gate_policy">, override?: Partial<CaseGatePolicy>): CaseGatePolicy {
  return {
    scope: override?.scope ?? def.gate_policy.scope,
    default_serves_for: [...(override?.default_serves_for ?? def.gate_policy.default_serves_for)],
    default_perimeter: override?.default_perimeter ?? def.gate_policy.default_perimeter,
  };
}

// ── Blocchi (§3.5) ────────────────────────────────────────────────────

export interface BlockerScopeItem {
  kind: ItemKind;
  privacyClass: PrivacyClass;
  availability: readonly string[];
  perimeter: Perimeter | null;
  explicitBlockedBy: readonly string[];
}

export interface BlockerMatch {
  key: string;
  /** `template`: nel `blocked_by` esplicito; `scope`: solo per lo scope del blocco. */
  origin: "template" | "scope";
}

function toBlockerDef(b: TemplateBlocker): BlockerDef {
  return { key: b.key, label: b.label, scope: parseBlockerScope(b.scope), permanent: b.permanent === true, fallbackAllowed: b.fallback_allowed ?? null };
}

/**
 * Blocchi del caso: quelli del template, nell'ordine del template, più `a8` e
 * `sanitario` in coda se il template non li dichiara (`ensureMandatoryBlockers`
 * di `blockers.ts`, la stessa regola usata dai comandi interni).
 */
export function caseBlockersFromTemplate(blockers: readonly TemplateBlocker[]): TemplateBlocker[] {
  const present = new Set(blockers.map((b) => b.key));
  const added = ensureMandatoryBlockers(blockers.map(toBlockerDef))
    .filter((d) => !present.has(d.key))
    .map(
      (d): TemplateBlocker => ({
        key: d.key,
        label: d.label ?? d.key,
        scope: {
          privacy_classes: [...d.scope.privacyClasses],
          availability: [...d.scope.availability],
          perimeters: [...d.scope.perimeters],
          real_data: d.scope.realData,
        },
        ...(d.permanent ? { permanent: true } : {}),
      }),
    );
  return [...blockers, ...added];
}

/**
 * Blocchi di una voce: chiave nel `blocked_by` esplicito **oppure** voce nello
 * scope (classe privacy, un qualsiasi token di disponibilità, perimetro). Vale
 * per tutti i tipi di voce, domande comprese. `real_data` non blocca voci da
 * solo. Nell'ordine dei blocchi del template.
 *
 * Delega a `blockerLinksForItem` di `blockers.ts`, così creazione del caso e
 * riclassificazione usano la stessa regola, compreso lo scope minimo di `a8`
 * (classi di rango ≥ `personale` e `dopo_a8`) e di `sanitario`.
 */
export function matchTemplateBlockers(item: BlockerScopeItem, blockers: readonly TemplateBlocker[]): BlockerMatch[] {
  return blockerLinksForItem(item, blockers.map(toBlockerDef));
}

export type BlockerMatcher = (item: BlockerScopeItem, blockers: readonly TemplateBlocker[]) => BlockerMatch[];

// ── Righe ─────────────────────────────────────────────────────────────

/** Riga di `uc_items` (colonne con i nomi del DB, senza `case_id`). */
export interface CaseItemRow {
  id: string;
  key: string;
  template_item_key: string;
  kind: ItemKind;
  section: ItemSection;
  parent_item_id: string | null;
  title: string;
  explanation: string | null;
  why: string | null;
  example: string | null;
  help: string | null;
  spec: Record<string, Json>;
  priority: Priority | null;
  serves_for: Phase[];
  privacy_class: PrivacyClass;
  availability: string[];
  perimeter: Perimeter | null;
  levers: Lever[];
  response_type: ResponseType | null;
  response_config: Record<string, Json>;
  request_module_key: string | null;
  in_gate_scope: boolean;
  status: Extract<ItemStatus, "da_chiedere" | "bloccata">;
  owner_role_key: string | null;
  requires_validity_period: boolean;
  freshness_days: number | null;
  source_refs: string[];
  sort_order: number;
}

export interface CaseLinkRow {
  from_item_id: string;
  to_item_id: string;
  relation: LinkRelation;
  cardinality: string | null;
  note: string | null;
}

export interface CaseBlockerRow {
  id: string;
  key: string;
  label: string;
  status: "attivo" | "permanente";
  scope: Record<string, Json>;
  fallback_allowed: string | null;
}

export interface CaseItemBlockerRow {
  item_id: string;
  blocker_id: string;
  origin: "template" | "scope";
}

/** Grafo di `uc_maps.graph`. Le voci dei nodi sono chiavi (`uc_items.key`). */
export interface CaseMapGraph {
  nodes: { id: string; label: string; description?: string; input: string[]; output: string[]; items: string[] }[];
  edges: { from: string; to: string; label?: string }[];
}

export interface CaseMapRow {
  kind: MapKind;
  title: string;
  graph: CaseMapGraph;
}

export interface CaseBuildCounts {
  items: number;
  links: number;
  blockers: number;
  itemBlockers: number;
  byStatus: { da_chiedere: number; bloccata: number };
  /** Domande (voci `domanda`). */
  questions: { total: number; da_chiedere: number; bloccata: number };
  /** Righe `uc_item_blockers` per chiave, separate tra domande e altre voci. */
  itemBlockersByKey: { questions: Record<string, number>; others: Record<string, number> };
  /** Voci (non domande) con 2 o più blocchi. */
  othersWithMultipleBlockers: number;
  inGateScope: number;
  /** Voci dei moduli di richiesta: quelle contate dalla testata. */
  scopeTotal: number;
  scopeByStatus: { da_chiedere: number; bloccata: number };
  /** Insieme richiesto da G1 con la regola del caso. */
  g1Required: number;
  g1Should: number;
  /** Regola letterale (valori del template, senza default) e copertura con le domande. */
  literalRequired: number;
  literalCoveredByQuestions: number;
}

export interface CaseBuild {
  policy: CaseGatePolicy;
  items: CaseItemRow[];
  links: CaseLinkRow[];
  blockers: CaseBlockerRow[];
  itemBlockers: CaseItemBlockerRow[];
  maps: CaseMapRow[];
  milestones: [];
  counts: CaseBuildCounts;
}

export interface BuildCaseOptions {
  newId: () => string;
  policy?: Partial<CaseGatePolicy>;
  /** Per usare la stessa regola dei blocchi di `blockers.ts` quando c'è. */
  blockerMatcher?: BlockerMatcher;
}

const isPerimeter = (v: unknown): v is Perimeter => typeof v === "string" && (PERIMETERS as readonly string[]).includes(v);

function textOrNull(value: string | undefined): string | null {
  return value === undefined || value.trim() === "" ? null : value;
}

function itemSpec(item: TemplateItem, defaultsApplied: string[]): Record<string, Json> {
  const spec: Record<string, Json> = { ...(item.spec as Record<string, Json>) };
  if (item.validations?.length) spec.validations = item.validations as unknown as Json;
  if (item.notes && Object.keys(item.notes).length) spec.notes = item.notes as Record<string, Json>;
  if (item.unresolved_refs.length) spec.unresolved_refs = [...item.unresolved_refs];
  if (item.blocked_by.length) spec.blocked_by = [...item.blocked_by];
  if (defaultsApplied.length) spec.defaults_applied = defaultsApplied;
  return spec;
}

function depthOf(key: string, parents: ReadonlyMap<string, string | undefined>, memo: Map<string, number>): number {
  const known = memo.get(key);
  if (known !== undefined) return known;
  // Il template validato non ha cicli: la catena finisce sempre.
  const chain: string[] = [];
  let current: string | undefined = key;
  while (current !== undefined && !memo.has(current)) {
    chain.push(current);
    current = parents.get(current);
  }
  let depth = current === undefined ? -1 : memo.get(current)!;
  for (let i = chain.length - 1; i >= 0; i--) memo.set(chain[i], ++depth);
  return memo.get(key)!;
}

/** Righe del caso dal template canonico (validato). */
export function buildCaseRows(def: CanonicalDefinition, options: BuildCaseOptions): CaseBuild {
  const policy = resolveGatePolicy(def, options.policy);
  const matcher = options.blockerMatcher ?? matchTemplateBlockers;
  const withDefaults = policy.scope !== "letterale";
  const allInScope = policy.scope !== "request_modules";

  const ids = new Map<string, string>();
  for (const item of def.items) ids.set(item.key, options.newId());

  const caseBlockers = caseBlockersFromTemplate(def.blockers);
  const blockers: CaseBlockerRow[] = caseBlockers.map((b) => ({
    id: options.newId(),
    key: b.key,
    label: b.label,
    status: isPermanentBlocker(toBlockerDef(b)) ? "permanente" : "attivo",
    scope: b.scope as Record<string, Json>,
    fallback_allowed: b.fallback_allowed ?? null,
  }));
  const blockerId = new Map(blockers.map((b) => [b.key, b.id]));

  const items: CaseItemRow[] = [];
  const itemBlockers: CaseItemBlockerRow[] = [];
  const counts: CaseBuildCounts = {
    items: 0,
    links: 0,
    blockers: blockers.length,
    itemBlockers: 0,
    byStatus: { da_chiedere: 0, bloccata: 0 },
    questions: { total: 0, da_chiedere: 0, bloccata: 0 },
    itemBlockersByKey: { questions: {}, others: {} },
    othersWithMultipleBlockers: 0,
    inGateScope: 0,
    scopeTotal: 0,
    scopeByStatus: { da_chiedere: 0, bloccata: 0 },
    g1Required: 0,
    g1Should: 0,
    literalRequired: 0,
    literalCoveredByQuestions: 0,
  };

  const literal = new Set<string>();
  def.items.forEach((item, index) => {
    const id = ids.get(item.key)!;
    const inModule = item.request_module !== undefined;
    const collected = inModule && withDefaults;
    const defaultsApplied: string[] = [];
    let servesFor = [...item.serves_for];
    let perimeter: Perimeter | null = item.perimeter ?? null;
    if (collected && servesFor.length === 0) {
      servesFor = [...policy.default_serves_for];
      defaultsApplied.push("serves_for");
    }
    if (collected && perimeter === null && isPerimeter(policy.default_perimeter)) {
      perimeter = policy.default_perimeter;
      defaultsApplied.push("perimeter");
    }
    const inGateScope = inModule || allInScope;

    const matches = matcher(
      { kind: item.kind, privacyClass: item.privacy_class, availability: item.availability, perimeter, explicitBlockedBy: item.blocked_by },
      caseBlockers,
    );
    const status: CaseItemRow["status"] = matches.length > 0 ? "bloccata" : "da_chiedere";
    for (const m of matches) {
      const bid = blockerId.get(m.key);
      if (!bid) continue;
      itemBlockers.push({ item_id: id, blocker_id: bid, origin: m.origin });
      const bucket = item.kind === "domanda" ? counts.itemBlockersByKey.questions : counts.itemBlockersByKey.others;
      bucket[m.key] = (bucket[m.key] ?? 0) + 1;
    }
    if (item.kind !== "domanda" && matches.length >= 2) counts.othersWithMultipleBlockers += 1;

    const response = item.response;
    items.push({
      id,
      key: item.key,
      template_item_key: item.key,
      kind: item.kind,
      section: item.section,
      parent_item_id: item.parent !== undefined ? (ids.get(item.parent) ?? null) : null,
      title: item.title,
      explanation: textOrNull(item.explanation),
      why: textOrNull(item.why),
      example: textOrNull(item.example),
      help: textOrNull(item.help),
      spec: itemSpec(item, defaultsApplied),
      priority: item.priority ?? null,
      serves_for: servesFor,
      privacy_class: item.privacy_class,
      availability: [...item.availability],
      perimeter,
      levers: [...item.levers],
      response_type: response?.type ?? null,
      response_config: (response?.config ?? {}) as Record<string, Json>,
      request_module_key: item.request_module ?? null,
      in_gate_scope: inGateScope,
      status,
      owner_role_key: item.owner_role_key ?? null,
      requires_validity_period: item.requires_validity_period ?? response?.type === "valuta",
      freshness_days: item.freshness_days ?? null,
      source_refs: [...item.sources],
      sort_order: index,
    });

    counts.byStatus[status] += 1;
    if (item.kind === "domanda") {
      counts.questions.total += 1;
      counts.questions[status] += 1;
    }
    if (inGateScope) counts.inGateScope += 1;
    if (inModule) {
      counts.scopeTotal += 1;
      counts.scopeByStatus[status] += 1;
    }
    const servesModel = servesFor.includes(G1_PHASE) && perimeter === "in_contratto";
    if (inGateScope && servesModel && item.priority === "must") counts.g1Required += 1;
    if (inGateScope && servesModel && item.priority === "should") counts.g1Should += 1;
    if (item.priority === "must" && item.perimeter === "in_contratto" && item.serves_for.includes(G1_PHASE)) literal.add(item.key);
  });

  // Parent prima dei figli: la FK `parent_item_id` si controlla a ogni istruzione.
  const parents = new Map(def.items.map((i) => [i.key, i.parent]));
  const memo = new Map<string, number>();
  const depth = new Map(def.items.map((i) => [i.key, depthOf(i.key, parents, memo)]));
  items.sort((a, b) => depth.get(a.key)! - depth.get(b.key)! || a.sort_order - b.sort_order);

  const links: CaseLinkRow[] = [];
  const covered = new Set<string>();
  for (const item of def.items) {
    for (const link of item.links) {
      links.push({
        from_item_id: ids.get(item.key)!,
        to_item_id: ids.get(link.to)!,
        relation: link.rel,
        cardinality: link.cardinality ?? null,
        note: link.note ?? null,
      });
      if (item.kind === "domanda" && item.request_module !== undefined && link.rel === "precisa" && literal.has(link.to)) covered.add(link.to);
    }
  }

  counts.items = items.length;
  counts.links = links.length;
  counts.itemBlockers = itemBlockers.length;
  counts.literalRequired = literal.size;
  counts.literalCoveredByQuestions = covered.size;

  const map = def.map;
  const maps: CaseMapRow[] = [
    {
      kind: map.kind,
      title: map.title ?? "Mappa della soluzione",
      graph: {
        nodes: map.nodes.map((n) => ({
          id: n.id,
          label: n.label,
          ...(n.description !== undefined ? { description: n.description } : {}),
          input: [...n.input],
          output: [...n.output],
          items: [...n.items],
        })),
        edges: map.edges.map((e) => ({ from: e.from, to: e.to, ...(e.label !== undefined ? { label: e.label } : {}) })),
      },
    },
  ];

  return { policy, items, links, blockers, itemBlockers, maps, milestones: [], counts };
}

// ── Testata del caso ──────────────────────────────────────────────────

/** Descrizione iniziale: il testo del template come «In breve», oppure i suoi blocchi. */
export function descriptionFromTemplate(def: Pick<CanonicalDefinition, "description">): Record<string, Json> {
  return typeof def.description === "string" ? { in_breve: def.description } : { ...(def.description as Record<string, Json>) };
}

/**
 * `uc_cases.settings` alla creazione: regola del gate (da confermare) e
 * `client_text` (§5.8): vero salvo template non confidenziale e non riservato.
 */
export function initialCaseSettings(i: { policy: CaseGatePolicy; confidential: boolean; restricted: boolean }): Record<string, Json> {
  return {
    gate_policy: {
      scope: i.policy.scope,
      default_serves_for: [...i.policy.default_serves_for],
      default_perimeter: i.policy.default_perimeter,
      confirmed: null,
    },
    client_text: i.confidential || i.restricted,
  };
}

/** Deroghe ammesse su `required` voci: 10%, nessuna sotto le 10 voci (§3.6). */
export function waiverCap(required: number): number {
  return required < 10 ? 0 : Math.floor(WAIVER_SHARE * required);
}

/**
 * Cache `uc_cases.readiness` alla creazione (§3.7): nessuna voce è ancora a
 * posto. I comandi successivi la ricalcolano con `semaforo.ts`/`gates.ts`.
 */
export function initialReadiness(build: Pick<CaseBuild, "counts">, now: Date): Record<string, Json> {
  const c = build.counts;
  const perStato: Record<string, number> = {};
  if (c.scopeByStatus.da_chiedere) perStato.da_chiedere = c.scopeByStatus.da_chiedere;
  if (c.scopeByStatus.bloccata) perStato.bloccata = c.scopeByStatus.bloccata;
  return {
    computed_at: now.toISOString(),
    catalog_revision: 0,
    scope_total: c.scopeTotal,
    per_stato: perStato,
    green_pct: 0,
    G1: {
      required: c.g1Required,
      ok: 0,
      ready: false,
      should: { total: c.g1Should, ok: 0 },
      waivers: { used: 0, cap: waiverCap(c.g1Required) },
    },
    coverage_model: { literal_required: c.literalRequired, covered_by_questions: c.literalCoveredByQuestions, ok: 0 },
    gate_reconfirm: false,
  };
}
