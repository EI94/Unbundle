/**
 * Dalle righe del database alla vista del referente (PIANO §5.4, D16, D45).
 *
 * - Ogni voce porta solo quello che serve al referente: testi del template,
 *   stato in parole sue, valore già noto da confermare (mai personale o
 *   sanitario, mai con visibilità `solo_ls`), la sua ultima risposta, il
 *   chiarimento aperto, la bozza e i file caricati da questo link.
 * - Le firme in attesa del link di approvazione si costruiscono in
 *   `views/approvals.ts`; questo modulo le riesporta.
 *
 * Modulo puro.
 */
import { canConfirmDeclared } from "./answers/confirm.ts";
import { answerContext, prefillFromDeclared } from "./answers/normalize.ts";
import { displayJsonValue } from "./export/format.ts";
import {
  OTHER_QUESTIONS_TITLE,
  isPersonalClass,
  referentCapabilities,
  referentItemDone,
  referentStatusLabel,
  type ReferentDeclaredValue,
  type ReferentFileView,
  type ReferentItemView,
  type ReferentModuleView,
  type ReferentOwnAnswer,
} from "./public-view.ts";
import { estimateMinutes } from "./request-state.ts";
import { SOURCE_REF_PATTERN } from "./seed/source-refs.ts";
import { rowBool, rowDate, rowJson, rowNumber, rowObject, rowString, rowVocab, type Row } from "./sql/readiness.ts";
import type { Json } from "./types.ts";
import { findForbidden } from "./views/copy-guard.ts";
import {
  ANSWER_KINDS,
  ANSWER_SOURCE_KINDS,
  CASE_STATUSES,
  CONFIDENCE,
  ITEM_STATUSES,
  PRIVACY_CLASSES,
  REQUEST_ITEM_STATES,
  REQUEST_PURPOSES,
  REQUEST_STATUSES,
  RESPONSE_TYPES,
  SCAN_STATUSES,
  type CaseStatus,
  type RequestPurpose,
  type RequestStatus,
} from "./vocab.ts";

// ── Il link ───────────────────────────────────────────────────────────

/** Il link letto da `resolveTokenSql`. Nessun token in chiaro: solo l'id della riga. */
export interface ResolvedLink {
  tokenId: string;
  requestId: string;
  caseId: string;
  workspaceId: string;
  contactId: string;
  contactEmail: string | null;
  purpose: RequestPurpose;
  status: RequestStatus;
  actingRoleKey: string | null;
  delegationDepth: number;
  expiresAt: Date;
  opened: boolean;
  privacyAckAt: Date | null;
  privacyNoticeVersion: string | null;
  caseStatus: CaseStatus;
  caseCode: string;
  caseTitle: string;
  clientLabel: string;
  /** `uc_request_live`: falso solo con il caso in pausa (sola lettura). */
  live: boolean;
}

export function parseLinkRow(row: Row | undefined): ResolvedLink | null {
  if (!row || !row.token_id) return null;
  const purpose = rowVocab(REQUEST_PURPOSES, row.purpose);
  const status = rowVocab(REQUEST_STATUSES, row.status);
  const caseStatus = rowVocab(CASE_STATUSES, row.case_status);
  const expiresAt = rowDate(row.expires_at);
  if (!purpose || !status || !caseStatus || !expiresAt) return null;
  return {
    tokenId: String(row.token_id),
    requestId: String(row.request_id),
    caseId: String(row.case_id),
    workspaceId: String(row.workspace_id),
    contactId: String(row.contact_id),
    contactEmail: rowString(row.contact_email),
    purpose,
    status,
    actingRoleKey: rowString(row.acting_role_key),
    delegationDepth: rowNumber(row.delegation_depth) ?? 0,
    expiresAt,
    opened: rowBool(row.opened),
    privacyAckAt: rowDate(row.privacy_ack_at),
    privacyNoticeVersion: rowString(row.privacy_notice_version),
    caseStatus,
    caseCode: String(row.case_code ?? ""),
    caseTitle: String(row.case_title ?? ""),
    clientLabel: String(row.client_label ?? ""),
    live: rowBool(row.live),
  };
}

/** L'informativa di questa versione è stata letta su questa richiesta. */
export function privacyAcknowledged(link: Pick<ResolvedLink, "privacyAckAt" | "privacyNoticeVersion">, version: string): boolean {
  return link.privacyAckAt !== null && link.privacyNoticeVersion === version;
}

