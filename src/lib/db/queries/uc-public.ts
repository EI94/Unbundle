/**
 * Link dei referenti: pagina `/r/[token]` e API pubbliche a token
 * `/api/r/[token]/…` (PIANO §5.4, §5.5; D13, D14, D16, D28, D42, D45; b30, b33).
 *
 * - **Lettura del link** (`resolveRequestToken`): formato del token, poi una
 *   sola SQL con l'impronta (`uc_request_visible`, orologio del DB). Token
 *   sbagliato, scaduto o revocato danno lo stesso «non valido». Nessuna
 *   scrittura in lettura: `first_opened_at` solo con `markLinkOpened` (POST).
 * - **Pagina** (`loadReferentPage`): solo le voci del referente, raggruppate nei
 *   moduli del template, con il valore già noto da confermare («dichiarato in
 *   call»), la sua bozza, la sua ultima risposta e i chiarimenti aperti. Nel
 *   link di approvazione, le firme in attesa del firmatario designato.
 * - **Scritture**: link vivo (`uc_request_live`, ripetuto nel batch), informativa
 *   letta su questa richiesta, scansione del testo prima di salvare
 *   (`prepareAnswer`: dati sanitari e discriminatori bloccati con un messaggio
 *   chiaro). Ogni cambio di stato passa da `applyItemTransitions`, cioè da
 *   `checkItemTransition` con `actorRequestItem`, CAS con `uc_require` ed evento
 *   nello stesso batch.
 * - **Voci personali**: solo con `a8` sciolto e la chiave della zona personale;
 *   il valore va cifrato in `value_encrypted`, mai in bozza.
 * - **Deleghe**: profondità ≤ 2, ≤ 5 al giorno per richiesta, collega del
 *   cliente; con un dominio che non è tra i referenti del caso la delega resta
 *   in bozza finché Lateral Space non la approva (`approveDelegation`).
 * - **Firme dal link di approvazione**: solo `purpose = 'approvazioni'` e
 *   contatto ancora designato; si firma con i comandi interni (`signNa`,
 *   `signWaiver`, `signFallback`, `signGate`, `resolveBlocker`,
 *   `signPersonalZoneAccess`) e un firmatario `{ kind: "link" }`, che
 *   ricontrollano designazione ed email al momento della firma.
 *
 * Modulo senza import dell'app (`@/…`, `server-only`): l'esecutore e l'ambiente
 * (domini di Lateral Space, chiave della zona personale, email configurata,
 * impronta dell'IP) arrivano dal route handler.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { answerKindForChoice, confirmValueConfig } from "../../uc/answers/confirm.ts";
import { issue, type Issue } from "../../uc/answers/issues.ts";
import { answerContext } from "../../uc/answers/normalize.ts";
import { prepareAnswer, prepareUniversalAction, type PreparedAnswer } from "../../uc/answers/prepare.ts";
import { isPlainObject } from "../../uc/answers/strings.ts";
import { TABLE_LIMITS } from "../../uc/answers/table-paste.ts";
import { deriveWorkspaceKek, envelopeAad, personalZoneKeyConfigured, sealJson } from "../../uc/crypto.ts";
import { readTabularFile } from "../../uc/files/profile.ts";
import { isIsoDate, romeDateOf, romeMidnightUtc } from "../../uc/freshness.ts";
import { firstExceeded, type RateLimitRule } from "../../uc/http.ts";
import { checkContactEmail, checkSignerEmail, type Signer } from "../../uc/permissions.ts";
import { bellPrefix, dedupeKey } from "../../uc/notify/dedupe.ts";
import { nextReminderAt, romeDate } from "../../uc/notify/schedule.ts";
import {
  APPROVAL_KINDS,
  INVALID_LINK_MESSAGE,
  MAX_BATCH_ANSWERS,
  MAX_DELEGATION_DEPTH,
  PAUSED_CASE_MESSAGE,
  PERSONAL_LOCKED_MESSAGE,
  PRIVACY_PENDING_MESSAGE,
  REFERENT_ANSWER_KINDS,
  REFERENT_PRIVACY_NOTICE,
  SINGLE_SEND_MESSAGE,
  VISIBLE_REQUEST_ITEM_STATES,
  greetingNameFrom,
  isPersonalClass,
  planReferentAnswer,
  publicFail,
  referentProgress,
  referentStatusLabel,
  type ApprovalKind,
  type ApprovalView,
  type BatchAnswerOutcome,
  type BatchAnswersResult,
  type PublicOutcome,
  type ReferentAnswerKind,
  type ReferentPage,
  type ReferentView,
} from "../../uc/public-view.ts";
import {
  buildApprovals,
  groupReferentModules,
  parseLinkRow,
  parseModules,
  privacyAcknowledged,
  referentItemsFromRows,
  referentMinutes,
  withQuestionCounts,
  type ResolvedLink,
} from "../../uc/public-rows.ts";
import { checkDelegation, expiryOnSend, MAX_DELEGATIONS_PER_DAY } from "../../uc/request-state.ts";
import {
  a8StatusSql,
  answerValueSql,
  caseContactDomainsSql,
  caseModulesDetailSql,
  clarificationReplySql,
  contactByEmailSql,
  delegableItemsSql,
  delegateContactInsertSql,
  delegationEventSql,
  delegationItemsInsertSql,
  delegationRequestInsertSql,
  delegationsPerDayGuardSql,
  draftClearSql,
  draftItemGuardSql,
  draftSaveSql,
  gateRejectedEventSql,
  linkGuardSql,
  linkOpenedSql,
  pendingA8Sql,
  pendingGateSql,
  pendingNaSql,
  pendingWaiversAndFallbacksSql,
  pendingZoneGrantsSql,
  privacyAckSql,
  publicAnswerInsertSql,
  rateLimitHitSql,
  referentItemsSql,
  requestItemRowSql,
  requestProgressSql,
  resolveTokenSql,
  usableRequestFilesSql,
} from "../../uc/sql/public.ts";
import { rowBool, rowJson, rowNumber, rowString, rowVocab, type Row } from "../../uc/sql/readiness.ts";
import { alignAssigneeSql, contactEventSql, delegationsTodaySql, tokenInsertSql } from "../../uc/sql/request-commands.ts";
import { cast, toStatement, ucSql, type UcStatement } from "../../uc/sql/statement.ts";
import { templatePartsReader } from "../../uc/sql/template-parts.ts";
import { gateReviewDecideSql, type LoadedItem } from "../../uc/sql/transitions.ts";
import { findingMessage, hasHardBlock, scanPayload, type PayloadScanResult } from "../../uc/text/scan.ts";
import { hashRequestToken, looksLikeRequestToken, newRequestToken, requestLinkPath } from "../../uc/tokens.ts";
import { fail, ok, type Approval, type Json, type Result } from "../../uc/types.ts";
import { CONFIDENCE, REQUEST_ITEM_STATES, SOURCE_BASIS, type AnswerDevice, type BlockerStatus, type Confidence, type RequestItemState } from "../../uc/vocab.ts";
import { prepareDelegation } from "../../uc/views/referente-form.ts";
import { enqueueForLsMembersSql, enqueueSql } from "./uc-notifications.ts";
import { isUuid, loadCaseCore, loadSignatureContext, loadUserContext, runCommand, signPersonalZoneAccess, type UcCommandContext } from "./uc-cases.ts";
import { resolveBlocker, signGate } from "./uc-gates.ts";
import { uploadFromReferent, type UcFilesEnv, type UcRequestMeta, type UploadResult } from "./uc-files.ts";
import { applyItemTransitions, loadItems, rejectNa, signFallback, signNa, signWaiver } from "./uc-items.ts";
import type { UcExecutor } from "../uc-executor.ts";
import { UUID } from "../../uc/ids.ts";

export type { ResolvedLink } from "../../uc/public-rows.ts";

/**
 * Ambiente della chiamata, letto dal route handler o dalla pagina (mai
 * `process.env` qui): `{ now, ...publicCallEnv(headers, process.env) }`.
 */
