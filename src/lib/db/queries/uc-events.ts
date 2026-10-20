/**
 * Audit della sezione «Casi d'uso» (`uc_events`, PIANO §7.2).
 *
 * `eventInsertSql` / `eventInsertFromSql` restituiscono un frammento SQL da
 * mettere nello **stesso batch** (o nella stessa CTE) della modifica. Il payload
 * passa sempre da `eventPayload(type, data)`: uno schema zod per tipo che toglie
 * tutto ciò che non è nell'elenco. Ammessi: chiavi, stati, versioni, conteggi,
 * formati, impronte, codici di motivo. Vietati: valori, testi liberi, nomi,
 * email, telefoni, token, IP.
 *
 * Modulo puro (nessun accesso al DB, import relativi `.ts`): lo usano anche gli
 * script operatore. In fondo, le letture di Attività e Privacy (DESIGN §3.10,
 * §3.12): ricevono l'esecutore da fuori, come le altre query uc.
 */
import { z } from "zod";
import type { Actor, Json } from "../../uc/types.ts";
import { userContextFrom } from "../../uc/lateral-space.ts";
import { caseBlockersSql, rowBool, rowDate, rowJson, rowNumber, rowObject, rowString, rowToCaseBlocker, rowVocab, type Row } from "../../uc/sql/readiness.ts";
import { cast, jsonb, raw, ref, toStatement, ucSql, type SqlFragment, type UcStatement } from "../../uc/sql/statement.ts";
import {
  ACTIVITY_PAGE_SIZE,
  AUDIT_MIN_DAILY,
  auditHasPeriod,
  auditWhereSql,
  dailyCountsAboveThreshold,
  eventActorIsLsSql,
  referentAnswersWhereSql,
  type ActivityRow,
  type AuditFilter,
} from "../../uc/views/audit.ts";
import type { MemberRowInput } from "../../uc/views/people.ts";
import type { BlockerRowInput } from "../../uc/views/privacy.ts";
import { clientPlainText, type CaseViewContext } from "../../uc/views/rows.ts";
import { CASE_ROLES, EVENT_ACTOR_TYPES, PRIVACY_CLASSES, type EventActorType, type PrivacyClass } from "../../uc/vocab.ts";
import type { UcExecutor } from "../uc-executor.ts";
import { UUID } from "../../uc/ids.ts";
import { caseViewContextReader } from "./uc-views.ts";

// ── Tipi di evento ────────────────────────────────────────────────────

export const UC_EVENT_TYPES = [
  "caso.creato",
  "caso.importato",
  "caso.stato_cambiato",
  "caso.descrizione_modificata",
  "caso.ambiente_ai",
  "caso.regola_gate_confermata",
  "membro.aggiunto",
  "membro.rimosso",
  "membro.zona_personale",
  "referente.creato",
  "referente.modificato",
  "referente.anonimizzato",
  "firmatario.designato",
  "voce.creata",
  "voce.modificata",
  "voce.classe_privacy_cambiata",
  "voce.stato_cambiato",
  "voce.stato_importato",
  "voce.assegnata",
  "voce.na_proposta",
  "voce.na_firmata",
  "voce.na_respinta",
  "voce.deroga_firmata",
  "voce.ripiego_firmato",
  "risposta.inviata",
  "risposta.letta_personale",
  "risposta.cancellata_privacy",
  "validazione.registrata",
  "commento.creato",
  "chiarimento.richiesto",
  "chiarimento.risolto",
  "richiesta.creata",
  "richiesta.inviata",
  "richiesta.promemoria",
  "richiesta.revocata",
  "richiesta.scaduta",
  "richiesta.prorogata",
  "link.aperto",
  "link.copiato",
  "link.revocati_tutti",
  "delega.creata",
  "delega.approvata",
  "informativa.vista",
  "file.caricato",
  "file.rifiutato",
  "file.revisionato",
  "file.scaricato",
  "file.cancellato",
  "dataset.creato",
  "dataset.validato",
  "blocco.attivato",
  "blocco.firmato",
  "blocco.sciolto",
  "blocco.riattivato",
  "gate.proposto",
  "gate.firmato",
  "gate.approvato",
  "gate.respinto",
  "catalogo.congelato",
  "catalogo.esportato",
  "catalogo.letto_mcp",
  "registro.esportato",
  "casi_prova.importati",
  "template.caricato",
  "seed.applicato",
  "seed.valore_omesso",
  "notifica.inviata",
  "notifica.errore",
] as const;
export type UcEventType = (typeof UC_EVENT_TYPES)[number];

