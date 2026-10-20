/**
 * Referenti, assegnazioni e richieste interne (PIANO §2.3 tabelle 2, 9, 9-bis,
 * 10; §3.3; §5.3 `uc-people.ts`; §5.4; §7.1; D13, D16, D42; b29, b30, b33).
 *
 * Qui stanno i controlli puri e i costruttori SQL che usano i comandi di
 * `src/lib/db/queries/uc-requests.ts`:
 * - referenti (`uc_contacts`): input, email del cliente (`checkContactEmail`),
 *   creazione, modifica, anonimizzazione;
 * - assegnazione delle voci, anche in blocco per ruolo (`checkAssignee`);
 * - richieste: bozza, invio (la richiesta nasce già inviata o passa da bozza a
 *   inviata con CAS), revoca singola e in blocco (`share_epoch`), proroga;
 * - token dei link: solo l'impronta sha256 in `uc_request_tokens`, con il
 *   predicato unico `uc_request_live` nella stessa istruzione dell'inserimento.
 *
 * Regole di scrittura: ogni modifica è un compare-and-swap che chiude con
 * `uc_require(count(*) = n, '<codice>')`, e l'evento di audit va nello stesso
 * batch, senza valori, nomi, email o token. I link di approvazione
 * (`purpose = 'approvazioni'`) non si copiano mai.
 *
 * Modulo puro: import relativi `.ts`, nessun accesso a DB o ambiente.
 */
import { z } from "zod";
import { eventInsertFromSql, eventInsertSql, type EventActor } from "../../db/queries/uc-events.ts";
import { normalizeEmail } from "../answers/universal.ts";
import { checkAssignee, checkContactEmail } from "../permissions.ts";
import { checkDelegation, MAX_DELEGATION_DEPTH } from "../request-state.ts";
import { fail, ok, type ItemSnapshot, type Result, type UserContext } from "../types.ts";
import {
  ACTIVE_REQUEST_ITEM_STATES,
  CONTACT_CHANNELS,
  REQUEST_CHANNELS,
  REQUEST_PURPOSES,
  REQUEST_STATUSES,
  isVocab,
  type CaseStatus,
  type ContactChannel,
  type ItemStatus,
  type RequestChannel,
  type RequestPurpose,
  type RequestStatus,
  type TokenIssuedFor,
} from "../vocab.ts";
import { rowBool, rowDate, rowJson, rowNumber, rowString, rowStringArray, type Row } from "./readiness.ts";
import { REQUEST_LINK_TTL_DAYS, requestLiveSql, requestVisibleSql } from "./requests.ts";
import { cast, join, jsonb, raw, requireRows, toStatement, ucSql, type SqlFragment, type UcStatement } from "./statement.ts";
import type { TemplateParts } from "./template-parts.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIVE_STATES_SQL = ACTIVE_REQUEST_ITEM_STATES.map((s) => `'${s}'`).join(", ");
const CODE = /^[a-z0-9_]{1,60}$/;

function code(value: string | null | undefined): string | undefined {
  return value && CODE.test(value) ? value : undefined;
}

function uuid(value: string, what: string): string {
  if (!UUID.test(value)) throw new Error(`Id non valido (${what})`);
  return value;
}

function uuids(values: readonly string[], what: string): string[] {
  return values.map((v) => uuid(v, what));
}

/** Messaggi dei codici `uc:<codice>` dei batch di questo modulo. */
export const REQUEST_MESSAGES: Readonly<Record<string, string>> = {
  conflitto: "Qualcuno ha appena modificato questi dati. Aggiorna la pagina e riprova.",
  richiesta_non_viva: "Questo link non è più valido: crea una richiesta nuova.",
  email_in_uso: "C'è già un referente con questa email in questo workspace.",
  richieste_aperte: "Il referente ha ancora richieste aperte: revocale prima.",
  firmatario_designato: "Il referente è indicato come firmatario del cliente: cambia prima la designazione.",
  caso_chiuso: "Il caso è chiuso: non si modifica più.",
};

// ── Referenti ─────────────────────────────────────────────────────────

const ROLE_KEY = /^[a-z0-9_]{1,80}$/;
const PHONE = /^\+[1-9][0-9]{6,14}$/;

/** Telefono in formato E.164 (`+39…`), senza spazi, punti, trattini o parentesi. `undefined` se non valido. */
export function normalizePhone(input: unknown): string | null | undefined {
  if (input === null || input === undefined) return null;
  if (typeof input !== "string") return undefined;
  const trimmed = input.trim();
  if (!trimmed) return null;
  let compact = trimmed.replace(/[\s.()/-]/g, "");
  if (compact.startsWith("00")) compact = `+${compact.slice(2)}`;
  return PHONE.test(compact) ? compact : undefined;
}

export interface ContactDraft {
  displayName: string;
  roleLabel: string | null;
  templateRoleKey: string | null;
  email: string | null;
  phoneE164: string | null;
  preferredChannel: ContactChannel;
}

const text = (max: number) => z.string().trim().max(max, "Il testo è troppo lungo.");
const roleKey = z.string().trim().regex(ROLE_KEY, "Ruolo non valido.").nullish().or(z.literal(""));

const ContactSchema = z.object({
  displayName: text(255).min(2, "Scrivi il nome del referente."),
  roleLabel: text(255).nullish(),
  templateRoleKey: roleKey,
  email: text(320).nullish(),
  phone: text(40).nullish(),
  preferredChannel: z.enum(CONTACT_CHANNELS).nullish(),
});

function emptyToNull(value: string | null | undefined): string | null {
  return value === undefined || value === null || value.trim() === "" ? null : value.trim();
}

function channelFor(email: string | null, phone: string | null, chosen: ContactChannel | null | undefined): Result<ContactChannel> {
  const channel = chosen ?? (email ? "email" : phone ? "whatsapp_manuale" : "email");
  if ((channel === "whatsapp_manuale" || channel === "entrambi") && !phone) {
    return fail("telefono_mancante", "Per mandare il link su WhatsApp serve il telefono.");
  }
  if (channel === "entrambi" && !email) return fail("email_mancante", "Per «entrambi» servono email e telefono.");
  return ok(channel);
}

/** Il canale ha ancora i contatti che gli servono? */
function channelFits(channel: ContactChannel, email: string | null, phone: string | null): boolean {
  if (channel === "email") return email !== null;
  if (channel === "whatsapp_manuale") return phone !== null;
  return email !== null && phone !== null;
}

function parseEmail(value: string | null | undefined): Result<string | null> {
  const emailText = emptyToNull(value);
  if (emailText === null) return ok(null);
  const email = normalizeEmail(emailText);
  return email === null ? fail("email_non_valida", "Controlla l'indirizzo email del referente.") : ok(email);
}

const PHONE_MESSAGE = "Scrivi il telefono con il prefisso internazionale, per esempio +39 333 1234567.";

/**
 * Input di un referente: nome e ruolo bastano; l'email serve per l'invio
 * automatico, il telefono solo per mandare il link su WhatsApp a mano.
 */
export function prepareContact(raw: unknown): Result<ContactDraft> {
  const parsed = ContactSchema.safeParse(raw);
  if (!parsed.success) return fail("dati_non_validi", parsed.error.issues[0]?.message ?? "Controlla i dati del referente.");
  const d = parsed.data;
  const email = parseEmail(d.email);
  if (!email.ok) return email;
  const phone = normalizePhone(d.phone ?? null);
  if (phone === undefined) return fail("telefono_non_valido", PHONE_MESSAGE);
  const channel = channelFor(email.value, phone, d.preferredChannel);
  if (!channel.ok) return channel;
  return ok({
    displayName: d.displayName,
    roleLabel: emptyToNull(d.roleLabel),
    templateRoleKey: emptyToNull(d.templateRoleKey ?? null),
    email: email.value,
    phoneE164: phone,
    preferredChannel: channel.value,
  });
}

/** Valori correnti del referente (riga `uc_contacts`). */
export interface ContactRowState {
  id: string;
  displayName: string;
  roleLabel: string | null;
  templateRoleKey: string | null;
  email: string | null;
  phoneE164: string | null;
  preferredChannel: ContactChannel;
  isActive: boolean;
  anonymized: boolean;
  userId: string | null;
}

export function parseContactRow(row: Row | undefined): ContactRowState | null {
  if (!row || !row.id) return null;
  const channel = rowString(row.preferred_channel);
  return {
    id: String(row.id),
    displayName: String(row.display_name ?? ""),
    roleLabel: rowString(row.role_label),
    templateRoleKey: rowString(row.template_role_key),
    email: rowString(row.email),
    phoneE164: rowString(row.phone_e164),
    preferredChannel: isVocab(CONTACT_CHANNELS, channel) ? channel : "email",
    isActive: rowBool(row.is_active),
    anonymized: row.anonymized_at !== null && row.anonymized_at !== undefined && row.anonymized_at !== false,
    userId: rowString(row.user_id),
  };
}

