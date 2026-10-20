/**
 * Piano del seed di un caso (PIANO §8.1, §8.2, D2, D27): dal file di seed
 * validato (`schema.ts`) e dal template canonico già caricato, tutto ciò che
 * lo script `scripts/uc-seed-case.ts` scrive nel batch di sovrapposizione.
 *
 * - **Stati** delle domande da `initial_state` (import, fuori dalla macchina a
 *   stati), con il motivo obbligatorio sulle mancanti.
 * - **Valori dichiarati** → risposta v1 `valore`, `{text}`, senza valore
 *   normalizzato, `source_kind = dichiarato_in_call`, `confidence =
 *   da_verificare`, `source_ref` con gli id F…/E1/E2 citati. Lo stato della voce
 *   non cambia.
 * - **Voci personali o bloccate**: nessun valore in chiaro. Il valore si omette
 *   (evento `seed.valore_omesso`); quelli personali tornano solo con
 *   `includePersonalValues`, da cifrare (A.8 sciolta e chiave presenti: lo
 *   controlla lo script). Le voci `escluso_sanitario` non ricevono mai un valore.
 * - **Redazione** con il file privato dei nomi (email, telefoni, nomi →
 *   «[referente]») su tutti i testi che si salvano, prima della scansione.
 * - **Scansione** (`scanText(context: 'seed')`) di ogni valore e di ogni testo di
 *   sovrapposizione. Il report contiene solo chiave o percorso, categoria ed
 *   esito, mai il testo; il suo sha256 si approva con `--accept-scan`. Finché
 *   non è approvato, i valori con esito sanitario o discriminatorio non si
 *   salvano e un esito così nei testi ferma l'apply.
 * - **Controlli** che il seed non apra un lucchetto: una voce bloccata dal
 *   template resta `bloccata`, e una voce `bloccata` deve avere un blocco.
 *
 * Scansione e redazione arrivano iniettate (`text/scan.ts`, `text/redact.ts`).
 * Modulo puro: niente I/O, niente orologio.
 */
import { blockerKeysForItem, ensureMandatoryBlockers, parseBlockerScope, type BlockerDef } from "../blockers.ts";
import type { Json } from "../types.ts";
import { sha256Hex, stableStringify } from "../snapshot.ts";
import {
  HEALTH_PRIVACY_CLASS,
  ITEM_KINDS,
  LEVERS,
  PERSONAL_PRIVACY_CLASSES,
  isVocab,
  type Lever,
  type Perimeter,
  type PrivacyClass,
  type ResponseType,
} from "../vocab.ts";
import { SEED_INITIAL_STATES, type CaseSeed, type SeedInitialState, type SeedMapBlock, type SeedProcessStep } from "./schema.ts";
import { extractContractRefs, extractSourceRefs, sourceRefLabel } from "./source-refs.ts";
import { stripParenthetical, workspaceSearch, type WorkspaceSearch } from "./workspace.ts";

// ── Ingressi ──────────────────────────────────────────────────────────

/** Sottoinsieme di una voce del template canonico (`unbundle.uc-template/1`, §4.1). */
export interface SeedTemplateItem {
  key: string;
  kind: string;
  title: string;
  privacy_class: PrivacyClass;
  request_module?: string | null;
  response?: { type: ResponseType } | null;
  blocked_by?: readonly string[];
  /** Token di disponibilità e perimetro: decidono i blocchi per scope, come alla creazione del caso. */
  availability?: readonly string[];
  perimeter?: Perimeter | null;
  spec?: { readonly [key: string]: unknown };
}

/** Blocco del template canonico: con `scope` la voce si blocca anche per disponibilità, perimetro o classe. */
export interface SeedTemplateBlocker {
  key: string;
  label?: string;
  scope?: unknown;
  permanent?: boolean;
}

export interface SeedTemplate {
  key: string;
  version: string;
  items: readonly SeedTemplateItem[];
  roles?: readonly { key: string }[];
  blockers?: readonly SeedTemplateBlocker[];
  /** Mappa della soluzione del template: le voci dei nodi sono già derivate dal normalizzatore. */
  map?: { nodes: readonly { id: string; items?: readonly string[] }[] } | null;
}

/** Esito di `scanText` (`text/scan.ts`, PIANO §3.10). */
export interface SeedFinding {
  category: string;
  term?: string;
}
export type SeedScanner = (
  text: string,
  opts: { context: "seed"; healthRuleQuestion?: { questionText: string } },
) => { blocking: readonly SeedFinding[]; warnings: readonly SeedFinding[] };

/** `redactPersonalMentions` (`text/redact.ts`): email, telefoni e nomi → «[referente]». */
export type SeedRedactor = (text: string, names: readonly string[]) => { text: string; count: number };

