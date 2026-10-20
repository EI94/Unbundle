/**
 * Referenti, assegnazioni e richieste interne della sezione «Casi d'uso»
 * (PIANO §5.3 `uc-people.ts`, §5.4, §7.1; D13, D16, D42; b10, b29, b30, b33).
 *
 * - Referenti (`uc_contacts`, a livello di workspace): creazione, modifica,
 *   anonimizzazione. L'email è sempre del cliente (`checkContactEmail`); un
 *   cambio di email revoca i link già mandati e, per un firmatario designato,
 *   toglie le sue firme in attesa e i link di approvazione.
 * - Assegnazione delle voci a un referente, una per una, per ruolo del template
 *   o con il referente proposto dal ruolo (`checkAssignee`).
 * - Richieste: bozza, invio (una richiesta = un referente + le sue voci; le voci
 *   passano a «Chiesta» con `checkItemTransition`), reinvio, «Copia link»
 *   (token nuovo `copia`, mostrato una volta, mai per i link di approvazione),
 *   revoca singola e in blocco (`share_epoch`: voci `chiesta` di nuovo da
 *   chiedere, riga 31, e token MCP del caso revocati), proroga (al massimo
 *   `now() + 30 giorni`), approvazione delle deleghe (profondità ≤ 2, ≤ 5 al
 *   giorno), richiesta di conferma al titolare del dato (riga 19) e link di
 *   approvazione per email al firmatario designato.
 * - Token: `issueRequestToken` emette un token per l'invio, il promemoria o la
 *   delega (dispatch delle email, API pubbliche). In banca dati va solo la sua
 *   impronta sha256; il token in chiaro non si registra mai.
 *
 * Modulo senza import dell'app (`@/…`, `server-only`), come `uc-cases.ts`:
 * l'esecutore arriva da fuori. L'accesso al workspace e al caso lo controlla
 * il chiamante; qui ogni comando ricalcola i permessi con le funzioni pure e
 * scrive con compare-and-swap più evento nello stesso batch.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { checkCaseTransition } from "../../uc/case-state.ts";
import { addDaysToDate, isIsoDate, romeDateOf, romeMidnightUtc } from "../../uc/freshness.ts";
import { checkItemTransition } from "../../uc/item-state.ts";
import { dedupeKey } from "../../uc/notify/dedupe.ts";
import { nextReminderAt } from "../../uc/notify/schedule.ts";
import { can, checkSignerEmail, type CaseAction } from "../../uc/permissions.ts";
import { checkExtendExpiry, estimateMinutes, expiryOnSend, requestStatusLabel } from "../../uc/request-state.ts";
import { rowBool, rowDate, rowJson, rowNumber, rowObject, rowString, rowStringArray, type CaseCore, type Row } from "../../uc/sql/readiness.ts";
import {
  REQUEST_MESSAGES,
  alignAssigneeSql,
  assignItemsSql,
  assignmentItemsSql,
  caseModulesRow,
  caseModulesSql,
  caseRequestsListSql,
  channelForContact,
  checkConfirmationTarget,
  checkContactAssignable,
  checkContactDraft,
  checkCopyLink,
  checkDelegationApproval,
  checkRemind,
  checkRequestable,
  checkRevoke,
  contactAnonymizeSql,
  contactApprovalRequestsRevokeSql,
  contactDesignationsSql,
  contactEmailTakenSql,
  contactEventSql,
  contactHasNoOpenRequestsSql,
  contactIdOf,
  contactInsertSql,
  contactNotDesignatedSql,
  contactNotificationsCancelSql,
  contactRoleIfMissingSql,
  contactRowsSql,
  contactsListSql,
  contactTokensRevokeSql,
  contactUpdateSql,
  delegationsTodaySql,
  extendExpirySql,
  groupByAssignee,
  linkCopiedEventSql,
  linksRevokedEventSql,
  liveApprovalRequestSql,
  noAskedItemsLeftSql,
  notificationExistsSql,
  parseContactRow,
  parseRequestRow,
  planAssignment,
  prepareContact,
  prepareContactPatch,
  requestChannelSql,
  requestEventSql,
  requestInsertSql,
  requestItemsInsertSql,
  requestItemsReleaseSql,
  requestItemsStillAskedSql,
  requestLiveGuardSql,
  requestNotificationsCancelSql,
  requestRevokeSql,
  requestRowSql,
  requestSendSql,
  requestTokensRevokeSql,
  revokeAllRequestsSql,
  revokeAllTargetsSql,
  revokedRequestItemsReleaseSql,
  revokedRequestNotificationsCancelSql,
  roleContactsSql,
  shareEpochBumpSql,
  splitRequestable,
  suggestContactForRole,
  tokenInsertSql,
  tokenRevokeSql,
  type AssignableItem,
  type AssignmentTarget,
  type ContactRowState,
  type RequestRowState,
  type SkippedItem,
} from "../../uc/sql/request-commands.ts";
import { toStatement, type UcStatement } from "../../uc/sql/statement.ts";
import { templatePartsReader } from "../../uc/sql/template-parts.ts";
import { caseRevisionSql, caseTransitionSql, dropPendingApprovalsSql, requestItemsStateSql, revokeCaseMcpTokensSql, revokeCaseTokensSql } from "../../uc/sql/transitions.ts";
import { newRequestToken, requestLinkPath } from "../../uc/tokens.ts";
import { fail, ok, type Result, type UserContext } from "../../uc/types.ts";
import { isVocab, ITEM_STATUSES, REQUEST_STATUSES, RESPONSE_TYPES, type ItemStatus, type RequestChannel, type RequestStatus, type ResponseType } from "../../uc/vocab.ts";
import { eventActorFrom } from "./uc-events.ts";
import { enqueueSql } from "./uc-notifications.ts";
import { actorRoles, actorUserId, checkLsText, isUuid, loadCaseCore, loadSignatureContext, loadUserContext, runCommand, type UcCommandContext } from "./uc-cases.ts";
import { applyItemTransitions, loadItems, type AppliedTransitions, type LoadedItem } from "./uc-items.ts";
import type { UcExecutor } from "../uc-executor.ts";
import { UUID } from "../../uc/ids.ts";

const Id = z.string().regex(UUID, "Identificativo non valido.");
const CASE_NOT_FOUND = "Caso non trovato.";
const REQUEST_NOT_FOUND = "Richiesta non trovata in questo caso.";
const CONTACT_NOT_FOUND = "Referente non trovato in questo workspace.";
const MAX_ITEMS = 2000;

/** Opzioni dei comandi che dipendono dall'ambiente (lette dall'azione). */
export interface RequestCommandOptions {
  /** `RESEND_API_KEY` e `UC_EMAIL_FROM` presenti: le email partono davvero. */
  emailConfigured?: boolean;
}

// ── Aiuti ─────────────────────────────────────────────────────────────

const ACTOR_MESSAGES: Partial<Record<CaseAction, string>> = {
  aggiungere_referenti: "Solo il responsabile Lateral Space o il responsabile del cliente aggiungono referenti.",
  gestire_membri: "Solo il responsabile Lateral Space modifica i referenti.",
  assegnare: "Solo il responsabile Lateral Space assegna le domande.",
  riassegnare: "Solo il responsabile Lateral Space o il responsabile del cliente cambiano chi risponde a una domanda.",
  inviare_richieste: "Solo il responsabile Lateral Space invia le domande e i link.",
  revocare_link: "Solo il responsabile Lateral Space revoca i link.",
};

/** L'attore è un utente con il permesso indicato; restituisce il suo id. */
function actorFor(ctx: UcCommandContext, action: CaseAction): Result<string> {
  const userId = actorUserId(ctx);
  if (!userId || !can(actorRoles(ctx), action)) return fail("attore_non_ammesso", ACTOR_MESSAGES[action] ?? "Non puoi fare questa operazione.");
  return ok(userId);
}

/** Caso del workspace, non chiuso; con `sending` nemmeno sospeso (niente invii durante la pausa). */
async function openCase(executor: UcExecutor, ctx: UcCommandContext, opts: { sending?: boolean } = {}): Promise<Result<CaseCore>> {
  const core = await loadCaseCore(executor, ctx.workspaceId, ctx.caseId);
  if (!core) return fail("non_trovato", CASE_NOT_FOUND);
  if (core.status === "chiuso") return fail("caso_chiuso", REQUEST_MESSAGES.caso_chiuso);
  if (opts.sending && core.status === "sospeso") return fail("caso_sospeso", "Il caso è in pausa: niente invii finché non riprende.");
  return ok(core);
}

/** Guardia di apertura dei batch che non cambiano lo stato delle voci: caso ancora nello stato letto, senza alzare la revisione. */
function caseGuard(ctx: UcCommandContext, core: CaseCore): UcStatement {
  return caseRevisionSql({ workspaceId: ctx.workspaceId, caseId: ctx.caseId, expectStatus: [core.status], bump: false });
}

async function lsMemberEmails(executor: UcExecutor, core: CaseCore, lsDomains: readonly string[]): Promise<string[]> {
  return [...(await loadSignatureContext(executor, core, lsDomains)).lsMemberEmails];
}

async function loadContacts(executor: UcExecutor, workspaceId: string, ids: readonly string[]): Promise<Map<string, ContactRowState>> {
  const unique = [...new Set(ids)].filter((id) => isUuid(id));
  if (unique.length === 0) return new Map();
  const [rows] = await executor.batch([contactRowsSql(workspaceId, unique)]);
  const out = new Map<string, ContactRowState>();
  for (const row of rows) {
    const c = parseContactRow(row);
    if (c) out.set(c.id, c);
  }
  return out;
}

/** Account collegato al referente, se c'è: serve a `checkContactEmail` (un account di Lateral Space non è un referente). */
async function contactUser(executor: UcExecutor, contact: Pick<ContactRowState, "userId">, lsDomains: readonly string[]): Promise<UserContext | null> {
  return contact.userId ? loadUserContext(executor, contact.userId, lsDomains) : null;
}

async function assignable(executor: UcExecutor, contact: ContactRowState, ctx: UcCommandContext, emails: readonly string[]): Promise<Result<void>> {
  return checkContactAssignable(contact, { lsDomains: ctx.lsDomains, lsMemberEmails: emails, user: await contactUser(executor, contact, ctx.lsDomains) });
}

async function loadRequest(executor: UcExecutor, ctx: UcCommandContext, requestId: unknown): Promise<Result<RequestRowState>> {
  if (!isUuid(requestId)) return fail("dati_non_validi", "Richiesta non valida.");
  const [rows] = await executor.batch([requestRowSql({ workspaceId: ctx.workspaceId, caseId: ctx.caseId, requestId })]);
  const r = parseRequestRow(rows[0]);
  return r ? ok(r) : fail("richiesta_non_trovata", REQUEST_NOT_FOUND);
}

