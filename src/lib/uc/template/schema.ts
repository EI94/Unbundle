/**
 * Formato canonico `unbundle.uc-template/1` (PIANO §4.1) e regole di rifiuto.
 *
 * Due fasi:
 * 1. forma (zod 4, oggetti **stretti**: una chiave sconosciuta è un errore, così
 *    un file grezzo non normalizzato viene rifiutato);
 * 2. controlli incrociati (`checkTemplate`): chiavi doppie, schema degli ID,
 *    relazioni ammesse, collegamenti verso voci assenti, moduli di richiesta,
 *    vocabolari, blocchi, gate, mappa, casi di prova, limiti.
 *
 * Solo avvisi: moduli vuoti, domande senza collegamenti, `unresolved_refs`,
 * cicli `dipende_da`, `scelta` senza opzioni su voci che non sono domande.
 *
 * Modulo puro: niente I/O. La lettura del file sta negli script.
 */
import { z } from "zod";
import {
  CASE_ROLES,
  GATE_KEYS,
  GATE_POLICY_SCOPES,
  ITEM_KINDS,
  ITEM_SECTIONS,
  LEVERS,
  LINK_RELATIONS,
  MAP_KINDS,
  PERIMETERS,
  PHASES,
  PRIORITIES,
  PRIVACY_CLASSES,
  RESPONSE_TYPES,
  TEMPLATE_STATUSES,
  TEST_CASE_KINDS,
  type GatePolicyScope,
  type ItemKind,
  type Perimeter,
  type Phase,
} from "../vocab.ts";
import { isDontKnowText } from "../answers/choice.ts";
import { checkItemKey, MAX_ITEM_KEY_LENGTH } from "./ids.ts";
import { isRelationAllowed, relationMessage } from "./relations.ts";

export const TEMPLATE_SCHEMA_ID = "unbundle.uc-template/1" as const;

/** Limiti del caricamento (PIANO §4.1, regola 10). */
export const TEMPLATE_LIMITS = {
  maxItems: 10_000,
  maxLinks: 50_000,
  maxBytes: 8 * 1024 * 1024,
  /** Problemi riportati al massimo; il resto si conta. */
  maxIssues: 200,
} as const;

/** Regola del gate di default (PIANO §3.6, D1): voci dei moduli, `modello`, `in_contratto`. */
export const DEFAULT_GATE_POLICY: {
  readonly scope: GatePolicyScope;
  readonly default_serves_for: readonly Phase[];
  readonly default_perimeter: Perimeter;
} = { scope: "request_modules", default_serves_for: ["modello"], default_perimeter: "in_contratto" };

// ── Forma ─────────────────────────────────────────────────────────────

const TOKEN = /^[a-z0-9_]+$/;
const DOTTED = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;
const SEMVER = /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/;

const token = (max: number) => z.string().max(max).regex(TOKEN);
const itemKey = z.string().min(1).max(MAX_ITEM_KEY_LENGTH);
const moduleKey = z.string().min(1).max(80).regex(DOTTED);
const label = (max = 255) => z.string().min(1).max(max);
const jsonObject = z.record(z.string(), z.unknown());

const LinkSchema = z.strictObject({
  rel: z.enum(LINK_RELATIONS),
  to: itemKey,
  cardinality: z.string().min(1).max(40).optional(),
  note: z.string().max(4000).optional(),
});

const ResponseSchema = z.strictObject({
  type: z.enum(RESPONSE_TYPES),
  config: jsonObject.default(() => ({})),
});

const NotesSchema = z.strictObject({
  privacy: z.string().optional(),
  availability: z.string().optional(),
  perimeter: z.string().optional(),
});