// ── Campi ammessi nel payload ─────────────────────────────────────────

const SECRET_PREFIX = /^(ucr_|ub_mcp_|air_)/;
const keyString = z
  .string()
  .regex(/^[A-Za-z0-9_.:-]{1,160}$/)
  .refine((s) => !SECRET_PREFIX.test(s), "token");
const codeString = z.string().regex(/^[a-z0-9_]{1,60}$/);
const count = z.number().int().min(0).max(1_000_000_000);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const uuid = z.string().regex(UUID);
const version = z.union([count, z.string().regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/), z.literal("bozza")]);
const caseCode = z.string().regex(/^[A-Z0-9][A-Z0-9-]{1,39}$/);
const counts = z.record(codeString, count);
const keyList = z.array(keyString).max(500);
const codeList = z.array(codeString).max(100);

const FIELD_SCHEMAS = {
  item_key: keyString,
  item_keys: keyList,
  key: keyString,
  template_key: keyString,
  source_key: keyString,
  check_key: keyString,
  notice_version: keyString,
  code: caseCode,
  version,
  template_version: version,
  catalog_version: count,
  dataset_version: count,
  share_epoch: count,
  hash,
  scan_report_sha256: hash,
  summary_text_hash: hash,
  snapshot_hash: hash,
  count,
  items: count,
  links: count,
  blockers: count,
  requests: count,
  answers: count,
  rows: count,
  required: count,
  ok: count,
  waivers: count,
  reminder: count,
  depth: count,
  attempts: count,
  size_bytes: count,
  counts,
  kind: codeString,
  response_type: codeString,
  source_kind: codeString,
  trigger: codeString,
  reason: codeString,
  motivo: codeString,
  categoria: codeString,
  role: codeString,
  role_key: codeString,
  ruolo: codeString,
  purpose: codeString,
  channel: codeString,
  zona: codeString,
  scope: codeString,
  outcome: codeString,
  designation: codeString,
  action: codeString,
  visibility: codeString,
  tool: codeString,
  blocker_key: codeString,
  error_code: codeString,
  from: codeString,
  to: codeString,
  format: z.enum(["json", "md", "xlsx", "csv"]),
  gate: z.enum(["G1", "G2", "G3", "G4"]),
  mime: z.string().regex(/^[a-z0-9.+-]{1,60}\/[a-z0-9.+-]{1,80}$/),
  fields: codeList,
  blocks: codeList,
  token_id: uuid,
  evidence_file_id: uuid,
  approved: z.boolean(),
  complete: z.boolean(),
  needs_approval: z.boolean(),
} as const satisfies Record<string, z.ZodType>;

export type UcEventField = keyof typeof FIELD_SCHEMAS;

const F = <const T extends readonly UcEventField[]>(...fields: T) => fields;
const ITEM_SIGNATURE = F("item_key", "ruolo", "complete");
const REQUEST = F("items", "purpose", "channel");
const FILE = F("mime", "size_bytes", "zona", "motivo", "categoria", "outcome");
const BLOCKER = F("blocker_key", "items", "ruolo", "complete");
const GATE = F("gate", "required", "ok", "summary_text_hash", "waivers", "ruolo", "catalog_version");
const NOTIFICATION = F("template_key", "channel", "attempts", "error_code");