interface CaseTemplateInfo {
  modules: { key: string; title: string | null; roleKey: string | null; estimatedMinutes: number | null }[];
  roles: { key: string; label: string }[];
}

async function loadTemplateInfo(executor: UcExecutor, ctx: Pick<UcCommandContext, "workspaceId" | "caseId">): Promise<CaseTemplateInfo> {
  const template = templatePartsReader();
  const [[raw]] = await executor.batch([caseModulesSql({ workspaceId: ctx.workspaceId, caseId: ctx.caseId }, template.columns)]);
  const row = caseModulesRow(raw, template.read(raw));
  const modules = (rowJson<unknown[]>(row?.modules) ?? [])
    .filter((m): m is Record<string, unknown> => !!m && typeof m === "object" && typeof (m as Record<string, unknown>).key === "string")
    .map((m) => ({
      key: String(m.key),
      title: typeof m.title === "string" ? m.title : null,
      roleKey: typeof m.role_key === "string" ? m.role_key : null,
      estimatedMinutes: typeof m.estimated_minutes === "number" && Number.isFinite(m.estimated_minutes) ? m.estimated_minutes : null,
    }));
  const labels = rowObject(row?.role_labels);
  const roles = (rowJson<unknown[]>(row?.roles) ?? [])
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object" && typeof (r as Record<string, unknown>).key === "string")
    .map((r) => {
      const key = String(r.key);
      const fromCase = labels[key];
      return { key, label: typeof fromCase === "string" && fromCase.trim() ? fromCase : typeof r.label === "string" ? r.label : key };
    });
  return { modules, roles };
}

function minutesFor(info: CaseTemplateInfo, moduleKeys: readonly (string | null)[]): number {
  return estimateMinutes(info.modules, moduleKeys.map((moduleKey) => ({ moduleKey })));
}

/** Prossimo promemoria di una richiesta appena inviata (3 giorni lavorativi, alle 9 a Roma). */
function firstReminderAt(now: Date): Date | null {
  return nextReminderAt({ status: "inviata", purpose: "raccolta", sentAt: now, expiresAt: expiryOnSend(now), revokedAt: null, reminderCount: 0, escalatedAt: null }, now);
}

const MessageSchema = z.string().trim().max(2000, "Il messaggio può avere al massimo 2.000 caratteri.").nullish();

function cleanMessage(raw: string | null | undefined): Result<string | null> {
  const message = raw && raw.trim() ? raw.trim() : null;
  if (message) {
    const scanned = checkLsText({ message });
    if (!scanned.ok) return scanned;
  }
  return ok(message);
}

/** Email «richiesta inviata» al referente; il link (token nuovo) lo mette il dispatch al momento dell'invio. */
function requestEmailSql(i: { ctx: UcCommandContext; core: CaseCore; requestId: string; contactId: string; items: number; minutes: number; now: Date; shareEpoch?: number }): UcStatement {
  return toStatement(
    enqueueSql({
      workspaceId: i.ctx.workspaceId,
      caseId: i.ctx.caseId,
      requestId: i.requestId,
      recipient: { contactId: i.contactId },
      channel: "email",
      templateKey: "richiesta_inviata",
      payload: { items: i.items, minutes: i.minutes, case_code: i.core.code },
      dedupeKey: dedupeKey.richiesta(i.requestId, i.shareEpoch ?? i.core.shareEpoch, i.now),
    }),
  );
}

/** Elenco delle voci saltate da mostrare: le prime 200, più il totale. */
const MAX_SKIPPED_LISTED = 200;
function capSkipped(skipped: readonly SkippedItem[]): { skipped: SkippedItem[]; skippedTotal: number } {
  return { skipped: skipped.slice(0, MAX_SKIPPED_LISTED), skippedTotal: skipped.length };
}

function firstSkipFailure(skipped: readonly SkippedItem[], fallback: string): Result<never> {
  const first = skipped[0];
  // Mai la chiave della voce nel messaggio: lo leggono anche le persone del cliente.
  return first ? fail(first.code, skipped.length > 1 ? `${first.message} (${skipped.length} domande)` : first.message) : fail("nessuna_voce", fallback);
}

interface LightItem {
  id: string;
  key: string;
  title: string;
  status: ItemStatus;
  responseType: ResponseType | null;
  activeBlockerKeys: string[];
  assigneeContactId: string | null;
  activeRequestId: string | null;
  moduleKey: string | null;
  ownerRoleKey: string | null;
}

/** Riga di `assignmentItemsSql`: solo stato e metadati, per la preselezione (i comandi rileggono la voce intera). */
function lightItem(row: Row): LightItem | null {
  const status = rowString(row.status);
  if (!isVocab(ITEM_STATUSES, status)) return null;
  const responseType = rowString(row.response_type);
  return {
    id: String(row.id),
    key: String(row.key),
    title: String(row.title ?? ""),
    status,
    responseType: isVocab(RESPONSE_TYPES, responseType) ? responseType : null,
    activeBlockerKeys: rowBool(row.blocked) ? ["blocco"] : [],
    assigneeContactId: rowString(row.assignee_contact_id),
    activeRequestId: rowString(row.active_request_id),
    moduleKey: rowString(row.request_module_key),
    ownerRoleKey: rowString(row.owner_role_key),
  };
}

async function lightItems(executor: UcExecutor, filter: Parameters<typeof assignmentItemsSql>[0]): Promise<LightItem[]> {
  const [rows] = await executor.batch([assignmentItemsSql(filter)]);
  return rows.map(lightItem).filter((x): x is LightItem => x !== null);
}

function isLightRequestable(item: LightItem, contactId?: string | null): boolean {
  return checkRequestable(item, { activeRequestId: item.activeRequestId, contactId: contactId ?? null }).ok;
}

// ── Token dei link ────────────────────────────────────────────────────

export interface IssuedLink {
  /** Token in chiaro: solo per l'email o per la risposta di «Copia link». Mai in log, eventi o payload. */
  token: string;
  tokenId: string;
  prefix: string;
}

/**
 * Emette un token per una richiesta viva (`uc_request_live`, orologio del DB) e
 * ne salva solo l'impronta. Lo usano il dispatch delle email (`invio`,
 * `promemoria`, anche per i link di approvazione) e la delega dalle API
 * pubbliche (`delega`, solo richieste di raccolta). «Copia link» passa da
 * `copyRequestLink`, che registra chi copia. `extra` va nello stesso batch.
 */
export async function issueRequestToken(
  executor: UcExecutor,
  i: { workspaceId: string; caseId: string; requestId: string; issuedFor: "invio" | "promemoria" | "delega"; extra?: readonly UcStatement[] },
): Promise<Result<IssuedLink>> {
  if (!isUuid(i.workspaceId) || !isUuid(i.caseId) || !isUuid(i.requestId)) return fail("dati_non_validi", "Richiesta non valida.");
  const issued = newRequestToken();
  const tokenId = randomUUID();
  const run = await runCommand(
    executor,
    [
      tokenInsertSql({ tokenId, workspaceId: i.workspaceId, caseId: i.caseId, requestId: i.requestId, hash: issued.hash, prefix: issued.prefix, issuedFor: i.issuedFor, issuedByUserId: null }),
      ...(i.extra ?? []),
    ],
    REQUEST_MESSAGES,
  );
  if (!run.ok) return run;
  return ok({ token: issued.token, tokenId, prefix: issued.prefix });
}

/** Revoca un token appena emesso (l'email che lo portava non è partita). */
export async function revokeIssuedToken(executor: UcExecutor, i: { caseId: string; tokenId: string }): Promise<void> {
  if (!isUuid(i.caseId) || !isUuid(i.tokenId)) return;
  await executor.batch([tokenRevokeSql(i)]);
}

// ── Referenti ─────────────────────────────────────────────────────────

async function checkTemplateRole(executor: UcExecutor, ctx: UcCommandContext, roleKey: string | null | undefined): Promise<Result<void>> {
  if (!roleKey) return ok(undefined);
  const info = await loadTemplateInfo(executor, ctx);
  return info.roles.some((r) => r.key === roleKey) ? ok(undefined) : fail("ruolo_non_previsto", "Questo ruolo non è previsto dallo schema del dossier.");
}

/** Aggiunge un referente del cliente (Responsabile del caso o Owner del cliente). */
export async function createContact(executor: UcExecutor, ctx: UcCommandContext, input: unknown): Promise<Result<{ contactId: string }>> {
  const who = actorFor(ctx, "aggiungere_referenti");
  if (!who.ok) return who;
  const draft = prepareContact(input);
  if (!draft.ok) return draft;
  const opened = await openCase(executor, ctx);
  if (!opened.ok) return opened;
  const core = opened.value;
  const role = await checkTemplateRole(executor, ctx, draft.value.templateRoleKey);
  if (!role.ok) return role;
  const emails = await lsMemberEmails(executor, core, ctx.lsDomains);
  const allowed = checkContactDraft(draft.value, { lsDomains: ctx.lsDomains, lsMemberEmails: emails });
  if (!allowed.ok) return allowed;
  if (draft.value.email) {
    const [[taken]] = await executor.batch([contactEmailTakenSql({ workspaceId: ctx.workspaceId, email: draft.value.email })]);
    if (rowBool(taken?.taken)) return fail("email_in_uso", REQUEST_MESSAGES.email_in_uso);
  }
  const contactId = randomUUID();
  const d = draft.value;
  const fields = ["display_name", "preferred_channel", d.roleLabel && "role_label", d.templateRoleKey && "template_role_key", d.email && "email", d.phoneE164 && "phone_e164"].filter(
    (f): f is string => typeof f === "string",
  );
  const run = await runCommand(
    executor,
    [
      caseGuard(ctx, core),
      contactInsertSql({ id: contactId, workspaceId: ctx.workspaceId, draft: d, createdByUserId: who.value }),
      contactEventSql({ type: "referente.creato", workspaceId: ctx.workspaceId, caseId: ctx.caseId, actor: eventActorFrom(ctx.actor), contactId, roleKey: d.templateRoleKey, fields }),
    ],
    REQUEST_MESSAGES,
  );
  return run.ok ? ok({ contactId }) : run;
}

export interface UpdatedContact {
  contactId: string;
  fields: string[];
  /** L'email è cambiata: i link già mandati non valgono più (si reinvia o si copia un link nuovo). */
  linksRevoked: boolean;
}

/**
 * Modifica un referente (Responsabile del caso). Un'email cambiata revoca i
 * link già mandati; per un firmatario designato toglie anche le firme dal link
 * in attesa e i link di approvazione. Un referente con richieste aperte o
 * designato come firmatario non si disattiva.
 */