export interface PlanSeedOptions {
  scan: SeedScanner;
  redact: SeedRedactor;
  /** Nomi dal file privato. Vuoto solo in locale con `--allow-unredacted`. */
  names: readonly string[];
  /** sha256 del report di scansione approvato (`--accept-scan`). */
  acceptScan?: string | null;
  /** Prepara anche i valori personali, da cifrare (solo con A.8 sciolta e chiave: lo verifica lo script). */
  includePersonalValues?: boolean;
  /** `--contract-ref` aggiuntivi. */
  extraContractRefs?: readonly string[];
  /** Chiavi dei ruoli del seed → chiavi del template (`role-aliases.json`). */
  roleAliases?: Readonly<Record<string, string>>;
}

// ── Uscite ────────────────────────────────────────────────────────────

export interface SeedIssue {
  code: string;
  message: string;
  key?: string;
  path?: string;
}

/** Riga del report di scansione: solo riferimenti e categorie, mai il testo. */
export interface SeedScanEntry {
  /** `valore` = valore dichiarato di una domanda; `testo` = testo di sovrapposizione. */
  kind: "valore" | "testo";
  /** Chiave della voce oppure percorso nel seed (es. `description.rischi[2].mitigazione`). */
  ref: string;
  categoria: string;
  esito: "blocca" | "avviso";
  /** Trattiene il valore o ferma l'apply finché il report non è approvato. */
  trattiene: boolean;
  count: number;
}

export interface SeedScanReport {
  schema: "unbundle.uc-seed-scan/1";
  seed_hash: string;
  redactions: number;
  entries: SeedScanEntry[];
}

export interface SeedItemPlan {
  key: string;
  status: SeedInitialState;
  status_reason: string | null;
}

export interface SeedAnswerPlan {
  item_key: string;
  version: 1;
  kind: "valore";
  value: { text: string };
  value_normalized: null;
  source_kind: "dichiarato_in_call";
  source_ref: string;
  confidence: "da_verificare";
  responder_user_id: null;
  /** Valore in prosa su un tipo tipizzato: niente «Confermo», input tipizzato (§3.9, D45). */
  needs_retyping: boolean;
}

export type SeedPersonalAnswerPlan = Omit<SeedAnswerPlan, "needs_retyping"> & { encrypt: true };

export interface SeedOmission {
  item_key: string;
  /**
   * `personale`: voce personale (A.8); `bloccata`: voce bloccata non personale;
   * `sanitario_classe`: voce `escluso_sanitario`; altrimenti la categoria della scansione.
   */
  categoria: string;
}

export type SeedGraphNode = { [key: string]: Json } & {
  id: string;
  label: string;
  description: string | null;
  input: string[];
  output: string[];
  items: string[];
  unresolved_refs: string[];
};

export type SeedMapKind = "soluzione" | "processo_to_be" | "processo_as_is" | "esempio";

/**
 * Mappa da scrivere in `uc_maps`. La versione la sceglie lo script: la
 * creazione del caso ha già scritto la `soluzione` del template (v1), quindi la
 * mappa del seed diventa la versione successiva, con la precedente non più
 * corrente.
 */
export interface SeedMapPlan {
  kind: SeedMapKind;
  title: string;
  source: "import";
  graph: { nodes: SeedGraphNode[]; edges: { from: string; to: string; label: string | null }[] };
}

export interface SeedCostLine {
  key: string;
  label: string;
  kind: "una_tantum" | "ricorrente" | "escluso" | null;
  tipo_testo: string;
  how_estimated: string;
  value: null;
  status: "da_raccogliere";
  source: string;
  authorized_art_8_4: null;
}

export interface SeedBenefitLine {
  key: string;
  lever: Lever | null;
  lever_label: string;
  formula: string;
  inputs: string[];
  unresolved_refs: string[];
  value: null;
  status: "da_raccogliere";
  source: "seed";
  how_to_euro: string;
  data_needed: string[];
  example: string;
}

export interface SeedRoiPlan {
  version: 1;
  status: "stima";
  scenario: "base";
  currency: "EUR";
  horizon_years: 5;
  includes_human_review_time: true;
  cost_lines: SeedCostLine[];
  benefit_lines: SeedBenefitLine[];
  content: { [key: string]: Json };
}

export interface SeedMilestonePlan {
  key: string;
  title: string;
  planned_label: string | null;
  is_proposal: boolean;
  to_confirm: boolean;
  notes: string | null;
  sort_order: number;
}

export type SeedStateCounts = Record<SeedInitialState, number>;

export interface SeedPlanCounts {
  questions: number;
  by_state: SeedStateCounts;
  by_area: Record<string, SeedStateCounts>;
  known_values: number;
  answers: { total: number; by_state: SeedStateCounts };
  retyping: { total: number; by_state: SeedStateCounts };
  omitted: Record<string, number>;
  personal_answers: number;
  maps: Record<SeedMapKind, { nodes: number; edges: number }>;
  roi: { costs: number; benefits: number };
  milestones: { total: number; proposals: number; to_confirm: number };
  blockers: { attivo: number; permanente: number };
  contract_refs: number;
}

export type SeedEventType = "voce.stato_importato" | "seed.valore_omesso" | "seed.applicato";