/** Per ogni tipo, i soli campi ammessi nel payload. */
export const EVENT_PAYLOAD_FIELDS: Readonly<Record<UcEventType, readonly UcEventField[]>> = {
  "caso.creato": F("code", "template_key", "template_version", "items", "links", "blockers"),
  "caso.importato": F("code", "items", "counts"),
  "caso.stato_cambiato": F("from", "to", "reason"),
  "caso.descrizione_modificata": F("blocks", "version"),
  "caso.ambiente_ai": F("approved", "evidence_file_id"),
  "caso.regola_gate_confermata": F("scope"),
  "membro.aggiunto": F("role"),
  "membro.rimosso": F("role"),
  "membro.zona_personale": F("action", "role"),
  "referente.creato": F("role_key", "fields"),
  "referente.modificato": F("role_key", "fields"),
  "referente.anonimizzato": F("role_key"),
  "firmatario.designato": F("designation", "evidence_file_id"),
  "voce.creata": F("item_key", "kind", "fields"),
  "voce.modificata": F("item_key", "kind", "fields"),
  "voce.classe_privacy_cambiata": F("item_key", "from", "to"),
  "voce.stato_cambiato": F("item_key", "trigger", "reason"),
  "voce.stato_importato": F("count", "counts"),
  "voce.assegnata": F("item_key", "count", "role_key"),
  "voce.na_proposta": ITEM_SIGNATURE,
  "voce.na_firmata": ITEM_SIGNATURE,
  "voce.na_respinta": ITEM_SIGNATURE,
  "voce.deroga_firmata": ITEM_SIGNATURE,
  "voce.ripiego_firmato": ITEM_SIGNATURE,
  "risposta.inviata": F("item_key", "version", "kind", "response_type", "source_kind"),
  "risposta.letta_personale": F("item_key", "version"),
  "risposta.cancellata_privacy": F("item_key", "version", "reason"),
  "validazione.registrata": F("item_key", "check_key", "kind", "outcome"),
  "commento.creato": F("item_key", "kind", "visibility"),
  "chiarimento.richiesto": F("item_key"),
  "chiarimento.risolto": F("item_key"),
  "richiesta.creata": REQUEST,
  "richiesta.inviata": REQUEST,
  "richiesta.promemoria": F("reminder"),
  "richiesta.revocata": F("items", "reason"),
  "richiesta.scaduta": F("items"),
  "richiesta.prorogata": F(),
  "link.aperto": F(),
  "link.copiato": F("token_id"),
  "link.revocati_tutti": F("share_epoch", "requests"),
  "delega.creata": F("items", "depth", "needs_approval"),
  "delega.approvata": F("items"),
  "informativa.vista": F("notice_version"),
  "file.caricato": FILE,
  "file.rifiutato": FILE,
  "file.revisionato": FILE,
  "file.scaricato": FILE,
  "file.cancellato": FILE,
  "dataset.creato": F("source_key", "dataset_version", "rows"),
  "dataset.validato": F("source_key", "dataset_version", "rows"),
  "blocco.attivato": BLOCKER,
  "blocco.firmato": BLOCKER,
  "blocco.sciolto": BLOCKER,
  "blocco.riattivato": BLOCKER,
  "gate.proposto": GATE,
  "gate.firmato": GATE,
  "gate.approvato": GATE,
  "gate.respinto": GATE,
  "catalogo.congelato": F("version", "snapshot_hash", "items", "reason"),
  "catalogo.esportato": F("format", "version"),
  "catalogo.letto_mcp": F("tool", "version", "items"),
  // Export CSV del Registro (WP8): formato e numero di righe, mai il contenuto.
  "registro.esportato": F("format", "count"),
  // Import dei casi di prova da file (WP12b): solo conteggi e formato, mai i testi dei casi.
  "casi_prova.importati": F("count", "counts", "format"),
  "template.caricato": F("key", "version", "hash", "items"),
  "seed.applicato": F("hash", "scan_report_sha256", "counts", "answers"),
  "seed.valore_omesso": F("count", "categoria"),
  "notifica.inviata": NOTIFICATION,
  "notifica.errore": NOTIFICATION,
};

/** Campo opzionale: un valore non valido diventa assente invece di far fallire tutto. */
function lenient(field: UcEventField): z.ZodType<unknown> {
  const schema: z.ZodType<unknown> = FIELD_SCHEMAS[field];
  return schema.optional().catch(undefined);
}

/** Schema zod per tipo: campi dell'elenco, valori non validi scartati, il resto tolto. */
const EVENT_PAYLOAD_SCHEMAS = Object.fromEntries(
  UC_EVENT_TYPES.map((type) => [type, z.object(Object.fromEntries(EVENT_PAYLOAD_FIELDS[type].map((f) => [f, lenient(f)])))]),
) as unknown as Record<UcEventType, z.ZodType<Record<string, unknown>>>;

export function isUcEventType(value: unknown): value is UcEventType {
  return typeof value === "string" && (UC_EVENT_TYPES as readonly string[]).includes(value);
}