export async function updateContact(executor: UcExecutor, ctx: UcCommandContext, input: unknown): Promise<Result<UpdatedContact>> {
  const who = actorFor(ctx, "gestire_membri");
  if (!who.ok) return who;
  const contactId = contactIdOf(input);
  if (!contactId) return fail("dati_non_validi", "Referente non valido.");
  const opened = await openCase(executor, ctx);
  if (!opened.ok) return opened;
  const core = opened.value;
  const contact = (await loadContacts(executor, ctx.workspaceId, [contactId])).get(contactId);
  if (!contact) return fail("contatto_non_trovato", CONTACT_NOT_FOUND);
  const prepared = prepareContactPatch(input, contact);
  if (!prepared.ok) return prepared;
  const { patch, fields, emailChanged, deactivated } = prepared.value;
  if (fields.length === 0) return ok({ contactId, fields: [], linksRevoked: false });
  if (patch.templateRoleKey) {
    const role = await checkTemplateRole(executor, ctx, patch.templateRoleKey);
    if (!role.ok) return role;
  }
  const [designationRows] = await executor.batch([contactDesignationsSql(ctx.workspaceId, contactId)]);
  const designated = designationRows.length > 0;
  if (emailChanged) {
    const emails = await lsMemberEmails(executor, core, ctx.lsDomains);
    const allowed = checkContactDraft({ email: patch.email ?? null }, { lsDomains: ctx.lsDomains, lsMemberEmails: emails, user: await contactUser(executor, contact, ctx.lsDomains) });
    if (!allowed.ok) return allowed;
    if (designated) {
      if (!patch.email) return fail("email_firmatario", "È firmatario del cliente: l'email serve per il link di approvazione. Cambia prima la designazione.");
      const signer = checkSignerEmail(patch.email, ctx.lsDomains, emails);
      if (!signer.ok) return signer;
    }
    if (patch.email) {
      const [[taken]] = await executor.batch([contactEmailTakenSql({ workspaceId: ctx.workspaceId, email: patch.email, excludeContactId: contactId })]);
      if (rowBool(taken?.taken)) return fail("email_in_uso", REQUEST_MESSAGES.email_in_uso);
    }
  }
  const statements: UcStatement[] = [caseGuard(ctx, core)];
  if (deactivated) statements.push(contactHasNoOpenRequestsSql(contactId), contactNotDesignatedSql(ctx.workspaceId, contactId));
  statements.push(contactUpdateSql({ workspaceId: ctx.workspaceId, contactId, patch, expect: { email: contact.email, isActive: contact.isActive } }));
  if (emailChanged) {
    statements.push(contactTokensRevokeSql(contactId));
    if (designated) {
      statements.push(
        ...dropPendingApprovalsSql({ scope: { workspaceId: ctx.workspaceId }, match: { contactId } }),
        contactApprovalRequestsRevokeSql({ contactId, reasonCode: "email_cambiata" }),
      );
    }
  }
  statements.push(
    contactEventSql({
      type: "referente.modificato",
      workspaceId: ctx.workspaceId,
      caseId: ctx.caseId,
      actor: eventActorFrom(ctx.actor),
      contactId,
      roleKey: patch.templateRoleKey ?? contact.templateRoleKey,
      fields,
    }),
  );
  const run = await runCommand(executor, statements, REQUEST_MESSAGES);
  return run.ok ? ok({ contactId, fields, linksRevoked: emailChanged }) : run;
}

const ContactOnlySchema = z.object({ contactId: Id });

/**
 * Anonimizza un referente (Responsabile del caso): il nome diventa l'etichetta
 * del ruolo, email e telefono si tolgono, i suoi link si revocano e la sua coda
 * si annulla. Non con richieste aperte né se è firmatario designato.
 */
export async function anonymizeContact(executor: UcExecutor, ctx: UcCommandContext, input: unknown): Promise<Result<{ contactId: string }>> {
  const who = actorFor(ctx, "gestire_membri");
  if (!who.ok) return who;
  const parsed = ContactOnlySchema.safeParse(input);
  if (!parsed.success) return fail("dati_non_validi", "Referente non valido.");
  const { contactId } = parsed.data;
  const opened = await openCase(executor, ctx);
  if (!opened.ok) return opened;
  const contact = (await loadContacts(executor, ctx.workspaceId, [contactId])).get(contactId);
  if (!contact) return fail("contatto_non_trovato", CONTACT_NOT_FOUND);
  if (contact.anonymized) return fail("contatto_anonimizzato", "Il referente è già anonimizzato.");
  const run = await runCommand(
    executor,
    [
      caseGuard(ctx, opened.value),
      contactHasNoOpenRequestsSql(contactId),
      contactNotDesignatedSql(ctx.workspaceId, contactId),
      contactAnonymizeSql({ workspaceId: ctx.workspaceId, contactId }),
      contactTokensRevokeSql(contactId),
      contactNotificationsCancelSql(contactId),
      contactEventSql({ type: "referente.anonimizzato", workspaceId: ctx.workspaceId, caseId: ctx.caseId, actor: eventActorFrom(ctx.actor), contactId, roleKey: contact.templateRoleKey }),
    ],
    REQUEST_MESSAGES,
  );
  return run.ok ? ok({ contactId }) : run;
}

// ── Assegnazione ──────────────────────────────────────────────────────

const RoleKeySchema = z.string().trim().regex(/^[a-z0-9_]{1,80}$/, "Ruolo non valido.");

const AssignSchema = z.discriminatedUnion("mode", [
  /** Voci scelte → un referente (o nessuno, con `contactId: null`). */
  z.object({ mode: z.literal("voci"), itemIds: z.array(Id).min(1).max(MAX_ITEMS), contactId: Id.nullable() }),
  /** Tutte le voci di un ruolo del template (o solo quelle scelte) → un referente. */
  z.object({ mode: z.literal("ruolo"), roleKey: RoleKeySchema, contactId: Id, itemIds: z.array(Id).min(1).max(MAX_ITEMS).optional(), overwrite: z.boolean().optional() }),
  /** Ogni voce (tutte o quelle scelte) → il referente proposto dal suo ruolo, se ce n'è uno solo. */
  z.object({ mode: z.literal("proposta"), itemIds: z.array(Id).min(1).max(MAX_ITEMS).optional(), overwrite: z.boolean().optional() }),
]);

export interface AssignmentResult {
  assigned: number;
  unchanged: number;
  /** Al massimo le prime 200 voci saltate, con il motivo; il totale è in `skippedTotal`. */
  skipped: SkippedItem[];
  skippedTotal: number;
  /** Voci con un ruolo del titolare diverso da quello del referente: per le obbligatorie servirà la conferma del titolare. */
  roleMismatch: number;
}

/**
 * Assegna le voci (PIANO §5.3 `assignItems`): una per una, in blocco per ruolo
 * («tutte le voci del controllo di gestione») o con il referente proposto dal
 * ruolo del template. Una voce in una richiesta aperta non cambia referente.
 * Il referente è attivo e del cliente (`checkAssignee`).
 */
export async function assignItems(executor: UcExecutor, ctx: UcCommandContext, input: unknown): Promise<Result<AssignmentResult>> {
  const parsed = AssignSchema.safeParse(input);
  if (!parsed.success) return fail("dati_non_validi", parsed.error.issues[0]?.message ?? "Controlla le domande e il referente.");
  const data = parsed.data;
  const who = actorFor(ctx, data.mode === "voci" ? "riassegnare" : "assegnare");
  if (!who.ok) return who;
  const opened = await openCase(executor, ctx);
  if (!opened.ok) return opened;
  const core = opened.value;
  const items = await lightItems(executor, {
    caseId: ctx.caseId,
    itemIds: data.itemIds ?? null,
    roleKey: data.mode === "ruolo" ? data.roleKey : null,
  });
  if (data.mode === "voci" && items.length !== new Set(data.itemIds).size) return fail("voce_non_trovata", "Domanda non trovata in questo dossier.");
  // Su tutto il caso la proposta riguarda solo le voci con un ruolo del titolare: le altre non sono «saltate».
  const considered = data.mode === "proposta" && !data.itemIds ? items.filter((i) => i.ownerRoleKey) : items;
  if (considered.length === 0) return fail("nessuna_voce", data.mode === "ruolo" ? "Nessuna domanda ha questo ruolo." : "Nessuna domanda da assegnare.");
  const emails = await lsMemberEmails(executor, core, ctx.lsDomains);

  let target: (item: AssignableItem) => AssignmentTarget;
  const contactsById = new Map<string, ContactRowState>();
  if (data.mode === "proposta") {
    const [rows] = await executor.batch([roleContactsSql(ctx.workspaceId)]);
    const candidates = rows.map(parseContactRow).filter((c): c is ContactRowState => c !== null);
    const valid = new Set<string>();
    for (const c of candidates) {
      contactsById.set(c.id, c);
      if ((await assignable(executor, c, ctx, emails)).ok) valid.add(c.id);
    }
    const usable = candidates.filter((c) => valid.has(c.id));
    target = (item) => suggestContactForRole(usable, item.ownerRoleKey);
  } else if (data.contactId === null) {
    target = () => ({ contactId: null });
  } else {
    const contact = (await loadContacts(executor, ctx.workspaceId, [data.contactId])).get(data.contactId);
    if (!contact) return fail("contatto_non_trovato", CONTACT_NOT_FOUND);
    const allowed = await assignable(executor, contact, ctx, emails);
    if (!allowed.ok) return allowed;
    contactsById.set(contact.id, contact);
    target = () => ({ contactId: contact.id });
  }
  const plan = planAssignment({ items: considered, target, overwrite: data.mode === "voci" ? true : (data.overwrite ?? false) });
  const skipped = capSkipped(plan.skipped.map((s) => ({ itemId: s.id, key: s.key, code: s.code, message: s.message })));
  const ownerRole = new Map(considered.map((i) => [i.id, i.ownerRoleKey]));
  const roleMismatch = plan.assign.filter((a) => {
    const role = ownerRole.get(a.id);
    const contactRole = a.contact ? (contactsById.get(a.contact)?.templateRoleKey ?? (data.mode === "ruolo" ? data.roleKey : null)) : null;
    return Boolean(a.contact && role && contactRole && role !== contactRole);
  }).length;
  if (plan.assign.length === 0) return ok({ assigned: 0, unchanged: plan.unchanged, ...skipped, roleMismatch: 0 });
  const statements: UcStatement[] = [
    caseGuard(ctx, core),
    assignItemsSql({ workspaceId: ctx.workspaceId, caseId: ctx.caseId, rows: plan.assign, actor: eventActorFrom(ctx.actor), roleKey: data.mode === "ruolo" ? data.roleKey : null }),
  ];
  if (data.mode === "ruolo") statements.push(contactRoleIfMissingSql({ workspaceId: ctx.workspaceId, contactId: data.contactId, roleKey: data.roleKey }));
  const run = await runCommand(executor, statements, REQUEST_MESSAGES);
  if (!run.ok) return run;
  return ok({ assigned: plan.assign.length, unchanged: plan.unchanged, ...skipped, roleMismatch });
}

// ── Anteprima e creazione delle richieste ─────────────────────────────