// ── Moduli ────────────────────────────────────────────────────────────

export interface ModuleInfo {
  key: string;
  title: string;
  why: string | null;
  instructions: string | null;
  estimatedMinutes: number | null;
  estimatedLabel: string | null;
  /** Domande dell'argomento in tutto il caso (`withQuestionCounts`), oppure null. */
  questionCount: number | null;
}

/**
 * Moduli di richiesta del template. Un modulo senza titolo si chiama
 * «Argomento N»: la chiave del modulo non arriva mai al referente.
 */
export function parseModules(raw: unknown): ModuleInfo[] {
  const list = rowJson<unknown[]>(raw);
  if (!Array.isArray(list)) return [];
  const out: ModuleInfo[] = [];
  for (const m of list) {
    if (!m || typeof m !== "object") continue;
    const o = m as Record<string, unknown>;
    if (typeof o.key !== "string" || !o.key) continue;
    const minutes = rowNumber(o.estimated_minutes);
    out.push({
      key: o.key,
      title: typeof o.title === "string" && o.title.trim() ? o.title.trim() : `Argomento ${out.length + 1}`,
      why: rowString(o.why),
      instructions: rowString(o.instructions),
      estimatedMinutes: minutes !== null && minutes > 0 ? minutes : null,
      estimatedLabel: rowString(o.estimated_label),
      questionCount: null,
    });
  }
  return out;
}

/**
 * Aggiunge ai moduli il numero delle loro domande nel caso (righe `{key, n}` di
 * `moduleQuestionCountsSql` in `uc-public.ts`). Vale per ogni forma di modulo
 * con la chiave: così anche le email di richiesta e i promemoria possono
 * passare `questionCount` a `estimateMinutes` (DESIGN §4.4 punto 5).
 */
export function withQuestionCounts<M extends { key: string }>(modules: readonly M[], rows: readonly Row[]): (M & { questionCount: number | null })[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const key = rowString(r.key);
    const n = rowNumber(r.n);
    if (key && n !== null && n > 0) counts.set(key, n);
  }
  return modules.map((m) => ({ ...m, questionCount: counts.get(m.key) ?? null }));
}

// ── Voci ──────────────────────────────────────────────────────────────

export interface ReferentRowContext {
  contactId: string;
  writable: boolean;
  personalZoneOpen: boolean;
  delegationDepth: number;
  now: Date;
}

const ASKABLE: readonly string[] = ["chiesta", "mancante", "parziale"];
const DATA_KINDS: readonly string[] = ["valore", "conferma", "correzione"];

function textOf(value: Json | null): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && !Array.isArray(value) && typeof value.text === "string") return value.text;
  return null;
}

function stringOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function filesFrom(raw: unknown): ReferentFileView[] {
  const list = rowJson<unknown[]>(raw);
  if (!Array.isArray(list)) return [];
  const out: ReferentFileView[] = [];
  for (const f of list) {
    if (!f || typeof f !== "object") continue;
    const o = f as Record<string, unknown>;
    const status = rowVocab(SCAN_STATUSES, o.status);
    if (typeof o.id !== "string" || !status) continue;
    out.push({ id: o.id, name: String(o.name ?? "file"), sizeBytes: rowNumber(o.size), status, usable: rowBool(o.usable) });
  }
  return out;
}

function ownAnswerFrom(raw: unknown): ReferentOwnAnswer | null {
  const o = rowObject(raw);
  const kind = rowVocab(ANSWER_KINDS, o.kind);
  if (!kind) return null;
  const value = (o.value ?? null) as Json | null;
  const confidence = rowVocab(CONFIDENCE, o.confidence);
  return {
    kind,
    version: rowNumber(o.version) ?? 1,
    display: value === null ? null : displayJsonValue(value) || null,
    value,
    estimate: confidence === "stima",
    encrypted: rowBool(o.encrypted),
  };
}

/**
 * Codici delle fonti (fatti «F010», «F014a», «F-M3», email «E1», anche dentro
 * un titolo come «verbale F012») e ogni altro codice interno che il controllo
 * dei testi vieta al cliente: mai nella pagina del referente (DESIGN §7.1 P0-12).
 */
const SOURCE_CODE = new RegExp(SOURCE_REF_PATTERN.source, "i");

