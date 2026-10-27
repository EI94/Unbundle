/**
 * «Chiedi al referente»: i costruttori SQL puri condivisi dal servizio (`queries/use-case-referents.ts`,
 * `use-case-referent-public.ts`, `use-case-referent-files.ts`, `use-case-referent-dispatch.ts`), dalle
 * notifiche (`queries/use-case-notifications.ts`, che li riesporta) e dal comando dell'operatore
 * (`erase.ts`, `scripts/use-case-admin/erase-referent.ts`). Restituiscono `{ text, params }`.
 *
 * Regole comuni:
 * - **Una transazione**: ogni scrittura va in un solo batch con la sua Storia, le sue notifiche e
 *   la sua coda; gli effetti di una scadenza o di una revoca si riconoscono dentro la transazione
 *   con `expired_at = now()` / `revoked_at = now()` (costante per tutta la transazione).
 * - **Storia senza testi**: azione `modificato`, campo `richiesta_referente` o `cosa_serve`, codici.
 * - **Art. 15.4**: nessun ORDER BY, GROUP BY o conteggio per persona; i conteggi dei CAS stanno in
 *   una sottoquery sulla CTE (`casTail`).
 *
 * Modulo puro: import relativi `.ts`.
 */
import { CLIENT_SIDE_SQL, type FollowUpReason, type ReferentRevokeReason, type UseCaseNotificationKind } from "../../db/use-case-hub-referents-ddl.ts";
import { cast, raw, toStatement, ucSql, type SqlFragment, type UcStatement } from "../../uc/sql/statement.ts";
import { PORTFOLIO_REVIEWER_ROLES } from "../../workspace-permissions.ts";
import type { NeedStatus } from "../needs.ts";
import type { AlertSchedule } from "./alerts.ts";
import type { ReferentHistoryCode } from "./history.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[a-z0-9_]{1,60}$/;

export function uuidOf(value: string, what: string): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error(`Id non valido (${what})`);
  return value.toLowerCase();
}

const id = (value: string, what: string) => cast(uuidOf(value, what), "uuid");

/** Chi agisce: una persona del team dalla pagina, il referente dalla pagina pubblica, Unbundle (cron, invio). */
export type ReferentActor = { kind: "persona"; userId: string } | { kind: "referente" } | { kind: "sistema" };

function actorColumns(actor: ReferentActor): SqlFragment {
  if (actor.kind === "persona") return ucSql`${id(actor.userId, "persona")}, 'persona', 'pagina'`;
  if (actor.kind === "referente") return raw(`NULL::uuid, 'sistema', 'web'`);
  return raw(`NULL::uuid, 'sistema', 'altro'`);
}

export const actorUserIdOf = (actor: ReferentActor): string | null => (actor.kind === "persona" ? actor.userId : null);

/** `SELECT uc_require(<righe di cte> = n, '<codice>')`: il conteggio sta in una sottoquery sulla CTE. */
export function casTail(cte: string, expected: number, failCode: string): SqlFragment {
  if (!/^[a-z_][a-z0-9_]{0,30}$/.test(cte)) throw new Error("Nome della CTE non valido");
  if (!Number.isInteger(expected) || expected < 0) throw new Error("Numero di righe atteso non valido");
  if (!CODE.test(failCode)) throw new Error("Codice non valido");
  return ucSql`SELECT uc_require((SELECT count(*) FROM ${raw(cte)}) = ${cast(expected, "int")}, ${raw(`'${failCode}'`)}) AS ok`;
}

// ─── Storia ──────────────────────────────────────────────────────────

const EVENT_COLUMNS = raw("INSERT INTO use_case_events (workspace_id, use_case_id, actor_user_id, actor_kind, channel, action, fields, phase_before, phase_after)");
const REFERENT_FIELD = raw(`ARRAY['richiesta_referente']::text[]`);
const NEEDS_FIELD = raw(`ARRAY['cosa_serve']::text[]`);

/** Una riga `richiesta_referente` sulla Storia di uno use case del workspace. */
export function referentEventSql(i: { workspaceId: string; useCaseId: string; code: ReferentHistoryCode; actor: ReferentActor }): UcStatement {
  return toStatement(ucSql`${EVENT_COLUMNS}
SELECT u.workspace_id, u.id, ${actorColumns(i.actor)}, 'modificato', ${REFERENT_FIELD}, NULL, ${cast(i.code, "text")}
FROM use_cases u WHERE u.id = ${id(i.useCaseId, "use case")} AND u.workspace_id = ${id(i.workspaceId, "workspace")}`);
}

/** Una riga `richiesta_referente` per ogni richiesta che soddisfa `filter` (alias `r`). */
export function referentEventsForRequestsSql(i: { filter: SqlFragment; code: ReferentHistoryCode | SqlFragment; actor: ReferentActor }): UcStatement {
  const code = typeof i.code === "string" ? cast(i.code, "text") : i.code;
  return toStatement(ucSql`${EVENT_COLUMNS}
SELECT r.workspace_id, r.use_case_id, ${actorColumns(i.actor)}, 'modificato', ${REFERENT_FIELD}, NULL, ${code}
FROM use_case_referent_requests r WHERE ${i.filter}`);
}

// ─── Stati delle esigenze ────────────────────────────────────────────