export interface RequestPreviewGroup {
  contactId: string;
  displayName: string;
  roleLabel: string | null;
  /** Senza email il link si copia e si manda a mano. */
  channel: RequestChannel;
  /** Il referente non può ricevere richieste (non attivo, o con un'email di Lateral Space). */
  blockedReason: string | null;
  minutes: number;
  items: { itemId: string; key: string; title: string; status: ItemStatus; moduleKey: string | null }[];
}

const PreviewSchema = z.object({ contactIds: z.array(Id).max(200).optional(), itemIds: z.array(Id).max(MAX_ITEMS).optional() });

/**
 * Anteprima di «Assegna e invia»: per ogni referente le voci che partirebbero
 * (assegnate, da chiedere, senza blocchi né richieste aperte) e il tempo
 * stimato. Nessuna scrittura.
 */
export async function previewRequests(executor: UcExecutor, ctx: UcCommandContext, input: unknown): Promise<Result<{ groups: RequestPreviewGroup[]; notRequestable: number }>> {
  const who = actorFor(ctx, "inviare_richieste");
  if (!who.ok) return who;
  const parsed = PreviewSchema.safeParse(input ?? {});
  if (!parsed.success) return fail("dati_non_validi", "Controlla i referenti e le domande.");
  const core = await loadCaseCore(executor, ctx.workspaceId, ctx.caseId);
  if (!core) return fail("non_trovato", CASE_NOT_FOUND);
  const items = (await lightItems(executor, { caseId: ctx.caseId, contactIds: parsed.data.contactIds ?? null, itemIds: parsed.data.itemIds ?? null })).filter((i) => i.assigneeContactId);
  const eligible = items.filter((i) => isLightRequestable(i));
  const groups = groupByAssignee(eligible, (i) => i.assigneeContactId);
  const contacts = await loadContacts(executor, ctx.workspaceId, groups.map((g) => g.contactId));
  const emails = await lsMemberEmails(executor, core, ctx.lsDomains);
  const info = await loadTemplateInfo(executor, ctx);
  const out: RequestPreviewGroup[] = [];
  for (const g of groups) {
    const contact = contacts.get(g.contactId);
    if (!contact) continue;
    const allowed = await assignable(executor, contact, ctx, emails);
    out.push({
      contactId: contact.id,
      displayName: contact.displayName,
      roleLabel: contact.roleLabel,
      channel: channelForContact(contact.email),
      blockedReason: allowed.ok ? null : allowed.message,
      minutes: minutesFor(info, g.items.map((i) => i.moduleKey)),
      items: g.items.map((i) => ({ itemId: i.id, key: i.key, title: i.title, status: i.status, moduleKey: i.moduleKey })),
    });
  }
  out.sort((a, b) => a.displayName.localeCompare(b.displayName, "it"));
  return ok({ groups: out, notRequestable: items.length - eligible.length });
}

const CreateRequestSchema = z.object({ contactId: Id, itemIds: z.array(Id).min(1).max(MAX_ITEMS).optional(), message: MessageSchema });

/**
 * Bozza di richiesta per un referente (Responsabile del caso): le voci indicate,
 * oppure tutte quelle che gli sono assegnate e si possono chiedere. Una bozza
 * non ha token né scadenza.
 */
export async function createRequest(executor: UcExecutor, ctx: UcCommandContext, input: unknown): Promise<Result<{ requestId: string; items: number }>> {
  const who = actorFor(ctx, "inviare_richieste");
  if (!who.ok) return who;
  const parsed = CreateRequestSchema.safeParse(input);
  if (!parsed.success) return fail("dati_non_validi", parsed.error.issues[0]?.message ?? "Controlla il referente e le domande.");
  const message = cleanMessage(parsed.data.message);
  if (!message.ok) return message;
  const opened = await openCase(executor, ctx);
  if (!opened.ok) return opened;
  const core = opened.value;
  const { contactId } = parsed.data;
  const contact = (await loadContacts(executor, ctx.workspaceId, [contactId])).get(contactId);
  if (!contact) return fail("contatto_non_trovato", CONTACT_NOT_FOUND);
  const allowed = await assignable(executor, contact, ctx, await lsMemberEmails(executor, core, ctx.lsDomains));
  if (!allowed.ok) return allowed;
  const explicit = parsed.data.itemIds;
  const candidateIds = explicit ?? (await lightItems(executor, { caseId: ctx.caseId, contactIds: [contactId] })).filter((i) => isLightRequestable(i, contactId)).map((i) => i.id);
  if (candidateIds.length === 0) return fail("nessuna_voce", "Il referente non ha domande da inviare.");
  const loaded = await loadItems(executor, ctx.workspaceId, ctx.caseId, candidateIds);
  if (!loaded) return fail("non_trovato", CASE_NOT_FOUND);
  const list = candidateIds.map((id) => loaded.items.get(id)).filter((l): l is LoadedItem => l !== undefined);
  if (explicit && list.length !== new Set(explicit).size) return fail("voce_non_trovata", "Domanda non trovata in questo dossier.");
  const split = splitRequestable(list.map((l) => ({ ...l, activeRequestId: l.extra.activeRequestId })), { contactId });
  if (explicit && split.skipped.length > 0) return firstSkipFailure(split.skipped, "Nessuna domanda da inviare.");
  if (split.eligible.length === 0) return firstSkipFailure(split.skipped, "Il referente non ha domande da inviare.");
  const requestId = randomUUID();
  const channel = channelForContact(contact.email);
  const run = await runCommand(
    executor,
    [
      caseGuard(ctx, core),
      requestInsertSql({
        id: requestId,
        workspaceId: ctx.workspaceId,
        caseId: ctx.caseId,
        contactId,
        purpose: "raccolta",
        actingRoleKey: contact.templateRoleKey,
        message: message.value,
        channel,
        createdByUserId: who.value,
        send: false,
      }),
      requestItemsInsertSql({ caseId: ctx.caseId, requestId, contactId, items: split.eligible.map((l) => ({ id: l.snapshot.id, status: l.snapshot.status })) }),
      requestEventSql({ type: "richiesta.creata", workspaceId: ctx.workspaceId, caseId: ctx.caseId, actor: eventActorFrom(ctx.actor), requestId, items: split.eligible.length, purpose: "raccolta", channel, toState: "bozza" }),
    ],
    REQUEST_MESSAGES,
  );
  return run.ok ? ok({ requestId, items: split.eligible.length }) : run;
}

// ── Invio ─────────────────────────────────────────────────────────────

export interface SentRequest {
  requestId: string;
  contactId: string;
  items: number;
  channel: RequestChannel;
}

export interface SendResult {
  requests: SentRequest[];
  /** Al massimo le prime 200 voci saltate, con il motivo; il totale è in `skippedTotal`. */
  skipped: SkippedItem[];
  skippedTotal: number;
  /** Il caso è passato da bozza a raccolta con questo invio. */
  caseStarted: boolean;
}

function sendOutcome(applied: AppliedTransitions, requests: SentRequest[], skipped: SkippedItem[]): SendResult {
  return { requests, ...capSkipped(skipped), caseStarted: applied.sideEffects.includes("caso_in_raccolta") };
}

/**
 * Invio di una bozza: le voci ancora da chiedere passano a «Chiesta» (righe 1,
 * 10, 15, 28), le altre escono dalla bozza. Con `copy` il link si copia invece
 * di partire per email (canale `link_manuale`) e il token va nello stesso batch.
 */
async function sendDraft(
  executor: UcExecutor,
  ctx: UcCommandContext,
  request: RequestRowState,
  core: CaseCore,
  copy: { statements: UcStatement[] } | null,
): Promise<Result<SendResult>> {
  if (request.purpose !== "raccolta") return fail("link_approvazione", "Il link di approvazione parte solo per email.");
  if (request.status !== "bozza" || request.revokedAt) return fail("gia_inviata", "La richiesta è già stata inviata.");
  if (request.delegatedFromRequestId) return fail("delega_da_approvare", "È una delega da approvare: approvala da Persone.");
  const contact = (await loadContacts(executor, ctx.workspaceId, [request.contactId])).get(request.contactId);
  if (!contact) return fail("contatto_non_trovato", CONTACT_NOT_FOUND);
  const allowed = await assignable(executor, contact, ctx, await lsMemberEmails(executor, core, ctx.lsDomains));
  if (!allowed.ok) return allowed;
  if (request.activeItemIds.length === 0) return fail("nessuna_voce", "La bozza non ha domande da inviare.");
  const loaded = await loadItems(executor, ctx.workspaceId, ctx.caseId, request.activeItemIds);
  if (!loaded) return fail("non_trovato", CASE_NOT_FOUND);
  const list = request.activeItemIds.map((id) => loaded.items.get(id)).filter((l): l is LoadedItem => l !== undefined);
  const split = splitRequestable(list.map((l) => ({ ...l, activeRequestId: l.extra.activeRequestId })), { draftRequestId: request.id, contactId: request.contactId });
  if (split.eligible.length === 0) return firstSkipFailure(split.skipped, "Nessuna domanda da inviare in questa richiesta.");
  const now = ctx.now ?? new Date();
  const channel: RequestChannel = copy ? "link_manuale" : channelForContact(contact.email);
  const info = await loadTemplateInfo(executor, ctx);
  const eligibleIds = split.eligible.map((l) => l.snapshot.id);
  const actor = eventActorFrom(ctx.actor);
  const applied = await applyItemTransitions(executor, ctx, {
    itemIds: eligibleIds,
    transitions: eligibleIds.map((itemId) => ({ itemId, to: "chiesta" as const, trigger: "invio_richiesta" as const })),
    before: split.skipped.length ? [requestItemsReleaseSql({ caseId: ctx.caseId, requestId: request.id, itemIds: split.skipped.map((s) => s.itemId) })] : [],
    after: [
      requestSendSql({ workspaceId: ctx.workspaceId, caseId: ctx.caseId, requestId: request.id, channel, nextReminderAt: firstReminderAt(now) }),
      requestEventSql({ type: "richiesta.inviata", workspaceId: ctx.workspaceId, caseId: ctx.caseId, actor, requestId: request.id, items: eligibleIds.length, purpose: "raccolta", channel, toState: "inviata" }),
      ...(!copy && contact.email
        ? [requestEmailSql({ ctx, core, requestId: request.id, contactId: contact.id, items: eligibleIds.length, minutes: minutesFor(info, split.eligible.map((l) => l.extra.requestModuleKey)), now })]
        : []),
      ...(copy?.statements ?? []),
    ],
    messages: REQUEST_MESSAGES,
  });
  if (!applied.ok) return applied;
  return ok(sendOutcome(applied.value, [{ requestId: request.id, contactId: contact.id, items: eligibleIds.length, channel }], split.skipped));
}

const RequestOnlySchema = z.object({ requestId: Id });