export const TemplateItemSchema = z.strictObject({
  key: itemKey,
  kind: z.enum(ITEM_KINDS),
  section: z.enum(ITEM_SECTIONS),
  parent: itemKey.optional(),
  title: z.string().min(1).max(600),
  explanation: z.string().optional(),
  why: z.string().optional(),
  example: z.string().optional(),
  help: z.string().optional(),
  priority: z.enum(PRIORITIES).optional(),
  serves_for: z.array(z.enum(PHASES)).default(() => []),
  privacy_class: z.enum(PRIVACY_CLASSES),
  availability: z.array(token(60)).default(() => []),
  perimeter: z.enum(PERIMETERS).optional(),
  levers: z.array(z.enum(LEVERS)).default(() => []),
  owner_role_key: token(80).optional(),
  request_module: moduleKey.optional(),
  response: ResponseSchema.optional(),
  links: z.array(LinkSchema).default(() => []),
  validations: z.array(z.strictObject({ key: z.string().min(1).max(160), rule: z.string() })).optional(),
  blocked_by: z.array(token(60)).default(() => []),
  freshness_days: z.number().int().positive().max(3650).optional(),
  requires_validity_period: z.boolean().optional(),
  sources: z.array(z.string()).default(() => []),
  unresolved_refs: z.array(z.string()).default(() => []),
  notes: NotesSchema.optional(),
  spec: jsonObject.default(() => ({})),
});

const VocabulariesSchema = z.strictObject({
  priority: z.array(z.enum(PRIORITIES)).min(1),
  serves_for: z.array(z.enum(PHASES)).min(1),
  privacy_class: z.array(z.enum(PRIVACY_CLASSES)).min(1),
  availability: z.array(token(60)),
  perimeter: z.strictObject({ in: z.enum(PERIMETERS), out: z.enum(PERIMETERS) }),
  levers: z.array(z.enum(LEVERS)),
});

const BlockerSchema = z.strictObject({
  key: token(60),
  label: label(2000),
  scope: z
    .strictObject({
      privacy_classes: z.array(z.enum(PRIVACY_CLASSES)).optional(),
      availability: z.array(token(60)).optional(),
      perimeters: z.array(z.enum(PERIMETERS)).optional(),
      real_data: z.boolean().optional(),
    })
    .default(() => ({})),
  permanent: z.boolean().optional(),
  fallback_allowed: z.string().min(1).optional(),
});

const GateSchema = z.strictObject({
  key: z.enum(GATE_KEYS),
  label: label(),
  phase: z.enum(PHASES),
  rule: z.string().min(1),
  approvers: z.array(z.enum(CASE_ROLES)).min(1),
});

const GatePolicySchema = z.strictObject({
  scope: z.enum(GATE_POLICY_SCOPES),
  default_serves_for: z.array(z.enum(PHASES)).min(1),
  default_perimeter: z.enum(PERIMETERS),
});

const MapNodeSchema = z.strictObject({
  id: z.string().min(1).max(80),
  label: label(),
  description: z.string().optional(),
  input: z.array(z.string()).default(() => []),
  output: z.array(z.string()).default(() => []),
  items: z.array(itemKey).default(() => []),
});

const MapSchema = z.strictObject({
  kind: z.enum(MAP_KINDS),
  title: label().optional(),
  nodes: z.array(MapNodeSchema),
  edges: z.array(z.strictObject({ from: z.string().min(1), to: z.string().min(1), label: z.string().optional() })),
});

const ModuleSchema = z.strictObject({
  key: moduleKey,
  title: label(),
  role_key: token(80).optional(),
  why: z.string().optional(),
  instructions: z.string().optional(),
  estimated_minutes: z.number().int().positive().max(24 * 60).optional(),
  estimated_label: label().optional(),
  items: z.array(itemKey),
});

const TestCaseSchema = z.strictObject({
  key: z.string().min(1).max(120).regex(/^[a-z0-9_.-]+$/),
  kind: z.enum(TEST_CASE_KINDS),
  input: z.union([z.string().min(1), jsonObject]),
  expected: z.strictObject({ atteso: z.string().min(1), regole: z.array(itemKey).default(() => []) }),
  covers: z.array(itemKey).default(() => []),
  serve_per: z.array(token(40)).default(() => []),
});