export interface PublicOptions {
  now?: Date;
  /** `UC_LS_EMAIL_DOMAINS`. */
  lsDomains: readonly string[];
  /** Impronta con chiave dell'IP (`UC_SECRET`), oppure null. */
  ipHash?: string | null;
  userAgent?: string | null;
  device?: AnswerDevice | null;
  /** `RESEND_API_KEY` e `UC_EMAIL_FROM` presenti: le email partono davvero. */
  emailConfigured?: boolean;
  /** `UC_PERSONAL_ZONE_KEY`: senza, la zona personale resta chiusa. */
  personalZoneKey?: string | null;
  /**
   * Accensione per workspace (`isUcWorkspaceEnabled` con `UC_WORKSPACE_IDS`,
   * DESIGN §7.1 P0-1): il link di un workspace spento è «non valido». Senza,
   * ogni workspace è acceso (test e script).
   */
  workspaceEnabled?: (workspaceId: string) => boolean;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const NOT_AVAILABLE = "Questa domanda non è più nel tuo link.";
const CHANGED = "La domanda è cambiata nel frattempo: aggiorna la pagina e riprova.";
const ZONE_CLOSED = PERSONAL_LOCKED_MESSAGE;
const HEALTH_CLOSED = "Qui non raccogliamo dati sanitari.";

/** Messaggi dei codici dei batch pubblici. */
const PUBLIC_MESSAGES: Readonly<Record<string, string>> = {
  link_non_valido: INVALID_LINK_MESSAGE,
  conflitto: CHANGED,
  voce_non_disponibile: NOT_AVAILABLE,
  troppe_deleghe: "Hai già chiesto a molti colleghi oggi. Riprova domani o scrivi a Lateral Space.",
  caso_chiuso: INVALID_LINK_MESSAGE,
};

function fromResult<T>(r: Result<T>): PublicOutcome<T> {
  return r.ok ? r : publicFail(r.code, r.code === "link_non_valido" ? INVALID_LINK_MESSAGE : r.message);
}

function referentCtx(link: ResolvedLink, opts: PublicOptions, now: Date): UcCommandContext {
  return {
    workspaceId: link.workspaceId,
    caseId: link.caseId,
    actor: { type: "referente", contactId: link.contactId, requestId: link.requestId, roleKey: link.actingRoleKey },
    user: null,
    lsDomains: opts.lsDomains,
    now,
  };
}

function guard(link: ResolvedLink): UcStatement {
  return linkGuardSql({ workspaceId: link.workspaceId, caseId: link.caseId, requestId: link.requestId, tokenId: link.tokenId });
}

/** Le scritture vogliono il link vivo (caso non in pausa) e l'informativa letta su questa richiesta. */
function checkWritable(link: ResolvedLink): PublicOutcome<void> {
  if (!link.live) return publicFail("caso_sospeso", PAUSED_CASE_MESSAGE);
  if (!privacyAcknowledged(link, REFERENT_PRIVACY_NOTICE.version)) return publicFail("informativa_da_leggere", PRIVACY_PENDING_MESSAGE);
  return { ok: true, value: undefined };
}

function checkCollection(link: ResolvedLink): PublicOutcome<void> {
  return link.purpose === "raccolta" ? { ok: true, value: undefined } : publicFail("stato_non_ammesso", "Da questo link si danno solo approvazioni.");
}

const TOO_LONG = "La risposta è troppo lunga o troppo annidata: allega un file.";

/**
 * Esito bloccante della scansione del testo. Dati sanitari e discriminatori
 * vengono sempre per primi (e da soli bloccano anche le bozze); con `all` anche
 * nomi di persona, date di nascita, codici fiscali e contatti. Null se il testo
 * si può salvare. Gli `issues` portano solo categoria e campo, mai il testo.
 */
function scanFailure(findings: PayloadScanResult, all: boolean): PublicOutcome<never> | null {
  if (findings.truncated) return publicFail("testo_troppo_lungo", TOO_LONG);
  const hard = findings.blocking.filter((f) => hasHardBlock([f]));
  const shown = hard.length > 0 ? hard : all ? findings.blocking : [];
  const first = shown[0];
  if (!first) return null;
  const issues = shown.slice(0, 20).map((f) => issue(`testo_${f.category}`, findingMessage(f.category), f.path || undefined));
  return publicFail(`testo_${first.category}`, findingMessage(first.category), issues);
}

type ReferentScan = { context: "risposta"; healthRuleQuestion?: { questionText: string } };

/** Opzioni di scansione per una voce: l'avviso al posto del blocco vale solo per le domande sulla regola sanitaria. */
function scanOptionsFor(item: LoadedItem): ReferentScan {
  return { context: "risposta", healthRuleQuestion: item.extra.healthRuleQuestion ? { questionText: item.extra.title } : undefined };
}

/** Scansione di testi liberi del referente (note, motivi): sanitario, discriminatorio, nomi, contatti. */
function scanReferentText(payload: Record<string, unknown>, opts: ReferentScan = { context: "risposta" }): PublicOutcome<void> {
  return scanFailure(scanPayload(payload as Json, opts), true) ?? { ok: true, value: undefined };
}

/**
 * Risposta non accettata: un testo bloccato vince sul formato, così chi scrive
 * «visita medica» in un valore sbagliato legge prima il motivo vero.
 */
function preparedFailure(p: Extract<PreparedAnswer, { ok: false }>): PublicOutcome<never> {
  const blocked = scanFailure(p.findings, p.reason === "testo_bloccato");
  if (blocked) return blocked;
  const first = p.errors[0];
  if (p.reason === "testo_bloccato") return publicFail(first?.code ?? "testo_bloccato", first?.message ?? "Riformula il testo.", p.errors);
  return publicFail("risposta_non_valida", first?.message ?? "Controlla la risposta.", p.errors);
}

function cleanText(v: string | null | undefined): string | null {
  const t = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  return t ? t : null;
}

// ── Lettura del link ──────────────────────────────────────────────────

/**
 * Il link dal token in chiaro: formato, poi una sola SQL sull'impronta. Null
 * per ogni token non utilizzabile (stessa risposta per sbagliato, scaduto,
 * revocato, caso chiuso).
 */
export async function resolveRequestToken(executor: UcExecutor, token: unknown): Promise<ResolvedLink | null> {
  if (!looksLikeRequestToken(token)) return null;
  const [rows] = await executor.batch([resolveTokenSql(hashRequestToken(token))]);
  return parseLinkRow(rows[0]);
}

/** Il link vale solo se il workspace del caso ha la sezione accesa (DESIGN §7.1 P0-1). */
export function linkWorkspaceEnabled(link: Pick<ResolvedLink, "workspaceId">, opts: Pick<PublicOptions, "workspaceEnabled">): boolean {
  return opts.workspaceEnabled ? opts.workspaceEnabled(link.workspaceId) : true;
}

/** Nome del referente del link, per il saluto. */
function contactNameSql(i: { workspaceId: string; contactId: string }): UcStatement {
  return toStatement(ucSql`SELECT display_name FROM uc_contacts
WHERE id = ${cast(i.contactId, "uuid")} AND workspace_id = ${cast(i.workspaceId, "uuid")} AND anonymized_at IS NULL`);
}

/**
 * Domande di ogni modulo nel caso: servono a dividere la stima del modulo in
 * proporzione (DESIGN §4.4 punto 5). Esportata per chi stima i minuti fuori
 * dalla pagina (email di richiesta e promemoria), con `withQuestionCounts`.
 */
export function moduleQuestionCountsSql(caseId: string): UcStatement {
  return toStatement(ucSql`SELECT request_module_key AS key, count(*)::int AS n FROM uc_items
WHERE case_id = ${cast(caseId, "uuid")} AND deleted_at IS NULL AND request_module_key IS NOT NULL
GROUP BY request_module_key`);
}

async function personalZoneOpen(executor: UcExecutor, caseId: string, key: string | null | undefined): Promise<boolean> {
  if (!personalZoneKeyConfigured(key)) return false;
  const [[row]] = await executor.batch([a8StatusSql(caseId)]);
  return (rowString(row?.status) as BlockerStatus | null) === "sciolto";
}

/**
 * Vista della pagina del referente (anche per `GET /api/r/[token]`). Solo
 * letture: nessun evento, nessun `first_opened_at`.
 */
export async function loadReferentView(executor: UcExecutor, link: ResolvedLink, opts: PublicOptions): Promise<ReferentView> {
  const now = opts.now ?? new Date();
  const base = {
    access: link.live ? ("scrivibile" as const) : ("sola_lettura" as const),
    clientLabel: link.clientLabel,
    caseCode: link.caseCode,
    caseTitle: link.caseTitle,
    paused: !link.live,
    expiresAt: link.expiresAt.toISOString(),
    privacy: { acknowledged: privacyAcknowledged(link, REFERENT_PRIVACY_NOTICE.version), version: REFERENT_PRIVACY_NOTICE.version },
    emailConfigured: opts.emailConfigured === true,
  };
  if (link.purpose === "approvazioni") {
    const [approvals, [[contact]]] = await Promise.all([
      link.live ? loadApprovals(executor, link) : Promise.resolve([] as ApprovalView[]),
      executor.batch([contactNameSql({ workspaceId: link.workspaceId, contactId: link.contactId })]),
    ]);
    return {
      ...base,
      greetingName: greetingNameFrom(rowString(contact?.display_name)),
      mode: "approvazioni",
      progress: { done: 0, total: approvals.length },
      estimatedMinutes: 0,
      modules: [],
      delegation: { allowed: false, depth: link.delegationDepth, max: MAX_DELEGATION_DEPTH },
      approvals,
    };
  }
  const template = templatePartsReader();
  const [itemRows, [modulesRow], [a8Row], countRows, [contact]] = await executor.batch([
    referentItemsSql({ caseId: link.caseId, requestId: link.requestId, contactId: link.contactId }),
    caseModulesDetailSql({ workspaceId: link.workspaceId, caseId: link.caseId }, template.columns),
    a8StatusSql(link.caseId),
    moduleQuestionCountsSql(link.caseId),
    contactNameSql({ workspaceId: link.workspaceId, contactId: link.contactId }),
  ]);
  const zoneOpen = personalZoneKeyConfigured(opts.personalZoneKey) && rowString(a8Row?.status) === "sciolto";
  const items = referentItemsFromRows(itemRows, {
    contactId: link.contactId,
    writable: link.live,
    personalZoneOpen: zoneOpen,
    delegationDepth: link.delegationDepth,
    now,
  });
  const modules = withQuestionCounts(parseModules(template.read(modulesRow)?.modules), countRows);
  // Il tempo stimato riguarda solo quello che resta da fare adesso.
  const open = items.filter((i) => i.can.answer && !i.done);
  return {
    ...base,
    greetingName: greetingNameFrom(rowString(contact?.display_name)),
    mode: "raccolta",
    progress: referentProgress(items),
    estimatedMinutes: open.length ? referentMinutes(open, modules) : 0,
    modules: groupReferentModules(items, modules),
    delegation: { allowed: link.live && link.delegationDepth < MAX_DELEGATION_DEPTH && items.some((i) => i.can.delegate), depth: link.delegationDepth, max: MAX_DELEGATION_DEPTH },
    approvals: [],
  };
}

/**
 * Pagina `/r/[token]`: la scheda generica per ogni link non valido (anche di
 * un workspace con la sezione spenta), altrimenti la vista.
 */
export async function loadReferentPage(executor: UcExecutor, token: unknown, opts: PublicOptions): Promise<ReferentPage> {
  const link = await resolveRequestToken(executor, token);
  if (!link || !linkWorkspaceEnabled(link, opts)) return { access: "non_valido" };
  const view = await loadReferentView(executor, link, opts);
  return { access: view.access, view };
}

// ── Limiti di frequenza ───────────────────────────────────────────────

/** Conta la chiamata nei secchi indicati e restituisce la prima regola superata, se c'è. */
export async function hitRateLimits(executor: UcExecutor, rules: readonly RateLimitRule[]): Promise<RateLimitRule | null> {
  if (rules.length === 0) return null;
  const [rows] = await executor.batch([rateLimitHitSql(rules.map((r) => ({ bucket: r.bucket, unit: r.unit })))]);
  const counts = new Map(rows.map((r) => [String(r.bucket), rowNumber(r.count) ?? 0]));
  return firstExceeded(rules, counts);
}

// ── Apertura e informativa ────────────────────────────────────────────

/**
 * `POST …/opened` dopo l'idratazione: `first_opened_at` una volta, `inviata →
 * aperta`, evento `link.aperto` al massimo una volta al giorno. Con il caso in
 * pausa non scrive nulla (sola lettura) e non è un errore.
 */
export async function markLinkOpened(executor: UcExecutor, link: ResolvedLink, opts: PublicOptions): Promise<PublicOutcome<{ recorded: boolean }>> {
  if (!link.live) return { ok: true, value: { recorded: false } };
  const now = opts.now ?? new Date();
  const [[row]] = await executor.batch([
    linkOpenedSql({
      workspaceId: link.workspaceId,
      caseId: link.caseId,
      requestId: link.requestId,
      contactId: link.contactId,
      since: romeMidnightUtc(romeDateOf(now)),
      ipHash: opts.ipHash ?? null,
      userAgent: opts.userAgent ?? null,
    }),
  ]);
  if ((rowNumber(row?.live) ?? 0) === 0) return publicFail("link_non_valido", INVALID_LINK_MESSAGE);
  return { ok: true, value: { recorded: (rowNumber(row?.updated) ?? 0) > 0 || (rowNumber(row?.logged) ?? 0) > 0 } };
}

const PrivacyAckSchema = z.strictObject({ version: z.string().min(1).max(20) });

/** «Ho letto» sull'informativa di questa richiesta (versione corrente). */
export async function acknowledgePrivacy(executor: UcExecutor, link: ResolvedLink, input: unknown, opts: PublicOptions): Promise<PublicOutcome<{ version: string }>> {
  if (!link.live) return publicFail("caso_sospeso", PAUSED_CASE_MESSAGE);
  const parsed = PrivacyAckSchema.safeParse(input);
  if (!parsed.success) return publicFail("dati_non_validi", "Dati non validi. Aggiorna la pagina e riprova.");
  if (parsed.data.version !== REFERENT_PRIVACY_NOTICE.version) {
    return publicFail("informativa_cambiata", `L'informativa è stata aggiornata: aggiorna la pagina, rileggila e premi di nuovo «${REFERENT_PRIVACY_NOTICE.button}».`);
  }
  const [[row]] = await executor.batch([
    privacyAckSql({
      workspaceId: link.workspaceId,
      caseId: link.caseId,
      requestId: link.requestId,
      contactId: link.contactId,
      version: REFERENT_PRIVACY_NOTICE.version,
      ipHash: opts.ipHash ?? null,
      userAgent: opts.userAgent ?? null,
    }),
  ]);
  if ((rowNumber(row?.live) ?? 0) === 0) return publicFail("link_non_valido", INVALID_LINK_MESSAGE);
  return { ok: true, value: { version: REFERENT_PRIVACY_NOTICE.version } };
}

// ── Voce del referente ────────────────────────────────────────────────

interface ReferentItem {
  item: LoadedItem;
  requestItemState: RequestItemState;
  personal: boolean;
  zoneOpen: boolean;
}

/** Riga della richiesta e voce caricata → la voce del referente, se è ancora sua e visibile nel link. */
function referentItemFrom(link: ResolvedLink, ri: Row | undefined, item: LoadedItem | undefined): PublicOutcome<Omit<ReferentItem, "zoneOpen">> {
  const state = rowVocab(REQUEST_ITEM_STATES, ri?.state);
  if (!state || !(VISIBLE_REQUEST_ITEM_STATES as readonly string[]).includes(state)) return publicFail("voce_non_disponibile", NOT_AVAILABLE);
  if (!item) return publicFail("voce_non_disponibile", NOT_AVAILABLE);
  if (item.snapshot.assigneeContactId !== link.contactId) return publicFail("voce_non_disponibile", "Questa domanda non è più assegnata a te.");
  return { ok: true, value: { item, requestItemState: state, personal: isPersonalClass(item.snapshot.privacyClass) } };
}

/** La voce del link: riga visibile nella richiesta e voce ancora assegnata al referente. */
async function loadReferentItem(executor: UcExecutor, link: ResolvedLink, itemId: unknown, opts: PublicOptions): Promise<PublicOutcome<ReferentItem>> {
  if (!isUuid(itemId)) return publicFail("voce_non_disponibile", NOT_AVAILABLE);
  const [[ri]] = await executor.batch([requestItemRowSql({ caseId: link.caseId, requestId: link.requestId, itemId })]);
  const state = rowVocab(REQUEST_ITEM_STATES, ri?.state);
  if (!state || !(VISIBLE_REQUEST_ITEM_STATES as readonly string[]).includes(state)) return publicFail("voce_non_disponibile", NOT_AVAILABLE);
  const loaded = await loadItems(executor, link.workspaceId, link.caseId, [itemId]);
  const found = referentItemFrom(link, ri, loaded?.items.get(itemId));
  if (!found.ok) return found;
  const zoneOpen = found.value.personal ? await personalZoneOpen(executor, link.caseId, opts.personalZoneKey) : false;
  return { ok: true, value: { ...found.value, zoneOpen } };
}

interface PreloadedAnswer {
  loaded: PublicOutcome<ReferentItem>;
  usable: string[];
}

/**
 * Le voci di un invio a gruppi, lette insieme: righe della richiesta e file
 * utilizzabili in un solo batch, poi le voci (stesse regole di
 * `loadReferentItem`). Le voci personali non entrano negli invii a gruppi:
 * qui la zona personale resta chiusa e la voce si rifiuta prima.
 */
async function preloadReferentItems(executor: UcExecutor, link: ResolvedLink, itemIds: readonly string[]): Promise<Map<string, PreloadedAnswer>> {
  const out = new Map<string, PreloadedAnswer>();
  if (itemIds.length === 0) return out;
  const statements = itemIds.flatMap((itemId) => [
    requestItemRowSql({ caseId: link.caseId, requestId: link.requestId, itemId }),
    usableRequestFilesSql({ caseId: link.caseId, itemId, requestId: link.requestId }),
  ]);
  const [rows, loaded] = await Promise.all([executor.batch(statements), loadItems(executor, link.workspaceId, link.caseId, itemIds)]);
  itemIds.forEach((itemId, index) => {
    const found = referentItemFrom(link, rows[index * 2]?.[0], loaded?.items.get(itemId));
    out.set(itemId, {
      loaded: found.ok ? { ok: true, value: { ...found.value, zoneOpen: false } } : found,
      usable: (rows[index * 2 + 1] ?? []).map((r) => String(r.id)),
    });
  });
  return out;
}

// ── Bozze ─────────────────────────────────────────────────────────────

const DraftSchema = z.strictObject({
  kind: z.enum(REFERENT_ANSWER_KINDS).optional(),
  payload: z.unknown().optional(),
  note: z.string().max(2000).nullish(),
  confidence: z.enum(CONFIDENCE).nullish(),
  estimate: z.boolean().optional(),
  source_basis: z.enum(SOURCE_BASIS).nullish(),
  /** Solo cifre e separatori: la data si controlla all'invio, ma nessun testo libero passa da qui. */
  valid_from: z.string().regex(/^[0-9./-]{0,10}$/).nullish(),
  partial: z.boolean().optional(),
  who_might_know: z.string().max(300).nullish(),
  reason: z.string().max(2000).nullish(),
  /** Il referente ha deciso (DESIGN §4.2): senza, un valore scritto resta una bozza e non una risposta pronta. */
  decided: z.boolean().optional(),
});

/** Bozze più grandi di così non si salvano sul server (una tabella incollata resta sotto). */
export const MAX_DRAFT_JSON_LENGTH = 220_000;

/**
 * Autosalvataggio (`PUT …/items/[itemId]/draft`): normalizzazione non stretta e
 * scansione. Dati sanitari o discriminatori impediscono il salvataggio (nessun
 * testo arriva nel database); gli altri problemi tornano come `errors` da
 * correggere prima dell'invio. Mai per le voci personali o sanitarie.
 */
export async function saveReferentDraft(
  executor: UcExecutor,
  link: ResolvedLink,
  itemId: unknown,
  input: unknown,
  opts: PublicOptions,
): Promise<PublicOutcome<{ saved: true; errors: Issue[]; warnings: Issue[] }>> {
  const writable = checkWritable(link);
  if (!writable.ok) return writable;
  const collection = checkCollection(link);
  if (!collection.ok) return collection;
  const parsed = DraftSchema.safeParse(input);
  if (!parsed.success) return publicFail("dati_non_validi", "Bozza non valida. Aggiorna la pagina e riprova.");
  const loaded = await loadReferentItem(executor, link, itemId, opts);
  if (!loaded.ok) return loaded;
  const { item } = loaded.value;
  const s = item.snapshot;
  if (loaded.value.personal || s.privacyClass === "escluso_sanitario") {
    return publicFail("bozza_non_ammessa", "Per questa domanda non salviamo bozze: invia la risposta quando è pronta.");
  }
  if (!["chiesta", "mancante", "parziale", "validata"].includes(s.status)) return publicFail("stato_non_ammesso", "Per ora questa domanda non si può modificare.");
  const d = parsed.data;
  const draft: Record<string, Json> = { v: 1 };
  if (d.kind) draft.kind = d.kind;
  if (d.payload !== undefined) draft.payload = d.payload as Json;
  for (const k of ["note", "confidence", "source_basis", "valid_from", "who_might_know", "reason"] as const) {
    if (d[k] !== undefined && d[k] !== null) draft[k] = d[k] as Json;
  }
  if (d.estimate !== undefined) draft.estimate = d.estimate;
  if (d.partial !== undefined) draft.partial = d.partial;
  if (d.decided === true) draft.decided = true;
  let serialized: string;
  try {
    serialized = JSON.stringify(draft);
  } catch {
    return publicFail("dati_non_validi", "Bozza non valida.");
  }
  if (serialized.length > MAX_DRAFT_JSON_LENGTH) return publicFail("bozza_troppo_grande", "La bozza è troppo lunga: allega un file al posto del testo.");
  const now = opts.now ?? new Date();
  const kind = d.kind ?? "valore";
  const extras = { note: d.note ?? "", who_might_know: d.who_might_know ?? "", reason: d.reason ?? "" };
  const scan = scanOptionsFor(item);
  const type = s.responseType ?? "testo";
  let errors: Issue[] = [];
  let warnings: Issue[] = [];
  if (d.payload !== undefined && (kind === "valore" || kind === "risposta_chiarimento" || kind === "conferma" || kind === "correzione")) {
    const confirm = kind === "conferma" || kind === "correzione";
    const p = prepareAnswer({
      type: confirm ? "conferma_valore" : type,
      raw: confirm ? { choice: kind === "conferma" ? "confermo" : "correggo", value: d.payload } : d.payload,
      config: confirm ? confirmValueConfig(type, item.extra.responseConfig) : item.extra.responseConfig,
      ctx: answerContext(now, false, { proposedText: item.extra.title }),
      extras,
      scan,
    });
    // Dati sanitari o discriminatori non si salvano, anche se il valore non è ancora nel formato giusto.
    const blocked = scanFailure(p.findings, false);
    if (blocked) return blocked;
    if (!p.ok && p.reason === "testo_bloccato") return preparedFailure(p);
    errors = p.errors;
    warnings = p.warnings;
  } else {
    const findings = scanPayload({ payload: d.payload ?? null, ...extras } as Json, scan);
    const blocked = scanFailure(findings, false);
    if (blocked) return blocked;
    const soft = scanFailure(findings, true);
    if (soft && !soft.ok) errors = soft.issues ?? [];
  }
  const run = await runCommand(
    executor,
    [
      guard(link),
      draftItemGuardSql({ caseId: link.caseId, itemId: s.id, contactId: link.contactId }),
      draftSaveSql({ caseId: link.caseId, requestId: link.requestId, itemId: s.id, draft }),
      requestProgressSql({ caseId: link.caseId, requestId: link.requestId }),
    ],
    PUBLIC_MESSAGES,
  );
  if (!run.ok) return fromResult(run);
  return { ok: true, value: { saved: true, errors, warnings } };
}

// ── Risposte ──────────────────────────────────────────────────────────

const AnswerSchema = z.strictObject({
  kind: z.enum(REFERENT_ANSWER_KINDS).optional(),
  payload: z.unknown().optional(),
  confidence: z.enum(CONFIDENCE).nullish(),
  estimate: z.boolean().optional(),
  source_basis: z.enum(SOURCE_BASIS).nullish(),
  valid_from: z.string().regex(ISO_DATE, "Scegli una data valida.").refine(isIsoDate, "Scegli una data che esiste.").nullish(),
  note: z.string().max(2000, "La nota può avere al massimo 2.000 caratteri.").nullish(),
  file_ids: z.array(z.string().regex(UUID)).max(20).optional(),
  partial: z.boolean().optional(),
  supersedes_answer_id: z.string().regex(UUID).nullish(),
  who_might_know: z.string().max(300, "Al massimo 300 caratteri.").nullish(),
  reason: z.string().max(2000, "Il motivo può avere al massimo 2.000 caratteri.").nullish(),
});

type AnswerInput = z.infer<typeof AnswerSchema>;

const DATA_KINDS: readonly ReferentAnswerKind[] = ["valore", "conferma", "correzione"];

export interface SubmittedAnswer {
  itemId: string;
  status: string;
  label: string;
  warnings: Issue[];
}

/** Id dei file citati in un valore di tipo `file`. */
function fileIdsInValue(value: Json | null): string[] {
  if (!isPlainObject(value) || !Array.isArray(value.file_ids)) return [];
  return value.file_ids.filter((x): x is string => typeof x === "string");
}

interface PreparedSubmission {
  kind: ReferentAnswerKind;
  value: Json | null;
  normalized: Json | null;
  textHash: string | null;
  validFrom: string | null;
  partial: boolean;
  reason: string | null;
  supersedes: string | null;
  warnings: Issue[];
}

/** Valore da confermare: la risposta corrente, se è un dato e non viene da questo referente. */
async function loadDeclared(executor: UcExecutor, link: ResolvedLink, item: LoadedItem): Promise<{ id: string; value: Json; normalized: Json | null } | null> {
  const current = item.snapshot.currentAnswer;
  if (!current || current.responderContactId === link.contactId || !["valore", "conferma", "correzione"].includes(current.kind)) return null;
  const [[row]] = await executor.batch([answerValueSql({ caseId: link.caseId, itemId: item.snapshot.id, answerId: current.id })]);
  const value = (rowJson<Json>(row?.value) ?? null) as Json | null;
  if (value === null) return null;
  return { id: current.id, value, normalized: (rowJson<Json>(row?.value_normalized) ?? null) as Json | null };
}

async function prepareSubmission(
  executor: UcExecutor,
  link: ResolvedLink,
  item: LoadedItem,
  d: AnswerInput,
  usableFileIds: readonly string[],
  now: Date,
): Promise<PublicOutcome<PreparedSubmission>> {
  const s = item.snapshot;
  const type = s.responseType ?? "testo";
  const scan = scanOptionsFor(item);
  const note = cleanText(d.note);
  const extras = { note: note ?? "" };
  const ctxBase = { usableFileIds, proposedText: item.extra.title };
  let kind: ReferentAnswerKind = d.kind ?? "valore";
  const out: PreparedSubmission = {
    kind,
    value: null,
    normalized: null,
    textHash: null,
    validFrom: d.valid_from ?? null,
    partial: d.partial === true,
    reason: null,
    supersedes: null,
    warnings: [],
  };

  if (kind === "non_so" || kind === "proposta_na") {
    const p = prepareUniversalAction({
      action: kind,
      raw: kind === "non_so" ? { who_might_know: d.who_might_know ?? undefined } : { reason: d.reason ?? "" },
      activeItemIds: [],
      scan,
    });
    if (!p.ok) return preparedFailure(p);
    if (note) {
      const scanned = scanReferentText({ note }, scan);
      if (!scanned.ok) return scanned;
    }
    out.value = p.value;
    out.warnings = p.warnings;
    if (kind === "proposta_na" && isPlainObject(p.value) && typeof p.value.reason === "string") out.reason = p.value.reason;
    return { ok: true, value: out };
  }

  if (kind === "conferma" || kind === "correzione") {
    const declared = await loadDeclared(executor, link, item);
    if (!declared) return publicFail("nulla_da_confermare", "Non c'è un valore da confermare: scrivi la risposta.");
    const hasValue = d.payload !== undefined && d.payload !== null && !(typeof d.payload === "string" && d.payload.trim() === "");
    if (kind === "conferma" && !hasValue && item.extra.valueVisibility === "solo_ls") {
      return publicFail("valore_richiesto", "Scrivi il valore nel formato richiesto e invia.");
    }
    const p = prepareAnswer({
      type: "conferma_valore",
      raw: { choice: kind === "conferma" ? "confermo" : "correggo", ...(hasValue ? { value: d.payload } : {}) },
      config: confirmValueConfig(type, item.extra.responseConfig),
      ctx: answerContext(now, true, { ...ctxBase, declared: { value: declared.value, normalized: declared.normalized } }),
      extras,
      scan,
    });
    if (!p.ok) return preparedFailure(p);
    out.value = isPlainObject(p.value) && "value" in p.value ? ((p.value.value ?? null) as Json | null) : declared.value;
    out.normalized = p.normalized;
    out.textHash = p.textHash ?? null;
    out.validFrom = out.validFrom ?? p.validFrom ?? null;
    out.partial = out.partial || p.partial === true;
    out.supersedes = declared.id;
    out.warnings = p.warnings;
    return { ok: true, value: out };
  }

  const p = prepareAnswer({ type, raw: d.payload, config: item.extra.responseConfig, ctx: answerContext(now, true, ctxBase), extras, scan });
  if (!p.ok) return preparedFailure(p);
  out.value = p.value;
  out.normalized = p.normalized;
  out.textHash = p.textHash ?? null;
  out.validFrom = out.validFrom ?? p.validFrom ?? null;
  out.warnings = p.warnings;
  if (p.partial === true) {
    out.partial = true;
    out.reason = note ?? "La tabella ha meno righe del minimo richiesto.";
  }
  if (type === "conferma_regola" || type === "conferma_formula") {
    // La scelta decide il tipo di risposta: «Confermo» è una conferma (vale per il ruolo titolare), «Non lo so» è «Non lo so».
    const derived = answerKindForChoice(type, p.value);
    if (derived === "non_so" || derived === "conferma" || derived === "correzione") kind = derived;
  }
  out.kind = kind;
  return { ok: true, value: out };
}

async function submitOnce(
  executor: UcExecutor,
  link: ResolvedLink,
  itemId: unknown,
  d: AnswerInput,
  opts: PublicOptions,
  pre?: PreloadedAnswer,
): Promise<PublicOutcome<SubmittedAnswer> & { retryable?: boolean }> {
  const loaded = pre ? pre.loaded : await loadReferentItem(executor, link, itemId, opts);
  if (!loaded.ok) return loaded;
  const { item, requestItemState, personal, zoneOpen } = loaded.value;
  const s = item.snapshot;
  if (s.privacyClass === "escluso_sanitario") return publicFail("valore_sanitario", HEALTH_CLOSED);
  if (personal && !zoneOpen) return publicFail("zona_personale_chiusa", ZONE_CLOSED);
  if (d.supersedes_answer_id && d.supersedes_answer_id !== (s.currentAnswer?.id ?? null)) return publicFail("conflitto", CHANGED);
  const now = opts.now ?? new Date();
  const usable = pre
    ? pre.usable
    : (await executor.batch([usableRequestFilesSql({ caseId: link.caseId, itemId: s.id, requestId: link.requestId })]))[0].map((r) => String(r.id));
  const prepared = await prepareSubmission(executor, link, item, d, usable, now);
  if (!prepared.ok) return prepared;
  const p = prepared.value;

  if (DATA_KINDS.includes(p.kind) && s.requiresValidityPeriod && !p.validFrom) {
    const message = "Indica da quando vale questo valore.";
    return publicFail("valido_dal_mancante", message, [issue("valido_dal_mancante", message, "valid_from")]);
  }
  const fileIds = [...new Set([...(d.file_ids ?? []), ...fileIdsInValue(p.value)])];
  if (fileIds.some((id) => !usable.includes(id))) {
    return publicFail("file_non_valido", "Allega solo file caricati e controllati per questa domanda.");
  }
  const PARTIAL = "Il referente ha risposto solo in parte.";
  let reason = p.reason;
  if (p.partial && !reason) reason = cleanText(d.note) ?? PARTIAL;
  if (p.partial && reason && reason.length < 3) reason = PARTIAL;
  // Il motivo di «parziale» si vede in chiaro sulla voce: per una voce personale niente testo del referente.
  if (p.partial && personal) reason = PARTIAL;
  const plan = planReferentAnswer({ status: s.status, requestItemState, kind: p.kind, partial: p.partial });
  if (!plan.ok) return publicFail(plan.code, plan.message);

  const answerId = randomUUID();
  let value = p.value;
  let normalized = p.normalized;
  let textHash = p.textHash;
  let encrypted: string | null = null;
  if (personal) {
    const kek = deriveWorkspaceKek(opts.personalZoneKey, link.workspaceId);
    if (!kek.ok) return publicFail("zona_personale_chiusa", ZONE_CLOSED);
    encrypted = sealJson(kek.value, { value, normalized }, envelopeAad({ workspaceId: link.workspaceId, caseId: link.caseId, objectId: answerId })).toString("base64");
    value = null;
    normalized = null;
    // Un'impronta di un dato personale si inverte provando i valori: niente impronta.
    textHash = null;
  }
  const confidence: Confidence | null = d.confidence ?? (d.estimate ? "stima" : null);
  const note = cleanText(d.note);
  const ctx = referentCtx(link, opts, now);
  const clarificationReply = p.kind === "risposta_chiarimento" && note && s.openClarification ? note : null;
  const applied = await applyItemTransitions(executor, ctx, {
    itemIds: [s.id],
    transitions: (items) => {
      const current = items.get(s.id)?.snapshot;
      if (!current || current.status !== s.status || (current.currentAnswer?.id ?? null) !== (s.currentAnswer?.id ?? null)) return fail("conflitto", CHANGED);
      return ok([
        {
          itemId: s.id,
          to: plan.value.to,
          trigger: plan.value.trigger,
          reason,
          answer: { kind: p.kind, sourceKind: "referente" },
          actorRequestItem: { requestId: link.requestId, state: requestItemState },
          extraSet: { currentAnswerId: answerId },
        },
      ]);
    },
    before: [
      guard(link),
      publicAnswerInsertSql({
        id: answerId,
        workspaceId: link.workspaceId,
        caseId: link.caseId,
        itemId: s.id,
        requestId: link.requestId,
        contactId: link.contactId,
        kind: p.kind,
        value,
        valueNormalized: normalized,
        valueEncryptedB64: encrypted,
        validFrom: p.validFrom,
        confidence,
        note: personal ? null : note,
        sourceBasis: d.source_basis ?? null,
        supersedesAnswerId: p.supersedes,
        fileIds,
        textHash,
        responseType: s.responseType,
        ipHash: opts.ipHash ?? null,
        userAgent: opts.userAgent ?? null,
        device: opts.device ?? null,
      }),
    ],
    after: (_planned, _items, core) => [
      draftClearSql({ caseId: link.caseId, requestId: link.requestId, itemId: s.id }),
      requestProgressSql({ caseId: link.caseId, requestId: link.requestId }),
      ...(clarificationReply
        ? [
            clarificationReplySql({
              id: randomUUID(),
              workspaceId: link.workspaceId,
              caseId: link.caseId,
              itemId: s.id,
              contactId: link.contactId,
              body: clarificationReply.slice(0, 4000),
              ipHash: opts.ipHash ?? null,
              userAgent: opts.userAgent ?? null,
            }),
          ]
        : []),
      toStatement(
        enqueueForLsMembersSql({
          workspaceId: link.workspaceId,
          caseId: link.caseId,
          requestId: link.requestId,
          templateKey: "risposta_ricevuta",
          payload: { case_code: core.code, item_keys: [s.key] },
          dedupeKeyPrefix: `risposte:${link.caseId.toLowerCase()}:${romeDate(now)}`,
        }),
      ),
    ],
    messages: PUBLIC_MESSAGES,
  });
  if (!applied.ok) {
    const message = applied.code === "link_non_valido" ? INVALID_LINK_MESSAGE : applied.message;
    return { ok: false, code: applied.code, message, retryable: applied.code === "conflitto" };
  }
  const label = referentStatusLabel({ status: plan.value.to, requestItemState: p.kind === "non_so" ? "non_so" : "inviata", clarification: false, hasDraft: false });
  return { ok: true, value: { itemId: s.id, status: plan.value.to, label: label.label, warnings: p.warnings } };
}

/**
 * Risposta del referente (`POST …/items/[itemId]/answer`): valore, conferma o
 * correzione del valore già noto, «Non lo so» (risposta valida), proposta «non
 * si applica», risposta a un chiarimento, «Ho risposto solo in parte», «È una
 * stima». Normalizzazione stretta e scansione bloccante; risposta nuova (a sola
 * aggiunta) e transizione nello stesso batch. Un conflitto si riprova una volta.
 */
export async function submitReferentAnswer(
  executor: UcExecutor,
  link: ResolvedLink,
  itemId: unknown,
  input: unknown,
  opts: PublicOptions,
): Promise<PublicOutcome<SubmittedAnswer>> {
  const writable = checkWritable(link);
  if (!writable.ok) return writable;
  const collection = checkCollection(link);
  if (!collection.ok) return collection;
  const parsed = AnswerSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const human = first && !/^(Invalid|Expected|Unrecognized|Too)/i.test(first.message) ? first.message : "Dati non validi. Aggiorna la pagina e riprova.";
    return publicFail("dati_non_validi", human);
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await submitOnce(executor, link, itemId, parsed.data, opts);
    if (r.ok || !r.retryable || attempt === 1) {
      if (!r.ok) return publicFail(r.code, r.message, r.issues);
      return r;
    }
  }
  return publicFail("conflitto", CHANGED);
}