export interface SeedPlan {
  /** Nessun errore: lo script può procedere (salvo `scan.applyBlocked`). */
  ok: boolean;
  errors: SeedIssue[];
  warnings: SeedIssue[];
  /** sha256 del seed in JSON stabile: `settings.seed.hash`, chiave dell'idempotenza. */
  seedHash: string;
  template: { key: string; version: string };
  workspace: { search: WorkspaceSearch };
  case: {
    code: string;
    title: string;
    one_liner: string | null;
    status: CaseSeed["case"]["status"];
    perimeter_label: string | null;
    client_owner_role_label: string | null;
    contract_refs: string[];
    data_controller_label: null;
    description: { [key: string]: Json };
    settings: { role_labels: Record<string, string>; seed: { hash: string; scan_report_sha256: string | null } };
  };
  items: SeedItemPlan[];
  answers: SeedAnswerPlan[];
  /** Solo con `includePersonalValues`: valori da cifrare in `value_encrypted`, mai in chiaro. */
  personalAnswers: SeedPersonalAnswerPlan[];
  omitted: SeedOmission[];
  maps: SeedMapPlan[];
  roi: SeedRoiPlan;
  milestones: SeedMilestonePlan[];
  blockers: { key: string; status: "attivo" | "permanente" }[];
  scan: {
    report: SeedScanReport;
    sha256: string;
    accepted: boolean;
    /** Valori non salvati per la scansione (0 con il report approvato). */
    valuesHeld: number;
    /** Testi di sovrapposizione con esito sanitario o discriminatorio. */
    textsHeld: number;
    /** Testi trattenuti e report non approvato: l'apply si ferma. */
    applyBlocked: boolean;
  };
  redactions: number;
  counts: SeedPlanCounts;
  /** Eventi aggregati da scrivere (payload con soli conteggi, codici e impronte). */
  events: { type: SeedEventType; payload: { [key: string]: Json } }[];
}

// ── Costanti ──────────────────────────────────────────────────────────

/** Categorie della scansione che trattengono un valore o fermano l'apply finché il report non è approvato. */
export const SEED_HOLD_CATEGORIES: ReadonlySet<string> = new Set(["sanitario", "discriminatorio"]);

/** Tipi base per cui un valore in prosa resta confermabile così com'è (guardia 10, §3.3). */
export const PROSE_CONFIRMABLE_TYPES: ReadonlySet<ResponseType> = new Set(["testo", "conferma_regola", "conferma_formula", "file", "tabella"]);

export const SEED_REASONS = {
  mancante_dichiarato: "Dichiarato in call: oggi non disponibile (vedi valore già dichiarato)",
  mancante_senza_valore: "Dichiarato in call: oggi non disponibile",
  valore_omesso: "Valore omesso: da richiedere",
  valore_personale: "Valore già dichiarato: si carica dopo l'approvazione della scheda A.8",
  valore_bloccato: "Valore già dichiarato: si carica quando il blocco si scioglie",
} as const;

export const SEED_MAP_TITLES = {
  processo_as_is: "Processo di oggi",
  processo_to_be: "Processo con l'agente",
  esempio: "Esempio completo",
} as const;

const PERSONAL = new Set<PrivacyClass>(PERSONAL_PRIVACY_CLASSES);
const TITLE_MAX = 255;
/** Chiavi di voce citate nei testi (`kpi.area.nome`, `q.modulo.01`, …). */
const ITEM_KEY_IN_TEXT = /\b(?:[a-z][a-z0-9_]*\.)+[a-z0-9_]+\b/g;
/** Stringhe che sono codici o chiavi, non prosa: niente redazione né scansione. */
const CODE_LIKE = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;

function emptyStates(): SeedStateCounts {
  return Object.fromEntries(SEED_INITIAL_STATES.map((s) => [s, 0])) as SeedStateCounts;
}

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// ── Redazione e scansione ─────────────────────────────────────────────

class TextPipeline {
  redactions = 0;
  private readonly entries = new Map<string, SeedScanEntry>();
  private readonly holding = new Set<string>();
  private readonly opts: PlanSeedOptions;

  constructor(opts: PlanSeedOptions) {
    this.opts = opts;
  }

  /** Redige e scansiona un testo da salvare. Restituisce il testo redatto. */
  text(value: string, kind: SeedScanEntry["kind"], ref: string, healthRuleQuestion?: { questionText: string }): string {
    if (kind === "testo" && CODE_LIKE.test(value)) return value;
    const redacted = this.opts.redact(value, this.opts.names);
    this.redactions += redacted.count;
    const result = this.opts.scan(redacted.text, healthRuleQuestion ? { context: "seed", healthRuleQuestion } : { context: "seed" });
    for (const [esito, list] of [
      ["blocca", result.blocking],
      ["avviso", result.warnings],
    ] as const) {
      for (const f of list) {
        const categoria = /^[a-z_]{1,40}$/.test(f.category) ? f.category : "altro";
        const trattiene = esito === "blocca" && SEED_HOLD_CATEGORIES.has(categoria);
        const id = `${kind}\u0000${ref}\u0000${categoria}\u0000${esito}`;
        const prev = this.entries.get(id);
        if (prev) prev.count += 1;
        else this.entries.set(id, { kind, ref, categoria, esito, trattiene, count: 1 });
        if (trattiene) this.holding.add(`${kind}\u0000${ref}`);
      }
    }
    return redacted.text;
  }

