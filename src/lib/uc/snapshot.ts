/**
 * Fotografia del catalogo di un caso (`unbundle.uc-catalog/1`, PIANO §5.10).
 *
 * - `buildCatalogSnapshot`: costruisce la fotografia congelata (versione N) o la
 *   bozza (`version: "bozza"`, solo per l'export dei ruoli Lateral Space).
 *   I valori personali non entrano mai; nella versione congelata entra solo il
 *   valore **validato**.
 * - `snapshotHash`: sha256 di `stableStringify` (chiavi ordinate).
 * - `diffSnapshots`: voci aggiunte, tolte e cambiate (con i campi).
 * - `validatedItems` / `excludedItems`: la vista «solo verdi o blu» di una
 *   versione congelata (validata, oppure non applicabile con le due firme).
 * - `snapshotForViewer`: toglie i valori che il ruolo non può vedere
 *   (`value_visibility`).
 *
 * Modulo puro: import relativi `.ts`, solo `node:crypto` per l'impronta.
 */
import { createHash } from "node:crypto";
import type { Fallback, Json, Result, Waiver } from "./types.ts";
import { fail, ok } from "./types.ts";
import {
  HEALTH_PRIVACY_CLASS,
  ITEM_STATUSES,
  LS_CASE_ROLES,
  PERSONAL_PRIVACY_CLASSES,
  type AnswerKind,
  type CaseRole,
  type Confidence,
  type GateDecision,
  type GateKey,
  type GatePolicyScope,
  type ItemKind,
  type ItemSection,
  type ItemStatus,
  type Lever,
  type LinkRelation,
  type Perimeter,
  type Phase,
  type Priority,
  type PrivacyClass,
  type ResponseType,
  type SourceBasis,
  type SourceKind,
  type ValueVisibility,
} from "./vocab.ts";

export const CATALOG_SNAPSHOT_SCHEMA = "unbundle.uc-catalog/1" as const;

/** Perché un valore non compare nella fotografia o in una vista. */
export type ValueHiddenReason = "personale" | "visibilita" | "ambiente_non_approvato";

// ── JSON stabile e impronta ───────────────────────────────────────────

function canonical(value: unknown, seen: Set<object>): unknown {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) return null;
    if (typeof value === "bigint") return value.toString();
    return value;
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (seen.has(value)) throw new Error("Struttura circolare: non si può fotografare");
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((v) => (v === undefined || typeof v === "function" ? null : canonical(v, seen)));
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v === undefined || typeof v === "function" || typeof v === "symbol") continue;
      out[key] = canonical(v, seen);
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