export const TemplateSchema = z.strictObject({
  schema: z.literal(TEMPLATE_SCHEMA_ID),
  key: z.string().max(120).regex(/^[a-z0-9_]+(\.[a-z0-9_]+)+$/),
  version: z.string().max(20).regex(SEMVER),
  status: z.enum(TEMPLATE_STATUSES).default("bozza"),
  language: z.string().regex(/^[a-z]{2}$/).default("it"),
  name: label(),
  archetype: token(80),
  /** true = contiene testi del cliente: si carica solo riservato a un workspace. */
  confidential: z.boolean().default(false),
  industry: label(80).optional(),
  function_area: label(80).optional(),
  description: z.union([z.string().min(1), jsonObject]),
  vocabularies: VocabulariesSchema,
  roles: z.array(z.strictObject({ key: token(80), label: label() })),
  sections: z.array(z.strictObject({ key: token(60), title: label() })),
  blockers: z.array(BlockerSchema),
  gates: z.array(GateSchema),
  gate_policy: GatePolicySchema.default(() => ({ ...DEFAULT_GATE_POLICY, default_serves_for: [...DEFAULT_GATE_POLICY.default_serves_for] })),
  map: MapSchema,
  items: z.array(TemplateItemSchema).min(1).max(TEMPLATE_LIMITS.maxItems),
  request_modules: z.array(ModuleSchema),
  roi: jsonObject.optional(),
  glossary: z.array(z.strictObject({ term: label(), explanation: z.string().min(1), example: z.string().optional() })).optional(),
  test_cases: z.array(TestCaseSchema).optional(),
});

export type TemplateDefinition = z.output<typeof TemplateSchema>;
export type TemplateDefinitionInput = z.input<typeof TemplateSchema>;
export type TemplateItem = TemplateDefinition["items"][number];
export type TemplateLink = TemplateItem["links"][number];
export type TemplateBlocker = TemplateDefinition["blockers"][number];
export type TemplateModule = TemplateDefinition["request_modules"][number];
export type TemplateMap = TemplateDefinition["map"];
export type TemplateGatePolicy = TemplateDefinition["gate_policy"];

// ── Esito ─────────────────────────────────────────────────────────────

export interface TemplateIssue {
  /** Codice stabile, es. `chiave_doppia`, `relazione_non_ammessa`. */
  code: string;
  /** Messaggio in italiano semplice. */
  message: string;
  /** Percorso nel JSON (`items.12.links.0.to`) o chiave della voce. */
  path?: string;
}

export interface TemplateStats {
  items: number;
  links: number;
  byKind: Record<ItemKind, number>;
  modules: number;
  questions: number;
  mustQuestions: number;
  blockers: number;
  gates: number;
  mapNodes: number;
}

export type TemplateValidation =
  | { ok: true; template: TemplateDefinition; warnings: TemplateIssue[]; stats: TemplateStats }
  | { ok: false; errors: TemplateIssue[]; warnings: TemplateIssue[] };

/**
 * «Non lo so» non è un'opzione: è l'azione sempre presente (PIANO §3.9). Stesso
 * controllo delle risposte (`isDontKnowText`), anche per «Non lo sappiamo».
 */
export function isDontKnowOption(option: unknown): boolean {
  if (typeof option === "string") return isDontKnowText(option.normalize("NFKC"));
  if (option && typeof option === "object" && !Array.isArray(option)) {
    const o = option as { value?: unknown; label?: unknown };
    return [o.value, o.label].some((t) => typeof t === "string" && isDontKnowText(t.normalize("NFKC")));
  }
  return false;
}

class IssueList {
  readonly items: TemplateIssue[] = [];
  private dropped = 0;
  add(code: string, message: string, path?: string): void {
    if (this.items.length < TEMPLATE_LIMITS.maxIssues) this.items.push(path ? { code, message, path } : { code, message });
    else this.dropped += 1;
  }
  get count(): number {
    return this.items.length + this.dropped;
  }
  finish(kind: "errori" | "avvisi"): TemplateIssue[] {
    if (this.dropped > 0) {
      return [...this.items, { code: "altri_problemi", message: `E altri ${this.dropped} ${kind} non elencati.` }];
    }
    return this.items;
  }
}