/** Payload minimizzato per l'audit. Mai valori, testi liberi, nomi, email, token o IP. */
export function eventPayload(type: UcEventType, data: Record<string, unknown> = {}): Record<string, Json> {
  const parsed = EVENT_PAYLOAD_SCHEMAS[type].parse(data);
  const out: Record<string, Json> = {};
  for (const [k, v] of Object.entries(parsed)) if (v !== undefined) out[k] = v as Json;
  return out;
}

// ── Frammenti SQL ─────────────────────────────────────────────────────

export type EventActor =
  | { type: "utente"; userId: string }
  | { type: "referente"; contactId: string }
  | { type: "sistema" }
  | { type: "mcp"; integrationTokenId: string };

/** Attore dell'evento da un `Actor` dei comandi. Il link di approvazione è un referente. */
export function eventActorFrom(actor: Actor): EventActor {
  switch (actor.type) {
    case "utente":
      return { type: "utente", userId: actor.userId };
    case "referente":
    case "owner_link":
      return { type: "referente", contactId: actor.contactId };
    case "sistema":
      return { type: "sistema" };
  }
}

export interface UcEventSpec {
  type: UcEventType;
  /** null solo per gli eventi dei template non riservati. */
  workspaceId: string | null;
  caseId?: string | null;
  actor: EventActor;
  targetType?: string | null;
  targetId?: string | null;
  fromState?: string | null;
  toState?: string | null;
  payload?: Record<string, unknown>;
  ipHash?: string | null;
  userAgent?: string | null;
}

const TARGET_TYPE = /^[a-z_]{1,40}$/;
const STATE = /^[a-z0-9_]{1,40}$/;
const IP_HASH = /^[0-9a-f]{16,64}$/;

function checked(value: string | null | undefined, pattern: RegExp, what: string): string | null {
  if (value === null || value === undefined) return null;
  if (!pattern.test(value)) throw new Error(`Evento uc: ${what} non valido`);
  return value;
}

function actorColumns(actor: EventActor): { type: EventActorType; userId: string | null; contactId: string | null; tokenId: string | null } {
  return {
    type: actor.type,
    userId: actor.type === "utente" ? actor.userId : null,
    contactId: actor.type === "referente" ? actor.contactId : null,
    tokenId: actor.type === "mcp" ? actor.integrationTokenId : null,
  };
}

function common(e: UcEventSpec) {
  if (!isUcEventType(e.type)) throw new Error("Tipo di evento uc sconosciuto");
  const a = actorColumns(e.actor);
  return {
    workspace: cast(e.workspaceId ?? null, "uuid"),
    caseId: cast(e.caseId ?? null, "uuid"),
    actorType: cast(a.type, "text"),
    actorUser: cast(a.userId, "uuid"),
    actorContact: cast(a.contactId, "uuid"),
    token: cast(a.tokenId, "uuid"),
    eventType: cast(e.type, "text"),
    targetType: cast(checked(e.targetType, TARGET_TYPE, "target_type"), "text"),
    ipHash: cast(checked(e.ipHash, IP_HASH, "ip_hash"), "text"),
    userAgent: cast(e.userAgent ? e.userAgent.slice(0, 300) : null, "text"),
  };
}

const COLUMNS = raw(
  "INSERT INTO uc_events (workspace_id, case_id, actor_type, actor_user_id, actor_contact_id, integration_token_id, event_type, target_type, target_id, from_state, to_state, payload, ip_hash, user_agent)",
);

/** Un evento, come istruzione a sé o come CTE (`ev AS (${eventInsertSql(...)})`). */
export function eventInsertSql(e: UcEventSpec): SqlFragment {
  const c = common(e);
  const payload = jsonb(eventPayload(e.type, e.payload));
  const fromState = cast(checked(e.fromState, STATE, "from_state"), "text");
  const toState = cast(checked(e.toState, STATE, "to_state"), "text");
  return ucSql`${COLUMNS}
VALUES (${c.workspace}, ${c.caseId}, ${c.actorType}, ${c.actorUser}, ${c.actorContact}, ${c.token}, ${c.eventType}, ${c.targetType}, ${cast(e.targetId ?? null, "uuid")}, ${fromState}, ${toState}, ${payload}, ${c.ipHash}, ${c.userAgent})`;
}