  /** Copia con ogni stringa redatta e scansionata; `ref` di ogni stringa = il suo percorso. */
  json<T>(value: T, path: string): T {
    if (typeof value === "string") return this.text(value, "testo", path) as T;
    if (Array.isArray(value)) return value.map((v, i) => this.json(v, `${path}[${i}]`)) as T;
    if (value !== null && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) out[k] = this.json(v, `${path}.${k}`);
      return out as T;
    }
    return value;
  }

  holds(kind: SeedScanEntry["kind"], ref: string): boolean {
    return this.holding.has(`${kind}\u0000${ref}`);
  }

  heldTexts(): number {
    return [...this.holding].filter((h) => h.startsWith("testo\u0000")).length;
  }

  report(seedHash: string): SeedScanReport {
    const entries = [...this.entries.values()].sort(
      (a, b) => byText(a.kind, b.kind) || byText(a.ref, b.ref) || byText(a.categoria, b.categoria) || byText(a.esito, b.esito),
    );
    return { schema: "unbundle.uc-seed-scan/1", seed_hash: seedHash, redactions: this.redactions, entries };
  }
}

// ── Aiuti ─────────────────────────────────────────────────────────────

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function nonEmpty(value: string | null | undefined): string | null {
  return value && value.trim() ? value.trim() : null;
}

/** «Nuove capacità» → `nuove_capacita`, se è una delle 8 leve. */
export function leverKey(label: string): Lever | null {
  const k = label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  return isVocab(LEVERS, k) ? k : null;
}

/** Tipo della riga di costo dal testo del seed («una tantum …», «ricorrente …», «escluse …»). */
export function costKind(tipo: string): SeedCostLine["kind"] {
  const t = tipo.trim().toLowerCase();
  if (t.startsWith("una tantum")) return "una_tantum";
  if (t.startsWith("ricorrent")) return "ricorrente";
  if (t.startsWith("esclus")) return "escluso";
  return null;
}

/** Un valore in prosa su questo tipo va ritipizzato (niente «Confermo»)? */
export function needsRetyping(type: ResponseType | null | undefined): boolean {
  return type !== null && type !== undefined && !PROSE_CONFIRMABLE_TYPES.has(type);
}

function unique(values: Iterable<string>): string[] {
  return [...new Set(values)];
}

function keysInText(texts: readonly string[], known: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const t of texts) for (const m of t.matchAll(ITEM_KEY_IN_TEXT)) if (known.has(m[0])) out.push(m[0]);
  return unique(out);
}

function splitRefs(refs: readonly string[], known: ReadonlySet<string>): { items: string[]; unresolved: string[] } {
  const items: string[] = [];
  const unresolved: string[] = [];
  for (const r of unique(refs)) (known.has(r) ? items : unresolved).push(r);
  return { items, unresolved };
}

/**
 * Blocchi che il template impone alla voce, con la stessa regola della
 * creazione del caso (`blockerKeysForItem` di `blockers.ts`): `blocked_by`, più
 * lo scope dei blocchi del template (classe, un qualsiasi token di
 * disponibilità come `dopo_a8`, perimetro come `evoluzione`), più lo scope
 * minimo di `a8` e `sanitario`, che valgono anche se il template non li
 * dichiara. Il seed non apre un lucchetto che la creazione del caso chiude (§8.1).
 */
export function templateLocks(
  item: Pick<SeedTemplateItem, "privacy_class" | "blocked_by" | "availability" | "perimeter"> & { kind?: string },
  blockers: readonly SeedTemplateBlocker[] = [],
): string[] {
  const defs: BlockerDef[] = ensureMandatoryBlockers(
    blockers.map((b) => ({ key: b.key, label: b.label, scope: parseBlockerScope(b.scope), permanent: b.permanent === true })),
  );
  const explicit = item.blocked_by ?? [];
  const keys = new Set([
    ...explicit,
    ...blockerKeysForItem(
      {
        kind: isVocab(ITEM_KINDS, item.kind) ? item.kind : "domanda",
        privacyClass: item.privacy_class,
        availability: item.availability ?? [],
        perimeter: item.perimeter ?? null,
        explicitBlockedBy: explicit,
      },
      defs,
    ),
  ]);
  return [...keys].sort(byText);
}

function sequentialEdges(ids: readonly string[]): SeedMapPlan["graph"]["edges"] {
  return ids.slice(1).map((to, i) => ({ from: ids[i], to, label: null }));
}

// ── Piano ─────────────────────────────────────────────────────────────

interface QuestionDraft {
  key: string;
  state: SeedInitialState;
  privacy: PrivacyClass;
  locked: boolean;
  responseType: ResponseType | null;
  /** Valore già redatto e scansionato, con la sua fonte. */
  value: { text: string; sourceRef: string } | null;
}

