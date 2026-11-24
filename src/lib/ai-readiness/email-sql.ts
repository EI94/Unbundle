/**
 * Le istruzioni SQL della coda delle email dell'AI Readiness (0044, `ai_readiness_alert_emails`; le regole in
 * `email.ts`). Le esegue `queries/ai-readiness-email.ts`; qui stanno pure, così i test leggono le regole che il
 * database applica: una riga in attesa per rilevazione, persona e tipo; «risultati» una volta; un'email al giorno per
 * rilevazione e persona; il segno del tentativo prima di Resend; la riga del giorno dopo per le risposte arrivate
 * durante l'invio.
 *
 * Nessun testo nelle righe: id, tipi, stati, istanti e codici. Modulo puro.
 */
import { AIR_EMAIL_PENDING_SQL, AIR_EMAIL_SWITCH_COLUMN, AIR_EMAIL_TABLE, type AirEmailKind } from "../db/ai-readiness-email-ddl.ts";
import { CASE_ONLY_ENUM_VALUE } from "../db/use-case-hub-case-only-ddl.ts";
import { cast, raw, toStatement, ucSql, type SqlFragment, type UcStatement } from "../uc/sql/statement.ts";

const T = raw(AIR_EMAIL_TABLE);
const PENDING = raw(AIR_EMAIL_PENDING_SQL);
const SWITCH = raw(AIR_EMAIL_SWITCH_COLUMN);

/** Una riga presa non si riprende per questi minuti. */
export const AIR_EMAIL_LEASE_MINUTES = 5;
/** Dopo un errore certo, o una lettura mancata, si riprova dopo questi minuti. */
export const AIR_EMAIL_RETRY_MINUTES = 15;
/** Il lock che mette in fila i giri di invio: due giri non prendono mai due righe della stessa coppia. */
export const AIR_EMAIL_CLAIM_LOCK = "unbundle:ai-readiness-email:claim";

/**
 * Il ruolo di adesso di `u` nel workspace `w`, come `getWorkspaceAccessForUser`: quello dell'organizzazione, se c'è e
 * non è «Solo questo use case» (che vale solo nel workspace), altrimenti quello del workspace.
 */
const ROLE_SQL = raw(`coalesce(
    (SELECT m.role::text FROM memberships m WHERE m.user_id = u.id AND m.organization_id = w.organization_id AND m.role::text <> '${CASE_ONLY_ENUM_VALUE}' LIMIT 1),
    (SELECT wm.role::text FROM workspace_memberships wm WHERE wm.user_id = u.id AND wm.workspace_id = w.id LIMIT 1)
  )`);

/**
 * Le persone del workspace con il ruolo di adesso, l'email, se è verificata e la loro scelta: chi riceve lo decide
 * `airEmailBlock` (chi gestisce, con l'email verificata e, per il cliente, l'ok sui sub-responsabili) più la scelta.
 */
export function airEmailMembersSql(workspaceId: string): UcStatement {
  return toStatement(ucSql`SELECT u.id AS user_id, lower(u.email) AS email, u.email_verified IS NOT NULL AS verified,
  coalesce(b.${SWITCH}, true) AS switch_on,
  ${ROLE_SQL} AS role
FROM workspaces w
JOIN users u ON u.id IN (
  SELECT m.user_id FROM memberships m WHERE m.organization_id = w.organization_id
  UNION SELECT wm.user_id FROM workspace_memberships wm WHERE wm.workspace_id = w.id
)
LEFT JOIN workspace_bell_state b ON b.workspace_id = w.id AND b.user_id = u.id
WHERE w.id = ${cast(workspaceId, "uuid")}
ORDER BY u.id`);
}

/**
 * Le righe in coda dopo un questionario inviato, per le persone scelte: «risultati» quando nasce la riga della soglia in
 * campanella (una volta per rilevazione e persona), «risposte» sempre (una sola in attesa per rilevazione e persona). Un
 * doppione non scrive niente (`ON CONFLICT DO NOTHING` su tutti e due gli indici unici). Le risposte nuove si contano da
 * `countsFrom` (l'invio del questionario), mai da un istante dopo l'orologio del database.
 */
