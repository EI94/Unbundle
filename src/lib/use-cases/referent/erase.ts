/**
 * «Cancella i dati di questa persona» e la conservazione di 12 mesi (SPEC §3.10): i costruttori SQL
 * puri condivisi dall'action dei revisori (`eraseReferentData`), dal cron (conservazione) e dal
 * comando dell'operatore (`node scripts/use-case-admin.ts erase-referent`). Restituiscono
 * `{ text, params }`, che è sia uno `UcStatement` sia un `AdminStatement`.
 *
 * - Un referente è «solo degli use case» quando nessun dossier lo usa: nessuna richiesta dei dossier
 *   (`uc_requests`), nessun riferimento nei casi (`contactRefsSql`, le stesse colonne della purge dei
 *   dossier), nessuna riga di audit con lui come attore. Solo allora l'anonimizzazione della riga
 *   `uc_contacts` va nello stesso batch; altrimenti la riga resta alla procedura dei dossier.
 * - Gli oggetti dell'archivio si cancellano **dopo** le righe (l'action con `after()`, il cron dopo):
 *   un oggetto non si perde mai di vista.
 *
 * Modulo puro: import relativi `.ts`.
 */
import { contactRefsSql } from "../../db/queries/uc-retention.ts";
import { contactAnonymizeSql, contactHasNoOpenRequestsSql, contactNotDesignatedSql } from "../../uc/sql/request-commands.ts";
import { cast, toStatement, ucSql, type SqlFragment, type UcStatement } from "../../uc/sql/statement.ts";
import { infoCompleteSyncStatements, referentEventsForRequestsSql, revokeStatements, uuidOf, type ReferentActor } from "./sql.ts";

function hubOnlyCondition(workspaceId: string, contactId: string): SqlFragment {
  const c = () => cast(uuidOf(contactId, "referente"), "uuid");
  return ucSql`(NOT EXISTS (SELECT 1 FROM uc_requests q WHERE q.contact_id = ${c()})
  AND NOT EXISTS (SELECT 1 FROM (${contactRefsSql(uuidOf(workspaceId, "workspace"))}) refs WHERE refs.contact_id = ${c()})
  AND NOT EXISTS (SELECT 1 FROM uc_events e WHERE e.actor_contact_id = ${c()}))`;
}

/** Guardia nel batch: il referente non è usato da nessun dossier, altrimenti `referente_in_dossier`. */
export function contactHubOnlySql(workspaceId: string, contactId: string): UcStatement {
  return toStatement(ucSql`SELECT uc_require(${hubOnlyCondition(workspaceId, contactId)}, 'referente_in_dossier') AS ok`);
}

/** La stessa condizione come colonna `hub_only`, per il pannello e per la lettura prima del batch. */
export function contactHubOnlyReadSql(workspaceId: string, contactId: string): UcStatement {
  return toStatement(ucSql`SELECT ${hubOnlyCondition(workspaceId, contactId)} AS hub_only`);
}

/** Le richieste del referente nel workspace (alias `r`). */
function contactRequests(workspaceId: string, contactId: string): SqlFragment {
  return ucSql`r.workspace_id = ${cast(uuidOf(workspaceId, "workspace"), "uuid")} AND r.contact_id = ${cast(uuidOf(contactId, "referente"), "uuid")}`;
}

/**
 * La cancellazione dei dati di un referente in un workspace, in un batch:
 * 1. le sue richieste vive (e completate) revocate, motivo «cancellazione» (le domande aperte tornano
 *    da chiedere);
 * 2. ogni suo link revocato, ogni email in coda per lui annullata;
 * 3. risposte (anche bozze) senza testo, file segnati cancellati con il nome tolto, messaggi delle
 *    richieste tolti (`purged_at`);
 * 4. con `anonymizeContact` (il referente è solo degli use case e non è già anonimizzato: lo legge
 *    chi chiama prima del batch): le guardie dei dossier e l'anonimizzazione della riga `uc_contacts`;
 *    un dossier che nel frattempo lo usa fa fallire il batch con `referente_in_dossier`;
 * 5. una riga «dati del referente cancellati» nella Storia di ogni use case toccato, e il segno
 *    «Informazioni complete» delle schede `useCaseIds` (lette prima del batch).
 * Una seconda volta non cambia niente.
 */