/** Referenti del workspace indicati (riga completa, per i controlli). */
export function contactRowsSql(workspaceId: string, contactIds: readonly string[]): UcStatement {
  return toStatement(ucSql`SELECT id, display_name, role_label, template_role_key, email, phone_e164, preferred_channel, is_active, anonymized_at, user_id
FROM uc_contacts WHERE workspace_id = ${cast(uuid(workspaceId, "workspace"), "uuid")} AND id = ANY(${cast(uuids(contactIds, "referente"), "uuid[]")})`);
}

/** Referenti attivi del workspace con un ruolo del template (per «Assegna per ruolo»). */
export function roleContactsSql(workspaceId: string): UcStatement {
  return toStatement(ucSql`SELECT id, display_name, role_label, template_role_key, email, phone_e164, preferred_channel, is_active, anonymized_at, user_id
FROM uc_contacts WHERE workspace_id = ${cast(uuid(workspaceId, "workspace"), "uuid")} AND template_role_key IS NOT NULL AND is_active AND anonymized_at IS NULL`);
}

export type ContactPatch = Partial<ContactDraft & { isActive: boolean }>;

const ContactPatchSchema = z
  .object({
    contactId: z.string().regex(UUID, "Referente non valido."),
    displayName: text(255).min(2, "Scrivi il nome del referente.").optional(),
    roleLabel: text(255).nullish(),
    templateRoleKey: roleKey,
    email: text(320).nullish(),
    phone: text(40).nullish(),
    preferredChannel: z.enum(CONTACT_CHANNELS).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

/** Id del referente da modificare (prima di leggerlo). */
export function contactIdOf(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const id = (raw as Record<string, unknown>).contactId;
  return typeof id === "string" && UUID.test(id) ? id : null;
}

/**
 * Modifica di un referente: solo i campi presenti cambiano. Restituisce la patch,
 * i nomi delle colonne davvero cambiate (per l'evento, senza valori), se cambia
 * l'email e se il referente viene disattivato.
 */
export function prepareContactPatch(
  raw: unknown,
  current: ContactRowState,
): Result<{ patch: ContactPatch; fields: string[]; emailChanged: boolean; deactivated: boolean }> {
  const parsed = ContactPatchSchema.safeParse(raw);
  if (!parsed.success) return fail("dati_non_validi", parsed.error.issues[0]?.message ?? "Controlla i dati del referente.");
  if (current.anonymized) return fail("contatto_anonimizzato", "Il referente è anonimizzato: non si modifica più.");
  const d = parsed.data;
  let email = current.email;
  if (d.email !== undefined) {
    const parsedEmail = parseEmail(d.email);
    if (!parsedEmail.ok) return parsedEmail;
    email = parsedEmail.value;
  }
  let phone = current.phoneE164;
  if (d.phone !== undefined) {
    const parsedPhone = normalizePhone(d.phone);
    if (parsedPhone === undefined) return fail("telefono_non_valido", PHONE_MESSAGE);
    phone = parsedPhone;
  }
  // Un canale non scelto resta quello di prima, salvo che non si adatti più ai contatti nuovi.
  let chosen: ContactChannel | null = d.preferredChannel ?? current.preferredChannel;
  if (d.preferredChannel === undefined && !channelFits(current.preferredChannel, email, phone)) chosen = null;
  const channel = channelFor(email, phone, chosen);
  if (!channel.ok) return channel;
  const next = {
    displayName: d.displayName ?? current.displayName,
    roleLabel: d.roleLabel !== undefined ? emptyToNull(d.roleLabel) : current.roleLabel,
    templateRoleKey: d.templateRoleKey !== undefined ? emptyToNull(d.templateRoleKey) : current.templateRoleKey,
    email,
    phoneE164: phone,
    preferredChannel: channel.value,
    isActive: d.isActive ?? current.isActive,
  };
  const patch: ContactPatch = {};
  const fields: string[] = [];
  for (const key of Object.keys(CONTACT_COLUMNS) as (keyof ContactPatch)[]) {
    if (next[key] !== current[key]) {
      (patch as Record<string, unknown>)[key] = next[key];
      fields.push(CONTACT_COLUMNS[key].column);
    }
  }
  return ok({ patch, fields, emailChanged: "email" in patch, deactivated: current.isActive && !next.isActive });
}

/** Email del referente: del cliente, non di Lateral Space né di un membro LS del caso. */
export function checkContactDraft(
  draft: { email: string | null },
  ctx: { lsDomains: readonly string[]; lsMemberEmails: readonly string[]; user?: Pick<UserContext, "isLateralSpace" | "emailDomain"> | null },
): Result<void> {
  return checkContactEmail({ email: draft.email, user: ctx.user ?? null, lsDomains: ctx.lsDomains, lsMemberEmails: ctx.lsMemberEmails });
}

/** Un altro referente del workspace (non anonimizzato) ha già questa email? */
export function contactEmailTakenSql(i: { workspaceId: string; email: string; excludeContactId?: string | null }): UcStatement {
  const exclude = i.excludeContactId ? ucSql` AND id <> ${cast(uuid(i.excludeContactId, "referente"), "uuid")}` : raw("");
  return toStatement(ucSql`SELECT EXISTS (SELECT 1 FROM uc_contacts WHERE workspace_id = ${cast(uuid(i.workspaceId, "workspace"), "uuid")}
  AND lower(email) = lower(${cast(i.email, "text")}) AND anonymized_at IS NULL${exclude}) AS taken`);
}

/** Referente nuovo; un'email già usata nel workspace fa fallire il batch con `email_in_uso`. */
export function contactInsertSql(i: { id: string; workspaceId: string; draft: ContactDraft; createdByUserId: string | null }): UcStatement {
  const d = i.draft;
  return toStatement(
    requireRows(
      ucSql`INSERT INTO uc_contacts (id, workspace_id, display_name, role_label, template_role_key, email, phone_e164, preferred_channel, created_by_user_id)
VALUES (${cast(uuid(i.id, "referente"), "uuid")}, ${cast(uuid(i.workspaceId, "workspace"), "uuid")}, ${cast(d.displayName, "text")}, ${cast(d.roleLabel, "text")},
  ${cast(d.templateRoleKey, "text")}, ${cast(d.email, "text")}, ${cast(d.phoneE164, "text")}, ${cast(d.preferredChannel, "text")}, ${cast(i.createdByUserId, "uuid")})
ON CONFLICT DO NOTHING
RETURNING id`,
      1,
      "email_in_uso",
    ),
  );
}

const CONTACT_COLUMNS: Readonly<Record<keyof ContactPatch, { column: string; type: "text" | "boolean" }>> = {
  displayName: { column: "display_name", type: "text" },
  roleLabel: { column: "role_label", type: "text" },
  templateRoleKey: { column: "template_role_key", type: "text" },
  email: { column: "email", type: "text" },
  phoneE164: { column: "phone_e164", type: "text" },
  preferredChannel: { column: "preferred_channel", type: "text" },
  isActive: { column: "is_active", type: "boolean" },
};

/**
 * Modifica con CAS sull'email e sullo stato letti: se qualcuno li ha cambiati
 * nel frattempo il batch si annulla.
 */
export function contactUpdateSql(i: { workspaceId: string; contactId: string; patch: ContactPatch; expect: { email: string | null; isActive: boolean } }): UcStatement {
  const sets: SqlFragment[] = [];
  for (const key of Object.keys(CONTACT_COLUMNS) as (keyof ContactPatch)[]) {
    if (!(key in i.patch) || i.patch[key] === undefined) continue;
    const { column, type } = CONTACT_COLUMNS[key];
    sets.push(ucSql`${raw(column)} = ${cast(i.patch[key] ?? null, type)}`);
  }
  sets.push(raw("updated_at = now()"));
  return toStatement(
    requireRows(
      ucSql`UPDATE uc_contacts SET ${join(sets, ", ")}
WHERE id = ${cast(uuid(i.contactId, "referente"), "uuid")} AND workspace_id = ${cast(uuid(i.workspaceId, "workspace"), "uuid")} AND anonymized_at IS NULL
  AND email IS NOT DISTINCT FROM ${cast(i.expect.email, "text")} AND is_active = ${cast(i.expect.isActive, "boolean")}
RETURNING id`,
      1,
      "conflitto",
    ),
  );
}

/** Anonimizzazione: il nome diventa l'etichetta del ruolo, email, telefono e account si tolgono. Non si cancella mai. */
export function contactAnonymizeSql(i: { workspaceId: string; contactId: string }): UcStatement {
  return toStatement(
    requireRows(
      ucSql`UPDATE uc_contacts SET display_name = left(coalesce(nullif(btrim(role_label), ''), 'Referente'), 255), email = NULL, phone_e164 = NULL, user_id = NULL,
  is_active = false, anonymized_at = now(), updated_at = now()
WHERE id = ${cast(uuid(i.contactId, "referente"), "uuid")} AND workspace_id = ${cast(uuid(i.workspaceId, "workspace"), "uuid")} AND anonymized_at IS NULL
RETURNING id`,
      1,
      "conflitto",
    ),
  );
}

/** Il referente non ha richieste ancora apribili (nemmeno su un caso sospeso). */
export function contactHasNoOpenRequestsSql(contactId: string): UcStatement {
  return toStatement(ucSql`SELECT uc_require(NOT EXISTS (
  SELECT 1 FROM uc_requests r JOIN uc_cases c ON c.id = r.case_id
  WHERE r.contact_id = ${cast(uuid(contactId, "referente"), "uuid")} AND ${requestVisibleSql("r", "c")}
), 'richieste_aperte') AS ok`);
}

/** Il referente non è firmatario designato in un caso non chiuso del workspace. */
export function contactNotDesignatedSql(workspaceId: string, contactId: string): UcStatement {
  const c = cast(uuid(contactId, "referente"), "uuid");
  return toStatement(ucSql`SELECT uc_require(NOT EXISTS (
  SELECT 1 FROM uc_cases WHERE workspace_id = ${cast(uuid(workspaceId, "workspace"), "uuid")} AND status <> 'chiuso'
    AND (client_owner_contact_id = ${c} OR client_privacy_approver_contact_id = ${c})
), 'firmatario_designato') AS ok`);
}

/** Casi non chiusi del workspace in cui il referente è firmatario designato. */
export function contactDesignationsSql(workspaceId: string, contactId: string): UcStatement {
  const c = cast(uuid(contactId, "referente"), "uuid");
  return toStatement(ucSql`SELECT id FROM uc_cases WHERE workspace_id = ${cast(uuid(workspaceId, "workspace"), "uuid")} AND status <> 'chiuso'
  AND (client_owner_contact_id = ${c} OR client_privacy_approver_contact_id = ${c})`);
}

/** Link già emessi per il referente (tutte le sue richieste) revocati: un'email cambiata non lascia link validi al vecchio indirizzo. */
export function contactTokensRevokeSql(contactId: string): UcStatement {
  return toStatement(ucSql`UPDATE uc_request_tokens t SET revoked_at = now()
FROM uc_requests r
WHERE t.request_id = r.id AND r.contact_id = ${cast(uuid(contactId, "referente"), "uuid")} AND t.revoked_at IS NULL`);
}

/** Link di approvazione del referente revocati, in tutti i casi (cambio di email). */
export function contactApprovalRequestsRevokeSql(i: { contactId: string; reasonCode: string }): UcStatement {
  return toStatement(ucSql`UPDATE uc_requests SET status = 'revocata', revoked_at = now(), revoked_reason = ${cast(code(i.reasonCode) ?? "revocata", "text")}, next_reminder_at = NULL, updated_at = now()
WHERE contact_id = ${cast(uuid(i.contactId, "referente"), "uuid")} AND purpose = 'approvazioni' AND revoked_at IS NULL AND status NOT IN ('revocata', 'scaduta')`);
}

/** Notifiche in coda per il referente annullate (anonimizzazione). */
export function contactNotificationsCancelSql(contactId: string): UcStatement {
  return toStatement(ucSql`UPDATE uc_notifications SET status = 'annullata'
WHERE recipient_contact_id = ${cast(uuid(contactId, "referente"), "uuid")} AND status IN ('in_coda', 'errore')`);
}

export function contactEventSql(i: {
  type: "referente.creato" | "referente.modificato" | "referente.anonimizzato";
  workspaceId: string;
  caseId: string;
  actor: EventActor;
  contactId: string;
  roleKey: string | null;
  fields?: readonly string[];
}): UcStatement {
  return toStatement(
    eventInsertSql({
      type: i.type,
      workspaceId: i.workspaceId,
      caseId: i.caseId,
      actor: i.actor,
      targetType: "referente",
      targetId: i.contactId,
      payload: { role_key: code(i.roleKey), ...(i.type === "referente.anonimizzato" ? {} : { fields: [...(i.fields ?? [])] }) },
    }),
  );
}

// ── Assegnazione ──────────────────────────────────────────────────────

export interface AssignableItem {
  id: string;
  key: string;
  assigneeContactId: string | null;
  ownerRoleKey: string | null;
  /** Richiesta attiva della voce (`uc_request_items` da_fare, bozza, inviata). */
  activeRequestId: string | null;
}

export type AssignmentTarget = { contactId: string | null } | { skip: { code: string; message: string } };

export interface AssignmentPlan {
  assign: { id: string; key: string; prev: string | null; contact: string | null }[];
  skipped: { id: string; key: string; code: string; message: string }[];
  unchanged: number;
}

/**
 * Chi riceve ogni voce. Una voce in una richiesta attiva (anche in bozza) non
 * cambia referente: va prima revocata la richiesta. Con `overwrite = false` le
 * voci già assegnate a qualcuno restano a lui.
 */
export function planAssignment(i: { items: readonly AssignableItem[]; target: (item: AssignableItem) => AssignmentTarget; overwrite: boolean }): AssignmentPlan {
  const out: AssignmentPlan = { assign: [], skipped: [], unchanged: 0 };
  const seen = new Set<string>();
  for (const item of i.items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const t = i.target(item);
    if ("skip" in t) {
      out.skipped.push({ id: item.id, key: item.key, ...t.skip });
      continue;
    }
    if (item.assigneeContactId === t.contactId) {
      out.unchanged++;
      continue;
    }
    if (item.activeRequestId) {
      out.skipped.push({ id: item.id, key: item.key, code: "in_richiesta", message: "È in una richiesta aperta: revocala prima di cambiare referente." });
      continue;
    }
    if (!i.overwrite && item.assigneeContactId !== null) {
      out.skipped.push({ id: item.id, key: item.key, code: "gia_assegnata", message: "Ha già un referente." });
      continue;
    }
    out.assign.push({ id: item.id, key: item.key, prev: item.assigneeContactId, contact: t.contactId });
  }
  return out;
}

/** Referente proposto per un ruolo del template: l'unico referente attivo con quel ruolo. */
export function suggestContactForRole(
  contacts: readonly { id: string; templateRoleKey: string | null; isActive: boolean; anonymized: boolean }[],
  role: string | null,
): AssignmentTarget {
  if (!role) return { skip: { code: "senza_ruolo", message: "La voce non ha un ruolo del template." } };
  const matches = contacts.filter((c) => c.templateRoleKey === role && c.isActive && !c.anonymized);
  if (matches.length === 1) return { contactId: matches[0].id };
  if (matches.length === 0) return { skip: { code: "nessun_referente_per_ruolo", message: "Nessun referente ha questo ruolo." } };
  return { skip: { code: "piu_referenti_per_ruolo", message: "Più referenti hanno questo ruolo: scegli tu a chi assegnare." } };
}

/** Referente assegnabile: attivo, non anonimizzato, del cliente (`checkAssignee`). */
export function checkContactAssignable(
  contact: Pick<ContactRowState, "email" | "isActive" | "anonymized">,
  ctx: { lsDomains: readonly string[]; lsMemberEmails: readonly string[]; user?: Pick<UserContext, "isLateralSpace" | "emailDomain"> | null },
): Result<void> {
  return checkAssignee({
    contact: { email: contact.email, isActive: contact.isActive, anonymized: contact.anonymized, user: ctx.user ?? null },
    lsDomains: ctx.lsDomains,
    lsMemberEmails: ctx.lsMemberEmails,
  });
}

/**
 * Assegnazione con CAS sul referente letto e senza richieste attive, più
 * l'evento `voce.assegnata` per ogni voce davvero aggiornata.
 */
export function assignItemsSql(i: {
  workspaceId: string;
  caseId: string;
  rows: readonly { id: string; prev: string | null; contact: string | null }[];
  actor: EventActor;
  roleKey?: string | null;
}): UcStatement {
  if (i.rows.length === 0) throw new Error("Nessuna voce da assegnare");
  const rows = i.rows.map((r) => ({ id: uuid(r.id, "voce"), prev: r.prev, contact: r.contact }));
  const event = eventInsertFromSql({
    type: "voce.assegnata",
    workspaceId: i.workspaceId,
    caseId: i.caseId,
    actor: i.actor,
    targetType: "voce",
    from: "u",
    targetIdColumn: "u.id",
    payload: { role_key: code(i.roleKey ?? null) },
    rowPayload: { item_key: "u.key" },
  });
  return toStatement(ucSql`WITH x AS (
  SELECT * FROM jsonb_to_recordset(${jsonb(rows)}) AS x(id uuid, prev uuid, contact uuid)
), u AS (
  UPDATE uc_items i SET assignee_contact_id = x.contact, updated_at = now()
  FROM x
  WHERE i.id = x.id AND i.case_id = ${cast(uuid(i.caseId, "caso"), "uuid")} AND i.deleted_at IS NULL
    AND i.assignee_contact_id IS NOT DISTINCT FROM x.prev
    AND NOT EXISTS (SELECT 1 FROM uc_request_items ri WHERE ri.item_id = i.id AND ri.state IN (${raw(ACTIVE_STATES_SQL)}))
  RETURNING i.id, i.key
), ev AS (${event})
SELECT uc_require(count(*) = ${cast(rows.length, "int")}, 'conflitto') AS ok FROM u`);
}

/** Ruolo del template dato al referente che ancora non ne ha uno (assegnazione per ruolo). */
export function contactRoleIfMissingSql(i: { workspaceId: string; contactId: string; roleKey: string }): UcStatement {
  if (!ROLE_KEY.test(i.roleKey)) throw new Error("Ruolo non valido");
  return toStatement(ucSql`UPDATE uc_contacts SET template_role_key = ${cast(i.roleKey, "text")}, updated_at = now()
WHERE id = ${cast(uuid(i.contactId, "referente"), "uuid")} AND workspace_id = ${cast(uuid(i.workspaceId, "workspace"), "uuid")} AND template_role_key IS NULL`);
}

// ── Voci da chiedere ──────────────────────────────────────────────────

/** Stati da cui una voce si chiede con una richiesta (righe 1, 10, 15, 28). */
export const SENDABLE_ITEM_STATUSES: readonly ItemStatus[] = ["da_chiedere", "mancante", "parziale", "bloccata"];

/**
 * La voce può entrare in una richiesta per questo referente? Stato da chiedere,
 * un tipo di risposta, nessun blocco attivo, nessuna richiesta attiva (salvo la
 * bozza che si sta inviando) e assegnata a quel referente.
 */
export function checkRequestable(
  item: Pick<ItemSnapshot, "status" | "responseType" | "activeBlockerKeys" | "assigneeContactId">,
  o: { activeRequestId: string | null; draftRequestId?: string | null; contactId?: string | null },
): Result<void> {
  if (!SENDABLE_ITEM_STATUSES.includes(item.status)) {
    return fail("stato_non_chiedibile", "In questo stato la voce non si chiede: è già chiesta, in verifica o chiusa.");
  }
  if (!item.responseType) return fail("senza_tipo_risposta", "La voce non ha un modo di rispondere: non si chiede al referente.");
  if (item.activeBlockerKeys.length > 0) return fail("voce_bloccata", "La voce è ancora bloccata: prima va sciolto il blocco.");
  if (o.activeRequestId !== null && o.activeRequestId !== (o.draftRequestId ?? null)) {
    return fail("gia_in_richiesta", "La voce è già in un'altra richiesta.");
  }
  if (!item.assigneeContactId) return fail("referente_assente", "Assegna prima la voce a un referente.");
  if (o.contactId && item.assigneeContactId !== o.contactId) return fail("altro_referente", "La voce è assegnata a un altro referente.");
  return ok(undefined);
}

export interface SkippedItem {
  itemId: string;
  key: string;
  code: string;
  message: string;
}

/** Divide le voci tra quelle che si possono chiedere e quelle saltate, con il motivo. */
export function splitRequestable<T extends { snapshot: Pick<ItemSnapshot, "id" | "key" | "status" | "responseType" | "activeBlockerKeys" | "assigneeContactId">; activeRequestId: string | null }>(
  items: readonly T[],
  o: { draftRequestId?: string | null; contactId?: string | null },
): { eligible: T[]; skipped: SkippedItem[] } {
  const eligible: T[] = [];
  const skipped: SkippedItem[] = [];
  for (const item of items) {
    const r = checkRequestable(item.snapshot, { activeRequestId: item.activeRequestId, draftRequestId: o.draftRequestId, contactId: o.contactId });
    if (r.ok) eligible.push(item);
    else skipped.push({ itemId: item.snapshot.id, key: item.snapshot.key, code: r.code, message: r.message });
  }
  return { eligible, skipped };
}

/** Voci raggruppate per referente assegnato, in ordine stabile (una richiesta = un referente + le sue voci). */
export function groupByAssignee<T>(items: readonly T[], contactOf: (item: T) => string | null): { contactId: string; items: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const contactId = contactOf(item);
    if (!contactId) continue;
    groups.set(contactId, [...(groups.get(contactId) ?? []), item]);
  }
  return [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([contactId, list]) => ({ contactId, items: list }));
}

/**
 * Richiesta di conferma al titolare del dato (riga 19): voce in verifica, con un
 * referente che ha il ruolo del titolare quando la voce ne ha uno. Altrimenti la
 * conferma non basterebbe a validarla.
 */
export function checkConfirmationTarget(
  item: Pick<ItemSnapshot, "status" | "assigneeContactId" | "ownerRoleKey">,
  contact: { templateRoleKey: string | null } | null,
): Result<void> {
  if (item.status !== "in_verifica") return fail("stato_non_ammesso", "Si chiede conferma solo di una voce in verifica.");
  if (!item.assigneeContactId || !contact) return fail("referente_assente", "Assegna prima la voce al referente che deve confermarla.");
  if (item.ownerRoleKey && contact.templateRoleKey !== item.ownerRoleKey) {
    return fail("ruolo_titolare_diverso", "Chiedi la conferma al referente con il ruolo del titolare del dato.");
  }
  return ok(undefined);
}

// ── Richieste ─────────────────────────────────────────────────────────

/** Riga `uc_requests` letta dai comandi, con il referente e lo stato del link. */
export interface RequestRowState {
  id: string;
  caseId: string;
  contactId: string;
  purpose: RequestPurpose;
  status: RequestStatus;
  shareEpoch: number;
  actingRoleKey: string | null;
  channel: RequestChannel;
  delegatedFromRequestId: string | null;
  delegationDepth: number;
  sentAt: Date | null;
  expiresAt: Date | null;
  reminderCount: number;
  escalatedAt: Date | null;
  revokedAt: Date | null;
  /** `uc_request_live` calcolato con l'orologio del database. */
  live: boolean;
  /** `uc_request_visible` (ammette il caso sospeso). */
  visible: boolean;
  activeItemIds: string[];
  contact: { email: string | null; isActive: boolean; anonymized: boolean; templateRoleKey: string | null; userId: string | null };
}

/** Riga della richiesta con referente, voci attive e predicati del link (orologio del DB). */
export function requestRowSql(i: { workspaceId: string; caseId: string; requestId: string }): UcStatement {
  return toStatement(ucSql`SELECT r.id, r.case_id, r.contact_id, r.purpose, r.status, r.share_epoch, r.acting_role_key, r.channel,
  r.delegated_from_request_id, r.delegation_depth, r.sent_at, r.expires_at, r.reminder_count, r.escalated_at, r.revoked_at,
  ct.email AS contact_email, ct.is_active AS contact_active, ct.anonymized_at IS NOT NULL AS contact_anonymized,
  ct.template_role_key AS contact_role_key, ct.user_id AS contact_user_id,
  ${requestLiveSql("r", "c")} AS live, ${requestVisibleSql("r", "c")} AS visible,
  coalesce((SELECT jsonb_agg(ri.item_id ORDER BY ri.item_id) FROM uc_request_items ri
    WHERE ri.request_id = r.id AND ri.state IN (${raw(ACTIVE_STATES_SQL)})), '[]'::jsonb) AS active_item_ids
FROM uc_requests r
JOIN uc_cases c ON c.id = r.case_id
JOIN uc_contacts ct ON ct.id = r.contact_id
WHERE r.id = ${cast(uuid(i.requestId, "richiesta"), "uuid")} AND r.case_id = ${cast(uuid(i.caseId, "caso"), "uuid")} AND c.workspace_id = ${cast(uuid(i.workspaceId, "workspace"), "uuid")}`);
}

export function parseRequestRow(row: Row | undefined): RequestRowState | null {
  if (!row || !row.id) return null;
  const purpose = rowString(row.purpose);
  const status = rowString(row.status);
  const channel = rowString(row.channel);
  if (!isVocab(REQUEST_PURPOSES, purpose) || !isVocab(REQUEST_STATUSES, status)) return null;
  return {
    id: String(row.id),
    caseId: String(row.case_id),
    contactId: String(row.contact_id),
    purpose,
    status,
    shareEpoch: rowNumber(row.share_epoch) ?? 0,
    actingRoleKey: rowString(row.acting_role_key),
    channel: isVocab(REQUEST_CHANNELS, channel) ? channel : "email",
    delegatedFromRequestId: rowString(row.delegated_from_request_id),
    delegationDepth: rowNumber(row.delegation_depth) ?? 0,
    sentAt: rowDate(row.sent_at),
    expiresAt: rowDate(row.expires_at),
    reminderCount: rowNumber(row.reminder_count) ?? 0,
    escalatedAt: rowDate(row.escalated_at),
    revokedAt: rowDate(row.revoked_at),
    live: rowBool(row.live),
    visible: rowBool(row.visible),
    activeItemIds: rowStringArray(rowJson(row.active_item_ids)),
    contact: {
      email: rowString(row.contact_email),
      isActive: rowBool(row.contact_active),
      anonymized: rowBool(row.contact_anonymized),
      templateRoleKey: rowString(row.contact_role_key),
      userId: rowString(row.contact_user_id),
    },
  };
}

/** Scadenza di un link dall'invio, in SQL (orologio del DB). */
// In ore, non in giorni: `interval '30 days'` segue il fuso della sessione e con il
// cambio dell'ora dura 30 giorni ± 1 ora, mentre i controlli in TypeScript contano
// 30 × 24 ore esatte (`checkExtendExpiry`, `expiryOnSend`).
const EXPIRY_SQL = raw(`now() + interval '${REQUEST_LINK_TTL_DAYS * 24} hours'`);

/**
 * Richiesta nuova per un referente attivo del workspace, nell'epoca dei link
 * corrente del caso. Con `send` nasce già inviata (`sent_at = now()`, scadenza a
 * 30 giorni): solo su un caso non chiuso né sospeso. Senza, è una bozza (senza
 * scadenza e senza token).
 */
export function requestInsertSql(i: {
  id: string;
  workspaceId: string;
  caseId: string;
  contactId: string;
  purpose: RequestPurpose;
  actingRoleKey: string | null;
  message: string | null;
  channel: RequestChannel;
  createdByUserId: string | null;
  send: boolean;
  nextReminderAt?: Date | null;
}): UcStatement {
  const blocked = i.send ? raw("('chiuso', 'sospeso')") : raw("('chiuso')");
  return toStatement(
    requireRows(
      ucSql`INSERT INTO uc_requests (id, case_id, contact_id, purpose, share_epoch, acting_role_key, status, message, channel, sent_at, expires_at, next_reminder_at, created_by_user_id)
SELECT ${cast(uuid(i.id, "richiesta"), "uuid")}, c.id, ct.id, ${cast(i.purpose, "text")}, c.share_epoch, ${cast(i.actingRoleKey, "text")},
  ${raw(i.send ? "'inviata'" : "'bozza'")}, ${cast(i.message, "text")}, ${cast(i.channel, "text")},
  ${raw(i.send ? "now()" : "NULL::timestamptz")}, ${i.send ? EXPIRY_SQL : raw("NULL::timestamptz")},
  ${cast(i.send && i.nextReminderAt ? i.nextReminderAt.toISOString() : null, "timestamptz")}, ${cast(i.createdByUserId, "uuid")}
FROM uc_cases c
JOIN uc_contacts ct ON ct.id = ${cast(uuid(i.contactId, "referente"), "uuid")} AND ct.workspace_id = c.workspace_id AND ct.is_active AND ct.anonymized_at IS NULL
WHERE c.id = ${cast(uuid(i.caseId, "caso"), "uuid")} AND c.workspace_id = ${cast(uuid(i.workspaceId, "workspace"), "uuid")}
  AND c.setup_completed_at IS NOT NULL AND c.status NOT IN ${blocked}
RETURNING id`,
      1,
      "conflitto",
    ),
  );
}

/**
 * Voci nella richiesta (`da_fare`), con CAS sullo stato letto e sul referente:
 * se una voce è cambiata o è già in un'altra richiesta attiva (indice unico
 * parziale) il batch si annulla.
 */
export function requestItemsInsertSql(i: { caseId: string; requestId: string; contactId: string; items: readonly { id: string; status: ItemStatus }[] }): UcStatement {
  const seen = new Set<string>();
  const items: { id: string; status: ItemStatus }[] = [];
  for (const x of i.items) {
    if (seen.has(x.id)) continue;
    seen.add(x.id);
    items.push({ id: uuid(x.id, "voce"), status: x.status });
  }
  if (items.length === 0) throw new Error("Nessuna voce nella richiesta");
  return toStatement(ucSql`WITH x AS (
  SELECT * FROM jsonb_to_recordset(${jsonb(items)}) AS x(id uuid, status text)
), ins AS (
  INSERT INTO uc_request_items (case_id, request_id, item_id, state)
  SELECT i.case_id, ${cast(uuid(i.requestId, "richiesta"), "uuid")}, i.id, 'da_fare'
  FROM uc_items i JOIN x ON x.id = i.id
  WHERE i.case_id = ${cast(uuid(i.caseId, "caso"), "uuid")} AND i.deleted_at IS NULL AND i.status = x.status
    AND i.assignee_contact_id = ${cast(uuid(i.contactId, "referente"), "uuid")}
  ON CONFLICT DO NOTHING
  RETURNING item_id
)
SELECT uc_require(count(*) = ${cast(items.length, "int")}, 'conflitto') AS ok FROM ins`);
}

/**
 * Invio di una bozza (CAS bozza → inviata): `sent_at = now()`, scadenza a 30
 * giorni, epoca dei link corrente del caso, referente ancora attivo, caso non
 * chiuso né sospeso.
 */
export function requestSendSql(i: { workspaceId: string; caseId: string; requestId: string; channel: RequestChannel; nextReminderAt: Date | null }): UcStatement {
  return toStatement(
    requireRows(
      ucSql`UPDATE uc_requests r SET status = 'inviata', sent_at = now(), expires_at = ${EXPIRY_SQL}, share_epoch = c.share_epoch,
  channel = ${cast(i.channel, "text")}, next_reminder_at = ${cast(i.nextReminderAt ? i.nextReminderAt.toISOString() : null, "timestamptz")}, updated_at = now()
FROM uc_cases c, uc_contacts ct
WHERE r.id = ${cast(uuid(i.requestId, "richiesta"), "uuid")} AND r.case_id = ${cast(uuid(i.caseId, "caso"), "uuid")}
  AND c.id = r.case_id AND c.workspace_id = ${cast(uuid(i.workspaceId, "workspace"), "uuid")} AND c.setup_completed_at IS NOT NULL
  AND c.status NOT IN ('chiuso', 'sospeso')
  AND r.status = 'bozza' AND r.revoked_at IS NULL
  AND ct.id = r.contact_id AND ct.is_active AND ct.anonymized_at IS NULL
RETURNING r.id`,
      1,
      "conflitto",
    ),
  );
}

/** Righe attive della richiesta (o solo di alcune voci) → `riassegnata`: la voce esce dal link. */
export function requestItemsReleaseSql(i: { caseId: string; requestId: string; itemIds?: readonly string[] }): UcStatement {
  const only = i.itemIds ? ucSql` AND item_id = ANY(${cast(uuids(i.itemIds, "voce"), "uuid[]")})` : raw("");
  return toStatement(ucSql`UPDATE uc_request_items SET state = 'riassegnata'
WHERE case_id = ${cast(uuid(i.caseId, "caso"), "uuid")} AND request_id = ${cast(uuid(i.requestId, "richiesta"), "uuid")} AND state IN (${raw(ACTIVE_STATES_SQL)})${only}`);
}

export function requestEventSql(i: {
  type: "richiesta.creata" | "richiesta.inviata" | "richiesta.promemoria" | "richiesta.revocata" | "richiesta.prorogata" | "delega.approvata";
  workspaceId: string;
  caseId: string;
  actor: EventActor;
  requestId: string;
  items?: number;
  purpose?: RequestPurpose;
  channel?: RequestChannel;
  reasonCode?: string | null;
  toState?: RequestStatus | null;
}): UcStatement {
  return toStatement(
    eventInsertSql({
      type: i.type,
      workspaceId: i.workspaceId,
      caseId: i.caseId,
      actor: i.actor,
      targetType: "richiesta",
      targetId: i.requestId,
      toState: i.toState ?? null,
      payload: { items: i.items, purpose: i.purpose, channel: i.channel, reason: code(i.reasonCode) },
    }),
  );
}

/** Canale della richiesta: email se il referente ne ha una, altrimenti il link si copia a mano. */
export function channelForContact(email: string | null): RequestChannel {
  return email ? "email" : "link_manuale";
}

// ── Token dei link ────────────────────────────────────────────────────

/**
 * Impronta di un token nuovo in `uc_request_tokens`, solo se la richiesta è viva
 * (`uc_request_live`, orologio del DB) nella stessa istruzione. «Copia» e
 * «delega» valgono solo per le richieste di raccolta: un link di approvazione
 * parte solo per email (`invio`/`promemoria`, senza utente). Solo la copia
 * registra chi l'ha fatta (guardia 9 dei quattro occhi).
 */
export function tokenInsertSql(i: {
  tokenId: string;
  workspaceId: string;
  caseId: string;
  requestId: string;
  hash: string;
  prefix: string;
  issuedFor: TokenIssuedFor;
  issuedByUserId: string | null;
}): UcStatement {
  if (!/^[0-9a-f]{64}$/.test(i.hash)) throw new Error("Impronta del token non valida");
  if (!/^ucr_[A-Za-z0-9_-]{8}$/.test(i.prefix)) throw new Error("Prefisso del token non valido");
  if (i.issuedFor === "copia" && !i.issuedByUserId) throw new Error("La copia del link registra chi la fa");
  if (i.issuedFor !== "copia" && i.issuedByUserId) throw new Error("Solo la copia del link registra un utente");
  const purpose = i.issuedFor === "copia" || i.issuedFor === "delega" ? raw(" AND r.purpose = 'raccolta'") : raw("");
  return toStatement(
    requireRows(
      ucSql`INSERT INTO uc_request_tokens (id, case_id, request_id, token_hash, token_prefix, issued_for, issued_by_user_id)
SELECT ${cast(uuid(i.tokenId, "token"), "uuid")}, r.case_id, r.id, ${cast(i.hash, "text")}, ${cast(i.prefix, "text")}, ${cast(i.issuedFor, "text")}, ${cast(i.issuedByUserId, "uuid")}
FROM uc_requests r JOIN uc_cases c ON c.id = r.case_id
WHERE r.id = ${cast(uuid(i.requestId, "richiesta"), "uuid")} AND r.case_id = ${cast(uuid(i.caseId, "caso"), "uuid")}
  AND c.workspace_id = ${cast(uuid(i.workspaceId, "workspace"), "uuid")} AND ${requestLiveSql("r", "c")}${purpose}
RETURNING id`,
      1,
      "richiesta_non_viva",
    ),
  );
}

/** Un token revocato (per esempio quando l'email che lo portava non è partita). */
export function tokenRevokeSql(i: { caseId: string; tokenId: string }): UcStatement {
  return toStatement(ucSql`UPDATE uc_request_tokens SET revoked_at = now()
WHERE id = ${cast(uuid(i.tokenId, "token"), "uuid")} AND case_id = ${cast(uuid(i.caseId, "caso"), "uuid")} AND revoked_at IS NULL`);
}

export function linkCopiedEventSql(i: { workspaceId: string; caseId: string; actor: EventActor; requestId: string; tokenId: string }): UcStatement {
  return toStatement(
    eventInsertSql({
      type: "link.copiato",
      workspaceId: i.workspaceId,
      caseId: i.caseId,
      actor: i.actor,
      targetType: "richiesta",
      targetId: i.requestId,
      payload: { token_id: i.tokenId },
    }),
  );
}

export type CopyLinkPlan = "invia_e_copia" | "copia";

/**
 * «Copia link»: mai per i link di approvazione; su una bozza la invia con il
 * canale `link_manuale`; su una delega in attesa di approvazione no; su una
 * richiesta viva emette un token nuovo; altrimenti il link non vale più.
 */
export function checkCopyLink(r: Pick<RequestRowState, "purpose" | "status" | "live" | "delegatedFromRequestId" | "revokedAt">, caseStatus: CaseStatus): Result<CopyLinkPlan> {
  if (r.purpose === "approvazioni") {
    return fail("link_approvazione", "Il link di approvazione parte solo per email al firmatario: non si mostra e non si copia.");
  }
  if (caseStatus === "chiuso") return fail("caso_chiuso", "Il caso è chiuso: i link non valgono più.");
  if (caseStatus === "sospeso") return fail("caso_sospeso", "Il caso è in pausa: niente link nuovi finché non riprende.");
  if (r.status === "bozza" && r.revokedAt === null) {
    if (r.delegatedFromRequestId) return fail("delega_da_approvare", "È una delega da approvare: approvala prima di mandare il link.");
    return ok("invia_e_copia");
  }
  if (r.live) return ok("copia");
  return fail("richiesta_non_viva", REQUEST_MESSAGES.richiesta_non_viva);
}

// ── Revoca ────────────────────────────────────────────────────────────

/** Una richiesta si revoca finché non è già revocata o scaduta (anche in bozza). */
export function checkRevoke(r: Pick<RequestRowState, "status" | "revokedAt">): Result<void> {
  if (r.status === "revocata" || r.status === "scaduta" || r.revokedAt !== null) return fail("richiesta_chiusa", "La richiesta è già revocata o scaduta.");
  return ok(undefined);
}

/** Revoca singola con CAS sullo stato letto. */
export function requestRevokeSql(i: { caseId: string; requestId: string; fromStatus: RequestStatus; reasonCode: string }): UcStatement {
  return toStatement(
    requireRows(
      ucSql`UPDATE uc_requests SET status = 'revocata', revoked_at = now(), revoked_reason = ${cast(code(i.reasonCode) ?? "revocata", "text")}, next_reminder_at = NULL, updated_at = now()
WHERE id = ${cast(uuid(i.requestId, "richiesta"), "uuid")} AND case_id = ${cast(uuid(i.caseId, "caso"), "uuid")} AND status = ${cast(i.fromStatus, "text")} AND revoked_at IS NULL
RETURNING id`,
      1,
      "conflitto",
    ),
  );
}

/** Token della richiesta revocati. */
export function requestTokensRevokeSql(i: { caseId: string; requestId: string }): UcStatement {
  return toStatement(ucSql`UPDATE uc_request_tokens SET revoked_at = now()
WHERE request_id = ${cast(uuid(i.requestId, "richiesta"), "uuid")} AND case_id = ${cast(uuid(i.caseId, "caso"), "uuid")} AND revoked_at IS NULL`);
}

/** Notifiche ancora in coda della richiesta annullate. */
export function requestNotificationsCancelSql(requestId: string): UcStatement {
  return toStatement(ucSql`UPDATE uc_notifications SET status = 'annullata'
WHERE request_id = ${cast(uuid(requestId, "richiesta"), "uuid")} AND status IN ('in_coda', 'errore')`);
}

/**
 * Richieste colpite da «Revoca tutti i link del caso»: tutte quelle non chiuse,
 * tranne le bozze scritte da Lateral Space (non hanno link). Le deleghe in attesa
 * di approvazione sono incluse.
 */
const REVOKE_ALL_TARGET = raw("r.status NOT IN ('revocata', 'scaduta') AND (r.status <> 'bozza' OR r.delegated_from_request_id IS NOT NULL)");

/** Richieste e voci `chiesta` colpite dalla revoca in blocco (lettura prima del batch). */
export function revokeAllTargetsSql(i: { workspaceId: string; caseId: string }): UcStatement {
  return toStatement(ucSql`SELECT r.id AS request_id,
  coalesce((SELECT jsonb_agg(ri.item_id ORDER BY ri.item_id) FROM uc_request_items ri JOIN uc_items it ON it.id = ri.item_id
    WHERE ri.request_id = r.id AND ri.state IN (${raw(ACTIVE_STATES_SQL)}) AND it.status = 'chiesta' AND it.deleted_at IS NULL), '[]'::jsonb) AS asked_item_ids
FROM uc_requests r JOIN uc_cases c ON c.id = r.case_id
WHERE r.case_id = ${cast(uuid(i.caseId, "caso"), "uuid")} AND c.workspace_id = ${cast(uuid(i.workspaceId, "workspace"), "uuid")} AND ${REVOKE_ALL_TARGET}
ORDER BY r.id`);
}

/**
 * Dopo le transizioni della revoca (riga 31) nessuna voce `chiesta` resta attiva
 * nella richiesta revocata (o nelle richieste della revoca in blocco): se ne è
 * nata una nel frattempo, il batch si annulla invece di lasciarla «Chiesta»
 * senza link.
 */
export function noAskedItemsLeftSql(i: { caseId: string; requestId: string } | { caseId: string; revokeAll: true }): UcStatement {
  const scope = "requestId" in i ? ucSql`r.id = ${cast(uuid(i.requestId, "richiesta"), "uuid")}` : REVOKE_ALL_TARGET;
  return toStatement(ucSql`SELECT uc_require(NOT EXISTS (
  SELECT 1 FROM uc_request_items ri
  JOIN uc_items it ON it.id = ri.item_id
  JOIN uc_requests r ON r.id = ri.request_id
  WHERE ri.case_id = ${cast(uuid(i.caseId, "caso"), "uuid")} AND ri.state IN (${raw(ACTIVE_STATES_SQL)}) AND it.status = 'chiesta' AND ${scope}
), 'conflitto') AS ok`);
}

/** Nuova epoca dei link (CAS sull'epoca letta): ogni richiesta dell'epoca precedente smette di valere. */
export function shareEpochBumpSql(i: { workspaceId: string; caseId: string; expectEpoch: number }): UcStatement {
  return toStatement(
    requireRows(
      ucSql`UPDATE uc_cases SET share_epoch = share_epoch + 1, updated_at = now()
WHERE id = ${cast(uuid(i.caseId, "caso"), "uuid")} AND workspace_id = ${cast(uuid(i.workspaceId, "workspace"), "uuid")}
  AND setup_completed_at IS NOT NULL AND status <> 'chiuso' AND share_epoch = ${cast(i.expectEpoch, "int")}
RETURNING id`,
      1,
      "conflitto",
    ),
  );
}

/** Revoca in blocco: le richieste colpite diventano `revocata`, con un evento per richiesta. */
export function revokeAllRequestsSql(i: { workspaceId: string; caseId: string; actor: EventActor; reasonCode: string }): UcStatement {
  const event = eventInsertFromSql({
    type: "richiesta.revocata",
    workspaceId: i.workspaceId,
    caseId: i.caseId,
    actor: i.actor,
    targetType: "richiesta",
    from: "u",
    targetIdColumn: "u.id",
    toStateColumn: "u.status",
    payload: { reason: code(i.reasonCode) },
  });
  return toStatement(ucSql`WITH u AS (
  UPDATE uc_requests r SET status = 'revocata', revoked_at = now(), revoked_reason = ${cast(code(i.reasonCode) ?? "revocata", "text")}, next_reminder_at = NULL, updated_at = now()
  WHERE r.case_id = ${cast(uuid(i.caseId, "caso"), "uuid")} AND r.revoked_at IS NULL AND ${REVOKE_ALL_TARGET}
  RETURNING r.id, r.status
), ev AS (${event})
SELECT count(*)::int AS revoked FROM u`);
}

/** Voci ancora attive di richieste revocate → `riassegnata` (le bozze di Lateral Space non sono revocate e restano). */
export function revokedRequestItemsReleaseSql(caseId: string): UcStatement {
  return toStatement(ucSql`UPDATE uc_request_items ri SET state = 'riassegnata'
FROM uc_requests r
WHERE ri.request_id = r.id AND ri.case_id = ${cast(uuid(caseId, "caso"), "uuid")} AND r.case_id = ri.case_id AND r.status = 'revocata'
  AND ri.state IN (${raw(ACTIVE_STATES_SQL)})`);
}

/** Notifiche in coda delle richieste revocate annullate. */
export function revokedRequestNotificationsCancelSql(caseId: string): UcStatement {
  return toStatement(ucSql`UPDATE uc_notifications n SET status = 'annullata'
FROM uc_requests r
WHERE n.request_id = r.id AND r.case_id = ${cast(uuid(caseId, "caso"), "uuid")} AND r.status = 'revocata' AND n.status IN ('in_coda', 'errore')`);
}

export function linksRevokedEventSql(i: { workspaceId: string; caseId: string; actor: EventActor; shareEpoch: number; requests: number }): UcStatement {
  return toStatement(
    eventInsertSql({
      type: "link.revocati_tutti",
      workspaceId: i.workspaceId,
      caseId: i.caseId,
      actor: i.actor,
      targetType: "caso",
      targetId: i.caseId,
      payload: { share_epoch: i.shareEpoch, requests: i.requests },
    }),
  );
}

// ── Proroga e reinvio ─────────────────────────────────────────────────

/**
 * Proroga della scadenza: mai oltre `now() + 30 giorni` (orologio del DB) e mai
 * indietro; la richiesta deve essere ancora apribile (anche su un caso sospeso,
 * perché il link non scada durante la pausa).
 */
export function extendExpirySql(i: { workspaceId: string; caseId: string; requestId: string; requested: Date; nextReminderAt: Date | null }): UcStatement {
  return toStatement(
    requireRows(
      ucSql`UPDATE uc_requests r SET expires_at = GREATEST(r.expires_at, LEAST(${cast(i.requested.toISOString(), "timestamptz")}, ${EXPIRY_SQL})),
  next_reminder_at = ${cast(i.nextReminderAt ? i.nextReminderAt.toISOString() : null, "timestamptz")}, updated_at = now()
FROM uc_cases c
WHERE r.id = ${cast(uuid(i.requestId, "richiesta"), "uuid")} AND r.case_id = ${cast(uuid(i.caseId, "caso"), "uuid")}
  AND c.id = r.case_id AND c.workspace_id = ${cast(uuid(i.workspaceId, "workspace"), "uuid")} AND ${requestVisibleSql("r", "c")}
RETURNING r.id`,
      1,
      "richiesta_non_viva",
    ),
  );
}

/** La richiesta è ancora viva (guardia nei batch che non la modificano). */
export function requestLiveGuardSql(i: { workspaceId: string; caseId: string; requestId: string }): UcStatement {
  return toStatement(ucSql`SELECT uc_require(EXISTS (
  SELECT 1 FROM uc_requests r JOIN uc_cases c ON c.id = r.case_id
  WHERE r.id = ${cast(uuid(i.requestId, "richiesta"), "uuid")} AND r.case_id = ${cast(uuid(i.caseId, "caso"), "uuid")}
    AND c.workspace_id = ${cast(uuid(i.workspaceId, "workspace"), "uuid")} AND ${requestLiveSql("r", "c")}
), 'richiesta_non_viva') AS ok`);
}

/** Canale della richiesta aggiornato (reinvio a un referente che ora ha l'email). */
export function requestChannelSql(i: { caseId: string; requestId: string; channel: RequestChannel }): UcStatement {
  return toStatement(ucSql`UPDATE uc_requests SET channel = ${cast(i.channel, "text")}, updated_at = now()
WHERE id = ${cast(uuid(i.requestId, "richiesta"), "uuid")} AND case_id = ${cast(uuid(i.caseId, "caso"), "uuid")} AND channel IS DISTINCT FROM ${cast(i.channel, "text")}`);
}

/** Si reinvia solo una richiesta di raccolta viva, a un referente attivo con email. */
export function checkRemind(r: Pick<RequestRowState, "purpose" | "live" | "status" | "contact">): Result<void> {
  if (r.purpose !== "raccolta") return fail("link_approvazione", "Il link di approvazione si manda di nuovo con «Chiedi la firma».");
  if (r.status === "bozza") return fail("non_inviata", "La richiesta non è ancora stata inviata: inviala.");
  if (!r.live) return fail("richiesta_non_viva", REQUEST_MESSAGES.richiesta_non_viva);
  if (!r.contact.isActive || r.contact.anonymized) return fail("contatto_non_attivo", "Il referente non è attivo.");
  if (!r.contact.email) return fail("email_mancante", "Il referente non ha un'email: copia il link e mandalo tu.");
  return ok(undefined);
}

// ── Deleghe ───────────────────────────────────────────────────────────

/**
 * Approvazione di una delega in bozza (dominio non tra i referenti del caso):
 * si ricontrollano profondità ≤ 2, al massimo 5 deleghe al giorno dalla stessa
 * richiesta, email del collega (non Lateral Space) e voci ancora attive.
 */
export function checkDelegationApproval(i: {
  request: Pick<RequestRowState, "status" | "purpose" | "delegatedFromRequestId" | "delegationDepth" | "revokedAt" | "activeItemIds" | "contact">;
  delegationsToday: number;
  lsDomains: readonly string[];
  lsMemberEmails: readonly string[];
}): Result<{ depth: number }> {
  const r = i.request;
  if (!r.delegatedFromRequestId || r.purpose !== "raccolta") return fail("non_delega", "Questa richiesta non è una delega da approvare.");
  if (r.status !== "bozza" || r.revokedAt !== null) return fail("delega_gia_decisa", "La delega è già stata inviata o revocata.");
  if (!Number.isInteger(r.delegationDepth) || r.delegationDepth < 1 || r.delegationDepth > MAX_DELEGATION_DEPTH) {
    return fail("delega_troppo_profonda", "Questa domanda è già stata girata due volte: riassegnala tu.");
  }
  if (!r.contact.isActive || r.contact.anonymized) return fail("contatto_non_attivo", "Il collega non è un referente attivo.");
  if (r.activeItemIds.length === 0) return fail("nessuna_voce", "Non resta nessuna voce da girare: revoca la delega.");
  const rules = checkDelegation({
    parentDepth: r.delegationDepth - 1,
    delegationsToday: i.delegationsToday,
    delegateEmail: r.contact.email ?? "",
    caseContactDomains: [],
    lsDomains: i.lsDomains,
    itemIds: r.activeItemIds,
    activeItemIds: r.activeItemIds,
  });
  if (!rules.ok) return rules;
  const email = checkContactEmail({ email: r.contact.email, lsDomains: i.lsDomains, lsMemberEmails: i.lsMemberEmails });
  if (!email.ok) return email;
  return ok({ depth: rules.value.depth });
}

/** Deleghe create dalla stessa richiesta da `since` (inizio del giorno di Roma), esclusa quella da approvare. */
export function delegationsTodaySql(i: { caseId: string; parentRequestId: string; excludeRequestId: string; since: Date }): UcStatement {
  return toStatement(ucSql`SELECT count(*)::int AS n FROM uc_requests
WHERE case_id = ${cast(uuid(i.caseId, "caso"), "uuid")} AND delegated_from_request_id = ${cast(uuid(i.parentRequestId, "richiesta"), "uuid")}
  AND id <> ${cast(uuid(i.excludeRequestId, "richiesta"), "uuid")} AND status <> 'revocata' AND created_at >= ${cast(i.since.toISOString(), "timestamptz")}`);
}

/** Le voci della delega approvata passano al collega (se non è già lui il referente), con l'evento. */
export function alignAssigneeSql(i: { workspaceId: string; caseId: string; itemIds: readonly string[]; contactId: string; actor: EventActor }): UcStatement {
  const event = eventInsertFromSql({
    type: "voce.assegnata",
    workspaceId: i.workspaceId,
    caseId: i.caseId,
    actor: i.actor,
    targetType: "voce",
    from: "u",
    targetIdColumn: "u.id",
    rowPayload: { item_key: "u.key" },
  });
  return toStatement(ucSql`WITH u AS (
  UPDATE uc_items i SET assignee_contact_id = ${cast(uuid(i.contactId, "referente"), "uuid")}, updated_at = now()
  WHERE i.case_id = ${cast(uuid(i.caseId, "caso"), "uuid")} AND i.id = ANY(${cast(uuids(i.itemIds, "voce"), "uuid[]")})
    AND i.deleted_at IS NULL AND i.assignee_contact_id IS DISTINCT FROM ${cast(i.contactId, "uuid")}
  RETURNING i.id, i.key
), ev AS (${event})
SELECT count(*)::int AS aligned FROM u`);
}

/** Le voci della richiesta sono ancora tutte `chiesta` e nella richiesta (guardia dell'approvazione della delega). */
export function requestItemsStillAskedSql(i: { caseId: string; requestId: string; itemIds: readonly string[] }): UcStatement {
  return toStatement(ucSql`SELECT uc_require((
  SELECT count(*) FROM uc_request_items ri JOIN uc_items it ON it.id = ri.item_id
  WHERE ri.request_id = ${cast(uuid(i.requestId, "richiesta"), "uuid")} AND ri.case_id = ${cast(uuid(i.caseId, "caso"), "uuid")}
    AND ri.item_id = ANY(${cast(uuids(i.itemIds, "voce"), "uuid[]")}) AND ri.state IN (${raw(ACTIVE_STATES_SQL)}) AND it.status = 'chiesta'
) = ${cast(i.itemIds.length, "int")}, 'conflitto') AS ok`);
}

// ── Letture per le pagine ─────────────────────────────────────────────

/** Referenti del workspace con i conteggi delle voci assegnate nel caso (solo conteggi). */
export function contactsListSql(i: { workspaceId: string; caseId: string }): UcStatement {
  const c = cast(uuid(i.caseId, "caso"), "uuid");
  return toStatement(ucSql`SELECT ct.id, ct.display_name, ct.role_label, ct.template_role_key, ct.email, ct.phone_e164, ct.preferred_channel, ct.is_active,
  ct.anonymized_at, ct.user_id,
  (SELECT count(*) FROM uc_items i WHERE i.case_id = ${c} AND i.assignee_contact_id = ct.id AND i.deleted_at IS NULL)::int AS assigned,
  (SELECT count(*) FROM uc_items i WHERE i.case_id = ${c} AND i.assignee_contact_id = ct.id AND i.deleted_at IS NULL
     AND i.status NOT IN ('validata', 'non_applicabile'))::int AS open_items
FROM uc_contacts ct
WHERE ct.workspace_id = ${cast(uuid(i.workspaceId, "workspace"), "uuid")}
ORDER BY ct.anonymized_at IS NOT NULL, lower(ct.display_name), ct.id`);
}

/**
 * Richieste del caso. Mai `first_opened_at`, `completed_at` o date di risposta:
 * nessun tempo per persona (art. 15.4).
 */
export function caseRequestsListSql(i: { workspaceId: string; caseId: string }): UcStatement {
  return toStatement(ucSql`SELECT r.id, r.contact_id, ct.display_name AS contact_name, ct.role_label AS contact_role_label, ct.email IS NOT NULL AS contact_has_email,
  r.purpose, r.status, r.channel, r.acting_role_key, r.delegated_from_request_id, r.delegation_depth, r.sent_at, r.expires_at,
  r.reminder_count, r.last_reminder_at, r.next_reminder_at, r.escalated_at, r.revoked_at, r.created_at,
  ${requestLiveSql("r", "c")} AS live, ${requestVisibleSql("r", "c")} AS visible,
  (SELECT count(*) FROM uc_request_items ri WHERE ri.request_id = r.id)::int AS items,
  (SELECT count(*) FROM uc_request_items ri WHERE ri.request_id = r.id AND ri.state IN ('da_fare', 'bozza'))::int AS open_items,
  (SELECT count(*) FROM uc_request_tokens t WHERE t.request_id = r.id AND t.revoked_at IS NULL)::int AS active_links,
  (SELECT n.hold_reason FROM uc_notifications n WHERE n.request_id = r.id AND n.status = 'in_coda' AND n.channel = 'email'
     ORDER BY n.created_at DESC LIMIT 1) AS email_hold_reason,
  EXISTS (SELECT 1 FROM uc_notifications n WHERE n.request_id = r.id AND n.status = 'in_coda' AND n.channel = 'email') AS email_queued
FROM uc_requests r
JOIN uc_cases c ON c.id = r.case_id
JOIN uc_contacts ct ON ct.id = r.contact_id
WHERE r.case_id = ${cast(uuid(i.caseId, "caso"), "uuid")} AND c.workspace_id = ${cast(uuid(i.workspaceId, "workspace"), "uuid")}
ORDER BY r.created_at DESC, r.id`);
}

/** Voci di una richiesta, con stato della voce e della riga. Mai valori o bozze. */
export function requestItemsListSql(i: { workspaceId: string; caseId: string; requestId: string }): UcStatement {
  return toStatement(ucSql`SELECT ri.item_id, ri.state, i.key, i.title, i.status, i.request_module_key, i.priority
FROM uc_request_items ri
JOIN uc_items i ON i.id = ri.item_id AND i.case_id = ri.case_id
JOIN uc_cases c ON c.id = ri.case_id
WHERE ri.request_id = ${cast(uuid(i.requestId, "richiesta"), "uuid")} AND ri.case_id = ${cast(uuid(i.caseId, "caso"), "uuid")}
  AND c.workspace_id = ${cast(uuid(i.workspaceId, "workspace"), "uuid")} AND i.deleted_at IS NULL
ORDER BY i.sort_order, i.key`);
}

/**
 * Moduli di richiesta e ruoli del template del caso, con le etichette dei ruoli
 * del caso, senza portare fuori tutta la definizione: le parti del template si
 * leggono una volta per impronta (DESIGN §7.1 P0-5 b). `parts` sono le colonne
 * di `templatePartsReader()`; `caseModulesRow` rimette la riga nella forma
 * `modules`, `roles`, `role_labels`.
 */
export function caseModulesSql(i: { workspaceId: string; caseId: string }, parts: SqlFragment): UcStatement {
  return toStatement(ucSql`SELECT ${parts}, c.settings -> 'role_labels' AS role_labels
FROM uc_cases c JOIN uc_templates t ON t.id = c.template_id
WHERE c.id = ${cast(uuid(i.caseId, "caso"), "uuid")} AND c.workspace_id = ${cast(uuid(i.workspaceId, "workspace"), "uuid")}`);
}

/**
 * La riga di `caseModulesSql` con le parti del template (`read(row)` del
 * lettore): moduli `{ key, title, role_key, estimated_minutes, … }`, ruoli
 * `{ key, label }` nell'ordine dello schema ed etichette del caso. Senza riga,
 * niente.
 */
export function caseModulesRow(row: Record<string, unknown> | undefined, parts: TemplateParts | null): Record<string, unknown> | undefined {
  if (!row) return undefined;
  const roles = (parts?.roles ?? []).map((r) => {
    const o = r && typeof r === "object" && !Array.isArray(r) ? r : {};
    return { key: typeof o.key === "string" ? o.key : null, label: typeof o.label === "string" ? o.label : null };
  });
  return { modules: parts?.modules ?? [], roles, role_labels: row.role_labels ?? null };
}

/** Voci del caso (tutte, di alcuni referenti, di un ruolo o indicate), solo colonne di stato e metadati. */
export function assignmentItemsSql(i: { caseId: string; contactIds?: readonly string[] | null; roleKey?: string | null; itemIds?: readonly string[] | null }): UcStatement {
  const filters: SqlFragment[] = [];
  if (i.contactIds) filters.push(ucSql`i.assignee_contact_id = ANY(${cast(uuids(i.contactIds, "referente"), "uuid[]")})`);
  if (i.roleKey !== undefined && i.roleKey !== null) filters.push(ucSql`i.owner_role_key = ${cast(i.roleKey, "text")}`);
  if (i.itemIds) filters.push(ucSql`i.id = ANY(${cast(uuids(i.itemIds, "voce"), "uuid[]")})`);
  const where = filters.length ? ucSql` AND ${join(filters, " AND ")}` : raw("");
  return toStatement(ucSql`SELECT i.id, i.key, i.title, i.status, i.response_type, i.owner_role_key, i.assignee_contact_id, i.request_module_key, i.priority,
  (SELECT ri.request_id FROM uc_request_items ri WHERE ri.item_id = i.id AND ri.state IN (${raw(ACTIVE_STATES_SQL)}) LIMIT 1) AS active_request_id,
  EXISTS (SELECT 1 FROM uc_item_blockers ib JOIN uc_blockers b ON b.id = ib.blocker_id WHERE ib.item_id = i.id AND b.status IN ('attivo', 'permanente')) AS blocked
FROM uc_items i
WHERE i.case_id = ${cast(uuid(i.caseId, "caso"), "uuid")} AND i.deleted_at IS NULL${where}
ORDER BY i.sort_order, i.key`);
}

/** Richiesta di approvazione ancora viva per il firmatario (si riusa invece di crearne un'altra). */
export function liveApprovalRequestSql(i: { workspaceId: string; caseId: string; contactId: string }): UcStatement {
  return toStatement(ucSql`SELECT r.id FROM uc_requests r JOIN uc_cases c ON c.id = r.case_id
WHERE r.case_id = ${cast(uuid(i.caseId, "caso"), "uuid")} AND c.workspace_id = ${cast(uuid(i.workspaceId, "workspace"), "uuid")}
  AND r.contact_id = ${cast(uuid(i.contactId, "referente"), "uuid")} AND r.purpose = 'approvazioni' AND ${requestLiveSql("r", "c")}
ORDER BY r.created_at DESC LIMIT 1`);
}

/** Notifica con questa chiave già in coda o inviata (al massimo un invio al giorno per richiesta). */
export function notificationExistsSql(dedupeKey: string): UcStatement {
  return toStatement(ucSql`SELECT EXISTS (SELECT 1 FROM uc_notifications WHERE dedupe_key = ${cast(dedupeKey, "text")}) AS found`);
}
