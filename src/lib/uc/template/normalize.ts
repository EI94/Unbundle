/**
 * Normalizzatore dei template (PIANO §4.2): JSON grezzo (v1.0.0, campi in
 * italiano e testi liberi) → formato canonico `unbundle.uc-template/1` (§4.1),
 * più un report con un conteggio per ogni trasformazione.
 *
 * È deterministico: stesso ingresso, stessa uscita. Il report contiene solo
 * chiavi, codici e conteggi, mai testi del cliente: i ruoli scritti a testo
 * libero (con nomi di persone) si eliminano e si risolvono solo frasi-ruolo
 * generiche, prese dalle etichette dei ruoli del template stesso.
 *
 * L'uscita va poi validata con `validateTemplate` (lo script lo fa sempre).
 *
 * Modulo puro.
 */
import {
  ITEM_KINDS,
  PERIMETERS,
  PERSONAL_PRIVACY_CLASSES,
  PRIVACY_CLASSES,
  type ItemKind,
  type Perimeter,
  type PrivacyClass,
} from "../vocab.ts";
import { deriveItemKeys } from "./map-items.ts";
import { DEFAULT_GATE_POLICY, isDontKnowOption, TEMPLATE_SCHEMA_ID } from "./schema.ts";

export const NORMALIZE_REPORT_SCHEMA = "unbundle.uc-template-normalize-report/1" as const;

export interface NormalizeOptions {
  /** Area delle domande (`q.<area>.<nn>`) e dei moduli → chiave di ruolo del template. */
  roleAliases?: Readonly<Record<string, string>>;
  /** Contiene testi del cliente? Default true: si carica solo riservato a un workspace. */
  confidential?: boolean;
}

export interface NormalizeReport {
  schema: typeof NORMALIZE_REPORT_SCHEMA;
  template: { key: string; version: string };
  /** Un conteggio per trasformazione, chiavi in ordine alfabetico. */
  counts: Record<string, number>;
  /** Classi privacy dopo la normalizzazione. */
  privacy_classes: Record<PrivacyClass, number>;
  /** Solo chiavi di voci, moduli o nodi: mai testi. */
  lists: {
    health_rule_questions: string[];
    health_with_personal: string[];
    unresolved_owner_items: string[];
    unresolved_question_areas: string[];
    unresolved_module_roles: string[];
    unresolved_rule_params: string[];
    unresolved_ref_entities: string[];
    empty_modules: string[];
    map_nodes_without_items: string[];
    /** Campi della radice che il formato canonico non conosce (si scartano). */
    dropped_root_fields: string[];
  };
}

export type NormalizeResult =
  | { ok: true; template: Record<string, unknown>; report: NormalizeReport }
  | { ok: false; code: string; message: string };

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v : undefined);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const objects = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);