/** Invia una bozza (Responsabile del caso). L'email con il link parte dalla coda; senza email il link si copia. */
export async function sendRequest(executor: UcExecutor, ctx: UcCommandContext, input: unknown): Promise<Result<SendResult>> {
  const who = actorFor(ctx, "inviare_richieste");
  if (!who.ok) return who;
  const parsed = RequestOnlySchema.safeParse(input);
  if (!parsed.success) return fail("dati_non_validi", "Richiesta non valida.");
  const opened = await openCase(executor, ctx, { sending: true });
  if (!opened.ok) return opened;
  const request = await loadRequest(executor, ctx, parsed.data.requestId);
  if (!request.ok) return request;
  return sendDraft(executor, ctx, request.value, opened.value, null);
}

const SendRequestsSchema = z.object({ contactIds: z.array(Id).min(1).max(200).optional(), itemIds: z.array(Id).min(1).max(MAX_ITEMS).optional(), message: MessageSchema });

/**
 * «Invia» (Assegna e invia, o le voci scelte nel catalogo): per ogni referente
 * nasce una richiesta già inviata con le sue voci da chiedere (una richiesta =
 * un referente + le sue voci) e le voci passano a «Chiesta». Le voci che non si
 * possono chiedere si saltano, con il motivo.
 */
export async function sendRequests(executor: UcExecutor, ctx: UcCommandContext, input: unknown): Promise<Result<SendResult>> {
  const who = actorFor(ctx, "inviare_richieste");
  if (!who.ok) return who;
  const parsed = SendRequestsSchema.safeParse(input ?? {});
  if (!parsed.success) return fail("dati_non_validi", parsed.error.issues[0]?.message ?? "Controlla i referenti e le domande.");
  const message = cleanMessage(parsed.data.message);
  if (!message.ok) return message;
  const opened = await openCase(executor, ctx, { sending: true });
  if (!opened.ok) return opened;
  const core = opened.value;
  const explicit = parsed.data.itemIds;
  const candidates = await lightItems(executor, { caseId: ctx.caseId, contactIds: parsed.data.contactIds ?? null, itemIds: explicit ?? null });
  if (explicit && !parsed.data.contactIds && candidates.length !== new Set(explicit).size) return fail("voce_non_trovata", "Domanda non trovata in questo dossier.");
  // Senza scelta esplicita si considerano solo le voci che si possono chiedere: le altre non sono «saltate».
  const considered = explicit ? candidates : candidates.filter((i) => isLightRequestable(i));
  if (considered.length === 0) return fail("nessuna_voce", "Nessuna domanda assegnata da inviare.");
  if (considered.length > MAX_ITEMS) return fail("troppe_voci", "Troppe domande in una volta: invia per referente.");
  const loaded = await loadItems(executor, ctx.workspaceId, ctx.caseId, considered.map((i) => i.id));
  if (!loaded) return fail("non_trovato", CASE_NOT_FOUND);
  const list = considered.map((i) => loaded.items.get(i.id)).filter((l): l is LoadedItem => l !== undefined);
  const split = splitRequestable(list.map((l) => ({ ...l, activeRequestId: l.extra.activeRequestId })), {});
  const skipped = [...split.skipped];
  const groups = groupByAssignee(split.eligible, (l) => l.snapshot.assigneeContactId);
  const contacts = await loadContacts(executor, ctx.workspaceId, groups.map((g) => g.contactId));
  const emails = await lsMemberEmails(executor, core, ctx.lsDomains);
  const sendable: { contact: ContactRowState; items: LoadedItem[] }[] = [];
  for (const g of groups) {
    const contact = contacts.get(g.contactId);
    const allowed = contact ? await assignable(executor, contact, ctx, emails) : fail("contatto_non_trovato", CONTACT_NOT_FOUND);
    if (!contact || !allowed.ok) {
      for (const l of g.items) skipped.push({ itemId: l.snapshot.id, key: l.snapshot.key, code: allowed.ok ? "contatto_non_trovato" : allowed.code, message: allowed.ok ? CONTACT_NOT_FOUND : allowed.message });
      continue;
    }
    sendable.push({ contact, items: g.items });
  }
  if (sendable.length === 0) return firstSkipFailure(skipped, "Nessuna domanda da inviare.");
  const now = ctx.now ?? new Date();
  const info = await loadTemplateInfo(executor, ctx);
  const actor = eventActorFrom(ctx.actor);
  const planned = sendable.map((g) => ({ ...g, requestId: randomUUID(), channel: channelForContact(g.contact.email) }));
  const itemIds = planned.flatMap((g) => g.items.map((l) => l.snapshot.id));
  const applied = await applyItemTransitions(executor, ctx, {
    itemIds,
    transitions: itemIds.map((itemId) => ({ itemId, to: "chiesta" as const, trigger: "invio_richiesta" as const, overrides: { hasActiveRequestItem: true } })),
    before: planned.flatMap((g) => [
      requestInsertSql({
        id: g.requestId,
        workspaceId: ctx.workspaceId,
        caseId: ctx.caseId,
        contactId: g.contact.id,
        purpose: "raccolta",
        actingRoleKey: g.contact.templateRoleKey,
        message: message.value,
        channel: g.channel,
        createdByUserId: who.value,
        send: true,
        nextReminderAt: firstReminderAt(now),
      }),
      requestItemsInsertSql({ caseId: ctx.caseId, requestId: g.requestId, contactId: g.contact.id, items: g.items.map((l) => ({ id: l.snapshot.id, status: l.snapshot.status })) }),
    ]),
    after: planned.flatMap((g) => [
      requestEventSql({ type: "richiesta.inviata", workspaceId: ctx.workspaceId, caseId: ctx.caseId, actor, requestId: g.requestId, items: g.items.length, purpose: "raccolta", channel: g.channel, toState: "inviata" }),
      ...(g.contact.email
        ? [requestEmailSql({ ctx, core, requestId: g.requestId, contactId: g.contact.id, items: g.items.length, minutes: minutesFor(info, g.items.map((l) => l.extra.requestModuleKey)), now })]
        : []),
    ]),
    messages: REQUEST_MESSAGES,
  });
  if (!applied.ok) return applied;
  return ok(
    sendOutcome(
      applied.value,
      planned.map((g) => ({ requestId: g.requestId, contactId: g.contact.id, items: g.items.length, channel: g.channel })),
      skipped,
    ),
  );
}

const ConfirmationSchema = z.object({ itemIds: z.array(Id).min(1).max(MAX_ITEMS), message: MessageSchema });

/**
 * «Chiedi conferma» (riga 19): voci in verifica il cui dato non viene ancora da
 * chi lo possiede (dichiarato in call, inserito da Lateral Space, o dato da un
 * altro ruolo). Ogni voce entra in una richiesta nuova al suo referente, che ha
 * il ruolo del titolare, e torna «Chiesta». Le voci che non servono si saltano.
 */
export async function requestConfirmation(executor: UcExecutor, ctx: UcCommandContext, input: unknown): Promise<Result<SendResult>> {
  const who = actorFor(ctx, "inviare_richieste");
  if (!who.ok) return who;
  const parsed = ConfirmationSchema.safeParse(input);
  if (!parsed.success) return fail("dati_non_validi", parsed.error.issues[0]?.message ?? "Controlla le domande.");
  const message = cleanMessage(parsed.data.message);
  if (!message.ok) return message;
  const opened = await openCase(executor, ctx, { sending: true });
  if (!opened.ok) return opened;
  const core = opened.value;
  const loaded = await loadItems(executor, ctx.workspaceId, ctx.caseId, parsed.data.itemIds);
  if (!loaded) return fail("non_trovato", CASE_NOT_FOUND);
  const list = [...new Set(parsed.data.itemIds)].map((id) => loaded.items.get(id));
  if (list.some((l) => !l)) return fail("voce_non_trovata", "Domanda non trovata in questo dossier.");
  const items = list as LoadedItem[];
  const contacts = await loadContacts(executor, ctx.workspaceId, items.map((l) => l.snapshot.assigneeContactId).filter((c): c is string => c !== null));
  const emails = await lsMemberEmails(executor, core, ctx.lsDomains);
  const now = ctx.now ?? new Date();
  const skipped: SkippedItem[] = [];
  const eligible: LoadedItem[] = [];
  const validContacts = new Map<string, ContactRowState>();
  for (const l of items) {
    const contact = l.snapshot.assigneeContactId ? (contacts.get(l.snapshot.assigneeContactId) ?? null) : null;
    const target = checkConfirmationTarget(l.snapshot, contact);
    const contactOk = target.ok && contact ? await assignable(executor, contact, ctx, emails) : target;
    const transition = contactOk.ok
      ? checkItemTransition({
          item: { ...l.snapshot, hasActiveRequestItem: true },
          to: "chiesta",
          trigger: "richiesta_conferma",
          actor: ctx.actor,
          user: ctx.user,
          now,
          case: { status: core.status, statusBeforeSuspension: core.statusBeforeSuspension },
        })
      : contactOk;
    if (!transition.ok) {
      skipped.push({ itemId: l.snapshot.id, key: l.snapshot.key, code: transition.code, message: transition.message });
      continue;
    }
    eligible.push(l);
    validContacts.set(contact!.id, contact!);
  }
  if (eligible.length === 0) return firstSkipFailure(skipped, "Nessuna domanda da far confermare.");
  const groups = groupByAssignee(eligible, (l) => l.snapshot.assigneeContactId).map((g) => ({
    contact: validContacts.get(g.contactId)!,
    items: g.items,
    requestId: randomUUID(),
    channel: channelForContact(validContacts.get(g.contactId)!.email),
  }));
  const info = await loadTemplateInfo(executor, ctx);
  const actor = eventActorFrom(ctx.actor);
  const itemIds = eligible.map((l) => l.snapshot.id);
  const after: UcStatement[] = groups.flatMap((g) => [
    requestEventSql({ type: "richiesta.inviata", workspaceId: ctx.workspaceId, caseId: ctx.caseId, actor, requestId: g.requestId, items: g.items.length, purpose: "raccolta", channel: g.channel, toState: "inviata" }),
    ...(g.contact.email
      ? [requestEmailSql({ ctx, core, requestId: g.requestId, contactId: g.contact.id, items: g.items.length, minutes: minutesFor(info, g.items.map((l) => l.extra.requestModuleKey)), now })]
      : []),
  ]);
  if (core.status === "bozza") {
    // La prima richiesta del caso lo porta in raccolta, anche quando è una conferma.
    const toRaccolta = checkCaseTransition({
      from: "bozza",
      to: "raccolta",
      actor: { type: "sistema", job: "creazione" },
      approvedGates: new Set(),
      enteredAt: core.statusChangedAt,
      now,
      availableGates: [],
      statusBeforeSuspension: null,
    });
    if (!toRaccolta.ok) return toRaccolta;
    after.push(caseTransitionSql({ workspaceId: ctx.workspaceId, caseId: ctx.caseId, from: "bozza", statusBeforeSuspension: null, patch: toRaccolta.value.patch, actor: { type: "sistema" }, reasonCode: "primo_invio" }));
  }
  const applied = await applyItemTransitions(executor, ctx, {
    itemIds,
    transitions: itemIds.map((itemId) => ({ itemId, to: "chiesta" as const, trigger: "richiesta_conferma" as const, overrides: { hasActiveRequestItem: true } })),
    before: [
      // La riga attiva della richiesta precedente (per esempio quella a cui ha risposto un altro ruolo) esce dal vecchio link.
      requestItemsStateSql({ caseId: ctx.caseId, itemIds, state: "riassegnata" }),
      ...groups.flatMap((g) => [
        requestInsertSql({
          id: g.requestId,
          workspaceId: ctx.workspaceId,
          caseId: ctx.caseId,
          contactId: g.contact.id,
          purpose: "raccolta",
          actingRoleKey: g.contact.templateRoleKey,
          message: message.value,
          channel: g.channel,
          createdByUserId: who.value,
          send: true,
          nextReminderAt: firstReminderAt(now),
        }),
        requestItemsInsertSql({ caseId: ctx.caseId, requestId: g.requestId, contactId: g.contact.id, items: g.items.map((l) => ({ id: l.snapshot.id, status: l.snapshot.status })) }),
      ]),
    ],
    after,
    messages: REQUEST_MESSAGES,
  });
  if (!applied.ok) return applied;
  return ok({
    requests: groups.map((g) => ({ requestId: g.requestId, contactId: g.contact.id, items: g.items.length, channel: g.channel })),
    ...capSkipped(skipped),
    caseStarted: core.status === "bozza",
  });
}