/**
 * Le esigenze `needIds` (una sottoquery o un elenco) passano a `to` se sono in uno degli stati
 * `from` (o «chiesta» con l'id in `silentIds`): `version + 1`, `updated_at`, `done_at` coerente, e una
 * riga `cosa_serve` nella Storia di ogni use case collegato, solo dove lo stato cambia davvero.
 * Con `expect` il batch fallisce con quel codice se le righe toccate non sono quante attese.
 */
export function needTransitionSql(i: {
  workspaceId: string;
  needIds: SqlFragment | readonly string[];
  from: readonly NeedStatus[];
  silentIds?: readonly string[];
  to: NeedStatus;
  actor: ReferentActor;
  expect?: { count: number; code: string };
}): UcStatement {
  const ws = id(i.workspaceId, "workspace");
  const ids = Array.isArray(i.needIds) ? ucSql`SELECT unnest(${cast(i.needIds.map((x) => uuidOf(x, "esigenza")), "uuid[]")})` : (i.needIds as SqlFragment);
  const silent = i.silentIds && i.silentIds.length ? ucSql` OR (n.status = 'chiesta' AND n.id = ANY(${cast(i.silentIds.map((x) => uuidOf(x, "esigenza")), "uuid[]")}))` : raw("");
  const to = cast(i.to, "text");
  const tail = i.expect ? casTail("upd", i.expect.count, i.expect.code) : raw("SELECT id FROM upd");
  return toStatement(ucSql`WITH old AS (
  SELECT n.id, n.status FROM use_case_needs n
  WHERE n.workspace_id = ${ws} AND n.archived_at IS NULL AND n.type = 'requisito' AND n.id IN (${ids})
    AND (n.status = ANY(${cast([...i.from], "text[]")})${silent})
  FOR UPDATE
), upd AS (
  UPDATE use_case_needs n SET status = ${to}, version = n.version + 1, updated_at = now(),
    done_at = CASE WHEN ${to} IN ('validata', 'non_applicabile') THEN coalesce(n.done_at, now()) ELSE NULL END
  FROM old WHERE n.id = old.id
  RETURNING n.id, old.status AS old_status
), hist AS (
  ${EVENT_COLUMNS}
  SELECT u.workspace_id, u.id, ${actorColumns(i.actor)}, 'modificato', ${NEEDS_FIELD}, 'requisito.' || upd.old_status, 'modificata.requisito.' || ${to}
  FROM upd JOIN use_case_need_links l ON l.need_id = upd.id JOIN use_cases u ON u.id = l.use_case_id AND u.workspace_id = ${ws}
  WHERE upd.old_status <> ${to}
  RETURNING 1
)
${tail}`);
}

/** La domanda `i` della richiesta `r` è aperta (calcolata: `itemIsOpen`). */
export function openItemSql(item: string, request: string): SqlFragment {
  if (!/^[a-z][a-z0-9_]*$/.test(item) || !/^[a-z][a-z0-9_]*$/.test(request)) throw new Error("Alias non valido");
  return raw(`(${item}.state = 'aperta' AND EXISTS (
    SELECT 1 FROM use_case_needs oin JOIN use_case_need_links oil ON oil.need_id = oin.id AND oil.use_case_id = ${request}.use_case_id
    WHERE oin.id = ${item}.need_id AND oin.workspace_id = ${request}.workspace_id AND oin.status = 'chiesta' AND oin.archived_at IS NULL))`);
}

/** Quante domande aperte ha la richiesta `r` (sottoquery per scheda, mai per persona). */
export function openItemsCountSql(request: string): SqlFragment {
  return ucSql`(SELECT count(*)::int FROM use_case_referent_request_items oi WHERE oi.request_id = ${raw(request)}.id AND ${openItemSql("oi", request)})`;
}

/**
 * La richiesta `r` ha un link valido per l'indirizzo di adesso del suo referente: un token non
 * revocato e non scaduto emesso per quell'email. Falso dopo «Correggi l'email»: le email partite
 * finora sono andate all'indirizzo sbagliato, quindi il limite «un'email al giorno» non le conta.
 */
export function validLinkSql(request: string): SqlFragment {
  if (!/^[a-z][a-z0-9_]*$/.test(request)) throw new Error("Alias non valido");
  return raw(`EXISTS (SELECT 1 FROM use_case_referent_tokens vt JOIN uc_contacts vc ON vc.id = ${request}.contact_id AND vc.workspace_id = ${request}.workspace_id
    WHERE vt.request_id = ${request}.id AND vt.revoked_at IS NULL AND vt.expires_at > now() AND vc.email IS NOT NULL
      AND vt.recipient_hash = encode(sha256(convert_to(lower(btrim(vc.email)), 'UTF8')), 'hex'))`);
}

/**
 * L'ordine dei lock (§3.3): ogni batch che tocca una richiesta e le sue risposte o esigenze blocca
 * prima la riga della richiesta. Revoca, scadenza e cancellazione la aggiornano per prima; l'invio
 * delle risposte e le risposte del team la bloccano qui, prima di bozze ed esigenze. Così due
 * transazioni sulla stessa richiesta si mettono in fila invece di bloccarsi a vicenda (40P01).
 */