export function referentEraseStatements(i: {
  workspaceId: string;
  contactId: string;
  actorUserId: string | null;
  reason: "cancellazione";
  anonymizeContact?: boolean;
  useCaseIds?: readonly string[];
}): UcStatement[] {
  const ws = cast(uuidOf(i.workspaceId, "workspace"), "uuid");
  const c = cast(uuidOf(i.contactId, "referente"), "uuid");
  const actor: ReferentActor = i.actorUserId ? { kind: "persona", userId: i.actorUserId } : { kind: "sistema" };
  const mine = contactRequests(i.workspaceId, i.contactId);
  const statements: UcStatement[] = [
    ...revokeStatements({ workspaceId: i.workspaceId, target: { contactId: i.contactId }, reason: i.reason, actor }),
    toStatement(ucSql`UPDATE use_case_referent_tokens t SET revoked_at = now()
FROM use_case_referent_requests r
WHERE t.request_id = r.id AND t.revoked_at IS NULL AND ${mine}`),
    toStatement(ucSql`UPDATE use_case_referent_email_items it SET state = 'tolta', drop_reason = 'cancellazione'
FROM use_case_referent_emails e
WHERE it.email_id = e.id AND e.workspace_id = ${ws} AND e.contact_id = ${c} AND it.state = 'in_coda'`),
    toStatement(ucSql`UPDATE use_case_referent_emails SET status = 'annullata', cancel_reason = 'cancellazione', lease_until = NULL, updated_at = now()
WHERE workspace_id = ${ws} AND contact_id = ${c} AND status IN ('in_coda', 'errore')`),
    toStatement(ucSql`UPDATE use_case_need_answers a SET body = NULL, removed_at = coalesce(a.removed_at, now()), removed_reason = coalesce(a.removed_reason, 'cancellazione'), updated_at = now()
FROM use_case_referent_requests r
WHERE a.request_id = r.id AND ${mine} AND (a.body IS NOT NULL OR a.removed_at IS NULL)`),
    toStatement(ucSql`UPDATE use_case_need_files f SET deleted_at = coalesce(f.deleted_at, now()), deleted_reason = coalesce(f.deleted_reason, 'cancellazione'), file_name = 'file'
FROM use_case_referent_requests r
WHERE f.request_id = r.id AND ${mine} AND (f.deleted_at IS NULL OR f.file_name <> 'file')`),
    toStatement(ucSql`UPDATE use_case_referent_requests r SET message = NULL, purged_at = coalesce(r.purged_at, now())
WHERE ${mine} AND r.status <> 'inviata' AND (r.purged_at IS NULL OR r.message IS NOT NULL)`),
  ];
  if (i.anonymizeContact) {
    statements.push(
      contactHubOnlySql(i.workspaceId, i.contactId),
      contactHasNoOpenRequestsSql(i.contactId),
      contactNotDesignatedSql(i.workspaceId, i.contactId),
      contactAnonymizeSql({ workspaceId: i.workspaceId, contactId: i.contactId }),
    );
  }
  statements.push(
    toStatement(ucSql`INSERT INTO use_case_events (workspace_id, use_case_id, actor_user_id, actor_kind, channel, action, fields, phase_before, phase_after)
SELECT DISTINCT r.workspace_id, r.use_case_id, ${cast(i.actorUserId, "uuid")}, ${cast(i.actorUserId ? "persona" : "sistema", "text")}, ${cast(i.actorUserId ? "pagina" : "altro", "text")},
  'modificato', ARRAY['richiesta_referente']::text[], NULL, 'dati_cancellati'
FROM use_case_referent_requests r
WHERE ${mine} AND r.purged_at = now()`),
  );
  if (i.useCaseIds && i.useCaseIds.length) {
    statements.push(...infoCompleteSyncStatements({ workspaceId: i.workspaceId, useCaseIds: i.useCaseIds, actorUserId: i.actorUserId }));
  }
  return statements;
}

/**
 * La conservazione (cron, 12 mesi dopo la fine): risposte senza testo, file cancellati con il nome
 * tolto, messaggio tolto, `purged_at`; restano date, stati e id delle esigenze, così «Cosa serve»
 * conserva la sua storia. Una riga «risposte e file cancellati dopo 12 mesi» nella Storia.
 */
export function referentPurgeStatements(i: { workspaceId: string; requestId: string }): UcStatement[] {
  const ws = cast(uuidOf(i.workspaceId, "workspace"), "uuid");
  const req = () => cast(uuidOf(i.requestId, "richiesta"), "uuid");
  const filter = ucSql`r.workspace_id = ${cast(uuidOf(i.workspaceId, "workspace"), "uuid")} AND r.id = ${req()} AND r.purged_at = now()`;
  return [
    toStatement(ucSql`UPDATE use_case_referent_requests SET message = NULL, purged_at = now()
WHERE id = ${req()} AND workspace_id = ${ws} AND status <> 'inviata' AND purged_at IS NULL`),
    toStatement(ucSql`UPDATE use_case_need_answers SET body = NULL, removed_at = coalesce(removed_at, now()), removed_reason = coalesce(removed_reason, 'conservazione'), updated_at = now()
WHERE request_id = ${req()} AND workspace_id = ${ws}`),
    toStatement(ucSql`UPDATE use_case_need_files SET deleted_at = coalesce(deleted_at, now()), deleted_reason = coalesce(deleted_reason, 'conservazione'), file_name = 'file'
WHERE request_id = ${req()} AND workspace_id = ${ws}`),
    referentEventsForRequestsSql({ filter, code: "conservazione", actor: { kind: "sistema" } }),
  ];
}

/** Gli use case con richieste del referente nel workspace (lettura prima del batch). */
export function contactUseCasesSql(workspaceId: string, contactId: string): UcStatement {
  return toStatement(ucSql`SELECT DISTINCT r.use_case_id FROM use_case_referent_requests r WHERE ${contactRequests(workspaceId, contactId)}`);
}