/**
 * Costruisce il piano completo del seed. Non lancia: i problemi stanno in
 * `errors` (lo script si ferma) e `warnings` (lo script li stampa).
 */
export function planSeed(seed: CaseSeed, template: SeedTemplate, opts: PlanSeedOptions): SeedPlan {
  const errors: SeedIssue[] = [];
  const warnings: SeedIssue[] = [];
  const seedHash = sha256Hex(stableStringify(seed));
  const pipe = new TextPipeline(opts);

  if (seed.template.key !== template.key || seed.template.version !== template.version) {
    errors.push({
      code: "template_diverso",
      message: `Il seed vuole il template ${seed.template.key}@${seed.template.version}, non ${template.key}@${template.version}.`,
    });
  }
  const byKey = new Map(template.items.map((i) => [i.key, i]));
  const knownKeys: ReadonlySet<string> = new Set(byKey.keys());

  // ── 1. Domande: lucchetti, valori redatti e scansionati ──
  const drafts: QuestionDraft[] = [];
  for (const a of seed.answers) {
    const item = byKey.get(a.item_key);
    if (!item) {
      errors.push({ code: "voce_assente", key: a.item_key, message: `La domanda ${a.item_key} non esiste nel template.` });
      continue;
    }
    if (item.kind !== "domanda") {
      errors.push({ code: "non_domanda", key: a.item_key, message: `La voce ${a.item_key} non è una domanda.` });
      continue;
    }
    const locks = templateLocks(item, template.blockers ?? []);
    if (locks.length > 0 && a.initial_state !== "bloccata") {
      errors.push({ code: "lucchetto_aperto", key: a.item_key, message: `La domanda ${a.item_key} è bloccata dal template: il seed non può darle lo stato «${a.initial_state}».` });
    }
    if (a.initial_state === "bloccata" && locks.length === 0) {
      errors.push({ code: "blocco_senza_motivo", key: a.item_key, message: `La domanda ${a.item_key} è «bloccata» nel seed ma nessun blocco del template la riguarda.` });
    }
    const extra = unique(a.blocked_by).filter((k) => !locks.includes(k));
    if (extra.length > 0) {
      errors.push({ code: "blocco_non_previsto", key: a.item_key, message: `Il seed blocca ${a.item_key} con ${extra.join(", ")}, che il template non prevede per questa voce.` });
    }
    const raw = nonEmpty(a.known_value);
    const healthRule = item.spec?.health_rule_question === true ? { questionText: item.title } : undefined;
    drafts.push({
      key: a.item_key,
      state: a.initial_state,
      privacy: item.privacy_class,
      locked: locks.length > 0 || a.initial_state === "bloccata",
      responseType: item.response?.type ?? null,
      value: raw === null ? null : { text: pipe.text(raw, "valore", a.item_key, healthRule), sourceRef: sourceRefLabel(extractSourceRefs(raw)) },
    });
  }
  const seeded = new Set(seed.answers.map((a) => a.item_key));
  const unseeded = template.items.filter((i) => i.kind === "domanda" && i.request_module && !seeded.has(i.key));
  if (unseeded.length > 0) {
    warnings.push({
      code: "domande_senza_stato",
      key: unseeded[0].key,
      message: `${unseeded.length} domande del template non sono nel seed: restano nello stato di creazione.`,
    });
  }

  // ── 2. Testi di sovrapposizione, redatti e scansionati ──
  const caseTexts = {
    title: pipe.text(seed.case.title, "testo", "case.title"),
    one_liner: seed.case.one_liner === null ? null : pipe.text(seed.case.one_liner, "testo", "case.one_liner"),
    perimeter_label: seed.case.perimeter_label === null ? null : pipe.text(seed.case.perimeter_label, "testo", "case.perimeter_label"),
    owner_role_label:
      seed.case.owner_role_label === null ? null : nonEmpty(pipe.text(stripParenthetical(seed.case.owner_role_label), "testo", "case.owner_role_label")),
  };
  const description = pipe.json(seed.description, "description");
  const solution = pipe.json(seed.map, "map");
  const process = pipe.json(seed.process, "process");
  const roi = pipe.json(seed.roi, "roi");
  const milestones = pipe.json(seed.milestones, "milestones");
  const roleLabels: Record<string, string> = {};
  const templateRoles = template.roles ? new Set(template.roles.map((r) => r.key)) : null;
  seed.contacts_roles.forEach((r, i) => {
    const key = opts.roleAliases?.[r.template_role_key] ?? r.template_role_key;
    if (templateRoles && !templateRoles.has(key)) {
      warnings.push({ code: "ruolo_sconosciuto", key, path: `contacts_roles[${i}]`, message: `Il ruolo ${key} non è tra i ruoli del template: manca l'alias in role-aliases.json?` });
    }
    roleLabels[key] = pipe.text(r.role_label, "testo", `contacts_roles[${i}].role_label`);
  });

  // ── 3. Report di scansione ──
  const report = pipe.report(seedHash);
  const reportSha = sha256Hex(stableStringify(report));
  const acceptScan = opts.acceptScan?.trim().toLowerCase() || null;
  const accepted = acceptScan !== null && acceptScan === reportSha;
  if (acceptScan !== null && !accepted) {
    errors.push({ code: "report_diverso", message: "Il report di scansione approvato non è quello attuale: rileggi il dry run e approva il nuovo sha256." });
  }
  const textsHeld = pipe.heldTexts();

  // ── 4. Stati e risposte ──
  const items: SeedItemPlan[] = [];
  const answers: SeedAnswerPlan[] = [];
  const personalAnswers: SeedPersonalAnswerPlan[] = [];
  const omitted: SeedOmission[] = [];
  const byState = emptyStates();
  const byArea: Record<string, SeedStateCounts> = {};
  const answersByState = emptyStates();
  const retypingByState = emptyStates();
  let knownValues = 0;
  let valuesHeld = 0;

  for (const d of drafts) {
    byState[d.state] += 1;
    (byArea[d.key.split(".")[1] ?? ""] ??= emptyStates())[d.state] += 1;
    let reason: string | null = d.state === "mancante" ? SEED_REASONS.mancante_senza_valore : null;
    if (d.value) {
      knownValues += 1;
      const base = {
        item_key: d.key,
        version: 1 as const,
        kind: "valore" as const,
        value: { text: d.value.text },
        value_normalized: null,
        source_kind: "dichiarato_in_call" as const,
        source_ref: d.value.sourceRef,
        confidence: "da_verificare" as const,
        responder_user_id: null,
      };
      const held = pipe.holds("valore", d.key) && !accepted;
      if (d.privacy === HEALTH_PRIVACY_CLASS) {
        omitted.push({ item_key: d.key, categoria: "sanitario_classe" });
        if (d.state !== "bloccata") reason = SEED_REASONS.valore_omesso;
      } else if (PERSONAL.has(d.privacy)) {
        if (opts.includePersonalValues && !held) personalAnswers.push({ ...base, encrypt: true });
        else omitted.push({ item_key: d.key, categoria: "personale" });
        reason = SEED_REASONS.valore_personale;
      } else if (d.locked) {
        omitted.push({ item_key: d.key, categoria: "bloccata" });
        reason = SEED_REASONS.valore_bloccato;
      } else if (held) {
        valuesHeld += 1;
        const categories = report.entries.filter((e) => e.kind === "valore" && e.ref === d.key && e.trattiene).map((e) => e.categoria);
        omitted.push({ item_key: d.key, categoria: categories[0] ?? "scansione" });
        reason = SEED_REASONS.valore_omesso;
      } else {
        const retype = needsRetyping(d.responseType);
        answers.push({ ...base, needs_retyping: retype });
        answersByState[d.state] += 1;
        if (retype) retypingByState[d.state] += 1;
        if (d.state === "mancante") reason = SEED_REASONS.mancante_dichiarato;
      }
    }
    items.push({ key: d.key, status: d.state, status_reason: reason });
  }

  // ── 5. Mappe ──
  const maps = buildMaps({ solution, process, raw: seed, template, knownKeys, errors, warnings });

  // ── 6. ROI ──
  const costLines: SeedCostLine[] = roi.costi.map((c, i) => {
    const kind = costKind(c.tipo);
    if (!kind) warnings.push({ code: "tipo_costo", path: `roi.costi[${i}].tipo`, message: `Riga di costo ${i + 1}: tipo non riconosciuto (una tantum, ricorrente o escluso).` });
    return {
      key: `costo_${String(i + 1).padStart(2, "0")}`,
      label: c.voce,
      kind,
      tipo_testo: c.tipo,
      how_estimated: c.come_si_stima,
      value: null,
      status: "da_raccogliere",
      source: c.fonte,
      authorized_art_8_4: null,
    };
  });
  const usedLevers = new Set<string>();
  const benefitLines: SeedBenefitLine[] = roi.leve.map((l, i) => {
    const lever = leverKey(l.leva);
    if (!lever) warnings.push({ code: "leva_sconosciuta", path: `roi.leve[${i}].leva`, message: `Leva ${i + 1}: non è una delle 8 leve.` });
    const refs = splitRefs(l.kpi, knownKeys);
    if (refs.unresolved.length > 0) {
      warnings.push({ code: "kpi_assente", path: `roi.leve[${i}].kpi`, message: `Leva ${i + 1}: ${refs.unresolved.length} KPI non esistono nel template.` });
    }
    const base = lever ?? `leva_${String(i + 1).padStart(2, "0")}`;
    const key = usedLevers.has(base) ? `${base}_${i + 1}` : base;
    usedLevers.add(key);
    return {
      key,
      lever,
      lever_label: l.leva,
      formula: l.formula,
      inputs: refs.items,
      unresolved_refs: refs.unresolved,
      value: null,
      status: "da_raccogliere",
      source: "seed",
      how_to_euro: l.come_diventa_euro,
      data_needed: l.dati_necessari,
      example: l.esempio_illustrativo,
    };
  });
  const roiPlan: SeedRoiPlan = {
    version: 1,
    status: "stima",
    scenario: "base",
    currency: "EUR",
    horizon_years: 5,
    includes_human_review_time: true,
    cost_lines: costLines,
    benefit_lines: benefitLines,
    content: { spiegazione: roi.spiegazione, formula_roi: roi.formula_roi, esempio: roi.esempio, cosa_serve: roi.cosa_serve },
  };

  // ── 7. Milestone, blocchi, caso ──
  const milestonePlans: SeedMilestonePlan[] = milestones.map((m, i) => ({
    key: m.key,
    title: clip(m.title, TITLE_MAX),
    planned_label: m.planned_label,
    is_proposal: m.is_proposal,
    to_confirm: /da confermare/i.test(m.planned_label ?? ""),
    notes: m.notes,
    sort_order: i,
  }));

  const templateBlockers = template.blockers ? new Set(template.blockers.map((b) => b.key)) : null;
  const blockers = seed.blockers.map((b) => {
    if (templateBlockers && !templateBlockers.has(b.key)) {
      errors.push({ code: "blocco_assente", key: b.key, message: `Il blocco ${b.key} non esiste nel template.` });
    }
    return { key: b.key, status: b.status === "permanente" ? ("permanente" as const) : ("attivo" as const) };
  });
  const declaredLocks = new Set(seed.answers.flatMap((a) => a.blocked_by));
  for (const key of declaredLocks) {
    if (!blockers.some((b) => b.key === key)) {
      errors.push({ code: "blocco_non_dichiarato", key, message: `Il seed blocca alcune domande con ${key}, ma non elenca quel blocco tra i blocchi aperti.` });
    }
  }

  const contractRefs = unique([...extractContractRefs(seed.description.perimetro.caso_commerciale), ...(opts.extraContractRefs ?? []).map((r) => r.trim()).filter(Boolean)]);
  for (const r of contractRefs) if (r.length > 120) errors.push({ code: "riferimento_lungo", message: "Un riferimento di contratto supera 120 caratteri." });

  const caseTitle = clip(caseTexts.title, TITLE_MAX);
  if (caseTitle !== caseTexts.title) warnings.push({ code: "titolo_tagliato", path: "case.title", message: "Il titolo del caso, dopo la redazione, supera 255 caratteri ed è stato accorciato." });

  // ── 8. Conteggi ed eventi ──
  const omittedCounts: Record<string, number> = {};
  for (const o of omitted) omittedCounts[o.categoria] = (omittedCounts[o.categoria] ?? 0) + 1;
  const sum = (c: SeedStateCounts) => SEED_INITIAL_STATES.reduce((n, s) => n + c[s], 0);
  const counts: SeedPlanCounts = {
    questions: items.length,
    by_state: byState,
    by_area: Object.fromEntries(Object.entries(byArea).sort(([a], [b]) => byText(a, b))),
    known_values: knownValues,
    answers: { total: answers.length, by_state: answersByState },
    retyping: { total: sum(retypingByState), by_state: retypingByState },
    omitted: omittedCounts,
    personal_answers: personalAnswers.length,
    maps: Object.fromEntries(maps.map((m) => [m.kind, { nodes: m.graph.nodes.length, edges: m.graph.edges.length }])) as SeedPlanCounts["maps"],
    roi: { costs: costLines.length, benefits: benefitLines.length },
    milestones: {
      total: milestonePlans.length,
      proposals: milestonePlans.filter((m) => m.is_proposal).length,
      to_confirm: milestonePlans.filter((m) => m.to_confirm).length,
    },
    blockers: { attivo: blockers.filter((b) => b.status === "attivo").length, permanente: blockers.filter((b) => b.status === "permanente").length },
    contract_refs: contractRefs.length,
  };

  const events: SeedPlan["events"] = [{ type: "voce.stato_importato", payload: { count: items.length, counts: { ...byState } } }];
  for (const [categoria, count] of Object.entries(omittedCounts).sort(([a], [b]) => byText(a, b))) {
    events.push({ type: "seed.valore_omesso", payload: { count, categoria } });
  }
  events.push({
    type: "seed.applicato",
    payload: { hash: seedHash, ...(accepted ? { scan_report_sha256: reportSha } : {}), counts: { ...byState }, answers: answers.length + personalAnswers.length },
  });

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    seedHash,
    template: { ...seed.template },
    workspace: { search: workspaceSearch(seed.workspace_hint) },
    case: {
      code: seed.case.code,
      title: caseTitle,
      one_liner: caseTexts.one_liner === null ? null : clip(caseTexts.one_liner, 500),
      status: seed.case.status,
      perimeter_label: caseTexts.perimeter_label === null ? null : clip(caseTexts.perimeter_label, TITLE_MAX),
      client_owner_role_label: caseTexts.owner_role_label === null ? null : clip(caseTexts.owner_role_label, TITLE_MAX),
      contract_refs: contractRefs,
      data_controller_label: null,
      description: {
        version: 1,
        ...(description as unknown as { [key: string]: Json }),
        // Blocchi della specifica non presenti nel seed (§5.1, D17).
        uso_previsto: null,
        decisioni: [],
        riferimenti: contractRefs,
      },
      settings: { role_labels: roleLabels, seed: { hash: seedHash, scan_report_sha256: accepted ? reportSha : null } },
    },
    items,
    answers,
    personalAnswers,
    omitted,
    maps,
    roi: roiPlan,
    milestones: milestonePlans,
    blockers,
    scan: { report, sha256: reportSha, accepted, valuesHeld, textsHeld, applyBlocked: textsHeld > 0 && !accepted },
    redactions: pipe.redactions,
    counts,
    events,
  };
}