export function lockRequestSql(workspaceId: string, requestId: string): UcStatement {
  return toStatement(ucSql`SELECT r.id FROM use_case_referent_requests r
WHERE r.id = ${id(requestId, "richiesta")} AND r.workspace_id = ${id(workspaceId, "workspace")}
FOR UPDATE`);
}

/** Come `lockRequestSql`, per le richieste vive che chiedono l'esigenza `needId` (in ordine di id). */
export function lockRequestsOfNeedSql(workspaceId: string, needId: string): UcStatement {
  return toStatement(ucSql`SELECT r.id FROM use_case_referent_requests r
WHERE r.workspace_id = ${id(workspaceId, "workspace")} AND r.status = 'inviata'
  AND EXISTS (SELECT 1 FROM use_case_referent_request_items li WHERE li.request_id = r.id AND li.need_id = ${id(needId, "esigenza")})
ORDER BY r.id
FOR UPDATE`);
}

// ─── Fine di una richiesta: coda, bozze ──────────────────────────────

/** Le righe in coda delle richieste di `filter` si annullano; le voci dei promemoria si tolgono. */
export function cancelQueuedForRequestsStatements(i: { workspaceId: string; filter: SqlFragment; reason: string }): UcStatement[] {
  if (!CODE.test(i.reason)) throw new Error("Motivo non valido");
  const ws = id(i.workspaceId, "workspace");
  const reason = cast(i.reason, "text");
  return [
    toStatement(ucSql`UPDATE use_case_referent_emails e SET status = 'annullata', cancel_reason = ${reason}, lease_until = NULL, updated_at = now()
FROM use_case_referent_requests r
WHERE e.request_id = r.id AND e.workspace_id = ${ws} AND e.status IN ('in_coda', 'errore') AND ${i.filter}`),
    toStatement(ucSql`UPDATE use_case_referent_email_items it SET state = 'tolta', drop_reason = ${reason}
FROM use_case_referent_requests r
WHERE it.request_id = r.id AND it.workspace_id = ${ws} AND it.state = 'in_coda' AND ${i.filter}`),
    // Un promemoria rimasto senza voci in coda non parte più.
    toStatement(ucSql`UPDATE use_case_referent_emails e SET status = 'annullata', cancel_reason = 'nessuna_voce', lease_until = NULL, updated_at = now()
WHERE e.workspace_id = ${ws} AND e.template = 'promemoria' AND e.status IN ('in_coda', 'errore')
  AND NOT EXISTS (SELECT 1 FROM use_case_referent_email_items x WHERE x.email_id = e.id AND x.state = 'in_coda')
  AND EXISTS (SELECT 1 FROM use_case_referent_email_items y JOIN use_case_referent_requests r ON r.id = y.request_id WHERE y.email_id = e.id AND ${i.filter})`),
  ];
}

/**
 * Bozze e file non inviati delle richieste di `filter` (alias `r`): le bozze si cancellano, i file
 * si segnano cancellati («bozza_chiusa»; gli oggetti li toglie `deleteFileObjects` dopo la risposta
 * o il cron), `drafts_cleared_at` si scrive. Idempotente.
 */
export function draftsCleanupStatements(i: { workspaceId: string; filter: SqlFragment }): UcStatement[] {
  const ws = id(i.workspaceId, "workspace");
  return [
    toStatement(ucSql`DELETE FROM use_case_need_answers a USING use_case_referent_requests r
WHERE a.request_id = r.id AND a.workspace_id = ${ws} AND a.status = 'bozza' AND ${i.filter}`),
    toStatement(ucSql`UPDATE use_case_need_files f SET deleted_at = now(), deleted_reason = 'bozza_chiusa'
FROM use_case_referent_requests r
WHERE f.request_id = r.id AND f.workspace_id = ${ws} AND f.submitted_at IS NULL AND f.deleted_at IS NULL AND ${i.filter}`),
    toStatement(ucSql`UPDATE use_case_referent_requests r SET drafts_cleared_at = now()
WHERE r.workspace_id = ${ws} AND r.drafts_cleared_at IS NULL AND ${i.filter}`),
  ];
}

// ─── Le due strade si incontrano (Parte 3, §P3.5) ────────────────────

/**
 * Una risposta o un file del team dalla scheda su un'esigenza che una richiesta viva chiede ancora:
 * l'esigenza non è più «chiesta» (lo fa la transizione dello stesso batch, prima di queste righe),
 * quindi la domanda non è più aperta (`openItemSql`) e i promemoria non la contano. Qui, nello stesso
 * batch: ogni richiesta viva con una domanda su `needId` e nessuna domanda più aperta si completa
 * subito (coda annullata, bozze cancellate, Storia «completata» di Unbundle). Nessuna email, nessuna
 * notifica in più: la notifica, se c'è, è quella del file (`documenti`).
 */
export function completeHandledRequestsStatements(i: { workspaceId: string; needId: string }): UcStatement[] {
  const ws = id(i.workspaceId, "workspace");
  const filter = ucSql`r.workspace_id = ${ws} AND r.status = 'completata' AND r.completed_at = now()`;
  return [
    toStatement(ucSql`UPDATE use_case_referent_requests r SET status = 'completata', completed_at = now(), version = version + 1
WHERE r.workspace_id = ${ws} AND r.status = 'inviata' AND r.expires_at > now()
  AND EXISTS (SELECT 1 FROM use_case_referent_request_items ci WHERE ci.request_id = r.id AND ci.need_id = ${id(i.needId, "esigenza")})
  AND ${openItemsCountSql("r")} = 0
RETURNING r.id`),
    ...cancelQueuedForRequestsStatements({ workspaceId: i.workspaceId, filter, reason: "completata" }),
    ...draftsCleanupStatements({ workspaceId: i.workspaceId, filter }),
    referentEventsForRequestsSql({ filter, code: "completata", actor: { kind: "sistema" } }),
  ];
}