export interface UcEventFromSpec extends Omit<UcEventSpec, "targetId" | "fromState" | "toState"> {
  /** Nome della CTE (o tabella) con le righe davvero modificate, es. `changed`. */
  from: string;
  /** Colonne della CTE, es. `changed.id`. */
  targetIdColumn?: string;
  fromStateColumn?: string;
  toStateColumn?: string;
  /** Campi del payload presi dalle righe, es. `{ item_key: "changed.key" }`. Solo campi ammessi dal tipo. */
  rowPayload?: Partial<Record<UcEventField, string>>;
}

/**
 * Un evento per ogni riga di una CTE: così l'audit esiste solo per le righe
 * davvero aggiornate dal CAS.
 */
export function eventInsertFromSql(e: UcEventFromSpec): SqlFragment {
  const c = common(e);
  const allowed = EVENT_PAYLOAD_FIELDS[e.type];
  const rowFields = Object.entries(e.rowPayload ?? {}) as [UcEventField, string][];
  for (const [field] of rowFields) {
    if (!allowed.includes(field)) throw new Error(`Evento uc: campo ${field} non ammesso per ${e.type}`);
  }
  const base = jsonb(eventPayload(e.type, e.payload));
  const payload = rowFields.length
    ? ucSql`(${base} || jsonb_build_object(${raw(rowFields.map(([field, column]) => `'${field}', ${toRef(column)}`).join(", "))}))`
    : base;
  const target = e.targetIdColumn ? ref(e.targetIdColumn) : raw("NULL::uuid");
  const fromState = e.fromStateColumn ? ucSql`${ref(e.fromStateColumn)}::text` : raw("NULL::text");
  const toState = e.toStateColumn ? ucSql`${ref(e.toStateColumn)}::text` : raw("NULL::text");
  return ucSql`${COLUMNS}
SELECT ${c.workspace}, ${c.caseId}, ${c.actorType}, ${c.actorUser}, ${c.actorContact}, ${c.token}, ${c.eventType}, ${c.targetType}, ${target}, ${fromState}, ${toState}, ${payload}, ${c.ipHash}, ${c.userAgent}
FROM ${ref(e.from)}`;
}

function toRef(column: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}(\.[a-z_][a-z0-9_]{0,62})?$/.test(column)) throw new Error("Evento uc: colonna non valida");
  return column;
}

// ── Letture: Attività (DESIGN §3.12) ──────────────────────────────────

export interface ActivityQuery {
  workspaceId: string;
  caseId: string;
  filter: AuditFilter;
  /** Attività filtrata dell'art. 15.4 (responsabile del cliente, approvatore privacy). */
  clientView: boolean;
  /** Domini di Lateral Space (`ucLsDomains()`), per «(Lateral Space)» e per il filtro «Chi». */
  lsDomains: readonly string[];
}

export interface ActivityPage {
  rows: ActivityRow[];
  total: number;
  /** Solo per i ruoli del cliente, e solo se il filtro non esclude le risposte: risposte dei referenti per giorno (n ≥ 5). */
  daily: { days: { day: string; count: number }[]; below: number } | null;
}

function activityRowsSql(i: ActivityQuery & { limit: number; offset: number }): UcStatement {
  // Il nome del referente solo nell'attività completa (al cliente i suoi eventi non arrivano comunque);
  // al cliente il nome della persona, mai l'email.
  const contactName = i.clientView ? ucSql`NULL::text` : ucSql`ct.display_name`;
  const userName = i.clientView ? ucSql`nullif(btrim(u.name), '')` : ucSql`coalesce(nullif(btrim(u.name), ''), u.email)`;
  return toStatement(ucSql`SELECT e.id, e.created_at, e.event_type, e.actor_type, e.actor_user_id, e.actor_contact_id, e.target_type, e.from_state, e.to_state, e.payload,
  CASE WHEN e.actor_type = 'utente' THEN ${userName} WHEN e.actor_type = 'referente' THEN ${contactName} ELSE NULL END AS actor_name,
  (e.actor_type = 'utente' AND ${eventActorIsLsSql(i.lsDomains)}) AS actor_is_ls,
  it.title AS item_title
FROM uc_events e
LEFT JOIN users u ON u.id = e.actor_user_id
LEFT JOIN uc_contacts ct ON ct.id = e.actor_contact_id AND ct.workspace_id = e.workspace_id
LEFT JOIN uc_items it ON it.case_id = e.case_id AND it.key = e.payload ->> 'item_key'
WHERE ${auditWhereSql(i)}
ORDER BY e.created_at DESC, e.id
LIMIT ${cast(i.limit, "int")} OFFSET ${cast(i.offset, "int")}`);
}