export function queueAirEmailStatements(i: {
  workspaceId: string;
  assessmentId: string;
  recipients: readonly string[];
  countsFrom: Date;
  resultsReady: boolean;
}): UcStatement[] {
  if (i.recipients.length === 0) return [];
  const insert = (kind: AirEmailKind) =>
    toStatement(ucSql`INSERT INTO ${T} (workspace_id, assessment_id, recipient_user_id, kind, counts_from, scheduled_at)
SELECT a.workspace_id, a.id, r.id, ${cast(kind, "text")}, least(${cast(i.countsFrom.toISOString(), "timestamptz")}, now()), now()
FROM unnest(${cast([...i.recipients], "uuid[]")}) AS r(id)
JOIN ai_readiness_assessments a ON a.id = ${cast(i.assessmentId, "uuid")} AND a.workspace_id = ${cast(i.workspaceId, "uuid")}
ON CONFLICT DO NOTHING`);
  return i.resultsReady ? [insert("risultati"), insert("risposte")] : [insert("risposte")];
}

/**
 * Le righe dovute di un giro, prese con un lease: una per rilevazione e persona (prima «risultati»), mai per una coppia
 * che oggi (`dayStart`, la mezzanotte di Roma) ha già avuto un'email, anche dall'esito incerto, o che ha un'altra riga
 * presa o con un tentativo segnato. I giri passano uno alla volta (un advisory lock nella stessa transazione).
 */
export function claimAirEmailsStatements(i: { now: Date; dayStart: Date; limit: number }): UcStatement[] {
  const now = cast(i.now.toISOString(), "timestamptz");
  const dayStart = cast(i.dayStart.toISOString(), "timestamptz");
  return [
    toStatement(ucSql`SELECT pg_advisory_xact_lock(hashtext(${cast(AIR_EMAIL_CLAIM_LOCK, "text")}))`),
    toStatement(ucSql`WITH ranked AS MATERIALIZED (
  SELECT e.id,
    row_number() OVER (PARTITION BY e.assessment_id, e.recipient_user_id ORDER BY (e.kind = 'risultati') DESC, e.scheduled_at, e.id) AS n
  FROM ${T} e
  WHERE (e.status = 'in_coda' OR (e.status = 'errore' AND e.attempts < 3))
    AND e.scheduled_at <= ${now} AND e.attempt_started_at IS NULL
    AND (e.lease_until IS NULL OR e.lease_until <= ${now})
    AND NOT EXISTS (
      SELECT 1 FROM ${T} x
      WHERE x.assessment_id = e.assessment_id AND x.recipient_user_id = e.recipient_user_id AND x.id <> e.id
        AND (
          (x.${PENDING} AND (x.lease_until > ${now} OR x.attempt_started_at IS NOT NULL))
          OR (x.status = 'inviata' AND x.sent_at >= ${dayStart})
          OR (x.cancel_reason = 'esito_incerto' AND x.counted_until >= ${dayStart})
        )
    )
),
c AS (
  SELECT e.id FROM ${T} e JOIN ranked r ON r.id = e.id AND r.n = 1
  ORDER BY e.scheduled_at, e.id
  LIMIT ${cast(i.limit, "int")}
  FOR UPDATE OF e SKIP LOCKED
)
UPDATE ${T} e SET lease_until = ${now} + make_interval(mins => ${cast(AIR_EMAIL_LEASE_MINUTES, "int")}), updated_at = now()
FROM c WHERE e.id = c.id
RETURNING e.id, e.workspace_id, e.assessment_id, e.recipient_user_id, e.kind, e.scheduled_at, e.created_at, e.attempts`),
  ];
}

/**
 * Quello che serve al piano di una riga, letto adesso: il workspace, la rilevazione (di questo workspace), la persona con
 * il ruolo e la scelta di adesso, il totale delle risposte inviate e quelle nuove. Le nuove si contano dall'ultima email
 * della persona per la rilevazione (partita, o dall'esito incerto) o, la prima volta, dall'invio che ha messo in coda la
 * riga, fino all'orologio del database (`counted_until`, che diventa l'inizio della prossima).
 */
export function airEmailFactsSql(id: string): UcStatement {
  return toStatement(ucSql`WITH e AS (SELECT * FROM ${T} WHERE id = ${cast(id, "uuid")}),
last AS (
  SELECT max(x.counted_until) AS until FROM ${T} x JOIN e ON x.assessment_id = e.assessment_id AND x.recipient_user_id = e.recipient_user_id
  WHERE x.id <> e.id AND x.counted_until IS NOT NULL AND (x.status = 'inviata' OR x.cancel_reason = 'esito_incerto')
),
since AS (SELECT coalesce((SELECT until FROM last), (SELECT counts_from FROM e)) AS at)
SELECT now() AS counted_until, w.name AS company,
  a.id AS assessment_id, a.name AS assessment_name, a.scoring_config, a.aggregation_threshold,
  u.id AS user_id, lower(u.email) AS email, u.email_verified IS NOT NULL AS verified,
  coalesce(b.${SWITCH}, true) AS switch_on,
  ${ROLE_SQL} AS role,
  (SELECT count(*)::int FROM ai_readiness_responses r WHERE r.assessment_id = e.assessment_id AND r.status = 'submitted') AS total,
  (SELECT count(*)::int FROM ai_readiness_responses r, since s
   WHERE r.assessment_id = e.assessment_id AND r.status = 'submitted' AND r.submitted_at IS NOT NULL
     AND (r.submitted_at AT TIME ZONE 'UTC') >= s.at AND (r.submitted_at AT TIME ZONE 'UTC') < now()) AS new_answers
FROM e
JOIN workspaces w ON w.id = e.workspace_id
LEFT JOIN ai_readiness_assessments a ON a.id = e.assessment_id AND a.workspace_id = e.workspace_id
LEFT JOIN users u ON u.id = e.recipient_user_id
LEFT JOIN workspace_bell_state b ON b.workspace_id = e.workspace_id AND b.user_id = e.recipient_user_id`);
}