// ── Controlli incrociati ──────────────────────────────────────────────

const QUESTION_CHOICE_TYPES = new Set(["scelta", "scelta_multipla"]);

function checkResponse(item: TemplateItem, path: string, errors: IssueList, warnings: IssueList): void {
  const response = item.response;
  if (!response) {
    if (item.kind === "domanda") errors.add("domanda_senza_risposta", `La domanda «${item.key}» non ha un tipo di risposta.`, path);
    return;
  }
  const config = response.config;
  if (QUESTION_CHOICE_TYPES.has(response.type)) {
    const options = config.options;
    if (options === undefined) {
      if (item.kind === "domanda") {
        errors.add("scelta_senza_opzioni", `La domanda «${item.key}» è una scelta senza opzioni.`, `${path}.response.config.options`);
      } else {
        warnings.add("scelta_senza_opzioni", `«${item.key}» è una scelta senza opzioni (solo dizionario dati).`, `${path}.response.config.options`);
      }
    } else if (!Array.isArray(options) || options.some((o) => typeof o !== "string" || o.trim() === "")) {
      errors.add("opzioni_non_valide", `Le opzioni di «${item.key}» devono essere testi non vuoti.`, `${path}.response.config.options`);
    } else {
      if (options.length < 2) errors.add("opzioni_insufficienti", `«${item.key}» deve avere almeno 2 opzioni.`, `${path}.response.config.options`);
      if (new Set(options.map((o) => (o as string).trim().toLowerCase())).size !== options.length) {
        errors.add("opzioni_doppie", `«${item.key}» ha opzioni ripetute.`, `${path}.response.config.options`);
      }
      if (options.some(isDontKnowOption)) {
        errors.add("opzione_non_lo_so", `«${item.key}»: «Non lo so» non è un'opzione, è un'azione sempre presente.`, `${path}.response.config.options`);
      }
    }
  }
  if (response.type === "codice" && config.pattern !== undefined) {
    let valid = typeof config.pattern === "string" && config.pattern.length <= 500;
    if (valid) {
      try {
        // Same flags as the answers (`answers/simple.ts`): a pattern valid only without «u» would reject every answer.
        new RegExp(config.pattern as string, "u");
      } catch {
        valid = false;
      }
    }
    if (!valid) errors.add("pattern_non_valido", `Lo schema del codice di «${item.key}» non è un'espressione regolare valida.`, `${path}.response.config.pattern`);
  }
}

/** Cicli sulla relazione `dipende_da` (solo avviso). Visita iterativa. */
function dependsOnCycles(items: readonly TemplateItem[]): string[] {
  const graph = new Map<string, string[]>();
  for (const item of items) {
    const next = item.links.filter((l) => l.rel === "dipende_da").map((l) => l.to);
    if (next.length) graph.set(item.key, next);
  }
  const state = new Map<string, 1 | 2>();
  const cycles: string[] = [];
  for (const start of graph.keys()) {
    if (state.has(start)) continue;
    const stack: { key: string; next: number }[] = [{ key: start, next: 0 }];
    state.set(start, 1);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const edges = graph.get(top.key) ?? [];
      if (top.next >= edges.length) {
        state.set(top.key, 2);
        stack.pop();
        continue;
      }
      const to = edges[top.next++];
      const s = state.get(to);
      if (s === 1) {
        if (cycles.length < 20) cycles.push(`${top.key} → ${to}`);
      } else if (s === undefined) {
        state.set(to, 1);
        stack.push({ key: to, next: 0 });
      }
    }
  }
  return cycles;
}

/**
 * Controlli che zod non può fare da solo. Restituisce errori (bloccanti) e
 * avvisi, più i conteggi.
 */