function internalRef(ref: string): boolean {
  return SOURCE_CODE.test(ref) || findForbidden(ref, "cliente").length > 0;
}

/**
 * Da dove viene il valore già noto, nelle parole del referente (DESIGN §4.3
 * R2a): «In una call con Lateral Space» oppure «Da un documento: {titolo}».
 * Mai il codice del fatto.
 */
export function declaredSourceLabel(source: (typeof ANSWER_SOURCE_KINDS)[number], sourceRef: string | null): string {
  const ref = sourceRef && !internalRef(sourceRef) ? sourceRef.replace(/\s+/g, " ").trim().slice(0, 120) || null : null;
  switch (source) {
    case "dichiarato_in_call":
      return "In una call con Lateral Space";
    case "documento":
      return ref ? `Da un documento: ${ref}` : "Da un documento";
    case "sistema":
      return "Dai vostri sistemi";
    case "referente":
      return "Da un collega";
    default:
      return "Da Lateral Space";
  }
}

/**
 * Valore già noto da confermare: la risposta corrente, se non è di questo
 * referente ed è un dato. Un valore che il referente non può vedere (`solo_ls`)
 * non si mostra e non si conferma: la domanda si pone normalmente (DESIGN §4.3
 * R2a, §7.1 P0-13).
 */
function declaredFrom(row: Row, ctx: ReferentRowContext, status: string): ReferentDeclaredValue | null {
  const answerId = rowString(row.current_answer_id);
  const kind = rowString(row.a_kind);
  const source = rowVocab(ANSWER_SOURCE_KINDS, row.a_source_kind);
  if (!answerId || !kind || !source || !DATA_KINDS.includes(kind) || !ASKABLE.includes(status)) return null;
  if (rowString(row.a_responder_contact_id) === ctx.contactId) return null;
  if (rowString(row.value_visibility) === "solo_ls") return null;
  const value = (rowJson<Json>(row.a_value) ?? null) as Json | null;
  if (value === null) return null;
  const display = displayJsonValue(value) || null;
  if (display === null) return null;
  const normalized = (rowJson<Json>(row.a_value_normalized) ?? null) as Json | null;
  const responseType = rowVocab(RESPONSE_TYPES, row.response_type) ?? "testo";
  const canConfirm = canConfirmDeclared(responseType, { normalized });
  const sourceRef = rowString(row.a_source_ref);
  const declaredInCall = source === "dichiarato_in_call";
  let prefill: Json | null = null;
  let missing: ReferentDeclaredValue["missing"] = [];
  const text = textOf(value);
  if (!canConfirm && text) {
    const p = prefillFromDeclared(responseType, text, rowObject(row.response_config), answerContext(ctx.now, false));
    if (p) {
      prefill = p.value;
      missing = p.missing;
    }
  }
  return {
    answerId,
    display,
    value,
    sourceLabel: declaredSourceLabel(source, sourceRef),
    declaredInCall,
    canConfirm,
    prefill,
    missing,
  };
}

/** Una riga di `referentItemsSql` → voce della pagina, oppure null se la riga non è leggibile. */
export function referentItemFromRow(row: Row, ctx: ReferentRowContext): ReferentItemView | null {
  const status = rowVocab(ITEM_STATUSES, row.status);
  const riState = rowVocab(REQUEST_ITEM_STATES, row.ri_state);
  const privacyClass = rowVocab(PRIVACY_CLASSES, row.privacy_class) ?? "riservato_azienda";
  if (!status || !riState || !row.item_id) return null;
  const spec = rowObject(row.spec);
  const config = rowObject(row.response_config);
  const personal = isPersonalClass(privacyClass);
  const clarification = stringOrNull(row.clarification);
  const draft = personal || privacyClass === "escluso_sanitario" ? null : ((rowJson<Json>(row.draft) ?? null) as Json | null);
  const label = referentStatusLabel({ status, requestItemState: riState, clarification: clarification !== null, hasDraft: draft !== null });
  const can = referentCapabilities({
    status,
    requestItemState: riState,
    assignedToMe: rowString(row.assignee_contact_id) === ctx.contactId,
    privacyClass,
    personalZoneOpen: ctx.personalZoneOpen,
    writable: ctx.writable,
    delegationDepth: ctx.delegationDepth,
  });
  return {
    id: String(row.item_id),
    key: String(row.key ?? ""),
    title: String(row.title ?? ""),
    explanation: stringOrNull(row.explanation),
    why: stringOrNull(row.why),
    example: stringOrNull(row.example),
    help: stringOrNull(row.help),
    attachmentHint: stringOrNull(spec.allegato) ?? stringOrNull(config.allegato),
    responseType: rowVocab(RESPONSE_TYPES, row.response_type),
    config,
    status,
    statusReason: status === "mancante" || status === "parziale" ? stringOrNull(row.status_reason) : null,
    requestItemState: riState,
    label: label.label,
    tone: label.tone,
    done: referentItemDone({ status, requestItemState: riState }),
    personal,
    requiresValidFrom: rowBool(row.requires_validity_period),
    healthRuleQuestion: spec.health_rule_question === true,
    currentAnswerId: rowString(row.current_answer_id),
    toConfirm: personal ? null : declaredFrom(row, ctx, status),
    ownAnswer: ownAnswerFrom(row.own_answer),
    clarification,
    draft,
    files: filesFrom(row.files),
    can,
  };
}