function toActivityRow(r: Record<string, unknown>): ActivityRow | null {
  const actorType = rowVocab(EVENT_ACTOR_TYPES, r.actor_type);
  if (!actorType) return null;
  const actorId = rowString(r.actor_user_id) ?? rowString(r.actor_contact_id);
  return {
    id: String(r.id),
    at: rowDate(r.created_at)?.toISOString() ?? "",
    type: String(r.event_type),
    actorType,
    actorName: rowString(r.actor_name),
    targetType: rowString(r.target_type),
    fromState: rowString(r.from_state),
    toState: rowString(r.to_state),
    payload: rowObject(r.payload),
    actorKey: actorId ? `${actorType}:${actorId}` : actorType,
    actorIsLs: rowBool(r.actor_is_ls),
    itemTitle: rowString(r.item_title),
  };
}

/**
 * Risposte dei referenti per giorno (vista del cliente), oppure null se il
 * filtro le esclude. Con un periodo i giorni sotto la soglia non escono
 * nemmeno dal DB (`dailyCountsAboveThreshold`).
 */
function referentDailySql(i: ActivityQuery): UcStatement | null {
  const where = referentAnswersWhereSql(i);
  if (!where) return null;
  const having = auditHasPeriod(i.filter) ? ucSql` HAVING count(*) >= ${cast(AUDIT_MIN_DAILY, "int")}` : raw("");
  return toStatement(ucSql`SELECT ((e.created_at AT TIME ZONE 'Europe/Rome')::date)::text AS day, count(*)::int AS n FROM uc_events e WHERE ${where} GROUP BY 1${having}`);
}

function parseDaily(rows: readonly Record<string, unknown>[] | undefined, filter: AuditFilter): NonNullable<ActivityPage["daily"]> {
  return dailyCountsAboveThreshold(
    (rows ?? []).map((r) => ({ day: String(r.day), count: rowNumber(r.n) ?? 0 })),
    { period: auditHasPeriod(filter) },
  );
}

/** Le righe di Attività; per il cliente il titolo della domanda senza articoli, sigle o chiavi (DESIGN §6.2). */
function activityRowsFor(rows: readonly Row[], clientView: boolean): ActivityRow[] {
  const list = rows.map(toActivityRow).filter((r): r is ActivityRow => r !== null);
  return clientView ? list.map((r) => (r.itemTitle ? { ...r, itemTitle: clientPlainText(r.itemTitle) || null } : r)) : list;
}

/**
 * Una pagina di Attività (50 eventi, dal più recente) in un solo giro: righe,
 * totale e, per i ruoli del cliente, le risposte per giorno. Il filtro
 * dell'art. 15.4 è nella query (`auditWhereSql`).
 */
export async function loadActivityPage(executor: UcExecutor, i: ActivityQuery): Promise<ActivityPage> {
  if (!UUID.test(i.workspaceId) || !UUID.test(i.caseId)) return { rows: [], total: 0, daily: null };
  const offset = (i.filter.pagina - 1) * ACTIVITY_PAGE_SIZE;
  const daily = i.clientView ? referentDailySql(i) : null;
  const [rows, count, days] = await executor.batch([
    activityRowsSql({ ...i, limit: ACTIVITY_PAGE_SIZE, offset }),
    toStatement(ucSql`SELECT count(*)::int AS n FROM uc_events e WHERE ${auditWhereSql(i)}`),
    ...(daily ? [daily] : []),
  ]);
  return {
    rows: activityRowsFor(rows, i.clientView),
    total: rowNumber(count[0]?.n) ?? 0,
    // Un filtro che esclude le risposte (un «Chi», un «Tipo» diverso da Risposte) toglie anche la sezione.
    daily: daily ? parseDaily(days, i.filter) : null,
  };
}

export const ACTIVITY_EXPORT_LIMIT = 20_000;

/** Tutti gli eventi del filtro per il CSV di Attività (fino a 20.000), con lo stesso filtro della pagina. */
export async function loadActivityExport(executor: UcExecutor, i: ActivityQuery): Promise<ActivityPage> {
  if (!UUID.test(i.workspaceId) || !UUID.test(i.caseId)) return { rows: [], total: 0, daily: null };
  const daily = i.clientView ? referentDailySql(i) : null;
  const [rows, days] = await executor.batch([activityRowsSql({ ...i, filter: { ...i.filter, pagina: 1 }, limit: ACTIVITY_EXPORT_LIMIT, offset: 0 }), ...(daily ? [daily] : [])]);
  const list = activityRowsFor(rows, i.clientView);
  return { rows: list, total: list.length, daily: daily ? parseDaily(days, i.filter) : null };
}