// ─── Scadenza ────────────────────────────────────────────────────────

/** Le richieste scadute adesso, in questa transazione (alias `r`). */
export function justExpiredFilter(workspaceId: string, useCaseId: string | null = null): SqlFragment {
  const uc = useCaseId ? ucSql` AND r.use_case_id = ${id(useCaseId, "use case")}` : raw("");
  return ucSql`r.workspace_id = ${id(workspaceId, "workspace")} AND r.status = 'scaduta' AND r.expired_at = now()${uc}`;
}

/**
 * La scadenza di una o più richieste vive oltre `expires_at` (pigra nei batch dei revisori, o del
 * cron): stato `scaduta` con `version + 1`, coda annullata, bozze cancellate, Storia «scaduta»; le
 * esigenze restano «chiesta» (Parte 2: «Senza risposta»). Con domande aperte e senza l'ultimo
 * promemoria, anche l'evento «Nessuna risposta» e l'avviso a chi ha chiesto (`reask` salta le
 * richieste che il batch sta chiedendo di nuovo; l'attore non riceve la notifica).
 */
export function expireStatements(i: {
  workspaceId: string;
  useCaseId?: string | null;
  requestId?: string | null;
  actorUserId: string | null;
  reask?: { previousRequestId: string | null; needIds: readonly string[] };
  schedule: AlertSchedule;
  now: Date;
}): UcStatement[] {
  const ws = id(i.workspaceId, "workspace");
  const uc = i.useCaseId ? ucSql` AND use_case_id = ${id(i.useCaseId, "use case")}` : raw("");
  const one = i.requestId ? ucSql` AND id = ${id(i.requestId, "richiesta")}` : raw("");
  const filter = justExpiredFilter(i.workspaceId, i.useCaseId ?? null);
  return [
    toStatement(ucSql`UPDATE use_case_referent_requests SET status = 'scaduta', expired_at = now(), version = version + 1
WHERE workspace_id = ${ws}${uc}${one} AND status = 'inviata' AND expires_at <= now()
RETURNING id`),
    ...cancelQueuedForRequestsStatements({ workspaceId: i.workspaceId, filter, reason: "scaduta" }),
    ...draftsCleanupStatements({ workspaceId: i.workspaceId, filter }),
    referentEventsForRequestsSql({ filter, code: "scaduta", actor: { kind: "sistema" } }),
    notifyExpiredRequestsSql({ workspaceId: i.workspaceId, useCaseId: i.useCaseId ?? null, actorUserId: i.actorUserId, reask: i.reask }),
    queueExpiredRequestAlertsSql({ workspaceId: i.workspaceId, useCaseId: i.useCaseId ?? null, actorUserId: i.actorUserId, reask: i.reask, schedule: i.schedule, now: i.now }),
  ];
}

// ─── Revoca ──────────────────────────────────────────────────────────

/** Le richieste revocate adesso, in questa transazione (alias `r`). */
export function justRevokedFilter(workspaceId: string): SqlFragment {
  return ucSql`r.workspace_id = ${id(workspaceId, "workspace")} AND r.status = 'revocata' AND r.revoked_at = now()`;
}

/**
 * La revoca di una richiesta (per id, con la versione letta) o di tutte le richieste vive di un
 * referente: link revocati, coda annullata, bozze cancellate, Storia «revocata» (revisore,
 * sostituita) o «revocata_sistema» (referente non più attivo, cancellazione). Le domande aperte
 * tornano «Non ancora chiesta», tranne con «sostituita» (le chiede subito la richiesta nuova) e
 * tranne quando un'altra richiesta viva le chiede ancora.
 */