// ── Invio a gruppi ────────────────────────────────────────────────────

const BatchSchema = z.strictObject({ answers: z.array(z.unknown()).min(1).max(MAX_BATCH_ANSWERS) });
const BatchEntrySchema = z.strictObject({ ...AnswerSchema.shape, item_id: z.string().regex(UUID) });

function humanParseMessage(error: z.ZodError): string {
  const first = error.issues[0];
  return first && !/^(Invalid|Expected|Unrecognized|Too)/i.test(first.message) ? first.message : "Dati non validi. Aggiorna la pagina e riprova.";
}

/**
 * Invio a gruppi del riepilogo di un argomento (`POST …/answers`, DESIGN §4.2
 * e §7.1 P0-11): al massimo 50 risposte, una sola unità del limite di
 * frequenza (la conta il route handler), un esito per ogni risposta. Ogni
 * risposta passa dalle stesse regole di `submitReferentAnswer` ed è un comando
 * a sé: una che non va non ferma le altre. Restano fuori le risposte che
 * partono da sole: dati personali, risposte a un chiarimento, voci con un
 * chiarimento aperto.
 */
export async function submitReferentAnswers(executor: UcExecutor, link: ResolvedLink, input: unknown, opts: PublicOptions): Promise<PublicOutcome<BatchAnswersResult>> {
  const writable = checkWritable(link);
  if (!writable.ok) return writable;
  const collection = checkCollection(link);
  if (!collection.ok) return collection;
  const parsed = BatchSchema.safeParse(input);
  if (!parsed.success) {
    const tooMany = parsed.error.issues.some((i) => i.code === "too_big");
    return publicFail("dati_non_validi", tooMany ? `Manda al massimo ${MAX_BATCH_ANSWERS} risposte alla volta.` : "Dati non validi. Aggiorna la pagina e riprova.");
  }
  const results: (BatchAnswerOutcome | null)[] = [];
  const valid: { index: number; itemId: string; data: AnswerInput }[] = [];
  const seen = new Set<string>();
  parsed.data.answers.forEach((raw, index) => {
    const entry = BatchEntrySchema.safeParse(raw);
    const rawId = raw && typeof raw === "object" && typeof (raw as Record<string, unknown>).item_id === "string" ? String((raw as Record<string, unknown>).item_id) : "";
    if (!entry.success) {
      results.push({ itemId: rawId, ok: false, code: "dati_non_validi", message: humanParseMessage(entry.error) });
      return;
    }
    const { item_id, ...data } = entry.data;
    const itemId = item_id.toLowerCase();
    if (seen.has(itemId)) {
      results.push({ itemId, ok: false, code: "voce_ripetuta", message: "Questa domanda compare due volte nell'invio." });
      return;
    }
    seen.add(itemId);
    if (data.kind === "risposta_chiarimento") {
      results.push({ itemId, ok: false, code: "invio_singolo", message: SINGLE_SEND_MESSAGE });
      return;
    }
    results.push(null);
    valid.push({ index, itemId, data });
  });
  const preloaded = await preloadReferentItems(executor, link, valid.map((v) => v.itemId));
  for (const { index, itemId, data } of valid) {
    const pre = preloaded.get(itemId)!;
    if (pre.loaded.ok && (pre.loaded.value.personal || pre.loaded.value.item.snapshot.openClarification)) {
      results[index] = { itemId, ok: false, code: "invio_singolo", message: SINGLE_SEND_MESSAGE };
      continue;
    }
    let r = await submitOnce(executor, link, itemId, data, opts, pre);
    // Un conflitto (la voce è cambiata nel frattempo) si riprova una volta, rileggendo la voce.
    if (!r.ok && r.retryable) r = await submitOnce(executor, link, itemId, data, opts);
    results[index] = r.ok
      ? { itemId, ok: true, status: r.value.status, label: r.value.label }
      : { itemId, ok: false, code: r.code, message: r.message, ...(r.issues && r.issues.length > 0 ? { issues: r.issues } : {}) };
  }
  const final = results.map((r) => r!);
  const sent = final.filter((r) => r.ok).length;
  return { ok: true, value: { sent, failed: final.length - sent, results: final } };
}