const id = (value: string) => cast(value, "uuid");
const pendingRow = (rowId: string): SqlFragment => ucSql`id = ${id(rowId)} AND ${PENDING}`;

/**
 * Il segno del tentativo, prima di chiamare Resend: solo su una riga ancora in attesa e senza un altro tentativo
 * segnato (un solo giro la manda). Il conteggio si ferma a `countedUntil`. Restituisce il numero del tentativo.
 */
export function beginAirEmailAttemptSql(rowId: string, countedUntil: Date): UcStatement {
  return toStatement(ucSql`UPDATE ${T} SET attempt_started_at = now(), counted_until = ${cast(countedUntil.toISOString(), "timestamptz")},
  attempts = least(3, attempts + 1), hold_reason = NULL, updated_at = now()
WHERE ${pendingRow(rowId)} AND attempt_started_at IS NULL
RETURNING attempts`);
}

/**
 * Partita: `inviata`. Nella stessa transazione, se durante l'invio sono arrivate risposte (dopo `counted_until`), la riga
 * delle risposte nuove che parte il giorno dopo (l'email del giorno è già partita): nessuna risposta resta senza email.
 */
export function markAirEmailSentStatements(rowId: string): UcStatement[] {
  return [
    toStatement(ucSql`UPDATE ${T} SET status = 'inviata', sent_at = now(), lease_until = NULL, attempt_started_at = NULL, hold_reason = NULL, updated_at = now()
WHERE ${pendingRow(rowId)} AND attempt_started_at IS NOT NULL`),
    toStatement(ucSql`INSERT INTO ${T} (workspace_id, assessment_id, recipient_user_id, kind, counts_from, scheduled_at)
SELECT e.workspace_id, e.assessment_id, e.recipient_user_id, 'risposte', e.counted_until, now()
FROM ${T} e
WHERE e.id = ${id(rowId)} AND e.status = 'inviata' AND e.counted_until IS NOT NULL
  AND EXISTS (SELECT 1 FROM ai_readiness_responses r
              WHERE r.assessment_id = e.assessment_id AND r.status = 'submitted' AND r.submitted_at IS NOT NULL
                AND (r.submitted_at AT TIME ZONE 'UTC') >= e.counted_until)
ON CONFLICT DO NOTHING`),
  ];
}

/**
 * Un errore certo: l'email non è partita. Il tentativo era già contato; dopo il terzo la riga si annulla
 * («tentativi_finiti»), così non tiene occupato il posto della prossima.
 */
export function markAirEmailFailedSql(rowId: string, code: string): UcStatement {
  return toStatement(ucSql`UPDATE ${T} SET status = CASE WHEN attempts >= 3 THEN 'annullata' ELSE 'errore' END,
  cancel_reason = CASE WHEN attempts >= 3 THEN 'tentativi_finiti' ELSE cancel_reason END,
  last_error_code = ${cast(code, "text")}, attempt_started_at = NULL, lease_until = NULL,
  scheduled_at = now() + make_interval(mins => ${cast(AIR_EMAIL_RETRY_MINUTES, "int")}), updated_at = now()
WHERE ${pendingRow(rowId)}`);
}

/** Un esito incerto: annullata, mai ripetuta. Il conteggio resta: la prossima email conta da lì. */
export function markAirEmailUncertainSql(rowId: string, code: string): UcStatement {
  return toStatement(ucSql`UPDATE ${T} SET status = 'annullata', cancel_reason = 'esito_incerto', last_error_code = ${cast(code, "text")},
  attempt_started_at = NULL, lease_until = NULL, updated_at = now()
WHERE ${pendingRow(rowId)}`);
}