export function revokeStatements(i: {
  workspaceId: string;
  target: { requestId: string; version?: number | null; statuses?: readonly ("inviata" | "completata")[] } | { contactId: string };
  reason: ReferentRevokeReason;
  actor: ReferentActor;
  /** Con un id: il batch fallisce con questo codice se la richiesta non si revoca (versione, stato). */
  failCode?: string;
}): UcStatement[] {
  const ws = id(i.workspaceId, "workspace");
  const statuses = "requestId" in i.target ? (i.target.statuses ?? ["inviata", "completata"]) : ["inviata", "completata"];
  const match =
    "requestId" in i.target
      ? ucSql`id = ${id(i.target.requestId, "richiesta")}${typeof i.target.version === "number" ? ucSql` AND version = ${cast(i.target.version, "int")}` : raw("")}`
      : ucSql`contact_id = ${id(i.target.contactId, "referente")}`;
  const update = ucSql`UPDATE use_case_referent_requests SET status = 'revocata', revoked_at = now(), revoked_by_user_id = ${cast(actorUserIdOf(i.actor), "uuid")},
    revoked_reason = ${cast(i.reason, "text")}, version = version + 1
  WHERE workspace_id = ${ws} AND ${match} AND status = ANY(${cast([...statuses], "text[]")})
  RETURNING id`;
  const first =
    "requestId" in i.target && i.failCode
      ? toStatement(ucSql`WITH rev AS (${update})
${casTail("rev", 1, i.failCode)}`)
      : toStatement(update);
  const filter = justRevokedFilter(i.workspaceId);
  const statements: UcStatement[] = [
    first,
    toStatement(ucSql`UPDATE use_case_referent_tokens t SET revoked_at = now()
FROM use_case_referent_requests r
WHERE t.request_id = r.id AND t.revoked_at IS NULL AND ${filter}`),
    ...cancelQueuedForRequestsStatements({ workspaceId: i.workspaceId, filter, reason: i.reason === "cancellazione" ? "cancellazione" : "revocata" }),
  ];
  if (i.reason !== "sostituita") {
    statements.push(
      needTransitionSql({
        workspaceId: i.workspaceId,
        needIds: ucSql`SELECT it.need_id FROM use_case_referent_request_items it JOIN use_case_referent_requests r ON r.id = it.request_id AND r.workspace_id = it.workspace_id
    WHERE ${filter} AND ${openItemSql("it", "r")}
      AND NOT EXISTS (SELECT 1 FROM use_case_referent_request_items o JOIN use_case_referent_requests ro ON ro.id = o.request_id
        WHERE o.need_id = it.need_id AND o.state = 'aperta' AND ro.status = 'inviata' AND ro.expires_at > now() AND ro.id <> r.id)`,
        from: ["chiesta"],
        to: "da_chiedere",
        actor: i.actor,
      }),
    );
  }
  statements.push(
    ...draftsCleanupStatements({ workspaceId: i.workspaceId, filter }),
    referentEventsForRequestsSql({
      filter,
      code: i.reason === "revisore" || i.reason === "sostituita" ? "revocata" : "revocata_sistema",
      actor: i.reason === "revisore" || i.reason === "sostituita" ? i.actor : { kind: "sistema" },
    }),
  );
  return statements;
}

// ─── Notifiche dei revisori (§P2.6) ──────────────────────────────────

const ROLES = () => cast([...PORTFOLIO_REVIEWER_ROLES], "text[]");

/** L'istante dell'evento: `now()` del database, oppure (solo nei test) l'istante dato. */
function clockOf(clock: Date | undefined): SqlFragment {
  return ucSql`coalesce(${cast(clock ? clock.toISOString() : null, "timestamptz")}, now())`;
}

/**
 * Le persone con un ruolo da revisore nel workspace (prima il ruolo nell'organizzazione, poi quello
 * nel workspace), tranne chi ha agito. Alias propri, per un `CROSS JOIN LATERAL`. Nessun ORDER BY,
 * nessun conteggio; 200 al massimo, per sicurezza.
 */
export function reviewerRecipientsSql(workspace: SqlFragment, exceptUserId: string | null, alsoExceptUserId: string | null = null): SqlFragment {
  // (Parte 3) Una seconda persona esclusa: chi ha caricato il documento che un'altra persona ha accettato.
  const also = alsoExceptUserId ? ucSql` AND ru.id <> ${id(alsoExceptUserId, "persona")}` : raw("");
  return ucSql`SELECT ru.id AS user_id
FROM workspaces rw
JOIN users ru ON ru.id IN (
  SELECT rm.user_id FROM memberships rm WHERE rm.organization_id = rw.organization_id
  UNION SELECT rwm.user_id FROM workspace_memberships rwm WHERE rwm.workspace_id = rw.id
)
WHERE rw.id = ${workspace} AND ru.id IS DISTINCT FROM ${cast(exceptUserId, "uuid")}${also}
  AND coalesce(
    (SELECT rm2.role::text FROM memberships rm2 WHERE rm2.user_id = ru.id AND rm2.organization_id = rw.organization_id LIMIT 1),
    (SELECT rwm2.role::text FROM workspace_memberships rwm2 WHERE rwm2.user_id = ru.id AND rwm2.workspace_id = rw.id LIMIT 1)
  ) = ANY(${ROLES()})
LIMIT 200`;
}

/** Eventi dello stesso giorno sommati, riga di nuovo non letta; dopo una lettura si riparte dall'evento nuovo. */
const COLLAPSE_SET = raw(`answers   = CASE WHEN use_case_notifications.read_at IS NULL THEN least(999, use_case_notifications.answers + EXCLUDED.answers) ELSE EXCLUDED.answers END,
  unknowns  = CASE WHEN use_case_notifications.read_at IS NULL THEN least(999, use_case_notifications.unknowns + EXCLUDED.unknowns) ELSE EXCLUDED.unknowns END,
  documents = CASE WHEN use_case_notifications.read_at IS NULL THEN least(999, use_case_notifications.documents + EXCLUDED.documents) ELSE EXCLUDED.documents END,
  follow_up = CASE WHEN use_case_notifications.read_at IS NOT NULL OR use_case_notifications.follow_up IS NULL OR EXCLUDED.follow_up = 'scaduta' THEN EXCLUDED.follow_up ELSE use_case_notifications.follow_up END,
  first_event_at = CASE WHEN use_case_notifications.read_at IS NULL THEN use_case_notifications.first_event_at ELSE EXCLUDED.first_event_at END,
  last_event_at = greatest(use_case_notifications.last_event_at, EXCLUDED.last_event_at),
  read_at = NULL`);