// ── Tabella da un file Excel ──────────────────────────────────────────

/** Esito di «Carica un Excel» su una domanda tabella: il file allegato e le sue righe. */
export interface TableFromFile {
  /** Il file caricato, come da `POST …/upload`: allegato alla risposta se è utilizzabile. */
  file: UploadResult;
  /** Righe del primo foglio con dati, intestazione compresa; null se il file non si legge come tabella. */
  rows: string[][] | null;
  /** Perché le righe mancano o sono incomplete, nelle parole del referente; altrimenti null. */
  rowsMessage: string | null;
}

const TABLE_UNREADABLE = "Non riesco a leggere una tabella da questo file: usa un Excel (.xlsx) o un CSV, oppure compila qui, riga per riga.";
const TABLE_CUT = `Ho letto solo le prime ${TABLE_LIMITS.maxRows.toLocaleString("it-IT")} righe e ${TABLE_LIMITS.maxCols} colonne del file.`;

/**
 * «Carica un Excel» su una domanda tabella (DESIGN §4.3 R2c): il file passa dal
 * caricamento di sempre (quarantena, controllo del contenuto, dichiarazione)
 * e resta allegato; se è pulito se ne leggono le righe con i lettori della
 * quarantena, senza parser di terze parti, perché la pagina riempia la tabella.
 * Le righe tornano solo a chi ha caricato il file; la tabella si controlla poi
 * come ogni bozza e ogni risposta.
 */