/** Una lettura mancata prima del tentativo: si riprova dopo 15 minuti, senza contare un tentativo. */
export function markAirEmailRetrySql(rowId: string, code: string): UcStatement {
  return toStatement(ucSql`UPDATE ${T} SET status = 'errore', last_error_code = ${cast(code, "text")}, lease_until = NULL,
  scheduled_at = now() + make_interval(mins => ${cast(AIR_EMAIL_RETRY_MINUTES, "int")}), updated_at = now()
WHERE ${pendingRow(rowId)} AND attempt_started_at IS NULL`);
}

export function markAirEmailHeldSql(rowId: string, reason: string): UcStatement {
  return toStatement(ucSql`UPDATE ${T} SET hold_reason = ${cast(reason, "text")}, lease_until = NULL, updated_at = now()
WHERE ${pendingRow(rowId)} AND attempt_started_at IS NULL`);
}

export function markAirEmailCancelledSql(rowId: string, reason: string): UcStatement {
  return toStatement(ucSql`UPDATE ${T} SET status = 'annullata', cancel_reason = ${cast(reason, "text")}, lease_until = NULL, updated_at = now()
WHERE ${pendingRow(rowId)} AND attempt_started_at IS NULL`);
}

/** Senza configurazione: le righe in attesa si segnano, una volta. */
export function holdUnconfiguredAirEmailsSql(): UcStatement {
  return toStatement(ucSql`UPDATE ${T} SET hold_reason = 'email_non_configurata', lease_until = NULL, updated_at = now()
WHERE ${PENDING} AND attempt_started_at IS NULL AND hold_reason IS DISTINCT FROM 'email_non_configurata'
RETURNING id`);
}

/** Le righe in attesa senza tentativo segnato, con la data di nascita: il motore sceglie quelle troppo vecchie. */
export function pendingAirEmailsSql(limit = 500): UcStatement {
  return toStatement(ucSql`SELECT id, created_at FROM ${T} WHERE ${PENDING} AND attempt_started_at IS NULL ORDER BY created_at, id LIMIT ${cast(limit, "int")}`);
}

export function cancelStaleAirEmailsSql(ids: readonly string[]): UcStatement {
  return toStatement(ucSql`UPDATE ${T} SET status = 'annullata', cancel_reason = 'troppo_vecchia', lease_until = NULL, updated_at = now()
WHERE id = ANY(${cast([...ids], "uuid[]")}) AND ${PENDING} AND attempt_started_at IS NULL
RETURNING id`);
}

/**
 * I tentativi interrotti a metà (il processo si è fermato dopo il segno e prima dell'esito, il lease è finito): l'email
 * può essere partita, quindi non si ripete mai («esito_incerto»).
 */
export function cancelInterruptedAirEmailsSql(now: Date): UcStatement {
  return toStatement(ucSql`UPDATE ${T} SET status = 'annullata', cancel_reason = 'esito_incerto', lease_until = NULL, attempt_started_at = NULL, updated_at = now()
WHERE ${PENDING} AND attempt_started_at IS NOT NULL AND (lease_until IS NULL OR lease_until <= ${cast(now.toISOString(), "timestamptz")})
RETURNING id`);
}

/** Le righe finite più vecchie di `days` giorni (con le notifiche vecchie). */
export function purgeAirEmailsSql(now: Date, days: number): UcStatement {
  return toStatement(ucSql`DELETE FROM ${T}
WHERE created_at < ${cast(new Date(now.getTime() - days * 86_400_000).toISOString(), "timestamptz")} AND status IN ('inviata', 'annullata', 'errore')
RETURNING id`);
}

/** «Avvisami per email sull'AI Readiness» di una persona in un workspace: accesa senza riga. */
export function airEmailSwitchSql(workspaceId: string, userId: string): UcStatement {
  return toStatement(ucSql`SELECT coalesce((SELECT b.${SWITCH} FROM workspace_bell_state b WHERE b.workspace_id = ${id(workspaceId)} AND b.user_id = ${id(userId)}), true) AS switch_on`);
}

/** La scelta della persona: la riga di `workspace_bell_state` nasce o cambia solo in questa colonna. */
export function setAirEmailSwitchSql(workspaceId: string, userId: string, on: boolean): UcStatement {
  return toStatement(ucSql`INSERT INTO workspace_bell_state (workspace_id, user_id, ${SWITCH}, updated_at)
VALUES (${id(workspaceId)}, ${id(userId)}, ${cast(on, "boolean")}, now())
ON CONFLICT (workspace_id, user_id) DO UPDATE SET ${SWITCH} = EXCLUDED.${SWITCH}, updated_at = now()
RETURNING ${SWITCH} AS switch_on`);
}
