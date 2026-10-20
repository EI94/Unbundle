/**
 * Coda delle notifiche uc (`uc_notifications`, PIANO §7.1): costruttori SQL da
 * mettere nello stesso batch dell'azione che genera la notifica.
 *
 * `INSERT … ON CONFLICT (dedupe_key) DO NOTHING`: una notifica con la stessa
 * chiave non si duplica. Il payload contiene solo chiavi, conteggi e id: mai
 * valori delle risposte, mai token. L'invio vero (email via Resend, campanella)
 * sta in `uc-notifications-dispatch.ts`.
 *
 * Modulo puro: lo usano anche gli script operatore.
 */
import { z } from "zod";
import type { Json } from "../../uc/types.ts";
import { cast, jsonb, raw, ucSql, type SqlFragment } from "../../uc/sql/statement.ts";
import { LS_CASE_ROLES, NOTIFICATION_CHANNELS, isVocab, type NotificationChannel } from "../../uc/vocab.ts";
import { UUID } from "../../uc/ids.ts";

export const UC_NOTIFICATION_TEMPLATES = [
  "richiesta_inviata",
  "promemoria_1",
  "promemoria_2",
  "segnalazione_owner",
  "riepilogo_settimanale",
  "chiarimento",
  "delega",
  "richiesta_approvazione",
  "risposta_ricevuta",
  "blocco_sciolto",
  "dato_scaduto",
  "gate_pronto",
  "gate_approvato",
  "ls_lead_da_indicare",
  "owner_da_indicare",
  // Dopo l'MVP.
  "esiti_verifica",
  "scadenza_vicina",
] as const;
export type UcNotificationTemplate = (typeof UC_NOTIFICATION_TEMPLATES)[number];

const SECRET_PREFIX = /^(ucr_|ub_mcp_|air_)/;
const keyString = z
  .string()
  .regex(/^[A-Za-z0-9_.:-]{1,160}$/)
  .refine((s) => !SECRET_PREFIX.test(s), "token");
const count = z.number().int().min(0).max(1_000_000);
const uuid = z.string().regex(UUID);

/** Campi ammessi nel payload della coda; tutto il resto si toglie. */
const PAYLOAD_SCHEMA = z.object({
  count: count.optional().catch(undefined),
  items: count.optional().catch(undefined),
  minutes: count.optional().catch(undefined),
  reminder: count.optional().catch(undefined),
  version: count.optional().catch(undefined),
  item_keys: z.array(keyString).max(200).optional().catch(undefined),
  blocker_key: keyString.optional().catch(undefined),
  role_key: keyString.optional().catch(undefined),
  case_code: z.string().regex(/^[A-Z0-9][A-Z0-9-]{1,39}$/).optional().catch(undefined),
  gate: z.enum(["G1", "G2", "G3", "G4"]).optional().catch(undefined),
  designation: z.enum(["owner", "privacy"]).optional().catch(undefined),
  week: z.string().regex(/^\d{4}-W\d{2}$/).optional().catch(undefined),
  review_id: uuid.optional().catch(undefined),
  blocker_id: uuid.optional().catch(undefined),
  item_id: uuid.optional().catch(undefined),
  comment_id: uuid.optional().catch(undefined),
});

/** Payload minimo della coda: solo chiavi, conteggi e id. */
export function notificationPayload(data: Record<string, unknown> = {}): Record<string, Json> {
  const parsed = PAYLOAD_SCHEMA.parse(data);
  const out: Record<string, Json> = {};
  for (const [k, v] of Object.entries(parsed)) if (v !== undefined) out[k] = v as Json;
  return out;
}

const DEDUPE_KEY = /^[A-Za-z0-9_.:-]{1,200}$/;
const HOLD_REASON = /^[a-z0-9_]{1,60}$/;

function assertTemplate(key: string): void {
  if (!(UC_NOTIFICATION_TEMPLATES as readonly string[]).includes(key)) throw new Error(`Notifica uc sconosciuta: ${key}`);
}

function assertDedupe(key: string, room = 0): void {
  if (!DEDUPE_KEY.test(key) || key.length + room > 200) throw new Error("Chiave di deduplica uc non valida");
  if (SECRET_PREFIX.test(key) || key.includes(":ucr_")) throw new Error("Chiave di deduplica uc non valida");
}