export async function tableFromReferentFile(
  executor: UcExecutor,
  link: ResolvedLink,
  input: { itemId: string; fileName: string; declaration: boolean; bytes: Uint8Array },
  meta: UcRequestMeta,
  env: UcFilesEnv,
  opts: PublicOptions,
): Promise<PublicOutcome<TableFromFile>> {
  const loaded = await loadReferentItem(executor, link, input.itemId, opts);
  if (!loaded.ok) return loaded;
  if (loaded.value.item.snapshot.responseType !== "tabella") return publicFail("voce_non_disponibile", "Questa domanda non chiede una tabella: allega il file con «Allega un file».");
  const uploaded = await uploadFromReferent(executor, link, input, meta, env);
  if (!uploaded.ok) return uploaded;
  const file = uploaded.value;
  if (file.status === "rifiutato" || !file.usable) return { ok: true, value: { file, rows: null, rowsMessage: null } };
  const table = readTabularFile(input.bytes, input.fileName);
  if (!table.ok) return { ok: true, value: { file, rows: null, rowsMessage: TABLE_UNREADABLE } };
  const all = table.value.rows;
  const rows = all.slice(0, TABLE_LIMITS.maxRows + 1).map((r) => r.slice(0, TABLE_LIMITS.maxCols).map((c) => c.slice(0, TABLE_LIMITS.maxCellLength)));
  const cut = table.value.truncated || all.length > rows.length || all.some((r) => r.length > TABLE_LIMITS.maxCols);
  return { ok: true, value: { file, rows, rowsMessage: cut ? TABLE_CUT : null } };
}