// ── Mappe ─────────────────────────────────────────────────────────────

function buildMaps(i: {
  /** Testi redatti, da salvare. */
  solution: CaseSeed["map"];
  process: CaseSeed["process"];
  /** Seed originale: le chiavi delle voci citate si cercano qui, prima che la redazione tocchi i testi. */
  raw: CaseSeed;
  template: SeedTemplate;
  knownKeys: ReadonlySet<string>;
  errors: SeedIssue[];
  warnings: SeedIssue[];
}): SeedMapPlan[] {
  const { solution, process, raw, template, knownKeys, errors, warnings } = i;
  const templateNodes = new Map((template.map?.nodes ?? []).map((n) => [n.id, n]));

  const solutionNodes: SeedGraphNode[] = solution.blocchi.map((b: SeedMapBlock, idx) => {
    const fromTemplate = templateNodes.get(b.id)?.items;
    const source = raw.map.blocchi[idx];
    const derived = fromTemplate ? fromTemplate.filter((k) => knownKeys.has(k)) : keysInText([source.descrizione, ...source.input, ...source.output], knownKeys);
    const kpi = splitRefs(b.kpi, knownKeys);
    return {
      id: b.id,
      label: b.titolo,
      description: b.descrizione,
      input: b.input,
      output: b.output,
      items: unique([...derived, ...kpi.items]),
      unresolved_refs: kpi.unresolved,
      chi: b.chi,
      perimetro: b.perimetro,
      priorita: b.priorita,
      disponibilita: b.disponibilita,
      leve: b.leve,
      serve_per: b.serve_per,
      privacy: b.privacy,
      kpi: b.kpi,
      documenti_cliente: b.documenti_cliente as unknown as Json,
    };
  });
  const nodeIds = new Set(solutionNodes.map((n) => n.id));
  const solutionEdges = solution.flussi.map((f, idx) => {
    if (!nodeIds.has(f.da) || !nodeIds.has(f.a)) {
      errors.push({ code: "arco_senza_nodo", path: `map.flussi[${idx}]`, message: `Il flusso ${idx + 1} collega un blocco che non esiste.` });
    }
    return { from: f.da, to: f.a, label: f.etichetta || null };
  });
  if (template.map) {
    const same = templateNodes.size === nodeIds.size && [...nodeIds].every((id) => templateNodes.has(id));
    if (!same) warnings.push({ code: "mappa_diversa", path: "map.blocchi", message: "I blocchi della mappa del seed non coincidono con i nodi della mappa del template." });
  }

  const steps = (list: readonly SeedProcessStep[], path: string): SeedMapPlan["graph"] => {
    const seen = new Set<string>();
    const nodes: SeedGraphNode[] = list.map((s, idx) => {
      if (seen.has(s.id)) errors.push({ code: "passo_doppio", path: `${path}[${idx}].id`, message: `Il passo ${s.id} compare due volte.` });
      seen.add(s.id);
      const refs = splitRefs(s.dati, knownKeys);
      const { id, nome, input, output, dati, ...rest } = s;
      return {
        ...(rest as unknown as { [key: string]: Json }),
        id,
        label: nome,
        description: null,
        input,
        output,
        dati,
        items: refs.items,
        unresolved_refs: refs.unresolved,
      };
    });
    return { nodes, edges: sequentialEdges(nodes.map((n) => n.id)) };
  };

  const exampleNodes: SeedGraphNode[] = process.esempio_end_to_end.passi.map((text, idx) => ({
    id: `passo_${String(idx + 1).padStart(2, "0")}`,
    label: text,
    description: null,
    input: [],
    output: [],
    items: keysInText([raw.process.esempio_end_to_end.passi[idx]], knownKeys),
    unresolved_refs: [],
  }));

  return [
    { kind: "soluzione", title: clip(solution.titolo, TITLE_MAX), source: "import", graph: { nodes: solutionNodes, edges: solutionEdges } },
    { kind: "processo_to_be", title: SEED_MAP_TITLES.processo_to_be, source: "import", graph: steps(process.to_be, "process.to_be") },
    { kind: "processo_as_is", title: SEED_MAP_TITLES.processo_as_is, source: "import", graph: steps(process.as_is, "process.as_is") },
    {
      kind: "esempio",
      title: clip(process.esempio_end_to_end.titolo || SEED_MAP_TITLES.esempio, TITLE_MAX),
      source: "import",
      graph: { nodes: exampleNodes, edges: sequentialEdges(exampleNodes.map((n) => n.id)) },
    },
  ];
}