export function checkTemplate(def: TemplateDefinition): { errors: TemplateIssue[]; warnings: TemplateIssue[]; stats: TemplateStats } {
  const errors = new IssueList();
  const warnings = new IssueList();
  const vocab = def.vocabularies;
  const perimeters = new Set<string>([vocab.perimeter.in, vocab.perimeter.out]);
  const availability = new Set(vocab.availability);

  // Chiavi di roles, sections, blockers, gates: uniche.
  const unique = (list: readonly { key: string }[], what: string, path: string): Set<string> => {
    const seen = new Set<string>();
    list.forEach((entry, i) => {
      if (seen.has(entry.key)) errors.add(`${what}_doppio`, `Chiave doppia in ${path}: «${entry.key}».`, `${path}.${i}.key`);
      seen.add(entry.key);
    });
    return seen;
  };
  const roleKeys = unique(def.roles, "ruolo", "roles");
  const sectionKeys = unique(def.sections, "sezione", "sections");
  const blockerKeys = unique(def.blockers, "blocco", "blockers");
  unique(def.gates, "gate", "gates");

  def.blockers.forEach((b, i) => {
    if (b.key === "sanitario" && b.permanent !== true) {
      errors.add("sanitario_non_permanente", "Il blocco «sanitario» deve essere permanente.", `blockers.${i}.permanent`);
    }
    for (const a of b.scope.availability ?? []) {
      if (!availability.has(a)) errors.add("vocabolario", `Il blocco «${b.key}» usa una disponibilità non dichiarata: «${a}».`, `blockers.${i}.scope.availability`);
    }
    for (const p of b.scope.perimeters ?? []) {
      if (!perimeters.has(p)) errors.add("vocabolario", `Il blocco «${b.key}» usa un perimetro non dichiarato: «${p}».`, `blockers.${i}.scope.perimeters`);
    }
    for (const c of b.scope.privacy_classes ?? []) {
      if (!vocab.privacy_class.includes(c)) errors.add("vocabolario", `Il blocco «${b.key}» usa una classe privacy non dichiarata: «${c}».`, `blockers.${i}.scope.privacy_classes`);
    }
  });
  def.gates.forEach((g, i) => {
    if (!vocab.serves_for.includes(g.phase)) errors.add("gate_fase", `La fase del gate ${g.key} («${g.phase}») non è tra gli usi dichiarati.`, `gates.${i}.phase`);
  });
  for (const p of def.gate_policy.default_serves_for) {
    if (!vocab.serves_for.includes(p)) errors.add("vocabolario", `gate_policy usa un uso non dichiarato: «${p}».`, "gate_policy.default_serves_for");
  }
  if (!perimeters.has(def.gate_policy.default_perimeter)) {
    errors.add("vocabolario", "gate_policy usa un perimetro non dichiarato.", "gate_policy.default_perimeter");
  }

  // Voci: chiavi doppie, poi tutto il resto.
  const byKey = new Map<string, TemplateItem>();
  def.items.forEach((item, i) => {
    if (byKey.has(item.key)) errors.add("chiave_doppia", `Chiave doppia: «${item.key}».`, `items.${i}.key`);
    else byKey.set(item.key, item);
  });
  const entityKeys = new Set(def.items.filter((i) => i.kind === "entita").map((i) => i.key));
  const byKind = Object.fromEntries(ITEM_KINDS.map((k) => [k, 0])) as Record<ItemKind, number>;
  let links = 0;
  const triples = new Set<string>();

  def.items.forEach((item, i) => {
    const path = `items.${i}`;
    byKind[item.kind] += 1;
    const keyIssue = checkItemKey(item, entityKeys);
    if (keyIssue) errors.add(keyIssue.code, keyIssue.message, `${path}.key`);
    if (!sectionKeys.has(item.section)) errors.add("sezione_non_dichiarata", `«${item.key}» usa una sezione non dichiarata: «${item.section}».`, `${path}.section`);

    if (item.parent !== undefined) {
      if (item.parent === item.key) errors.add("parent_se_stesso", `«${item.key}» non può essere parent di se stesso.`, `${path}.parent`);
      else if (!byKey.has(item.parent)) errors.add("parent_assente", `Il parent di «${item.key}» non esiste: «${item.parent}».`, `${path}.parent`);
    }

    if (item.priority && !vocab.priority.includes(item.priority)) errors.add("vocabolario", `«${item.key}»: priorità non dichiarata.`, `${path}.priority`);
    if (!vocab.privacy_class.includes(item.privacy_class)) errors.add("vocabolario", `«${item.key}»: classe privacy non dichiarata.`, `${path}.privacy_class`);
    for (const p of item.serves_for) if (!vocab.serves_for.includes(p)) errors.add("vocabolario", `«${item.key}»: uso non dichiarato «${p}».`, `${path}.serves_for`);
    for (const l of item.levers) if (!vocab.levers.includes(l)) errors.add("vocabolario", `«${item.key}»: leva non dichiarata «${l}».`, `${path}.levers`);
    if (item.perimeter && !perimeters.has(item.perimeter)) errors.add("vocabolario", `«${item.key}»: perimetro non dichiarato.`, `${path}.perimeter`);
    for (const a of item.availability) if (!availability.has(a)) errors.add("vocabolario", `«${item.key}»: disponibilità non dichiarata «${a}».`, `${path}.availability`);
    for (const b of item.blocked_by) if (!blockerKeys.has(b)) errors.add("blocco_assente", `«${item.key}» è bloccata da un blocco che non esiste: «${b}».`, `${path}.blocked_by`);
    if (item.owner_role_key && !roleKeys.has(item.owner_role_key)) {
      errors.add("ruolo_assente", `«${item.key}» ha un ruolo che non esiste: «${item.owner_role_key}».`, `${path}.owner_role_key`);
    }
    if (item.request_module && item.kind !== "domanda") {
      errors.add("modulo_voce_non_domanda", `Solo le domande stanno nei moduli di richiesta: «${item.key}».`, `${path}.request_module`);
    }
    checkResponse(item, path, errors, warnings);

    item.links.forEach((link, j) => {
      links += 1;
      const lpath = `${path}.links.${j}`;
      if (link.to === item.key) {
        errors.add("autoanello", `«${item.key}» è collegata a se stessa.`, lpath);
        return;
      }
      const triple = `${item.key}\u0000${link.rel}\u0000${link.to}`;
      if (triples.has(triple)) errors.add("collegamento_doppio", `Collegamento doppio: «${item.key}» -${link.rel}-> «${link.to}».`, lpath);
      triples.add(triple);
      const target = byKey.get(link.to);
      if (!target) {
        errors.add("collegamento_assente", `«${item.key}» è collegata a una voce che non esiste: «${link.to}».`, `${lpath}.to`);
        return;
      }
      if (!isRelationAllowed(item.kind, link.rel, target.kind)) {
        errors.add("relazione_non_ammessa", relationMessage(item.key, item.kind, link.rel, target.key, target.kind), `${lpath}.rel`);
      }
    });
    if (item.kind === "domanda" && item.links.length === 0) warnings.add("domanda_senza_collegamenti", `La domanda «${item.key}» non precisa nessuna voce.`, path);
    if (item.unresolved_refs.length > 0) warnings.add("riferimenti_non_collegati", `«${item.key}» cita ${item.unresolved_refs.length} voci che non esistono.`, `${path}.unresolved_refs`);
  });
  if (links > TEMPLATE_LIMITS.maxLinks) errors.add("limite_collegamenti", `Troppi collegamenti: ${links} (massimo ${TEMPLATE_LIMITS.maxLinks}).`, "items");

  // Catena dei parent senza cicli.
  for (const item of def.items) {
    const seen = new Set<string>([item.key]);
    let parent = item.parent;
    while (parent !== undefined) {
      if (seen.has(parent)) {
        errors.add("parent_ciclo", `I parent di «${item.key}» formano un ciclo.`, item.key);
        break;
      }
      seen.add(parent);
      parent = byKey.get(parent)?.parent;
    }
  }

  // Moduli di richiesta.
  const moduleOf = new Map<string, string>();
  const moduleKeys = new Set<string>();
  def.request_modules.forEach((m, i) => {
    const path = `request_modules.${i}`;
    if (moduleKeys.has(m.key)) errors.add("modulo_doppio", `Modulo doppio: «${m.key}».`, `${path}.key`);
    moduleKeys.add(m.key);
    if (m.role_key && !roleKeys.has(m.role_key)) errors.add("ruolo_assente", `Il modulo «${m.key}» ha un ruolo che non esiste: «${m.role_key}».`, `${path}.role_key`);
    if (m.items.length === 0) warnings.add("modulo_vuoto", `Il modulo «${m.key}» non ha domande.`, `${path}.items`);
    m.items.forEach((key, j) => {
      const item = byKey.get(key);
      if (!item) {
        errors.add("modulo_voce_assente", `Il modulo «${m.key}» cita una voce che non esiste: «${key}».`, `${path}.items.${j}`);
        return;
      }
      if (item.kind !== "domanda") {
        errors.add("modulo_voce_non_domanda", `Il modulo «${m.key}» contiene «${key}», che non è una domanda.`, `${path}.items.${j}`);
        return;
      }
      const previous = moduleOf.get(key);
      if (previous !== undefined) {
        errors.add("domanda_in_piu_moduli", `La domanda «${key}» sta in più moduli («${previous}», «${m.key}»).`, `${path}.items.${j}`);
        return;
      }
      moduleOf.set(key, m.key);
      if (item.request_module !== m.key) {
        errors.add("domanda_modulo_diverso", `La domanda «${key}» indica il modulo «${item.request_module ?? "-"}» ma sta in «${m.key}».`, `${path}.items.${j}`);
      }
    });
  });
  for (const item of def.items) {
    if (item.kind === "domanda" && !moduleOf.has(item.key)) {
      errors.add("domanda_senza_modulo", `La domanda «${item.key}» non sta in nessun modulo di richiesta.`, item.key);
    }
  }

  // Mappa.
  const nodeIds = new Set<string>();
  def.map.nodes.forEach((n, i) => {
    if (nodeIds.has(n.id)) errors.add("nodo_doppio", `Nodo doppio nella mappa: «${n.id}».`, `map.nodes.${i}.id`);
    nodeIds.add(n.id);
    n.items.forEach((key, j) => {
      if (!byKey.has(key)) errors.add("nodo_voce_assente", `Il nodo «${n.id}» cita una voce che non esiste: «${key}».`, `map.nodes.${i}.items.${j}`);
    });
  });
  def.map.edges.forEach((e, i) => {
    if (!nodeIds.has(e.from) || !nodeIds.has(e.to)) errors.add("arco_assente", `L'arco ${i + 1} della mappa collega un nodo che non esiste.`, `map.edges.${i}`);
  });

  // Casi di prova.
  const testKeys = new Set<string>();
  (def.test_cases ?? []).forEach((t, i) => {
    if (testKeys.has(t.key)) errors.add("caso_prova_doppio", `Caso di prova doppio: «${t.key}».`, `test_cases.${i}.key`);
    testKeys.add(t.key);
    for (const key of [...t.expected.regole, ...t.covers]) {
      if (!byKey.has(key)) errors.add("caso_prova_voce_assente", `Il caso di prova «${t.key}» cita una voce che non esiste: «${key}».`, `test_cases.${i}`);
    }
  });

  for (const cycle of dependsOnCycles(def.items)) warnings.add("ciclo_dipende_da", `Ciclo sulla relazione dipende_da: ${cycle}.`);

  const questions = def.items.filter((i) => i.kind === "domanda");
  return {
    errors: errors.finish("errori"),
    warnings: warnings.finish("avvisi"),
    stats: {
      items: def.items.length,
      links,
      byKind,
      modules: def.request_modules.length,
      questions: questions.length,
      mustQuestions: questions.filter((q) => q.priority === "must").length,
      blockers: def.blockers.length,
      gates: def.gates.length,
      mapNodes: def.map.nodes.length,
    },
  };
}