/** JSON con le chiavi ordinate a ogni livello (come `stable()` del server MCP del portafoglio). */
export function stableStringify(value: unknown): string {
  return JSON.stringify(canonical(value, new Set())) ?? "null";
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function snapshotHash(snapshot: CatalogSnapshot): string {
  return sha256Hex(stableStringify(snapshot));
}

// ── Forma della fotografia ────────────────────────────────────────────

export interface SnapshotAnswer {
  version: number;
  kind: AnswerKind;
  source_kind: SourceKind;
  source_ref: string | null;
  source_basis: SourceBasis | null;
  confidence: Confidence | null;
  valid_from: string | null;
  valid_to: string | null;
  text_hash: string | null;
  answered_at: string;
  /** Nella bozza una risposta non ancora validata ha `validated: false` («non validata»). */
  validated: boolean;
  value: Json | null;
  value_normalized: Json | null;
  value_hidden?: ValueHiddenReason;
}

export interface SnapshotItem {
  key: string;
  kind: ItemKind;
  section: ItemSection;
  parent_key: string | null;
  title: string;
  explanation: string | null;
  why: string | null;
  example: string | null;
  help: string | null;
  spec: { [key: string]: Json };
  priority: Priority | null;
  serves_for: Phase[];
  privacy_class: PrivacyClass;
  value_visibility: ValueVisibility;
  availability: string[];
  perimeter: Perimeter | null;
  levers: Lever[];
  response_type: ResponseType | null;
  unit: string | null;
  request_module_key: string | null;
  owner_role_key: string | null;
  in_gate_scope: boolean;
  status: ItemStatus;
  status_reason: string | null;
  stale_at: string | null;
  validated_at: string | null;
  answer: SnapshotAnswer | null;
  na: { reason: string | null; approved_at: string } | null;
  waiver: { motivo: string; piano: string; scadenza: string; approved_at: string } | null;
  fallback: { descrizione: string; valido_per: GateKey[]; da_sostituire_entro: string | null; approved_at: string } | null;
  source_refs: Json[];
}

export interface SnapshotLink {
  from: string;
  to: string;
  relation: LinkRelation;
  cardinality: string | null;
  note: string | null;
}

export interface SnapshotGate {
  key: GateKey;
  review_id: string | null;
  decision: GateDecision | null;
  policy_scope: GatePolicyScope | null;
  required: number;
  ok: number;
  summary_text_hash: string | null;
  /** Chiavi delle voci a posto per deroga. */
  waiver_keys: string[];
}

export interface CatalogSnapshot {
  schema: typeof CATALOG_SNAPSHOT_SCHEMA;
  case: {
    id: string;
    workspace_id: string;
    code: string;
    title: string;
    perimeter_label: string | null;
    contract_refs: string[];
    data_controller_label: string | null;
  };
  template: { key: string; version: string; hash: string };
  /** Numero della versione congelata, oppure `"bozza"` (mai congelata, mai per MCP). */
  version: number | "bozza";
  frozen_at: string | null;
  gate: SnapshotGate | null;
  counts: { total: number; by_status: Record<ItemStatus, number> };
  items: SnapshotItem[];
  links: SnapshotLink[];
}

// ── Ingressi ──────────────────────────────────────────────────────────

type DateLike = Date | string | null;

export interface SnapshotAnswerInput {
  version: number;
  kind: AnswerKind;
  value: Json | null;
  valueNormalized: Json | null;
  sourceKind: SourceKind;
  sourceRef: string | null;
  sourceBasis: SourceBasis | null;
  confidence: Confidence | null;
  validFrom: string | null;
  validTo: string | null;
  textHash: string | null;
  createdAt: Date | string;
  /** Una risposta cancellata per privacy non porta valori. */
  erasedAt?: DateLike;
}

export interface SnapshotItemInput {
  key: string;
  kind: ItemKind;
  section: ItemSection;
  parentKey: string | null;
  title: string;
  explanation: string | null;
  why: string | null;
  example: string | null;
  help: string | null;
  spec: { [key: string]: Json } | null;
  priority: Priority | null;
  servesFor: Phase[];
  privacyClass: PrivacyClass;
  valueVisibility: ValueVisibility;
  availability: string[];
  perimeter: Perimeter | null;
  levers: Lever[];
  responseType: ResponseType | null;
  responseConfig: { [key: string]: Json } | null;
  requestModuleKey: string | null;
  ownerRoleKey: string | null;
  inGateScope: boolean;
  status: ItemStatus;
  statusReason: string | null;
  staleAt: DateLike;
  validatedAt: DateLike;
  naReason: string | null;
  naApprovedAt: DateLike;
  waiver: Waiver | null;
  waiverApprovedAt: DateLike;
  fallback: Fallback | null;
  fallbackApprovedAt: DateLike;
  sourceRefs: Json[] | null;
  /** Risposta validata (`validated_answer_id`). */
  validatedAnswer: SnapshotAnswerInput | null;
  /** Risposta corrente (`current_answer_id`): entra solo nella bozza. */
  currentAnswer: SnapshotAnswerInput | null;
  deletedAt?: DateLike;
}

export interface SnapshotLinkInput {
  fromKey: string;
  toKey: string;
  relation: LinkRelation;
  cardinality: string | null;
  note: string | null;
}

export interface SnapshotGateInput {
  key: GateKey;
  reviewId: string | null;
  decision: GateDecision | null;
  policyScope: GatePolicyScope | null;
  required: number;
  ok: number;
  summaryTextHash: string | null;
  waiverKeys: string[];
}

export interface BuildSnapshotInput {
  case: {
    id: string;
    workspaceId: string;
    code: string;
    title: string;
    perimeterLabel: string | null;
    contractRefs: string[];
    dataControllerLabel: string | null;
  };
  template: { key: string; version: string; hash: string };
  version: number | "bozza";
  /** Obbligatorio per una versione congelata. */
  frozenAt: Date | null;
  gate: SnapshotGateInput | null;
  items: readonly SnapshotItemInput[];
  links: readonly SnapshotLinkInput[];
}

// ── Regole sui valori ─────────────────────────────────────────────────

const PERSONAL = new Set<PrivacyClass>([...PERSONAL_PRIVACY_CLASSES, HEALTH_PRIVACY_CLASS]);

/** Classi i cui valori non entrano mai in una fotografia, un export o l'MCP. */
export function isPersonalClass(privacyClass: PrivacyClass): boolean {
  return PERSONAL.has(privacyClass);
}

function iso(value: DateLike | undefined): string | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function unitOf(item: SnapshotItemInput): string | null {
  for (const source of [item.responseConfig, item.spec]) {
    if (!source) continue;
    for (const k of ["unit", "unita"]) {
      const v = source[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return null;
}

function answerFrom(input: SnapshotAnswerInput, item: SnapshotItemInput, validated: boolean): SnapshotAnswer {
  const answer: SnapshotAnswer = {
    version: input.version,
    kind: input.kind,
    source_kind: input.sourceKind,
    source_ref: input.sourceRef,
    source_basis: input.sourceBasis,
    confidence: input.confidence,
    valid_from: input.validFrom,
    valid_to: input.validTo,
    text_hash: input.textHash,
    answered_at: iso(input.createdAt) ?? "",
    validated,
    value: input.value ?? null,
    value_normalized: input.valueNormalized ?? null,
  };
  if (isPersonalClass(item.privacyClass)) {
    answer.value = null;
    answer.value_normalized = null;
    answer.value_hidden = "personale";
  } else if (input.erasedAt) {
    answer.value = null;
    answer.value_normalized = null;
  }
  return answer;
}

function emptyCounts(): Record<ItemStatus, number> {
  return Object.fromEntries(ITEM_STATUSES.map((s) => [s, 0])) as Record<ItemStatus, number>;
}

const byKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Costruisce la fotografia. Nella versione congelata entra solo il valore
 * validato delle voci `validata`; nella bozza anche la risposta corrente, con
 * `validated: false`. I valori personali non entrano mai.
 */
export function buildCatalogSnapshot(input: BuildSnapshotInput): Result<CatalogSnapshot> {
  const draft = input.version === "bozza";
  if (!draft && (!Number.isInteger(input.version) || (input.version as number) < 1)) {
    return fail("versione_non_valida", "La versione del catalogo deve essere un numero intero da 1 in su.");
  }
  if (!draft && !input.frozenAt) return fail("data_mancante", "Manca la data di congelamento del catalogo.");

  const items: SnapshotItem[] = [];
  const keys = new Set<string>();
  const counts = emptyCounts();
  for (const it of input.items) {
    if (it.deletedAt) continue;
    if (keys.has(it.key)) return fail("chiave_doppia", `La voce ${it.key} compare due volte.`);
    keys.add(it.key);
    counts[it.status] += 1;

    let answer: SnapshotAnswer | null = null;
    if (it.status === "validata" && it.validatedAnswer) answer = answerFrom(it.validatedAnswer, it, true);
    else if (draft && it.currentAnswer) answer = answerFrom(it.currentAnswer, it, false);

    const naApprovedAt = iso(it.naApprovedAt);
    const waiverApprovedAt = iso(it.waiverApprovedAt);
    const fallbackApprovedAt = iso(it.fallbackApprovedAt);
    items.push({
      key: it.key,
      kind: it.kind,
      section: it.section,
      parent_key: it.parentKey,
      title: it.title,
      explanation: it.explanation,
      why: it.why,
      example: it.example,
      help: it.help,
      spec: it.spec ?? {},
      priority: it.priority,
      serves_for: [...it.servesFor],
      privacy_class: it.privacyClass,
      value_visibility: it.valueVisibility,
      availability: [...it.availability],
      perimeter: it.perimeter,
      levers: [...it.levers],
      response_type: it.responseType,
      unit: unitOf(it),
      request_module_key: it.requestModuleKey,
      owner_role_key: it.ownerRoleKey,
      in_gate_scope: it.inGateScope,
      status: it.status,
      status_reason: it.statusReason,
      stale_at: iso(it.staleAt),
      validated_at: it.status === "validata" ? iso(it.validatedAt) : null,
      answer,
      na: it.status === "non_applicabile" && naApprovedAt ? { reason: it.naReason, approved_at: naApprovedAt } : null,
      waiver:
        it.waiver && waiverApprovedAt
          ? { motivo: it.waiver.motivo, piano: it.waiver.piano, scadenza: it.waiver.scadenza, approved_at: waiverApprovedAt }
          : null,
      fallback:
        it.fallback && fallbackApprovedAt
          ? {
              descrizione: it.fallback.descrizione,
              valido_per: [...it.fallback.valido_per],
              da_sostituire_entro: it.fallback.da_sostituire_entro,
              approved_at: fallbackApprovedAt,
            }
          : null,
      source_refs: [...(it.sourceRefs ?? [])],
    });
  }
  items.sort((a, b) => byKey(a.key, b.key));

  const links: SnapshotLink[] = [];
  const seenLinks = new Set<string>();
  for (const l of input.links) {
    if (!keys.has(l.fromKey) || !keys.has(l.toKey)) continue; // voce cancellata logicamente
    const id = `${l.fromKey}\u0000${l.toKey}\u0000${l.relation}`;
    if (seenLinks.has(id)) continue;
    seenLinks.add(id);
    links.push({ from: l.fromKey, to: l.toKey, relation: l.relation, cardinality: l.cardinality, note: l.note });
  }
  links.sort((a, b) => byKey(a.from, b.from) || byKey(a.to, b.to) || byKey(a.relation, b.relation));

  return ok({
    schema: CATALOG_SNAPSHOT_SCHEMA,
    case: {
      id: input.case.id,
      workspace_id: input.case.workspaceId,
      code: input.case.code,
      title: input.case.title,
      perimeter_label: input.case.perimeterLabel,
      contract_refs: [...input.case.contractRefs],
      data_controller_label: input.case.dataControllerLabel,
    },
    template: { ...input.template },
    version: input.version,
    frozen_at: draft ? null : iso(input.frozenAt),
    gate: input.gate
      ? {
          key: input.gate.key,
          review_id: input.gate.reviewId,
          decision: input.gate.decision,
          policy_scope: input.gate.policyScope,
          required: input.gate.required,
          ok: input.gate.ok,
          summary_text_hash: input.gate.summaryTextHash,
          waiver_keys: [...input.gate.waiverKeys].sort(byKey),
        }
      : null,
    counts: { total: items.length, by_status: counts },
    items,
    links,
  });
}

// ── Vista «solo verdi o blu» ──────────────────────────────────────────

export function isFrozen(snapshot: CatalogSnapshot): snapshot is CatalogSnapshot & { version: number } {
  return typeof snapshot.version === "number" && snapshot.frozen_at !== null;
}

/** Verde (validata) o blu (non applicabile con le due firme). */
export function isGreenOrBlue(item: SnapshotItem): boolean {
  return item.status === "validata" || (item.status === "non_applicabile" && item.na !== null);
}

/** Voci verdi o blu di una versione congelata. Una bozza non ha voci validate da esporre. */
export function validatedItems(snapshot: CatalogSnapshot): SnapshotItem[] {
  if (!isFrozen(snapshot)) return [];
  return snapshot.items.filter(isGreenOrBlue);
}

/** Voci escluse da `validatedItems`, solo chiave e stato. */
export function excludedItems(snapshot: CatalogSnapshot): { key: string; status: ItemStatus }[] {
  return snapshot.items.filter((i) => !isFrozen(snapshot) || !isGreenOrBlue(i)).map((i) => ({ key: i.key, status: i.status }));
}

// ── Visibilità dei valori per ruolo ───────────────────────────────────

const LS_ROLES = new Set<CaseRole>(LS_CASE_ROLES);

/** Il ruolo vede il valore? (`value_visibility`, PIANO §3.3; i personali mai). */
export function snapshotValueVisible(visibility: ValueVisibility, roles: readonly CaseRole[]): boolean {
  const isLs = roles.some((r) => LS_ROLES.has(r));
  if (visibility === "solo_ls") return isLs;
  if (visibility === "owner_e_ls") return isLs || roles.includes("owner_cliente");
  return roles.length > 0;
}

/** Copia della fotografia senza i valori che i ruoli non possono vedere. */
export function snapshotForViewer(snapshot: CatalogSnapshot, viewer: { roles: readonly CaseRole[] }): CatalogSnapshot {
  return {
    ...snapshot,
    items: snapshot.items.map((item) => {
      if (!item.answer || item.answer.value_hidden || snapshotValueVisible(item.value_visibility, viewer.roles)) return item;
      return { ...item, answer: { ...item.answer, value: null, value_normalized: null, value_hidden: "visibilita" } };
    }),
  };
}

// ── Differenze tra versioni ───────────────────────────────────────────

export interface SnapshotDiff {
  from_version: number | "bozza" | null;
  to_version: number | "bozza";
  added: string[];
  removed: string[];
  changed: { key: string; fields: string[] }[];
}

const DIFF_FIELDS = [
  "kind",
  "section",
  "parent_key",
  "title",
  "explanation",
  "why",
  "example",
  "help",
  "spec",
  "priority",
  "serves_for",
  "privacy_class",
  "value_visibility",
  "availability",
  "perimeter",
  "levers",
  "response_type",
  "unit",
  "request_module_key",
  "owner_role_key",
  "in_gate_scope",
  "status",
  "status_reason",
  "stale_at",
  "validated_at",
  "answer",
  "na",
  "waiver",
  "fallback",
  "source_refs",
] as const satisfies readonly (keyof SnapshotItem)[];

function outgoing(snapshot: CatalogSnapshot): Map<string, string> {
  const map = new Map<string, SnapshotLink[]>();
  for (const l of snapshot.links) {
    const list = map.get(l.from) ?? [];
    list.push(l);
    map.set(l.from, list);
  }
  return new Map([...map].map(([k, v]) => [k, stableStringify(v)]));
}

/** Voci aggiunte, tolte e cambiate rispetto alla versione precedente (`prev` null = prima versione). */
export function diffSnapshots(prev: CatalogSnapshot | null, next: CatalogSnapshot): SnapshotDiff {
  const before = new Map((prev?.items ?? []).map((i) => [i.key, i]));
  const after = new Map(next.items.map((i) => [i.key, i]));
  const linksBefore = prev ? outgoing(prev) : new Map<string, string>();
  const linksAfter = outgoing(next);

  const added = [...after.keys()].filter((k) => !before.has(k)).sort(byKey);
  const removed = [...before.keys()].filter((k) => !after.has(k)).sort(byKey);
  const changed: { key: string; fields: string[] }[] = [];
  for (const [key, item] of after) {
    const old = before.get(key);
    if (!old) continue;
    const fields: string[] = DIFF_FIELDS.filter((f) => stableStringify(old[f]) !== stableStringify(item[f]));
    if ((linksBefore.get(key) ?? "[]") !== (linksAfter.get(key) ?? "[]")) fields.push("links");
    if (fields.length > 0) changed.push({ key, fields });
  }
  changed.sort((a, b) => byKey(a.key, b.key));
  return { from_version: prev ? prev.version : null, to_version: next.version, added, removed, changed };
}