// ── Deleghe ───────────────────────────────────────────────────────────

export interface DelegationResult {
  /** `inviata`: il collega ha già il link; `da_approvare`: Lateral Space lo controlla prima. */
  status: "inviata" | "da_approvare";
  items: number;
  /** Percorso `/r/<token>` del collega, una volta sola, solo se l'email non è configurata. */
  link: string | null;
}

/**
 * «Chiedi a un collega» (`POST …/delegate`): scansione di nome e messaggio,
 * collega del cliente (mai Lateral Space, mai sé stessi), profondità ≤ 2, ≤ 5
 * deleghe al giorno dalla stessa richiesta. Il collega diventa un referente del
 * workspace (riusato per email). La richiesta nuova eredita il ruolo; le righe
 * del link passano a `delegata` (riga 8). Con un dominio nuovo per il caso la
 * richiesta resta in bozza finché Lateral Space non la approva; altrimenti le
 * voci passano al collega, le email (collega e chi delega) vanno in coda e,
 * senza email configurata, il link del collega torna una volta. In tutti e due
 * i casi la campanella avvisa Lateral Space.
 */
export async function delegateItems(executor: UcExecutor, link: ResolvedLink, input: unknown, opts: PublicOptions): Promise<PublicOutcome<DelegationResult>> {
  const writable = checkWritable(link);
  if (!writable.ok) return writable;
  const collection = checkCollection(link);
  if (!collection.ok) return collection;
  if (!isPlainObject(input)) return publicFail("dati_non_validi", "Indica nome ed email del collega.");
  const now = opts.now ?? new Date();
  const [delegable] = await executor.batch([delegableItemsSql({ caseId: link.caseId, requestId: link.requestId, contactId: link.contactId })]);
  const states = new Map(delegable.map((r) => [String(r.item_id), rowVocab(REQUEST_ITEM_STATES, r.state) ?? "da_fare"]));
  // Gli id delle domande non passano dalla scansione dei testi (P0-13): vedi `prepareDelegation`.
  const prepared = prepareDelegation(input, [...states.keys()]);
  if (!prepared.ok) return preparedFailure(prepared);
  const value = prepared.value as { nome: string; email: string; voci: string[]; messaggio?: string };
  const email = value.email.toLowerCase();
  if (link.contactEmail && link.contactEmail.trim().toLowerCase() === email) {
    return publicFail("delega_a_se_stessi", "Indica l'email di un collega, non la tua.", [issue("delega_a_se_stessi", "Indica l'email di un collega, non la tua.", "email")]);
  }
  const core = await loadCaseCore(executor, link.workspaceId, link.caseId);
  if (!core) return publicFail("link_non_valido", INVALID_LINK_MESSAGE);
  const sig = await loadSignatureContext(executor, core, opts.lsDomains);
  const [[existing], domainRows, [today]] = await executor.batch([
    contactByEmailSql({ workspaceId: link.workspaceId, email }),
    caseContactDomainsSql({ workspaceId: link.workspaceId, caseId: link.caseId }),
    delegationsTodaySql({ caseId: link.caseId, parentRequestId: link.requestId, excludeRequestId: randomUUID(), since: romeMidnightUtc(romeDateOf(now)) }),
  ]);
  const existingId = rowString(existing?.id);
  if (existingId === link.contactId) return publicFail("delega_a_se_stessi", "Indica l'email di un collega, non la tua.");
  if (existing && !rowBool(existing.is_active)) return publicFail("collega_non_attivo", "Questo collega non riceve più richieste: scrivi a Lateral Space.");
  const existingUserId = rowString(existing?.user_id);
  const existingUser = existingUserId ? await loadUserContext(executor, existingUserId, opts.lsDomains) : null;
  const allowed = checkContactEmail({ email, user: existingUser, lsDomains: opts.lsDomains, lsMemberEmails: sig.lsMemberEmails });
  if (!allowed.ok) return publicFail("delega_a_lateral_space", "Non si può girare una domanda a Lateral Space: chiedi a un collega della tua azienda.");
  const rules = checkDelegation({
    parentDepth: link.delegationDepth,
    delegationsToday: rowNumber(today?.n) ?? 0,
    delegateEmail: email,
    caseContactDomains: domainRows.map((r) => rowString(r.domain)).filter((d): d is string => !!d),
    lsDomains: opts.lsDomains,
    itemIds: value.voci,
    activeItemIds: [...states.keys()],
  });
  if (!rules.ok) return publicFail(rules.code, rules.message);
  const { depth, needsApproval } = rules.value;
  const send = !needsApproval;
  const contactId = existingId ?? randomUUID();
  const requestId = randomUUID();
  const issued = send && !opts.emailConfigured ? newRequestToken() : null;
  const template = templatePartsReader();
  const [[modulesRow], countRows] = await executor.batch([caseModulesDetailSql({ workspaceId: link.workspaceId, caseId: link.caseId }, template.columns), moduleQuestionCountsSql(link.caseId)]);
  const modules = withQuestionCounts(parseModules(template.read(modulesRow)?.modules), countRows);
  const message = cleanText(value.messaggio ?? null);
  const items = value.voci.length;
  const referentActor = { type: "referente" as const, contactId: link.contactId };

  const applied = await applyItemTransitions(executor, referentCtx(link, opts, now), {
    itemIds: value.voci,
    transitions: value.voci.map((itemId) => ({
      itemId,
      to: "chiesta" as const,
      trigger: "delega" as const,
      actorRequestItem: { requestId: link.requestId, state: states.get(itemId) ?? "da_fare" },
    })),
    before: [
      guard(link),
      ...(existingId
        ? []
        : [
            delegateContactInsertSql({ id: contactId, workspaceId: link.workspaceId, displayName: value.nome, email }),
            contactEventSql({ type: "referente.creato", workspaceId: link.workspaceId, caseId: link.caseId, actor: referentActor, contactId, roleKey: null, fields: ["display_name", "email", "preferred_channel"] }),
          ]),
    ],
    after: (_planned, loaded) => {
      const minutes = referentMinutes(value.voci.map((id) => ({ moduleKey: loaded.get(id)?.extra.requestModuleKey ?? null })), modules);
      const statements: UcStatement[] = [
        delegationRequestInsertSql({
          id: requestId,
          workspaceId: link.workspaceId,
          caseId: link.caseId,
          parentRequestId: link.requestId,
          contactId,
          message,
          send,
          nextReminderAt: send
            ? nextReminderAt({ status: "inviata", purpose: "raccolta", sentAt: now, expiresAt: expiryOnSend(now), revokedAt: null, reminderCount: 0, escalatedAt: null }, now)
            : null,
        }),
        delegationItemsInsertSql({ caseId: link.caseId, requestId, itemIds: value.voci }),
        delegationsPerDayGuardSql({ caseId: link.caseId, parentRequestId: link.requestId, since: romeMidnightUtc(romeDateOf(now)), max: MAX_DELEGATIONS_PER_DAY }),
        requestProgressSql({ caseId: link.caseId, requestId: link.requestId }),
        delegationEventSql({
          workspaceId: link.workspaceId,
          caseId: link.caseId,
          contactId: link.contactId,
          requestId,
          items,
          depth,
          needsApproval,
          ipHash: opts.ipHash ?? null,
          userAgent: opts.userAgent ?? null,
        }),
      ];
      if (send) {
        statements.push(
          alignAssigneeSql({ workspaceId: link.workspaceId, caseId: link.caseId, itemIds: value.voci, contactId, actor: referentActor }),
          toStatement(
            enqueueSql({
              workspaceId: link.workspaceId,
              caseId: link.caseId,
              requestId,
              recipient: { contactId },
              channel: "email",
              templateKey: "delega",
              payload: { items, minutes, case_code: core.code },
              dedupeKey: dedupeKey.delega(requestId),
            }),
          ),
        );
        if (link.contactEmail) {
          statements.push(
            toStatement(
              enqueueSql({
                workspaceId: link.workspaceId,
                caseId: link.caseId,
                requestId,
                recipient: { contactId: link.contactId },
                channel: "email",
                templateKey: "delega",
                payload: { items, case_code: core.code },
                dedupeKey: dedupeKey.delegaConferma(requestId),
              }),
            ),
          );
        }
        if (issued) {
          statements.push(
            tokenInsertSql({
              tokenId: randomUUID(),
              workspaceId: link.workspaceId,
              caseId: link.caseId,
              requestId,
              hash: issued.hash,
              prefix: issued.prefix,
              issuedFor: "delega",
              issuedByUserId: null,
            }),
          );
        }
      }
      // Lateral Space lo sa sempre (spec: «Lateral Space viene informato»): la campanella dice
      // se la delega è partita o aspetta l'approvazione (stato della richiesta nuova).
      statements.push(
        toStatement(
          enqueueForLsMembersSql({
            workspaceId: link.workspaceId,
            caseId: link.caseId,
            requestId,
            templateKey: "delega",
            payload: { items, case_code: core.code },
            dedupeKeyPrefix: bellPrefix.delegaDaApprovare(requestId),
          }),
        ),
      );
      return statements;
    },
    messages: PUBLIC_MESSAGES,
  });
  if (!applied.ok) return fromResult(applied);
  return { ok: true, value: { status: send ? "inviata" : "da_approvare", items, link: issued ? requestLinkPath(issued.token) : null } };
}