// ── Letture: Privacy (DESIGN §3.10) ───────────────────────────────────

export interface PrivacyZoneFile {
  id: string;
  /** Titolo della domanda del file (mai la chiave). */
  itemTitle: string | null;
  mime: string;
  sizeBytes: number;
  scanStatus: string;
  createdAt: string | null;
  retentionUntil: string | null;
}

export interface PrivacyAccessRow {
  id: string;
  at: string;
  type: string;
  /** Nome di chi ha agito (mai l'email). */
  actorName: string | null;
  itemTitle: string | null;
  action: string | null;
}

export interface PrivacyPageData {
  dataMode: string;
  /** Il cliente ha indicato chi firma la privacy (si può mandargli il link per firmare). */
  privacyDesignated: boolean;
  /** La scheda privacy (blocco `a8`), oppure null se il caso non la prevede. */
  a8: BlockerRowInput | null;
  /** Domande per riservatezza: tutto il catalogo e, a parte, le domande ai referenti. */
  classCounts: { all: Partial<Record<PrivacyClass, number>>; questions: Partial<Record<PrivacyClass, number>> };
  personalFiles: PrivacyZoneFile[];
  accessLog: PrivacyAccessRow[];
  /**
   * Membri del caso, una riga per ruolo (come `loadCaseMembers`), con «è
   * Lateral Space» dal dominio dell'email verificata. L'email non esce: la
   * pagina la legge anche il cliente.
   */
  members: MemberRowInput[];
  /** File del caso che si possono indicare nella scheda privacy (come `loadUsableCaseFiles`). */
  usableFiles: { id: string; name: string; createdAt: string | null }[];
  /** Contesto del caso: etichette dei ruoli del modello. */
  context: CaseViewContext;
}

/** Il caso esiste, è completo ed è del workspace. */
function caseOfWorkspace(workspaceId: string, caseId: string): SqlFragment {
  return ucSql`(SELECT c.id FROM uc_cases c WHERE c.id = ${cast(caseId, "uuid")} AND c.workspace_id = ${cast(workspaceId, "uuid")} AND c.setup_completed_at IS NOT NULL)`;
}

function privacySignerDesignated(v: unknown): boolean {
  const d = rowObject(v).privacy;
  return !!d && typeof d === "object" && !Array.isArray(d) && typeof (d as Record<string, unknown>).contact_id === "string";
}

/**
 * Dati della pagina Privacy in un solo giro (dopo la testata): modalità dei
 * dati, scheda privacy, domande per riservatezza, file della zona personale,
 * registro degli accessi, membri del caso, file indicabili nella scheda e
 * contesto del caso. Solo metadati: mai contenuti dei file, valori, chiavi
 * delle voci o email (quelle dei membri servono solo a riconoscere Lateral
 * Space e restano nel caricatore).
 */