const bounded = (n: number | undefined) => Math.max(0, Math.min(999, Math.floor(typeof n === "number" && Number.isFinite(n) ? n : 0)));

/** Un evento per i revisori di una scheda: risposte, documenti o nessuna risposta. */
export function notifyReviewersSql(n: {
  workspaceId: string;
  useCaseId: string;
  kind: Exclude<UseCaseNotificationKind, "complete">;
  answers?: number;
  unknowns?: number;
  documents?: number;
  followUp?: FollowUpReason | null;
  actorUserId: string | null;
  /** (Parte 3) Chi ha dato il documento quando l'evento è di un'altra persona (l'accettazione di Lateral Space). */
  alsoExceptUserId?: string | null;
  clock?: Date;
}): UcStatement {
  const ts = clockOf(n.clock);
  const counted = n.kind === "risposte" || n.kind === "documenti";
  const followUp = n.kind === "senza_risposta" ? (n.followUp ?? "scaduta") : null;
  return toStatement(ucSql`INSERT INTO use_case_notifications (workspace_id, use_case_id, recipient_user_id, kind, rome_day, answers, unknowns, documents, follow_up, first_event_at, last_event_at)
SELECT u.workspace_id, u.id, r.user_id, ${cast(n.kind, "text")},
       (${ts} AT TIME ZONE 'Europe/Rome')::date,
       ${cast(counted ? bounded(n.answers) : 0, "int")}, ${cast(n.kind === "risposte" ? bounded(n.unknowns) : 0, "int")}, ${cast(counted ? bounded(n.documents) : 0, "int")},
       ${cast(followUp, "text")}, ${ts}, ${ts}
FROM use_cases u
CROSS JOIN LATERAL (${reviewerRecipientsSql(raw("u.workspace_id"), n.actorUserId, n.alsoExceptUserId ?? null)}) r
WHERE u.id = ${id(n.useCaseId, "use case")} AND u.workspace_id = ${id(n.workspaceId, "workspace")}
ON CONFLICT (recipient_user_id, use_case_id, kind, rome_day) DO UPDATE SET
  ${COLLAPSE_SET}`);
}

/** Le richieste scadute in questa transazione, con domande aperte e senza l'ultimo promemoria. */
function expiredNowFilter(i: { workspaceId: string; useCaseId: string | null; reask?: { previousRequestId: string | null; needIds: readonly string[] } }): SqlFragment {
  const prev = i.reask ? ucSql` AND r.id IS DISTINCT FROM ${cast(i.reask.previousRequestId ? uuidOf(i.reask.previousRequestId, "richiesta") : null, "uuid")}` : raw("");
  const needs = i.reask && i.reask.needIds.length ? ucSql` AND n.id <> ALL(${cast(i.reask.needIds.map((x) => uuidOf(x, "esigenza")), "uuid[]")})` : raw("");
  return ucSql`${justExpiredFilter(i.workspaceId, i.useCaseId)} AND r.reminder_count < 2${prev}
    AND EXISTS (SELECT 1 FROM use_case_referent_request_items i
                JOIN use_case_needs n ON n.id = i.need_id AND n.workspace_id = r.workspace_id
                JOIN use_case_need_links l ON l.need_id = n.id AND l.use_case_id = r.use_case_id
                WHERE i.request_id = r.id AND i.state = 'aperta' AND n.status = 'chiesta' AND n.archived_at IS NULL${needs})`;
}

/** «Nessuna risposta» (scaduta) per le richieste scadute in questa transazione, una riga per revisore e scheda. */
export function notifyExpiredRequestsSql(i: {
  workspaceId: string;
  useCaseId: string | null;
  actorUserId: string | null;
  reask?: { previousRequestId: string | null; needIds: readonly string[] };
  clock?: Date;
}): UcStatement {
  const ts = clockOf(i.clock);
  return toStatement(ucSql`WITH ex AS (
  SELECT DISTINCT r.workspace_id, r.use_case_id
  FROM use_case_referent_requests r
  WHERE ${expiredNowFilter(i)}
)
INSERT INTO use_case_notifications (workspace_id, use_case_id, recipient_user_id, kind, rome_day, follow_up, first_event_at, last_event_at)
SELECT ex.workspace_id, ex.use_case_id, rc.user_id, 'senza_risposta', (${ts} AT TIME ZONE 'Europe/Rome')::date, 'scaduta', ${ts}, ${ts}
FROM ex CROSS JOIN LATERAL (${reviewerRecipientsSql(raw("ex.workspace_id"), i.actorUserId)}) rc
ON CONFLICT (recipient_user_id, use_case_id, kind, rome_day) DO UPDATE SET
  ${COLLAPSE_SET}`);
}

function targetCards(i: { workspaceId: string; useCaseIds?: readonly string[]; needId?: string | null }): SqlFragment {
  const ids = (i.useCaseIds ?? []).map((x) => uuidOf(x, "use case"));
  return ucSql`u.workspace_id = ${id(i.workspaceId, "workspace")}
    AND (u.id = ANY(${cast(ids, "uuid[]")}) OR u.id IN (SELECT l.use_case_id FROM use_case_need_links l WHERE l.need_id = ${cast(i.needId ? uuidOf(i.needId, "esigenza") : null, "uuid")}))`;
}