// ── Copia link e reinvio ──────────────────────────────────────────────

export interface CopiedLink {
  /** Percorso `/r/<token>`: mostrato una volta, non si ricostruisce. */
  path: string;
  prefix: string;
  expiresAt: string;
  /** La richiesta era una bozza ed è stata inviata ora (canale `link_manuale`). */
  sent: boolean;
}

/**
 * «Copia link» (Responsabile del caso): emette un token nuovo `copia` e lo
 * restituisce una volta; su una bozza la invia con il canale `link_manuale`.
 * Mai per i link di approvazione. Chi copia non potrà validare le risposte che
 * arrivano da quella richiesta (guardia 9).
 */
export async function copyRequestLink(executor: UcExecutor, ctx: UcCommandContext, input: unknown): Promise<Result<CopiedLink>> {
  const who = actorFor(ctx, "inviare_richieste");
  if (!who.ok) return who;
  const parsed = RequestOnlySchema.safeParse(input);
  if (!parsed.success) return fail("dati_non_validi", "Richiesta non valida.");
  const core = await loadCaseCore(executor, ctx.workspaceId, ctx.caseId);
  if (!core) return fail("non_trovato", CASE_NOT_FOUND);
  const request = await loadRequest(executor, ctx, parsed.data.requestId);
  if (!request.ok) return request;
  const plan = checkCopyLink(request.value, core.status);
  if (!plan.ok) return plan;
  const issued = newRequestToken();
  const tokenId = randomUUID();
  const tokenStatements = [
    tokenInsertSql({ tokenId, workspaceId: ctx.workspaceId, caseId: ctx.caseId, requestId: request.value.id, hash: issued.hash, prefix: issued.prefix, issuedFor: "copia", issuedByUserId: who.value }),
    linkCopiedEventSql({ workspaceId: ctx.workspaceId, caseId: ctx.caseId, actor: eventActorFrom(ctx.actor), requestId: request.value.id, tokenId }),
  ];
  const now = ctx.now ?? new Date();
  if (plan.value === "invia_e_copia") {
    const sent = await sendDraft(executor, ctx, request.value, core, { statements: tokenStatements });
    if (!sent.ok) return sent;
    return ok({ path: requestLinkPath(issued.token), prefix: issued.prefix, expiresAt: expiryOnSend(now).toISOString(), sent: true });
  }
  const run = await runCommand(executor, tokenStatements, REQUEST_MESSAGES);
  if (!run.ok) return run;
  return ok({ path: requestLinkPath(issued.token), prefix: issued.prefix, expiresAt: (request.value.expiresAt ?? expiryOnSend(now)).toISOString(), sent: false });
}

/**
 * Reinvia la richiesta per email (Responsabile del caso): al massimo una volta
 * al giorno per richiesta; il dispatch mette nell'email un token nuovo. Non
 * conta come promemoria automatico.
 */
export async function remindRequest(executor: UcExecutor, ctx: UcCommandContext, input: unknown): Promise<Result<{ requestId: string }>> {
  const who = actorFor(ctx, "inviare_richieste");
  if (!who.ok) return who;
  const parsed = RequestOnlySchema.safeParse(input);
  if (!parsed.success) return fail("dati_non_validi", "Richiesta non valida.");
  const opened = await openCase(executor, ctx, { sending: true });
  if (!opened.ok) return opened;
  const core = opened.value;
  const request = await loadRequest(executor, ctx, parsed.data.requestId);
  if (!request.ok) return request;
  const r = request.value;
  const checked = checkRemind(r);
  if (!checked.ok) return checked;
  const now = ctx.now ?? new Date();
  const key = dedupeKey.richiesta(r.id, r.shareEpoch, now);
  const [[existing]] = await executor.batch([notificationExistsSql(key)]);
  if (rowBool(existing?.found)) return fail("gia_inviata_oggi", "Il link è già partito oggi: riprova domani o copia il link.");
  const loaded = r.activeItemIds.length ? await loadItems(executor, ctx.workspaceId, ctx.caseId, r.activeItemIds) : null;
  const info = await loadTemplateInfo(executor, ctx);
  const moduleKeys = loaded ? [...loaded.items.values()].map((l) => l.extra.requestModuleKey) : [];
  const run = await runCommand(
    executor,
    [
      requestLiveGuardSql({ workspaceId: ctx.workspaceId, caseId: ctx.caseId, requestId: r.id }),
      requestChannelSql({ caseId: ctx.caseId, requestId: r.id, channel: "email" }),
      requestEmailSql({ ctx, core, requestId: r.id, contactId: r.contactId, items: r.activeItemIds.length, minutes: minutesFor(info, moduleKeys), now, shareEpoch: r.shareEpoch }),
      requestEventSql({ type: "richiesta.promemoria", workspaceId: ctx.workspaceId, caseId: ctx.caseId, actor: eventActorFrom(ctx.actor), requestId: r.id, channel: "email" }),
    ],
    REQUEST_MESSAGES,
  );
  return run.ok ? ok({ requestId: r.id }) : run;
}

// ── Revoca ────────────────────────────────────────────────────────────

/** Motivo facoltativo della revoca: se c'è, resta visibile sulle voci che tornano da chiedere. */
const ReasonSchema = z
  .string()
  .trim()
  .max(500, "Il motivo può avere al massimo 500 caratteri.")
  .nullish()
  .transform((v) => (v ? v : null));

const RevokeSchema = z.object({ requestId: Id, reason: ReasonSchema });

/** Esegue le istruzioni con le transizioni (se ci sono voci) o da sole, dietro la guardia del caso. */
async function withTransitions(
  executor: UcExecutor,
  ctx: UcCommandContext,
  core: CaseCore,
  i: { itemIds: string[]; reason: string | null; statements: UcStatement[] },
): Promise<Result<number>> {
  if (i.itemIds.length === 0) {
    const run = await runCommand(executor, [caseGuard(ctx, core), ...i.statements], REQUEST_MESSAGES);
    return run.ok ? ok(0) : run;
  }
  const applied = await applyItemTransitions(executor, ctx, {
    itemIds: i.itemIds,
    transitions: i.itemIds.map((itemId) => ({ itemId, to: "da_chiedere" as const, trigger: "richiesta_revocata" as const, reason: i.reason })),
    after: i.statements,
    messages: REQUEST_MESSAGES,
  });
  return applied.ok ? ok(applied.value.applied.length) : applied;
}

/**
 * Revoca una richiesta (Responsabile del caso), anche in bozza o una delega da
 * approvare: i suoi link non valgono più, le voci ancora «Chiesta» tornano da
 * chiedere (riga 31) e le altre escono dal link; la coda della richiesta si
 * annulla.
 */
export async function revokeRequest(executor: UcExecutor, ctx: UcCommandContext, input: unknown): Promise<Result<{ requestId: string; released: number; reopened: number }>> {
  const who = actorFor(ctx, "revocare_link");
  if (!who.ok) return who;
  const parsed = RevokeSchema.safeParse(input);
  if (!parsed.success) return fail("dati_non_validi", parsed.error.issues[0]?.message ?? "Richiesta non valida.");
  const reason = parsed.data.reason ?? null;
  if (reason) {
    const scanned = checkLsText({ reason });
    if (!scanned.ok) return scanned;
  }
  const opened = await openCase(executor, ctx);
  if (!opened.ok) return opened;
  const request = await loadRequest(executor, ctx, parsed.data.requestId);
  if (!request.ok) return request;
  const r = request.value;
  const checked = checkRevoke(r);
  if (!checked.ok) return checked;
  const loaded = r.activeItemIds.length ? await loadItems(executor, ctx.workspaceId, ctx.caseId, r.activeItemIds) : null;
  const asked = loaded ? [...loaded.items.values()].filter((l) => l.snapshot.status === "chiesta" && l.extra.activeRequestId === r.id).map((l) => l.snapshot.id) : [];
  const done = await withTransitions(executor, ctx, opened.value, {
    itemIds: asked,
    reason,
    statements: [
      noAskedItemsLeftSql({ caseId: ctx.caseId, requestId: r.id }),
      requestRevokeSql({ caseId: ctx.caseId, requestId: r.id, fromStatus: r.status, reasonCode: "revoca_singola" }),
      requestTokensRevokeSql({ caseId: ctx.caseId, requestId: r.id }),
      requestItemsReleaseSql({ caseId: ctx.caseId, requestId: r.id }),
      requestNotificationsCancelSql(r.id),
      requestEventSql({ type: "richiesta.revocata", workspaceId: ctx.workspaceId, caseId: ctx.caseId, actor: eventActorFrom(ctx.actor), requestId: r.id, items: r.activeItemIds.length, reasonCode: "revoca_singola", toState: "revocata" }),
    ],
  });
  return done.ok ? ok({ requestId: r.id, released: r.activeItemIds.length, reopened: done.value }) : done;
}

const RevokeAllSchema = z.object({ reason: ReasonSchema }).optional();

/**
 * «Revoca tutti i link del caso» (Responsabile del caso): nuova epoca dei link,
 * richieste aperte revocate (comprese quelle di approvazione e le deleghe da
 * approvare; restano le bozze di Lateral Space), voci «Chiesta» di nuovo da
 * chiedere (riga 31), token del caso e token MCP del caso revocati.
 */