// ── Firme dal link di approvazione ────────────────────────────────────

/** Firme in attesa del contatto del link, secondo le sue designazioni di oggi. */
export async function loadApprovals(executor: UcExecutor, link: ResolvedLink): Promise<ApprovalView[]> {
  if (link.purpose !== "approvazioni") return [];
  const core = await loadCaseCore(executor, link.workspaceId, link.caseId);
  if (!core) return [];
  const isOwner = core.designated.owner === link.contactId;
  const isPrivacy = core.designated.privacy === link.contactId;
  if (!isOwner && !isPrivacy) return [];
  const [na, wf, gates, a8, zone] = await executor.batch([
    pendingNaSql(link.caseId),
    pendingWaiversAndFallbacksSql(link.caseId),
    pendingGateSql(link.caseId),
    pendingA8Sql(link.caseId),
    pendingZoneGrantsSql(link.caseId),
  ]);
  return buildApprovals({ rows: { na, waiversAndFallbacks: wf, gates, a8, zone }, contactId: link.contactId, designated: core.designated });
}

const DecisionSchema = z.strictObject({
  kind: z.enum(APPROVAL_KINDS),
  target_id: z.string().regex(UUID),
  decision: z.enum(["approvo", "non_approvo"]),
  read: z.literal(true),
  text_hash: z.string().regex(/^[0-9a-f]{64}$/),
  reason: z.string().max(2000).nullish(),
});