/**
 * «Informazioni complete»: [il lock per scheda, la sincronizzazione], in fondo al batch e in
 * quest'ordine. L'avviso parte solo al passaggio a «completa» di una scheda con almeno una richiesta,
 * a tutti i revisori tranne chi l'ha completata.
 */
export function infoCompleteSyncStatements(i: {
  workspaceId: string;
  useCaseIds?: readonly string[];
  needId?: string | null;
  actorUserId: string | null;
  clock?: Date;
}): [UcStatement, UcStatement] {
  const ts = clockOf(i.clock);
  const lock = toStatement(ucSql`SELECT pg_advisory_xact_lock(hashtext('use-case-info:' || u.id::text))
FROM use_cases u
WHERE ${targetCards(i)}
ORDER BY u.id`);
  const sync = toStatement(ucSql`WITH target AS (
  SELECT u.id AS use_case_id, u.workspace_id FROM use_cases u
  WHERE ${targetCards(i)}
), state AS (
  SELECT t.use_case_id, t.workspace_id,
    EXISTS (SELECT 1 FROM use_case_needs n JOIN use_case_need_links l ON l.need_id = n.id
            WHERE l.use_case_id = t.use_case_id AND n.workspace_id = t.workspace_id AND n.type = 'requisito'
              AND n.archived_at IS NULL AND ${raw(CLIENT_SIDE_SQL("n"))}) AS has_needs,
    NOT EXISTS (SELECT 1 FROM use_case_needs n JOIN use_case_need_links l ON l.need_id = n.id
            WHERE l.use_case_id = t.use_case_id AND n.workspace_id = t.workspace_id AND n.type = 'requisito'
              AND n.archived_at IS NULL AND ${raw(CLIENT_SIDE_SQL("n"))} AND n.status NOT IN ('validata', 'non_applicabile')) AS all_done
  FROM target t
), prev AS (
  SELECT s.use_case_id, i.complete_since FROM state s LEFT JOIN use_case_info_state i ON i.use_case_id = s.use_case_id
), mark AS (
  INSERT INTO use_case_info_state (use_case_id, workspace_id, complete_since, updated_at)
  SELECT use_case_id, workspace_id, CASE WHEN has_needs AND all_done THEN ${ts} END, ${ts} FROM state
  ON CONFLICT (use_case_id) DO UPDATE SET
    complete_since = CASE WHEN EXCLUDED.complete_since IS NULL THEN NULL ELSE coalesce(use_case_info_state.complete_since, EXCLUDED.complete_since) END,
    updated_at = EXCLUDED.updated_at
  RETURNING use_case_id
), became AS (
  SELECT s.use_case_id, s.workspace_id FROM state s JOIN prev p ON p.use_case_id = s.use_case_id
  WHERE s.has_needs AND s.all_done AND p.complete_since IS NULL
    AND EXISTS (SELECT 1 FROM use_case_referent_requests r WHERE r.use_case_id = s.use_case_id AND r.workspace_id = s.workspace_id)
)
INSERT INTO use_case_notifications (workspace_id, use_case_id, recipient_user_id, kind, rome_day, first_event_at, last_event_at)
SELECT b.workspace_id, b.use_case_id, r.user_id, 'complete', (${ts} AT TIME ZONE 'Europe/Rome')::date, ${ts}, ${ts}
FROM became b CROSS JOIN LATERAL (${reviewerRecipientsSql(raw("b.workspace_id"), i.actorUserId)}) r
ON CONFLICT (recipient_user_id, use_case_id, kind, rome_day) DO UPDATE SET last_event_at = greatest(use_case_notifications.last_event_at, EXCLUDED.last_event_at), read_at = NULL`);
  return [lock, sync];
}

// ─── Avvisi per email a chi ha chiesto (§P2.7.2) ─────────────────────