export async function revokeAllLinks(executor: UcExecutor, ctx: UcCommandContext, input: unknown): Promise<Result<{ shareEpoch: number; requests: number; reopened: number }>> {
  const who = actorFor(ctx, "revocare_link");
  if (!who.ok) return who;
  const parsed = RevokeAllSchema.safeParse(input ?? undefined);
  if (!parsed.success) return fail("dati_non_validi", parsed.error.issues[0]?.message ?? "Scrivi il motivo.");
  const reason = parsed.data?.reason ?? null;
  if (reason) {
    const scanned = checkLsText({ reason });
    if (!scanned.ok) return scanned;
  }
  const opened = await openCase(executor, ctx);
  if (!opened.ok) return opened;
  const core = opened.value;
  const [targets] = await executor.batch([revokeAllTargetsSql({ workspaceId: ctx.workspaceId, caseId: ctx.caseId })]);
  const asked = [...new Set(targets.flatMap((t) => rowStringArray(rowJson(t.asked_item_ids))))];
  const actor = eventActorFrom(ctx.actor);
  const done = await withTransitions(executor, ctx, core, {
    itemIds: asked,
    reason: reason ?? "Link revocati",
    statements: [
      shareEpochBumpSql({ workspaceId: ctx.workspaceId, caseId: ctx.caseId, expectEpoch: core.shareEpoch }),
      noAskedItemsLeftSql({ caseId: ctx.caseId, revokeAll: true }),
      revokeAllRequestsSql({ workspaceId: ctx.workspaceId, caseId: ctx.caseId, actor, reasonCode: "revoca_in_blocco" }),
      revokedRequestItemsReleaseSql(ctx.caseId),
      revokedRequestNotificationsCancelSql(ctx.caseId),
      revokeCaseTokensSql(ctx.caseId),
      revokeCaseMcpTokensSql(ctx.workspaceId, ctx.caseId),
      linksRevokedEventSql({ workspaceId: ctx.workspaceId, caseId: ctx.caseId, actor, shareEpoch: core.shareEpoch + 1, requests: targets.length }),
    ],
  });
  return done.ok ? ok({ shareEpoch: core.shareEpoch + 1, requests: targets.length, reopened: done.value }) : done;
}

// ── Deleghe, proroga, approvazioni ────────────────────────────────────

/**
 * Approva una delega in bozza (Responsabile del caso): profondità ≤ 2, al
 * massimo 5 deleghe al giorno dalla stessa richiesta, collega del cliente. Le
 * voci passano al collega, la richiesta parte (email con un link nuovo dalla
 * coda; senza email si copia il link).
 */
export async function approveDelegation(executor: UcExecutor, ctx: UcCommandContext, input: unknown): Promise<Result<{ requestId: string; items: number; channel: RequestChannel }>> {
  const who = actorFor(ctx, "inviare_richieste");
  if (!who.ok) return who;
  const parsed = RequestOnlySchema.safeParse(input);
  if (!parsed.success) return fail("dati_non_validi", "Richiesta non valida.");
  const opened = await openCase(executor, ctx, { sending: true });
  if (!opened.ok) return opened;
  const core = opened.value;
  const request = await loadRequest(executor, ctx, parsed.data.requestId);
  if (!request.ok) return request;
  const r = request.value;
  if (!r.delegatedFromRequestId) return fail("non_delega", "Questa richiesta non è una delega da approvare.");
  const now = ctx.now ?? new Date();
  const [[today]] = await executor.batch([
    delegationsTodaySql({ caseId: ctx.caseId, parentRequestId: r.delegatedFromRequestId, excludeRequestId: r.id, since: romeMidnightUtc(romeDateOf(now)) }),
  ]);
  const emails = await lsMemberEmails(executor, core, ctx.lsDomains);
  const checked = checkDelegationApproval({ request: r, delegationsToday: rowNumber(today?.n) ?? 0, lsDomains: ctx.lsDomains, lsMemberEmails: emails });
  if (!checked.ok) return checked;
  const contactUserCtx = r.contact.userId ? await loadUserContext(executor, r.contact.userId, ctx.lsDomains) : null;
  if (contactUserCtx && (contactUserCtx.isLateralSpace || (contactUserCtx.emailDomain && ctx.lsDomains.includes(contactUserCtx.emailDomain)))) {
    return fail("referente_lateral_space", "Il referente è una persona del cliente: non può essere di Lateral Space.");
  }
  const loaded = await loadItems(executor, ctx.workspaceId, ctx.caseId, r.activeItemIds);
  if (!loaded) return fail("non_trovato", CASE_NOT_FOUND);
  const notAsked = r.activeItemIds.map((id) => loaded.items.get(id)).find((l) => !l || l.snapshot.status !== "chiesta");
  if (notAsked) return fail("conflitto", "Le domande della delega sono cambiate: aggiorna la pagina.");
  const channel = channelForContact(r.contact.email);
  const info = await loadTemplateInfo(executor, ctx);
  const actor = eventActorFrom(ctx.actor);
  const run = await runCommand(
    executor,
    [
      caseGuard(ctx, core),
      requestItemsStillAskedSql({ caseId: ctx.caseId, requestId: r.id, itemIds: r.activeItemIds }),
      alignAssigneeSql({ workspaceId: ctx.workspaceId, caseId: ctx.caseId, itemIds: r.activeItemIds, contactId: r.contactId, actor }),
      requestSendSql({ workspaceId: ctx.workspaceId, caseId: ctx.caseId, requestId: r.id, channel, nextReminderAt: firstReminderAt(now) }),
      requestEventSql({ type: "delega.approvata", workspaceId: ctx.workspaceId, caseId: ctx.caseId, actor, requestId: r.id, items: r.activeItemIds.length }),
      ...(r.contact.email
        ? [
            toStatement(
              enqueueSql({
                workspaceId: ctx.workspaceId,
                caseId: ctx.caseId,
                requestId: r.id,
                recipient: { contactId: r.contactId },
                channel: "email",
                templateKey: "delega",
                payload: { items: r.activeItemIds.length, minutes: minutesFor(info, [...loaded.items.values()].map((l) => l.extra.requestModuleKey)), case_code: core.code },
                dedupeKey: dedupeKey.delega(r.id),
              }),
            ),
          ]
        : []),
    ],
    REQUEST_MESSAGES,
  );
  return run.ok ? ok({ requestId: r.id, items: r.activeItemIds.length, channel }) : run;
}

const ExtendSchema = z.object({ requestId: Id, expiresAt: z.string().trim().min(10).max(40) });