/** Forma (zod) e controlli incrociati insieme. */
export function validateTemplate(input: unknown): TemplateValidation {
  const parsed = TemplateSchema.safeParse(input);
  if (!parsed.success) {
    const errors = new IssueList();
    for (const issue of parsed.error.issues) {
      const path = issue.path.map(String).join(".");
      errors.add("formato", `Formato non valido${path ? ` in ${path}` : ""}: ${issue.message}`, path || undefined);
    }
    return { ok: false, errors: errors.finish("errori"), warnings: [] };
  }
  const { errors, warnings, stats } = checkTemplate(parsed.data);
  if (errors.length > 0) return { ok: false, errors, warnings };
  return { ok: true, template: parsed.data, warnings, stats };
}

// ── Lettura del testo JSON ────────────────────────────────────────────

/**
 * Chiavi ripetute nello stesso oggetto JSON (`{"a":1,"a":2}`): `JSON.parse`
 * terrebbe in silenzio l'ultima. Restituisce i percorsi, al massimo `limit`.
 * Da chiamare su un testo che `JSON.parse` accetta.
 */
export function duplicateJsonKeys(text: string, limit = 20): string[] {
  type Frame = { keys: Set<string> | null; path: string; index: number; key: string | null; expectKey: boolean };
  const found: string[] = [];
  const stack: Frame[] = [];
  const childPath = (frame: Frame | undefined): string => {
    if (!frame) return "";
    const segment = frame.keys ? (frame.key ?? "") : String(frame.index);
    return frame.path ? `${frame.path}.${segment}` : segment;
  };
  let i = 0;
  while (i < text.length && found.length < limit) {
    const ch = text.charCodeAt(i);
    if (ch === 0x22 /* " */) {
      let j = i + 1;
      let escaped = false;
      while (j < text.length) {
        const c = text.charCodeAt(j);
        if (c === 0x5c /* \ */) {
          escaped = true;
          j += 2;
          continue;
        }
        if (c === 0x22) break;
        j += 1;
      }
      const top = stack[stack.length - 1];
      if (top?.keys && top.expectKey) {
        const rawKey = text.slice(i + 1, j);
        const key = escaped ? (JSON.parse(`"${rawKey}"`) as string) : rawKey;
        if (top.keys.has(key)) found.push(top.path ? `${top.path}.${key}` : key);
        top.keys.add(key);
        top.key = key;
        top.expectKey = false;
      }
      i = j + 1;
      continue;
    }
    if (ch === 0x7b /* { */ || ch === 0x5b /* [ */) {
      const parent = stack[stack.length - 1];
      stack.push({ keys: ch === 0x7b ? new Set() : null, path: childPath(parent), index: 0, key: null, expectKey: ch === 0x7b });
    } else if (ch === 0x7d /* } */ || ch === 0x5d /* ] */) {
      stack.pop();
    } else if (ch === 0x2c /* , */) {
      const top = stack[stack.length - 1];
      if (top) {
        if (top.keys) top.expectKey = true;
        else top.index += 1;
      }
    }
    i += 1;
  }
  return found;
}

export type TemplateTextResult = { ok: true; value: unknown; bytes: number } | { ok: false; code: string; message: string };

/** Testo del file → valore JSON, con limite di dimensione e controllo delle chiavi ripetute. */
export function parseTemplateText(text: string): TemplateTextResult {
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > TEMPLATE_LIMITS.maxBytes) {
    return { ok: false, code: "file_troppo_grande", message: `Il file supera ${TEMPLATE_LIMITS.maxBytes / (1024 * 1024)} MB.` };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, code: "json_non_valido", message: "Il file non è un JSON valido." };
  }
  const duplicates = duplicateJsonKeys(text, 5);
  if (duplicates.length > 0) {
    return { ok: false, code: "json_chiavi_ripetute", message: `Chiavi ripetute nello stesso oggetto: ${duplicates.join(", ")}.` };
  }
  return { ok: true, value, bytes };
}