export interface ApprovalDecision {
  kind: ApprovalKind;
  targetId: string;
  decision: "approvo" | "non_approvo";
  /** Con questa firma la decisione è completa (le due firme ci sono). */
  complete: boolean;
}

/**
 * «Approvo» / «Non approvo» dal link di approvazione (`POST …/approve`): solo
 * `purpose = 'approvazioni'`, contatto ancora designato, «Ho letto» e testo
 * uguale a quello mostrato (`text_hash`). Si firma con i comandi interni e un
 * firmatario `link` (con l'impronta dell'IP). «Non approvo» con motivo vale per
 * «non si applica» e per il gate; per le altre firme basta non firmare.
 */
export async function decideApproval(executor: UcExecutor, link: ResolvedLink, input: unknown, opts: PublicOptions): Promise<PublicOutcome<ApprovalDecision>> {
  const writable = checkWritable(link);
  if (!writable.ok) return writable;
  if (link.purpose !== "approvazioni") return publicFail("stato_non_ammesso", "Questo link non serve per le approvazioni.");
  const parsed = DecisionSchema.safeParse(input);
  if (!parsed.success) {
    const readMissing = parsed.error.issues.some((i) => i.path[0] === "read");
    return publicFail("dati_non_validi", readMissing ? "Spunta «Ho letto» prima di decidere." : "Dati non validi. Aggiorna la pagina e riprova.");
  }
  const d = parsed.data;
  const pending = await loadApprovals(executor, link);
  const target = pending.find((a) => a.kind === d.kind && a.targetId.toLowerCase() === d.target_id.toLowerCase());
  if (!target) return publicFail("approvazione_non_trovata", "Questa decisione non è più in attesa della tua firma. Aggiorna la pagina.");
  if (target.textHash !== d.text_hash) return publicFail("testo_cambiato", "Il testo da approvare è cambiato: aggiorna la pagina e rileggilo.");
  const now = opts.now ?? new Date();
  const ctx: UcCommandContext = {
    workspaceId: link.workspaceId,
    caseId: link.caseId,
    actor: { type: "owner_link", contactId: link.contactId, requestId: link.requestId, designation: target.designation },
    user: null,
    lsDomains: opts.lsDomains,
    now,
  };
  const signer: Signer = { kind: "link", contactId: link.contactId, designation: target.designation, email: link.contactEmail, ipHash: opts.ipHash ?? null };
  const done = (complete: boolean): PublicOutcome<ApprovalDecision> => ({ ok: true, value: { kind: d.kind, targetId: target.targetId, decision: d.decision, complete } });

  if (d.decision === "non_approvo") {
    if (!target.canReject) {
      return publicFail("rifiuto_non_disponibile", "Se non sei d'accordo, non firmare e scrivi a Lateral Space: senza la tua firma la proposta resta ferma.");
    }
    const reason = cleanText(d.reason);
    if (!reason || reason.length < 3) return publicFail("motivo_mancante", "Scrivi perché non approvi.", [issue("motivo_mancante", "Scrivi perché non approvi.", "reason")]);
    const scanned = scanReferentText({ reason });
    if (!scanned.ok) return scanned;
    // «Non approvo» non passa da `signatureRole`: designazione ed email si ricontrollano qui.
    const core = await loadCaseCore(executor, link.workspaceId, link.caseId);
    if (!core) return publicFail("link_non_valido", INVALID_LINK_MESSAGE);
    const sig = await loadSignatureContext(executor, core, opts.lsDomains);
    const email = checkSignerEmail(link.contactEmail, opts.lsDomains, sig.lsMemberEmails);
    if (!email.ok || core.designated.owner !== link.contactId) return publicFail("firmatario_non_designato", "Il firmatario non è più quello designato dal cliente.");
    if (target.kind === "na") {
      const r = await rejectNa(executor, ctx, { itemId: target.targetId, reason, expectedTextHash: d.text_hash });
      return r.ok ? done(true) : fromResult(r);
    }
    const r = await rejectGateFromLink(executor, link, target, reason, opts);
    return r.ok ? done(true) : r;
  }

  switch (target.kind) {
    case "na": {
      const r = await signNa(executor, ctx, { itemId: target.targetId, expectedTextHash: d.text_hash }, signer);
      return r.ok ? done(r.value.complete) : fromResult(r);
    }
    case "deroga": {
      const r = await signWaiver(executor, ctx, { itemId: target.targetId, expectedTextHash: d.text_hash }, signer);
      return r.ok ? done(r.value.complete) : fromResult(r);
    }
    case "ripiego": {
      const r = await signFallback(executor, ctx, { itemId: target.targetId, expectedTextHash: d.text_hash }, signer);
      return r.ok ? done(r.value.complete) : fromResult(r);
    }
    case "gate": {
      const r = await signGate(executor, ctx, { reviewId: target.targetId }, signer);
      return r.ok ? done(r.value.complete) : fromResult(r);
    }
    case "a8": {
      const r = await resolveBlocker(executor, ctx, { blockerId: target.targetId, expectedTextHash: d.text_hash }, signer);
      return r.ok ? done(r.value.complete) : fromResult(r);
    }
    case "zona_personale": {
      // Firmata solo sul testo letto: una concessione riproposta nel frattempo dà «testo_cambiato» (409).
      const r = await signPersonalZoneAccess(executor, ctx, { userId: target.targetId }, signer, { expectedTextHash: d.text_hash });
      return r.ok ? done(r.value.active) : fromResult(r);
    }
  }
}

/** Gate respinto dall'Owner designato dal link: CAS sulla proposta aperta e sulle firme lette, evento senza testo. */
async function rejectGateFromLink(executor: UcExecutor, link: ResolvedLink, target: ApprovalView, reason: string, opts: PublicOptions): Promise<PublicOutcome<void>> {
  const [rows] = await executor.batch([pendingGateSql(link.caseId)]);
  const row = rows.find((r: Row) => String(r.id) === target.targetId);
  if (!row) return publicFail("approvazione_non_trovata", "Questa decisione non è più in attesa della tua firma. Aggiorna la pagina.");
  const approvals = (rowJson<Approval[]>(row.approvals) ?? []) as Approval[];
  const run = await runCommand(
    executor,
    [
      guard(link),
      gateReviewDecideSql({ reviewId: target.targetId, caseId: link.caseId, decision: "respinto", oldApprovals: approvals, approvals, catalogVersion: null, snapshotHash: null, notes: reason }),
      gateRejectedEventSql({
        workspaceId: link.workspaceId,
        caseId: link.caseId,
        contactId: link.contactId,
        reviewId: target.targetId,
        gate: String(row.gate_key ?? "G1"),
        summaryTextHash: String(row.summary_text_hash),
        ipHash: opts.ipHash ?? null,
        userAgent: opts.userAgent ?? null,
      }),
    ],
    PUBLIC_MESSAGES,
  );
  return run.ok ? { ok: true, value: undefined } : fromResult(run);
}