export async function loadPrivacyPage(executor: UcExecutor, i: { workspaceId: string; caseId: string; lsDomains: readonly string[] }): Promise<PrivacyPageData | null> {
  if (!UUID.test(i.workspaceId) || !UUID.test(i.caseId)) return null;
  const c = caseOfWorkspace(i.workspaceId, i.caseId);
  const reader = caseViewContextReader(i.workspaceId, i.caseId);
  const [caseRows, blockers, classes, files, events, memberRows, usableRows, contextRows] = await executor.batch([
    toStatement(ucSql`SELECT data_mode, signers_designation FROM uc_cases WHERE id = ${c}`),
    caseBlockersSql(i.caseId),
    toStatement(ucSql`SELECT privacy_class, (request_module_key IS NOT NULL) AS question, count(*)::int AS n
FROM uc_items WHERE case_id = ${c} AND deleted_at IS NULL GROUP BY 1, 2`),
    toStatement(ucSql`SELECT f.id, it.title AS item_title, f.mime, f.size_bytes, f.scan_status, f.created_at, f.retention_until::text AS retention_until
FROM uc_files f LEFT JOIN uc_items it ON it.id = f.item_id
WHERE f.case_id = ${c} AND f.storage_zone = 'personale' AND f.deleted_at IS NULL ORDER BY f.created_at DESC LIMIT 200`),
    toStatement(ucSql`SELECT e.id, e.created_at, e.event_type, e.payload ->> 'action' AS action, nullif(btrim(u.name), '') AS actor_name, it.title AS item_title
FROM uc_events e
LEFT JOIN users u ON u.id = e.actor_user_id
LEFT JOIN uc_items it ON it.case_id = e.case_id AND it.key = e.payload ->> 'item_key'
WHERE e.case_id = ${c} AND e.workspace_id = ${cast(i.workspaceId, "uuid")}
  AND (e.event_type IN ('membro.zona_personale', 'risposta.letta_personale') OR (e.event_type = 'file.scaricato' AND e.payload ->> 'zona' = 'personale'))
ORDER BY e.created_at DESC LIMIT 200`),
    toStatement(ucSql`SELECT m.user_id, m.role, m.personal_zone_access, m.personal_zone_grant, u.name, u.email, u.email_verified
FROM uc_case_members m JOIN users u ON u.id = m.user_id
WHERE m.case_id = ${c}
ORDER BY lower(coalesce(u.name, u.email)), m.created_at`),
    toStatement(ucSql`SELECT f.id, f.file_name, f.created_at FROM uc_files f
WHERE f.case_id = ${c} AND f.deleted_at IS NULL AND f.storage_zone = 'standard'
  AND f.scan_status = 'pulito' AND (f.content_scanned OR f.reviewed_at IS NOT NULL)
ORDER BY f.created_at DESC LIMIT 200`),
    reader.statement,
  ]);
  const context = reader.parse(contextRows);
  if (!caseRows[0] || !context) return null;
  const all: Partial<Record<PrivacyClass, number>> = {};
  const questions: Partial<Record<PrivacyClass, number>> = {};
  for (const r of classes) {
    const k = rowVocab(PRIVACY_CLASSES, r.privacy_class);
    if (!k) continue;
    const n = rowNumber(r.n) ?? 0;
    all[k] = (all[k] ?? 0) + n;
    if (rowBool(r.question)) questions[k] = (questions[k] ?? 0) + n;
  }
  const a8 = blockers.map(rowToCaseBlocker).find((b) => b.key === "a8") ?? null;
  return {
    dataMode: String(caseRows[0].data_mode),
    privacyDesignated: privacySignerDesignated(caseRows[0].signers_designation),
    a8: a8
      ? { id: a8.id, key: a8.key, label: a8.label, status: a8.status, items: a8.items, evidence: a8.evidence, approvals: a8.approvals, resolvedAt: a8.resolvedAt?.toISOString() ?? null, fallbackAllowed: a8.fallbackAllowed }
      : null,
    classCounts: { all, questions },
    personalFiles: files.map((r) => ({
      id: String(r.id),
      itemTitle: rowString(r.item_title),
      mime: String(r.mime),
      sizeBytes: rowNumber(r.size_bytes) ?? 0,
      scanStatus: String(r.scan_status),
      createdAt: rowDate(r.created_at)?.toISOString() ?? null,
      retentionUntil: rowString(r.retention_until),
    })),
    accessLog: events.map((r) => ({
      id: String(r.id),
      at: rowDate(r.created_at)?.toISOString() ?? "",
      type: String(r.event_type),
      actorName: rowString(r.actor_name),
      itemTitle: rowString(r.item_title),
      action: rowString(r.action),
    })),
    members: memberRows.flatMap((r) => {
      const role = rowVocab(CASE_ROLES, r.role);
      if (!role) return [];
      const user = userContextFrom({ id: String(r.user_id), email: rowString(r.email), emailVerified: (r.email_verified as Date | string | null) ?? null }, i.lsDomains);
      return [
        {
          userId: String(r.user_id),
          role,
          name: rowString(r.name),
          email: null,
          isLateralSpace: user.isLateralSpace,
          personalZoneAccess: rowBool(r.personal_zone_access),
          personalZoneGrant: (rowJson(r.personal_zone_grant) as Json | null) ?? null,
        },
      ];
    }),
    usableFiles: usableRows.map((r) => ({ id: String(r.id), name: String(r.file_name), createdAt: rowDate(r.created_at)?.toISOString() ?? null })),
    context,
  };
}