/** Nuova scadenza da una data (`YYYY-MM-DD`: il link vale per tutto quel giorno, ora di Roma) o da un istante ISO. */
function parseRequestedExpiry(value: string): Date | null {
  if (isIsoDate(value)) return romeMidnightUtc(addDaysToDate(value, 1));
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * «Cambia la scadenza» (Responsabile del caso): mai oltre 30 giorni da oggi e
 * mai indietro; anche con il caso in pausa, perché il link non scada intanto.
 */
export async function extendExpiry(executor: UcExecutor, ctx: UcCommandContext, input: unknown): Promise<Result<{ requestId: string; expiresAt: string; clamped: boolean }>> {
  const who = actorFor(ctx, "inviare_richieste");
  if (!who.ok) return who;
  const parsed = ExtendSchema.safeParse(input);
  if (!parsed.success) return fail("dati_non_validi", "Scegli la nuova scadenza.");
  const requested = parseRequestedExpiry(parsed.data.expiresAt);
  if (!requested) return fail("data_non_valida", "Scegli una data valida.");
  const opened = await openCase(executor, ctx);
  if (!opened.ok) return opened;
  const request = await loadRequest(executor, ctx, parsed.data.requestId);
  if (!request.ok) return request;
  const r = request.value;
  if (!r.visible) return fail("richiesta_non_viva", REQUEST_MESSAGES.richiesta_non_viva);
  const now = ctx.now ?? new Date();
  const checked = checkExtendExpiry({ status: r.status, revokedAt: r.revokedAt, currentExpiresAt: r.expiresAt, requested, now });
  if (!checked.ok) return checked;
  const next = nextReminderAt(
    { status: r.status, purpose: r.purpose, sentAt: r.sentAt, expiresAt: checked.value.expiresAt, revokedAt: r.revokedAt, reminderCount: r.reminderCount, escalatedAt: r.escalatedAt },
    now,
  );
  const run = await runCommand(
    executor,
    [
      extendExpirySql({ workspaceId: ctx.workspaceId, caseId: ctx.caseId, requestId: r.id, requested: checked.value.expiresAt, nextReminderAt: next }),
      requestEventSql({ type: "richiesta.prorogata", workspaceId: ctx.workspaceId, caseId: ctx.caseId, actor: eventActorFrom(ctx.actor), requestId: r.id }),
    ],
    REQUEST_MESSAGES,
  );
  return run.ok ? ok({ requestId: r.id, expiresAt: checked.value.expiresAt.toISOString(), clamped: checked.value.clamped }) : run;
}

const ApprovalSchema = z.object({ designation: z.enum(["owner", "privacy"]) });

/**
 * «Chiedi la firma»: link di approvazione per email al firmatario designato con
 * prova scritta (PIANO §5.4, D16). Si crea una richiesta `approvazioni` (o si
 * riusa quella ancora viva) e l'email va in coda: il token lo emette il dispatch
 * al momento dell'invio. Senza email configurata non parte: il cliente firma dal
 * suo account. Il link non si mostra e non si copia mai.
 */
export async function requestApproval(
  executor: UcExecutor,
  ctx: UcCommandContext,
  input: unknown,
  options: RequestCommandOptions = {},
): Promise<Result<{ requestId: string; created: boolean }>> {
  const who = actorFor(ctx, "inviare_richieste");
  if (!who.ok) return who;
  const parsed = ApprovalSchema.safeParse(input);
  if (!parsed.success) return fail("dati_non_validi", "Scegli il firmatario.");
  const { designation } = parsed.data;
  const opened = await openCase(executor, ctx, { sending: true });
  if (!opened.ok) return opened;
  const core = opened.value;
  const contactId = core.designated[designation];
  if (!contactId) return fail("firmatario_mancante", "Indica prima il firmatario del cliente, con la prova scritta.");
  if (!options.emailConfigured) {
    return fail("email_non_configurata", "Email non configurata: il link di approvazione parte solo per email. Il cliente può firmare dal suo account.");
  }
  const contact = (await loadContacts(executor, ctx.workspaceId, [contactId])).get(contactId);
  if (!contact || !contact.isActive || contact.anonymized) return fail("contatto_non_attivo", "Il firmatario non è un referente attivo.");
  if (!contact.email) return fail("email_mancante", "Il firmatario deve avere un'email: il link di approvazione parte solo per email.");
  const signer = checkSignerEmail(contact.email, ctx.lsDomains, await lsMemberEmails(executor, core, ctx.lsDomains));
  if (!signer.ok) return signer;
  const now = ctx.now ?? new Date();
  const actor = eventActorFrom(ctx.actor);
  const approvalEmail = (requestId: string) =>
    toStatement(
      enqueueSql({
        workspaceId: ctx.workspaceId,
        caseId: ctx.caseId,
        requestId,
        recipient: { contactId },
        channel: "email",
        templateKey: "richiesta_approvazione",
        payload: { designation, case_code: core.code },
        dedupeKey: dedupeKey.richiesta(requestId, core.shareEpoch, now),
      }),
    );
  const [[live]] = await executor.batch([liveApprovalRequestSql({ workspaceId: ctx.workspaceId, caseId: ctx.caseId, contactId })]);
  const existing = rowString(live?.id);
  if (existing) {
    const [[sentToday]] = await executor.batch([notificationExistsSql(dedupeKey.richiesta(existing, core.shareEpoch, now))]);
    if (rowBool(sentToday?.found)) return fail("gia_inviata_oggi", "Il link di approvazione è già partito oggi.");
    const run = await runCommand(
      executor,
      [
        requestLiveGuardSql({ workspaceId: ctx.workspaceId, caseId: ctx.caseId, requestId: existing }),
        approvalEmail(existing),
        requestEventSql({ type: "richiesta.promemoria", workspaceId: ctx.workspaceId, caseId: ctx.caseId, actor, requestId: existing, purpose: "approvazioni", channel: "email" }),
      ],
      REQUEST_MESSAGES,
    );
    return run.ok ? ok({ requestId: existing, created: false }) : run;
  }
  const requestId = randomUUID();
  const run = await runCommand(
    executor,
    [
      caseGuard(ctx, core),
      requestInsertSql({
        id: requestId,
        workspaceId: ctx.workspaceId,
        caseId: ctx.caseId,
        contactId,
        purpose: "approvazioni",
        actingRoleKey: null,
        message: null,
        channel: "email",
        createdByUserId: who.value,
        send: true,
        nextReminderAt: null,
      }),
      requestEventSql({ type: "richiesta.inviata", workspaceId: ctx.workspaceId, caseId: ctx.caseId, actor, requestId, items: 0, purpose: "approvazioni", channel: "email", toState: "inviata" }),
      approvalEmail(requestId),
    ],
    REQUEST_MESSAGES,
  );
  return run.ok ? ok({ requestId, created: true }) : run;
}

// ── Letture per le pagine ─────────────────────────────────────────────

/** Chi guarda: Lateral Space vede tutto; i ruoli del cliente solo gli stati (art. 15.4). */
export type PeopleAudience = "lateral_space" | "cliente";

export interface ContactSummary {
  id: string;
  displayName: string;
  roleLabel: string | null;
  templateRoleKey: string | null;
  /** Solo per Lateral Space. */
  email: string | null;
  /** Solo per Lateral Space. */
  phone: string | null;
  hasEmail: boolean;
  hasPhone: boolean;
  preferredChannel: string;
  isActive: boolean;
  anonymized: boolean;
  /** Voci del caso assegnate e ancora aperte: solo conteggi, solo per Lateral Space (null per i ruoli del cliente, art. 15.4). */
  assigned: number | null;
  openItems: number | null;
  /** Firmatario designato nel caso. */
  designation: ("owner" | "privacy")[];
}

/**
 * Referenti del workspace per «Persone e richieste». Ai ruoli del cliente niente
 * email, telefono né conteggi per persona: solo nome, ruolo e stato.
 */
export async function listContacts(executor: UcExecutor, i: { workspaceId: string; caseId: string; audience: PeopleAudience }): Promise<ContactSummary[]> {
  if (!isUuid(i.workspaceId) || !isUuid(i.caseId)) return [];
  const core = await loadCaseCore(executor, i.workspaceId, i.caseId);
  if (!core) return [];
  const [rows] = await executor.batch([contactsListSql(i)]);
  const ls = i.audience === "lateral_space";
  return rows.map((row) => {
    const c = parseContactRow(row)!;
    const designation: ("owner" | "privacy")[] = [];
    if (core.designated.owner === c.id) designation.push("owner");
    if (core.designated.privacy === c.id) designation.push("privacy");
    return {
      id: c.id,
      displayName: c.displayName,
      roleLabel: c.roleLabel,
      templateRoleKey: c.templateRoleKey,
      email: ls ? c.email : null,
      phone: ls ? c.phoneE164 : null,
      hasEmail: c.email !== null,
      hasPhone: c.phoneE164 !== null,
      preferredChannel: c.preferredChannel,
      isActive: c.isActive,
      anonymized: c.anonymized,
      assigned: ls ? (rowNumber(row.assigned) ?? 0) : null,
      openItems: ls ? (rowNumber(row.open_items) ?? 0) : null,
      designation,
    };
  });
}

export interface RequestSummary {
  id: string;
  contactId: string;
  contactName: string;
  contactRoleLabel: string | null;
  purpose: "raccolta" | "approvazioni";
  status: RequestStatus;
  /** Per i ruoli del cliente inviata, aperta e in corso sono tutte «In attesa». */
  statusLabel: string;
  items: number;
  /** Solo per Lateral Space (null per i ruoli del cliente). */
  detail: {
    channel: RequestChannel;
    openItems: number;
    sentAt: string | null;
    expiresAt: string | null;
    reminderCount: number;
    lastReminderAt: string | null;
    nextReminderAt: string | null;
    escalated: boolean;
    activeLinks: number;
    live: boolean;
    emailQueued: boolean;
    /** Es. `email_non_configurata`: l'email resta in coda e il link si copia a mano. */
    emailHoldReason: string | null;
    contactHasEmail: boolean;
    delegatedFromRequestId: string | null;
    delegationDepth: number;
    /** Delega in bozza, con un dominio che non è tra i referenti del caso. */
    needsApproval: boolean;
    /** Il link si apre (anche in sola lettura con il caso in pausa): falso quando è scaduto. */
    visible: boolean;
  } | null;
  actions: { send: boolean; copyLink: boolean; remind: boolean; revoke: boolean; extend: boolean; approveDelegation: boolean };
}

const NO_ACTIONS = { send: false, copyLink: false, remind: false, revoke: false, extend: false, approveDelegation: false };
const CLIENT_VISIBLE_STATUSES: readonly RequestStatus[] = ["inviata", "aperta", "in_corso", "completata", "scaduta"];

/**
 * Richieste del caso per «Persone e richieste». Ai ruoli del cliente solo le
 * richieste partite, con lo stato («In attesa», «Completata», «Scaduta») e il
 * numero di voci: niente bozze, date, promemoria, deleghe, revoche, link di
 * approvazione o ordinamenti per tempi.
 */
export async function listCaseRequests(executor: UcExecutor, i: { workspaceId: string; caseId: string; audience: PeopleAudience }): Promise<RequestSummary[]> {
  if (!isUuid(i.workspaceId) || !isUuid(i.caseId)) return [];
  const core = await loadCaseCore(executor, i.workspaceId, i.caseId);
  if (!core) return [];
  const [rows] = await executor.batch([caseRequestsListSql(i)]);
  return requestSummariesFromRows(rows, { audience: i.audience, caseStatus: core.status });
}

/**
 * Le righe di `caseRequestsListSql` per chi guarda (la stessa regola di
 * `listCaseRequests`, per le letture che le prendono in un batch più grande):
 * ai ruoli del cliente solo le richieste di raccolta partite, senza dettagli né
 * azioni.
 */
export function requestSummariesFromRows(rows: readonly Row[], o: { audience: PeopleAudience; caseStatus: CaseCore["status"] }): RequestSummary[] {
  const ls = o.audience === "lateral_space";
  const caseOpen = o.caseStatus !== "chiuso";
  const caseSending = caseOpen && o.caseStatus !== "sospeso";
  const out: RequestSummary[] = [];
  for (const row of rows) {
    const status = rowString(row.status);
    const purpose = rowString(row.purpose);
    if (!isVocab(REQUEST_STATUSES, status) || (purpose !== "raccolta" && purpose !== "approvazioni")) continue;
    // Ai ruoli del cliente solo le richieste partite: «In attesa», «Completata», «Scaduta» (bozze, deleghe e revoche sono lavoro di Lateral Space).
    if (!ls && (purpose === "approvazioni" || !CLIENT_VISIBLE_STATUSES.includes(status))) continue;
    const live = rowBool(row.live);
    const visible = rowBool(row.visible);
    const delegatedFrom = rowString(row.delegated_from_request_id);
    const revoked = row.revoked_at !== null && row.revoked_at !== undefined;
    const draft = status === "bozza" && !revoked;
    const needsApproval = draft && delegatedFrom !== null;
    const channel = rowString(row.channel);
    const actions = ls
      ? {
          send: caseSending && draft && !needsApproval && purpose === "raccolta",
          copyLink: caseSending && purpose === "raccolta" && ((draft && !needsApproval) || live),
          remind: caseSending && purpose === "raccolta" && live && rowBool(row.contact_has_email),
          revoke: caseOpen && status !== "revocata" && status !== "scaduta" && !revoked,
          extend: caseOpen && visible,
          approveDelegation: caseSending && needsApproval,
        }
      : NO_ACTIONS;
    out.push({
      id: String(row.id),
      contactId: String(row.contact_id),
      contactName: String(row.contact_name ?? ""),
      contactRoleLabel: rowString(row.contact_role_label),
      purpose,
      status,
      statusLabel: requestStatusLabel(status, ls ? "lateral_space" : "cliente"),
      items: rowNumber(row.items) ?? 0,
      detail: ls
        ? {
            channel: channel === "link_manuale" ? "link_manuale" : "email",
            openItems: rowNumber(row.open_items) ?? 0,
            sentAt: rowDate(row.sent_at)?.toISOString() ?? null,
            expiresAt: rowDate(row.expires_at)?.toISOString() ?? null,
            reminderCount: rowNumber(row.reminder_count) ?? 0,
            lastReminderAt: rowDate(row.last_reminder_at)?.toISOString() ?? null,
            nextReminderAt: rowDate(row.next_reminder_at)?.toISOString() ?? null,
            escalated: row.escalated_at !== null && row.escalated_at !== undefined,
            activeLinks: rowNumber(row.active_links) ?? 0,
            live,
            emailQueued: rowBool(row.email_queued),
            emailHoldReason: rowString(row.email_hold_reason),
            contactHasEmail: rowBool(row.contact_has_email),
            delegatedFromRequestId: delegatedFrom,
            delegationDepth: rowNumber(row.delegation_depth) ?? 0,
            needsApproval,
            visible,
          }
        : null,
      actions,
    });
  }
  return out;
}

export type { ContactRowState, RequestRowState, SkippedItem };