function queueAlertSql(i: {
  workspaceId: string;
  target: SqlFragment;
  answers: number;
  unknowns: number;
  documents: number;
  followUp: FollowUpReason | null;
  actorUserId: string | null;
  alsoExceptUserId?: string | null;
  immediate: boolean;
  schedule: AlertSchedule;
  now: Date;
}): UcStatement {
  const ws = id(i.workspaceId, "workspace");
  const now = cast(i.now.toISOString(), "timestamptz");
  const also = i.alsoExceptUserId ? ucSql`
    AND r.requested_by_user_id <> ${id(i.alsoExceptUserId, "persona")}` : raw("");
  const today = cast(i.schedule.today, "date");
  return toStatement(ucSql`WITH req AS (
  SELECT r.id, r.workspace_id, r.use_case_id, r.requested_by_user_id AS uid
  FROM use_case_referent_requests r
  WHERE r.workspace_id = ${ws} AND r.purged_at IS NULL AND r.requested_by_user_id IS NOT NULL
    AND r.requested_by_user_id IS DISTINCT FROM ${cast(i.actorUserId, "uuid")}${also}
    AND ${i.target}
    AND coalesce((SELECT b.referent_emails FROM workspace_bell_state b WHERE b.workspace_id = r.workspace_id AND b.user_id = r.requested_by_user_id), true)
), who AS (
  SELECT DISTINCT req.workspace_id, req.uid FROM req
), slot AS (
  SELECT w.workspace_id, w.uid,
    CASE WHEN ${cast(i.schedule.inWindow, "boolean")} AND t.ok THEN ${today} ELSE ${cast(i.schedule.nextDay, "date")} END AS send_on,
    CASE WHEN ${cast(i.schedule.inWindow, "boolean")} AND t.ok THEN ${now} ELSE ${cast(i.schedule.nextAt.toISOString(), "timestamptz")} END AS scheduled_at
  FROM who w
  CROSS JOIN LATERAL (
    SELECT CASE WHEN ${cast(i.immediate, "boolean")}
      THEN NOT EXISTS (SELECT 1 FROM use_case_requester_emails e
             WHERE e.workspace_id = w.workspace_id AND e.recipient_user_id = w.uid AND e.send_on = ${today}
               AND NOT ((e.status = 'in_coda' OR (e.status = 'errore' AND e.attempts < 3)) AND (e.lease_until IS NULL OR e.lease_until <= ${now})))
      ELSE EXISTS (SELECT 1 FROM use_case_requester_emails e
             WHERE e.workspace_id = w.workspace_id AND e.recipient_user_id = w.uid AND e.send_on = ${today}
               AND (e.status = 'in_coda' OR (e.status = 'errore' AND e.attempts < 3)) AND (e.lease_until IS NULL OR e.lease_until <= ${now}))
    END AS ok
  ) t
), em AS (
  INSERT INTO use_case_requester_emails (workspace_id, recipient_user_id, send_on, scheduled_at, due_at)
  SELECT workspace_id, uid, send_on, scheduled_at, scheduled_at FROM slot
  ON CONFLICT (workspace_id, recipient_user_id, send_on) DO UPDATE SET
    scheduled_at = least(use_case_requester_emails.scheduled_at, EXCLUDED.scheduled_at),
    updated_at = now()
  RETURNING id, workspace_id, recipient_user_id, status
)
INSERT INTO use_case_requester_email_items (email_id, request_id, workspace_id, use_case_id, answers, unknowns, documents, follow_up)
SELECT em.id, req.id, req.workspace_id, req.use_case_id, ${cast(bounded(i.answers), "int")}, ${cast(bounded(i.unknowns), "int")}, ${cast(bounded(i.documents), "int")}, ${cast(i.followUp, "text")}
FROM req JOIN em ON em.workspace_id = req.workspace_id AND em.recipient_user_id = req.uid
WHERE em.status IN ('in_coda', 'errore')
ON CONFLICT (email_id, request_id) DO UPDATE SET
  answers = least(999, use_case_requester_email_items.answers + EXCLUDED.answers),
  unknowns = least(999, use_case_requester_email_items.unknowns + EXCLUDED.unknowns),
  documents = least(999, use_case_requester_email_items.documents + EXCLUDED.documents),
  follow_up = CASE WHEN EXCLUDED.follow_up = 'scaduta' OR use_case_requester_email_items.follow_up IS NULL THEN EXCLUDED.follow_up ELSE use_case_requester_email_items.follow_up END,
  updated_at = now()`);
}

/**
 * Un evento per l'email di chi ha chiesto: con `{ requestId }` quella richiesta; con
 * `{ useCaseId, needId }` (un file del team) l'ultima richiesta inviata o completata con quella
 * domanda. Solo le risposte del referente (`immediate`) partono oggi stesso.
 */
export function queueRequesterAlertSql(i: {
  workspaceId: string;
  target: { requestId: string } | { useCaseId: string; needId: string };
  answers: number;
  unknowns: number;
  documents: number;
  followUp: FollowUpReason | null;
  actorUserId: string | null;
  /** (Parte 3) Chi ha dato il documento accettato da un'altra persona: non riceve l'avviso del suo documento. */
  alsoExceptUserId?: string | null;
  immediate: boolean;
  schedule: AlertSchedule;
  now: Date;
}): UcStatement {
  const target =
    "requestId" in i.target
      ? ucSql`r.id = ${id(i.target.requestId, "richiesta")}`
      : ucSql`r.id = (SELECT r2.id FROM use_case_referent_requests r2 JOIN use_case_referent_request_items i2 ON i2.request_id = r2.id
          WHERE r2.workspace_id = ${id(i.workspaceId, "workspace")} AND r2.use_case_id = ${id(i.target.useCaseId, "use case")}
            AND i2.need_id = ${id(i.target.needId, "esigenza")} AND r2.status IN ('inviata', 'completata')
          ORDER BY r2.created_at DESC, r2.id LIMIT 1)`;
  return queueAlertSql({ ...i, target });
}

/** «Nessuna risposta» per scadenza: le stesse richieste di `notifyExpiredRequestsSql`, un'email per chi ha chiesto. */
export function queueExpiredRequestAlertsSql(i: {
  workspaceId: string;
  useCaseId: string | null;
  actorUserId: string | null;
  reask?: { previousRequestId: string | null; needIds: readonly string[] };
  schedule: AlertSchedule;
  now: Date;
}): UcStatement {
  return queueAlertSql({
    workspaceId: i.workspaceId,
    target: expiredNowFilter(i),
    answers: 0,
    unknowns: 0,
    documents: 0,
    followUp: "scaduta",
    actorUserId: i.actorUserId,
    immediate: false,
    schedule: i.schedule,
    now: i.now,
  });
}