export interface UcNotificationSpec {
  workspaceId: string;
  caseId?: string | null;
  requestId?: string | null;
  recipient: { contactId: string } | { userId: string };
  channel: NotificationChannel;
  templateKey: UcNotificationTemplate;
  payload?: Record<string, unknown>;
  dedupeKey: string;
  scheduledAt?: Date | null;
  /** Es. `email_non_configurata`, `caso_sospeso`: la riga resta `in_coda` con un motivo chiaro. */
  holdReason?: string | null;
}

const COLUMNS = raw(
  "INSERT INTO uc_notifications (workspace_id, case_id, request_id, recipient_contact_id, recipient_user_id, channel, template_key, payload, status, hold_reason, dedupe_key, scheduled_at)",
);

/** Una notifica in coda. `in_app` richiede un utente destinatario. */
export function enqueueSql(n: UcNotificationSpec): SqlFragment {
  assertTemplate(n.templateKey);
  assertDedupe(n.dedupeKey);
  if (!isVocab(NOTIFICATION_CHANNELS, n.channel)) throw new Error("Canale di notifica uc non valido");
  const contactId = "contactId" in n.recipient ? n.recipient.contactId : null;
  const userId = "userId" in n.recipient ? n.recipient.userId : null;
  if (n.channel === "in_app" && !userId) throw new Error("La campanella richiede un utente destinatario");
  if (n.holdReason && !HOLD_REASON.test(n.holdReason)) throw new Error("Motivo di attesa non valido");
  const scheduled = n.scheduledAt ? cast(n.scheduledAt.toISOString(), "timestamptz") : raw("now()");
  return ucSql`${COLUMNS}
VALUES (${cast(n.workspaceId, "uuid")}, ${cast(n.caseId ?? null, "uuid")}, ${cast(n.requestId ?? null, "uuid")}, ${cast(contactId, "uuid")}, ${cast(userId, "uuid")}, ${cast(n.channel, "text")}, ${cast(n.templateKey, "text")}, ${jsonb(notificationPayload(n.payload))}, 'in_coda', ${cast(n.holdReason ?? null, "text")}, ${cast(n.dedupeKey, "text")}, ${scheduled})
ON CONFLICT (dedupe_key) DO NOTHING`;
}

const LS_ROLES_SQL = LS_CASE_ROLES.map((r) => `'${r}'`).join(", ");

/**
 * Campanella per Lateral Space: una riga `in_app` per ogni membro con ruolo
 * `ls_*` del caso, con chiave `<prefisso>:<user_id>`. Ai membri del cliente non
 * arriva mai.
 */
export function enqueueForLsMembersSql(n: {
  workspaceId: string;
  caseId: string;
  templateKey: UcNotificationTemplate;
  payload?: Record<string, unknown>;
  dedupeKeyPrefix: string;
  requestId?: string | null;
  scheduledAt?: Date | null;
}): SqlFragment {
  assertTemplate(n.templateKey);
  assertDedupe(n.dedupeKeyPrefix, 37);
  const scheduled = n.scheduledAt ? cast(n.scheduledAt.toISOString(), "timestamptz") : raw("now()");
  return ucSql`${COLUMNS}
SELECT ${cast(n.workspaceId, "uuid")}, c.id, ${cast(n.requestId ?? null, "uuid")}, NULL::uuid, m.user_id, 'in_app', ${cast(n.templateKey, "text")}, ${jsonb(notificationPayload(n.payload))}, 'in_coda', NULL::text, ${cast(n.dedupeKeyPrefix, "text")} || ':' || m.user_id::text, ${scheduled}
FROM uc_cases c
JOIN (SELECT DISTINCT case_id, user_id FROM uc_case_members WHERE role IN (${raw(LS_ROLES_SQL)})) m ON m.case_id = c.id
WHERE c.id = ${cast(n.caseId, "uuid")} AND c.workspace_id = ${cast(n.workspaceId, "uuid")}
ON CONFLICT (dedupe_key) DO NOTHING`;
}