class Counter {
  private readonly map = new Map<string, number>();
  inc(name: string, by = 1): void {
    this.map.set(name, (this.map.get(name) ?? 0) + by);
  }
  set(name: string, value: number): void {
    this.map.set(name, value);
  }
  get(name: string): number {
    return this.map.get(name) ?? 0;
  }
  toJSON(): Record<string, number> {
    return Object.fromEntries([...this.map.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  }
}

// ── Classe privacy, disponibilità, perimetro ─────────────────────────

const PRIVACY_TOKEN = /(?<![a-z0-9_])(escluso_sanitario|personale_equipaggio|personale|riservato_azienda|nessuna)(?![a-z0-9_])/g;
const rank = (c: PrivacyClass): number => PRIVACY_CLASSES.indexOf(c);
const mostRestrictive = (list: readonly PrivacyClass[]): PrivacyClass => [...list].sort((a, b) => rank(a) - rank(b))[0];
const isPersonal = (c: PrivacyClass): boolean => (PERSONAL_PRIVACY_CLASSES as readonly string[]).includes(c);

interface PrivacyOutcome {
  cls: PrivacyClass;
  note?: string;
  healthRuleQuestion?: boolean;
  forbiddenHealthColumns?: boolean;
}

/**
 * Token più restrittivo [D], resto del testo in `notes.privacy`. Assente →
 * `riservato_azienda` [D]. Eccezioni (PIANO §3.5): una domanda `escluso_sanitario`
 * chiede la regola, non il dato → `riservato_azienda` (o la classe personale
 * indicata insieme, se c'è) + `health_rule_question`;
 * `escluso_sanitario` insieme a una classe personale → classe personale con
 * `forbidden_columns: ["sanitari"]`.
 */
export function normalizePrivacy(raw: unknown, kind: ItemKind, counts?: Counter): PrivacyOutcome {
  if (raw === null || raw === undefined) {
    counts?.inc("privacy_null_default");
    return { cls: "riservato_azienda" };
  }
  const text = String(raw);
  const tokens = [...new Set([...text.matchAll(PRIVACY_TOKEN)].map((m) => m[1] as PrivacyClass))];
  if (tokens.length === 0) {
    counts?.inc("privacy_unrecognized_default");
    return { cls: "riservato_azienda", note: text };
  }
  if (tokens.length > 1) counts?.inc("privacy_multi_token");
  let cls = mostRestrictive(tokens);
  const out: PrivacyOutcome = { cls };
  if (cls === "escluso_sanitario") {
    const personal = tokens.filter(isPersonal);
    if (kind === "domanda") {
      // Chiede la regola, non il dato. Se il testo indica anche una classe
      // personale, quella resta (e con lei il blocco a8).
      cls = personal.length > 0 ? mostRestrictive(personal) : "riservato_azienda";
      out.healthRuleQuestion = true;
      out.note = text;
      counts?.inc("privacy_health_rule_question");
    } else if (personal.length > 0) {
      cls = mostRestrictive(personal);
      out.forbiddenHealthColumns = true;
      counts?.inc("privacy_health_with_personal");
    }
    out.cls = cls;
  }
  if (out.note === undefined && text !== out.cls) {
    out.note = text;
    counts?.inc("privacy_notes");
  }
  return out;
}

function tokenPattern(vocabulary: readonly string[]): RegExp | null {
  const safe = vocabulary.filter((t) => /^[a-z0-9_]+$/.test(t)).sort((a, b) => b.length - a.length);
  return safe.length ? new RegExp(`(?<![a-z0-9_])(${safe.join("|")})(?![a-z0-9_])`, "g") : null;
}

/** Disponibilità come insieme di token del vocabolario; il resto del testo in `notes.availability`. */
export function normalizeAvailability(raw: unknown, vocabulary: readonly string[], counts?: Counter): { tokens: string[]; note?: string } {
  if (raw === null || raw === undefined) {
    counts?.inc("availability_null");
    return { tokens: [] };
  }
  if (Array.isArray(raw)) return { tokens: [...new Set(strings(raw))] };
  const text = String(raw);
  const pattern = tokenPattern(vocabulary);
  const tokens = pattern ? [...new Set([...text.matchAll(pattern)].map((m) => m[1]))] : [];
  if (tokens.length === 0) counts?.inc("availability_unrecognized");
  if (tokens.length === 1 && tokens[0] === text) return { tokens };
  counts?.inc("availability_notes");
  return { tokens, note: text };
}

/** Primo token del perimetro: `in` del vocabolario → `in_contratto`, `out` → `evoluzione`. */
export function normalizePerimeter(raw: unknown, vocabulary: { in?: string; out?: string }, counts?: Counter): { perimeter?: Perimeter; note?: string } {
  if (raw === null || raw === undefined) return {};
  const text = String(raw);
  const first = /^\s*([a-z_]+)/.exec(text)?.[1];
  let perimeter: Perimeter | undefined;
  if (first && first === vocabulary.in) perimeter = "in_contratto";
  else if (first && first === vocabulary.out) perimeter = "evoluzione";
  else if (first && (PERIMETERS as readonly string[]).includes(first)) perimeter = first as Perimeter;
  if (!perimeter) {
    counts?.inc("perimeter_unrecognized");
    return { note: text };
  }
  if (text.trim() !== first) {
    counts?.inc("perimeter_free_text");
    return { perimeter, note: text };
  }
  return { perimeter };
}

// ── Collegamenti ─────────────────────────────────────────────────────

/** Un estremo della cardinalità: `1`, `N`, `M`, `0..1`, `0..N`. */
const CARDINALITY_CODE = /^(?:1|N|M|0\.\.1|0\.\.N):(?:1|N|M|0\.\.1|0\.\.N)$/;
const CARDINALITY_SYNONYMS: Readonly<Record<string, string>> = {
  "uno a uno": "1:1",
  "uno a molti": "1:N",
  "molti a uno": "N:1",
  "molti a molti": "N:M",
  "N:N": "N:M",
  "M:N": "N:M",
  "M:M": "N:M",
};

/**
 * Cardinalità in codice (`1:1`, `1:N`, `N:1`, `N:M`, `N:0..1` e gli altri
 * estremi `0..1`, `0..N`); altrimenti il testo va in `note`.
 */
export function normalizeCardinality(raw: unknown): { cardinality?: string; note?: string } {
  const text = str(raw)?.trim();
  if (!text) return {};
  const compact = text.replace(/\s+/g, "").toUpperCase();
  const synonym = CARDINALITY_SYNONYMS[compact] ?? CARDINALITY_SYNONYMS[text.toLowerCase().replace(/\s+/g, " ")];
  if (synonym) return { cardinality: synonym };
  if (CARDINALITY_CODE.test(compact)) return { cardinality: compact };
  return { note: text };
}

function invertCardinality(code: string | undefined): string | undefined {
  if (!code) return code;
  const [a, b] = code.split(":");
  return b === undefined ? code : `${b}:${a}`;
}

// ── Ruoli ────────────────────────────────────────────────────────────

/** Testa della frase-ruolo: minuscolo, senza accenti e parentesi, fino al primo separatore. */
export function rolePhraseHead(text: string): string {
  const plain = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ");
  const head = plain.split(/[;,:/]|\s(?:con|e|ed|oppure|o|per|piu)\s/)[0];
  return head.replace(/\s+/g, " ").trim();
}

/**
 * Ruolo di una frase generica («Controllo di gestione con …»): uguale (o
 * prefisso) all'etichetta di un ruolo, alla sua chiave o a un'area degli alias.
 * Le frasi con nomi di persona non si risolvono: restano null, nel report.
 */
export function resolveRolePhrase(
  text: string,
  roles: readonly { key: string; label: string }[],
  aliases: Readonly<Record<string, string>>,
): string | null {
  const head = rolePhraseHead(text);
  if (!head) return null;
  const candidates = new Map<string, string>();
  for (const role of roles) {
    candidates.set(rolePhraseHead(role.label), role.key);
    candidates.set(role.key.replace(/_/g, " "), role.key);
  }
  const roleKeys = new Set(roles.map((r) => r.key));
  for (const [area, roleKey] of Object.entries(aliases)) if (roleKeys.has(roleKey)) candidates.set(area.replace(/_/g, " "), roleKey);
  let best: { phrase: string; key: string } | null = null;
  for (const [phrase, key] of candidates) {
    if (!phrase) continue;
    if ((head === phrase || head.startsWith(`${phrase} `)) && (!best || phrase.length > best.phrase.length)) best = { phrase, key };
  }
  return best?.key ?? null;
}

function areaRole(area: string | undefined, roleKeys: ReadonlySet<string>, aliases: Readonly<Record<string, string>>): string | null {
  if (!area) return null;
  const alias = aliases[area];
  if (alias && roleKeys.has(alias)) return alias;
  return roleKeys.has(area) ? area : null;
}

/** Minuti dal testo del tempo stimato: la prima durata («1 ora e 30 minuti» → 90). */
export function parseEstimatedMinutes(label: string): number | undefined {
  const m = /^\s*(?:(\d+)\s*or[ae](?:\s*e\s*(\d+)\s*minut[oi])?|(\d+)\s*minut[oi])/i.exec(label);
  if (!m) return undefined;
  const minutes = m[3] !== undefined ? Number(m[3]) : Number(m[1]) * 60 + Number(m[2] ?? 0);
  return minutes > 0 && minutes <= 24 * 60 ? minutes : undefined;
}

// ── Voci ─────────────────────────────────────────────────────────────

const RENAMED: Readonly<Record<string, string>> = { spiegazione: "explanation", perche: "why", esempio: "example" };
const COMMON_FIELDS = new Set([
  "key", "kind", "section", "parent", "title", "spiegazione", "explanation", "perche", "why", "esempio", "example", "help",
  "priority", "serves_for", "privacy_class", "availability", "perimeter", "levers", "default_owner_role", "owner_role_key",
  "modulo", "request_module", "response", "links", "validations", "blocked_by", "freshness_days", "requires_validity_period",
  "sources", "riferimenti_non_collegati", "unresolved_refs", "notes", "spec",
]);
/** Campi propri di ogni tipo che vanno in `spec` (PIANO §4.1). */
const SPEC_FIELDS = new Set([
  "qualita", "dominio", "formula", "formula_tecnica", "unit", "direzione", "granularita", "dimensioni", "baseline", "target",
  "pnl_line", "kpi_controllo", "kpi", "tipo_regola", "forma_logica", "parametri", "eccezioni", "stato_validazione",
  "controllo", "azione", "gravita", "definizione", "valori", "chiave", "frequenza", "fonte_verita", "fallback",
]);
const SOURCE_RESPONSE_SPEC = ["periodo", "formato", "metodo"] as const;
const TYPE_RENAMES: Readonly<Record<string, string>> = { "conferma regola": "conferma_regola", "conferma formula": "conferma_formula" };

interface ItemContext {
  counts: Counter;
  report: NormalizeReport["lists"];
  itemKind: ReadonlyMap<string, ItemKind>;
  vocabulary: { availability: readonly string[]; perimeter: { in?: string; out?: string } };
  roles: readonly { key: string; label: string }[];
  roleKeys: ReadonlySet<string>;
  aliases: Readonly<Record<string, string>>;
}

function normalizeResponse(raw: Obj, kind: ItemKind, key: string, ctx: ItemContext, spec: Obj, unresolved: string[]): Obj | undefined {
  const response = raw.response;
  if (!isObj(response)) return undefined;
  const rawType = str(response.type);
  if (!rawType) return undefined;
  let type = TYPE_RENAMES[rawType] ?? rawType;
  if (type !== rawType) ctx.counts.inc(`response_${type}`);
  // Formato canonico (`{type, config}`) o grezzo (configurazione accanto a `type`).
  const config: Obj = isObj(response.config) ? { ...response.config } : {};
  for (const [k, v] of Object.entries(response)) {
    if (k === "type" || k === "config" || v === null || v === undefined) continue;
    if (kind === "fonte" && (SOURCE_RESPONSE_SPEC as readonly string[]).includes(k)) {
      spec[k] = v;
      continue;
    }
    config[k] = v;
  }
  if (type === "riferimento") {
    type = "codice";
    ctx.counts.inc("response_riferimento_codice");
    const unit = str(config.unit);
    delete config.unit;
    if (unit) {
      const mentioned = [...unit.matchAll(/(?<![a-z0-9_.])(ent\.[a-z][a-z0-9_]*)(?![a-z0-9_])/g)].map((m) => m[1]);
      if (mentioned.length) ctx.counts.inc("response_ref_entity_mentioned");
      const resolved = mentioned.find((m) => ctx.itemKind.get(m) === "entita");
      if (resolved) {
        config.ref_entity = resolved;
        ctx.counts.inc("response_ref_entity_resolved");
      } else if (mentioned.length) {
        for (const m of mentioned) if (!unresolved.includes(m)) unresolved.push(m);
        ctx.report.unresolved_ref_entities.push(key);
      }
      if (unit !== resolved) config.ref_label = unit;
    }
  }
  if (kind === "campo" && typeof config.unit === "string" && config.unit.includes("|")) {
    config.options = config.unit
      .split("|")
      .map((o) => o.trim())
      .filter((o) => o !== "");
    delete config.unit;
    ctx.counts.inc("campo_unit_options");
  }
  if (Array.isArray(config.options)) {
    const before = config.options as unknown[];
    const kept = before.filter((o) => !isDontKnowOption(o));
    if (kept.length !== before.length) ctx.counts.inc("options_non_lo_so_removed");
    if (kept.length) config.options = kept;
    else delete config.options;
  }
  return { type, config };
}

function normalizeItem(raw: Obj, ctx: ItemContext): { item: Obj; rawParams: string[] } {
  const key = String(raw.key);
  const kind = raw.kind as ItemKind;
  const item: Obj = { key, kind, section: raw.section };
  if (str(raw.parent)) item.parent = raw.parent;
  item.title = raw.title;
  for (const [from, to] of [["spiegazione", "explanation"], ["perche", "why"], ["esempio", "example"]] as const) {
    const value = str(raw[from]) ?? str(raw[to]);
    if (value !== undefined) item[to] = value;
    if (str(raw[from]) !== undefined) ctx.counts.inc(`field_${from}_${RENAMED[from]}`);
  }
  if (str(raw.help)) item.help = raw.help;
  if (str(raw.priority)) item.priority = raw.priority;
  item.serves_for = strings(raw.serves_for);

  const notes: Obj = isObj(raw.notes) ? { ...raw.notes } : {};
  const spec: Obj = isObj(raw.spec) ? { ...raw.spec } : {};
  const privacy = normalizePrivacy(raw.privacy_class, kind, ctx.counts);
  item.privacy_class = privacy.cls;
  if (privacy.note !== undefined) notes.privacy = privacy.note;
  if (privacy.healthRuleQuestion) {
    spec.health_rule_question = true;
    ctx.report.health_rule_questions.push(key);
  }
  if (privacy.forbiddenHealthColumns) {
    const current = strings(spec.forbidden_columns);
    spec.forbidden_columns = current.includes("sanitari") ? current : [...current, "sanitari"];
    ctx.report.health_with_personal.push(key);
  }

  const availability = normalizeAvailability(raw.availability, ctx.vocabulary.availability, ctx.counts);
  item.availability = availability.tokens;
  if (availability.note !== undefined) notes.availability = availability.note;
  const perimeter = normalizePerimeter(raw.perimeter, ctx.vocabulary.perimeter, ctx.counts);
  if (perimeter.perimeter) item.perimeter = perimeter.perimeter;
  if (perimeter.note !== undefined) notes.perimeter = perimeter.note;
  item.levers = strings(raw.levers);

  // Ruolo del titolare: per area per le domande, per frase generica per gli altri.
  if (raw.default_owner_role !== undefined) ctx.counts.inc("default_owner_role_dropped");
  if (str(raw.owner_role_key) && ctx.roleKeys.has(raw.owner_role_key as string)) {
    item.owner_role_key = raw.owner_role_key;
  } else if (kind === "domanda") {
    const role = areaRole(key.split(".")[1], ctx.roleKeys, ctx.aliases);
    if (role) {
      item.owner_role_key = role;
      ctx.counts.inc("question_owner_role");
    } else ctx.report.unresolved_question_areas.push(key);
  } else if (str(raw.default_owner_role)) {
    const role = resolveRolePhrase(raw.default_owner_role as string, ctx.roles, ctx.aliases);
    if (role) {
      item.owner_role_key = role;
      ctx.counts.inc("owner_phrase_resolved");
    } else {
      ctx.counts.inc("owner_phrase_unresolved");
      ctx.report.unresolved_owner_items.push(key);
    }
  }
  const moduleKey = str(raw.modulo) ?? str(raw.request_module);
  if (moduleKey) item.request_module = moduleKey;

  const unresolved = [...strings(raw.unresolved_refs), ...strings(raw.riferimenti_non_collegati)];
  if (strings(raw.riferimenti_non_collegati).length) ctx.counts.inc("unresolved_refs_items");
  const response = normalizeResponse(raw, kind, key, ctx, spec, unresolved);
  if (response) item.response = response;
  item.links = [];
  if (Array.isArray(raw.validations)) item.validations = objects(raw.validations).map((v) => ({ key: String(v.key), rule: String(v.rule ?? "") }));
  item.blocked_by = strings(raw.blocked_by);
  if (typeof raw.freshness_days === "number") item.freshness_days = raw.freshness_days;
  if (typeof raw.requires_validity_period === "boolean") item.requires_validity_period = raw.requires_validity_period;
  item.sources = strings(raw.sources);
  if (strings(raw.sources).length) ctx.counts.inc("sources_items");

  // Campi propri del tipo → spec; campi sconosciuti → spec (nessuna perdita).
  for (const [k, v] of Object.entries(raw)) {
    if (COMMON_FIELDS.has(k) || v === null || v === undefined) continue;
    if (!SPEC_FIELDS.has(k)) ctx.counts.inc("extra_fields_to_spec");
    spec[k] = v;
  }
  const rawParams = kind === "regola" ? strings(raw.parametri) : [];
  item.unresolved_refs = unresolved;
  if (Object.keys(notes).length) item.notes = notes;
  item.spec = spec;
  return { item, rawParams };
}

// ── Template ─────────────────────────────────────────────────────────

/** Campi della radice gestiti dal normalizzatore. */
const ROOT_FIELDS = new Set([
  "schema", "key", "version", "status", "language", "name", "archetype", "confidential", "industry", "function_area",
  "description", "vocabularies", "roles", "sections", "blockers", "gates", "gate_policy", "map", "items", "request_modules",
  "roi", "glossary", "test_cases",
]);

/** Ambito di un blocco: classi «di rango ≥» della meno restrittiva elencata, `dopo_<chiave>` dalla disponibilità. */
function normalizeBlocker(raw: Obj, vocabulary: { availability: readonly string[]; perimeter: { in?: string; out?: string } }, counts: Counter): Obj {
  const key = String(raw.key);
  const scope: Obj = isObj(raw.scope) ? { ...raw.scope } : {};
  const classes = strings(raw.blocks_privacy_class).filter((c): c is PrivacyClass => (PRIVACY_CLASSES as readonly string[]).includes(c));
  if (classes.length) {
    const widest = Math.max(...classes.map(rank));
    scope.privacy_classes = PRIVACY_CLASSES.filter((c) => rank(c) <= widest);
  }
  const availability = [...new Set([...strings(scope.availability), ...strings(raw.blocks_availability)])];
  const after = `dopo_${key}`;
  if (vocabulary.availability.includes(after) && !availability.includes(after)) {
    availability.push(after);
    counts.inc("blocker_scope_after_token");
  }
  if (availability.length) scope.availability = availability;
  const perimeters = strings(raw.blocks_perimeter)
    .map((p) => normalizePerimeter(p, vocabulary.perimeter).perimeter)
    .filter((p): p is Perimeter => p !== undefined);
  if (perimeters.length) scope.perimeters = [...new Set(perimeters)];
  if (raw.blocks_real_data === true) scope.real_data = true;
  if (raw.blocks_privacy_class !== undefined || raw.blocks_availability !== undefined || raw.blocks_perimeter !== undefined || raw.blocks_real_data !== undefined) {
    counts.inc("blockers_scope");
  }
  const out: Obj = { key, label: raw.label, scope };
  if (raw.permanent === true || key === "sanitario") out.permanent = true;
  const fallback = str(raw.fallback_ammesso) ?? str(raw.fallback_allowed);
  if (fallback) out.fallback_allowed = fallback;
  return out;
}

function normalizeMap(raw: Obj, itemKeys: readonly string[], counts: Counter, report: NormalizeReport["lists"]): Obj {
  const nodes = objects(raw.nodes).map((n) => {
    const description = str(n.descrizione) ?? str(n.description);
    const input = strings(n.input);
    const output = strings(n.output);
    // Voci esplicite (formato canonico) restano come sono; altrimenti si ricavano dai testi.
    let items: string[];
    if (Array.isArray(n.items)) {
      items = [...new Set(strings(n.items))];
    } else {
      const derived = deriveItemKeys([description, ...input, ...output], itemKeys);
      items = derived.keys;
      if (items.length) counts.inc("map_nodes_items_derived");
      if (derived.wildcards.length) counts.inc("map_wildcards_expanded", derived.wildcards.length);
      if (derived.unresolved.length) counts.inc("map_mentions_unresolved", derived.unresolved.length);
    }
    if (items.length === 0) report.map_nodes_without_items.push(String(n.id));
    const node: Obj = { id: String(n.id), label: n.label };
    if (description) node.description = description;
    node.input = input;
    node.output = output;
    node.items = items;
    return node;
  });
  const edges = (Array.isArray(raw.edges) ? raw.edges : []).map((e) => {
    if (Array.isArray(e)) {
      counts.inc("map_edges_converted");
      const edge: Obj = { from: String(e[0]), to: String(e[1]) };
      if (str(e[2])) edge.label = e[2];
      return edge;
    }
    const o = isObj(e) ? e : {};
    const edge: Obj = { from: String(o.from), to: String(o.to) };
    if (str(o.label)) edge.label = o.label;
    return edge;
  });
  const out: Obj = { kind: raw.kind };
  if (str(raw.title)) out.title = raw.title;
  out.nodes = nodes;
  out.edges = edges;
  return out;
}

/** Normalizza un template grezzo. Non valida: il risultato va passato a `validateTemplate`. */
export function normalizeTemplate(raw: unknown, options: NormalizeOptions = {}): NormalizeResult {
  if (!isObj(raw)) return { ok: false, code: "non_oggetto", message: "Il template deve essere un oggetto JSON." };
  if (!Array.isArray(raw.items)) return { ok: false, code: "voci_assenti", message: "Il template non ha l'elenco delle voci (items)." };
  const counts = new Counter();
  const lists: NormalizeReport["lists"] = {
    health_rule_questions: [],
    health_with_personal: [],
    unresolved_owner_items: [],
    unresolved_question_areas: [],
    unresolved_module_roles: [],
    unresolved_rule_params: [],
    unresolved_ref_entities: [],
    empty_modules: [],
    map_nodes_without_items: [],
    dropped_root_fields: Object.keys(raw)
      .filter((k) => !ROOT_FIELDS.has(k))
      .sort(),
  };
  const aliases = options.roleAliases ?? {};
  const rawVocab = isObj(raw.vocabularies) ? raw.vocabularies : {};
  const rawPerimeter = isObj(rawVocab.perimeter) ? rawVocab.perimeter : {};
  const vocabulary = {
    availability: strings(rawVocab.availability),
    perimeter: { in: str(rawPerimeter.in), out: str(rawPerimeter.out) },
  };
  const roles = objects(raw.roles).map((r) => ({ key: String(r.key), label: String(r.label ?? r.key) }));
  const roleKeys = new Set(roles.map((r) => r.key));

  const rawItems = objects(raw.items);
  const itemKind = new Map<string, ItemKind>();
  for (const it of rawItems) {
    if (typeof it.key === "string" && (ITEM_KINDS as readonly string[]).includes(String(it.kind))) itemKind.set(it.key, it.kind as ItemKind);
  }
  const ctx: ItemContext = { counts, report: lists, itemKind, vocabulary, roles, roleKeys, aliases };
  const normalized = rawItems.map((it) => normalizeItem(it, ctx));
  const byKey = new Map(normalized.map(({ item }) => [item.key as string, item]));
  const itemKeys = normalized.map(({ item }) => item.key as string);

  // Collegamenti: autoanelli e doppioni via, fonte→entità capovolti, parametri delle regole come «usa».
  const seen = new Set<string>();
  const triple = (from: string, rel: string, to: string) => `${from}\u0000${rel}\u0000${to}`;
  const flips: { from: string; to: string; link: Obj }[] = [];
  let input = 0;
  rawItems.forEach((raw, i) => {
    const from = normalized[i].item.key as string;
    const fromKind = normalized[i].item.kind as ItemKind;
    const out = normalized[i].item.links as Obj[];
    for (const l of objects(raw.links)) {
      input += 1;
      const rel = String(l.rel);
      const to = String(l.to);
      const rawCardinality = l.cardinalita ?? l.cardinality;
      if (rawCardinality !== undefined && rawCardinality !== null) counts.inc("links_cardinality_input");
      if (to === from) {
        counts.inc("links_self_removed");
        continue;
      }
      const t = triple(from, rel, to);
      if (seen.has(t)) {
        counts.inc("links_duplicate_removed");
        continue;
      }
      seen.add(t);
      const card = normalizeCardinality(rawCardinality);
      const note = str(l.note);
      if (rawCardinality !== undefined && rawCardinality !== null) counts.inc(card.cardinality ? "links_cardinality_coded" : "links_cardinality_note");
      const link: Obj = { rel, to };
      if (card.cardinality) link.cardinality = card.cardinality;
      const noteText = [card.note, note].filter(Boolean).join(" · ");
      if (noteText) link.note = noteText;
      if (fromKind === "fonte" && rel === "alimentato_da" && itemKind.get(to) === "entita") {
        flips.push({ from, to, link });
        continue;
      }
      out.push(link);
    }
  });
  counts.set("links_input", input);
  for (const { from, to, link } of flips) {
    const t = triple(to, "alimentato_da", from);
    if (seen.has(t)) {
      counts.inc("links_flip_collision");
      continue;
    }
    seen.add(t);
    const flipped: Obj = { rel: "alimentato_da", to: from };
    const inverted = invertCardinality(link.cardinality as string | undefined);
    if (inverted) flipped.cardinality = inverted;
    if (link.note) flipped.note = link.note;
    (byKey.get(to)!.links as Obj[]).push(flipped);
    counts.inc("links_flipped_source_entity");
  }
  for (const { item, rawParams } of normalized) {
    for (const param of rawParams) {
      if (!byKey.has(param)) {
        counts.inc("rule_params_unresolved");
        const refs = item.unresolved_refs as string[];
        if (!refs.includes(param)) refs.push(param);
        lists.unresolved_rule_params.push(param);
        continue;
      }
      const t = triple(item.key as string, "usa", param);
      if (seen.has(t)) {
        counts.inc("rule_params_already_linked");
        continue;
      }
      seen.add(t);
      (item.links as Obj[]).push({ rel: "usa", to: param });
      counts.inc("links_from_rule_params");
    }
  }
  counts.set("links_total", normalized.reduce((n, { item }) => n + (item.links as Obj[]).length, 0));

  // Moduli di richiesta.
  const modules = objects(raw.request_modules).map((m) => {
    const key = String(m.key);
    let items: unknown = m.items;
    if (typeof items === "string") {
      try {
        items = JSON.parse(items);
        counts.inc("module_items_from_string");
      } catch {
        items = [];
      }
    }
    const list = strings(items);
    if (list.length === 0) lists.empty_modules.push(key);
    let roleKey = str(m.role_key) && roleKeys.has(m.role_key as string) ? (m.role_key as string) : null;
    if (!roleKey) {
      for (const token of key.split(".")) {
        roleKey = areaRole(token, roleKeys, aliases);
        if (roleKey) break;
      }
    }
    if (!roleKey) {
      const areas = list.map((k) => k.split(".")[1]).filter(Boolean);
      roleKey = areas.length ? areaRole(areas[0], roleKeys, aliases) : null;
    }
    if (m.role !== undefined) counts.inc("module_role_dropped");
    const out: Obj = { key, title: m.title };
    if (roleKey) {
      out.role_key = roleKey;
      counts.inc("module_role_key");
    } else lists.unresolved_module_roles.push(key);
    const why = str(m.perche) ?? str(m.why);
    if (why) out.why = why;
    const instructions = str(m.istruzioni) ?? str(m.instructions);
    if (instructions) out.instructions = instructions;
    const label = str(m.tempo_stimato) ?? str(m.estimated_label);
    const minutes = typeof m.estimated_minutes === "number" ? m.estimated_minutes : label ? parseEstimatedMinutes(label) : undefined;
    if (minutes !== undefined) {
      out.estimated_minutes = minutes;
      counts.inc("module_estimated_minutes");
    }
    if (label) out.estimated_label = label;
    out.items = list;
    return out;
  });

  const rawMap = isObj(raw.map) ? raw.map : { kind: "soluzione", nodes: [], edges: [] };
  const map = normalizeMap(rawMap, itemKeys, counts, lists);
  const blockers = objects(raw.blockers).map((b) => normalizeBlocker(b, vocabulary, counts));
  const gates = objects(raw.gates).map((g) => ({ key: g.key, label: g.label, phase: g.phase, rule: g.rule, approvers: strings(g.approvers) }));

  const confidential = options.confidential ?? true;
  if (confidential) counts.inc("confidential");
  const template: Obj = {
    schema: TEMPLATE_SCHEMA_ID,
    key: raw.key,
    version: raw.version,
    status: raw.status ?? "bozza",
    language: raw.language ?? "it",
    name: raw.name,
    archetype: raw.archetype,
    confidential,
  };
  if (str(raw.industry)) template.industry = raw.industry;
  if (str(raw.function_area)) template.function_area = raw.function_area;
  template.description = raw.description;
  template.vocabularies = {
    priority: strings(rawVocab.priority),
    serves_for: strings(rawVocab.serves_for),
    privacy_class: strings(rawVocab.privacy_class),
    availability: vocabulary.availability,
    perimeter: { in: "in_contratto", out: "evoluzione" },
    levers: strings(rawVocab.levers),
  };
  template.roles = roles;
  template.sections = objects(raw.sections).map((s) => ({ key: s.key, title: s.title }));
  template.blockers = blockers;
  template.gates = gates;
  if (isObj(raw.gate_policy)) template.gate_policy = raw.gate_policy;
  else {
    template.gate_policy = { ...DEFAULT_GATE_POLICY, default_serves_for: [...DEFAULT_GATE_POLICY.default_serves_for] };
    counts.inc("gate_policy_default");
  }
  template.map = map;
  template.items = normalized.map(({ item }) => item);
  template.request_modules = modules;
  if (isObj(raw.roi)) template.roi = raw.roi;
  if (Array.isArray(raw.glossary)) {
    template.glossary = objects(raw.glossary).map((g) => {
      const entry: Obj = { term: g.termine ?? g.term, explanation: g.spiegazione ?? g.explanation };
      const example = str(g.esempio) ?? str(g.example);
      if (example) entry.example = example;
      return entry;
    });
  }
  if (Array.isArray(raw.test_cases)) {
    template.test_cases = objects(raw.test_cases).map((t) => ({
      key: t.key,
      kind: t.kind ?? t.tipo,
      input: t.input ?? t.richiesta,
      expected: isObj(t.expected) ? t.expected : { atteso: t.atteso, regole: strings(t.regole) },
      covers: strings(t.covers),
      serve_per: strings(t.serve_per),
    }));
  }

  const privacyClasses = Object.fromEntries(PRIVACY_CLASSES.map((c) => [c, 0])) as Record<PrivacyClass, number>;
  for (const { item } of normalized) privacyClasses[item.privacy_class as PrivacyClass] += 1;
  counts.set("items", normalized.length);
  counts.set("modules", modules.length);
  return {
    ok: true,
    template,
    report: {
      schema: NORMALIZE_REPORT_SCHEMA,
      template: { key: String(raw.key), version: String(raw.version) },
      counts: counts.toJSON(),
      privacy_classes: privacyClasses,
      lists,
    },
  };
}