export type ReferentItemWithModule = ReferentItemView & { moduleKey: string | null };

/** Righe di `referentItemsSql` → voci della pagina, con il modulo del template. */
export function referentItemsFromRows(rows: readonly Row[], ctx: ReferentRowContext): ReferentItemWithModule[] {
  const out: ReferentItemWithModule[] = [];
  for (const row of rows) {
    const item = referentItemFromRow(row, ctx);
    if (item) out.push({ ...item, moduleKey: rowString(row.request_module_key) });
  }
  return out;
}

/**
 * Voci raggruppate nei moduli del template, nell'ordine dei moduli; le voci
 * fuori modulo (o di un modulo sconosciuto) vanno in «Altre domande», in fondo.
 */
export function groupReferentModules(items: readonly ReferentItemWithModule[], modules: readonly ModuleInfo[]): ReferentModuleView[] {
  const known = new Map(modules.map((m) => [m.key, m]));
  const groups = new Map<string, ReferentItemView[]>();
  const others: ReferentItemView[] = [];
  for (const item of items) {
    const { moduleKey, ...view } = item;
    if (moduleKey && known.has(moduleKey)) groups.set(moduleKey, [...(groups.get(moduleKey) ?? []), view]);
    else others.push(view);
  }
  const out: ReferentModuleView[] = modules
    .filter((m) => groups.has(m.key))
    .map((m) => ({
      key: m.key,
      title: m.title,
      why: m.why,
      instructions: m.instructions,
      estimatedMinutes: m.estimatedMinutes,
      estimatedLabel: m.estimatedLabel,
      questionCount: m.questionCount,
      items: groups.get(m.key)!,
    }));
  if (others.length > 0) {
    out.push({ key: null, title: OTHER_QUESTIONS_TITLE, why: null, instructions: null, estimatedMinutes: null, estimatedLabel: null, questionCount: null, items: others });
  }
  return out;
}

/**
 * Minuti stimati per le voci del link (DESIGN §4.4 punto 5): la stima del
 * modulo in proporzione alle sue domande nella richiesta, oppure i pesi fissi
 * per tipo (mezzo minuto per una conferma con un tocco).
 */
export function referentMinutes(
  items: readonly { moduleKey: string | null; responseType?: ReferentItemView["responseType"]; toConfirm?: ReferentItemView["toConfirm"] }[],
  modules: readonly ModuleInfo[],
): number {
  return estimateMinutes(
    modules.map((m) => ({ key: m.key, estimatedMinutes: m.estimatedMinutes, questionCount: m.questionCount })),
    items.map((i) => ({ moduleKey: i.moduleKey, ...(i.responseType !== undefined ? { responseType: i.responseType } : {}), oneTap: i.toConfirm?.canConfirm === true })),
  );
}

// ── Firme in attesa (link di approvazione) ────────────────────────────

// Il costruttore delle firme sta in `views/approvals.ts` (WP0, stesso
// comportamento e stesse impronte). Le esportazioni restano qui per chi le
// importa da questo modulo.
export {
  buildApprovals,
  fallbackApprovalHash,
  naApprovalHash,
  waiverApprovalHash,
  zoneApprovalHash,
  type PendingApprovalRows,
} from "./views/approvals.ts";
