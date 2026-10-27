/**
 * `use-case-admin erase-referent` (SPEC §3.10): la cancellazione dei dati di un referente raccolti
 * con «Chiedi al referente», per l'operatore. Gli stessi statement della scheda
 * (`referentEraseStatements`), in una transazione con `--apply`; a secco solo il piano.
 *
 * Lo script non ha accesso all'archivio dei file: le righe dei file restano con il percorso e gli
 * oggetti li cancella il prossimo giro del cron dei referenti (passo 7). Il piano lo dice.
 *
 * Modulo puro: import relativi `.ts`. Nell'uscita mai nomi, email, testi delle risposte o dei file.
 */
import { contactHubOnlyReadSql, contactUseCasesSql, referentEraseStatements } from "../referent/erase.ts";
import { uuidOf } from "../referent/sql.ts";
import { cast, toStatement, ucSql, type UcStatement } from "../../uc/sql/statement.ts";

export const ERASE_REFERENT_OPTIONS = Object.freeze({ values: Object.freeze(["contact"]) as readonly string[] });

/** Le tabelle e la funzione che il comando usa. */
export const ERASE_REFERENT_SCHEMA_SQL = `SELECT (to_regclass('public.use_case_referent_requests') IS NOT NULL
  AND to_regclass('public.uc_contacts') IS NOT NULL AND to_regclass('public.uc_requests') IS NOT NULL
  AND to_regprocedure('public.uc_require(boolean,text)') IS NOT NULL) AS ok`;

export const ERASE_REFERENT_SCHEMA_MESSAGE =
  "Mancano le tabelle di «Chiedi al referente» (drizzle/0024) o quelle dei dossier: il comando non può cancellare niente.";

export const ERASE_REFERENT_BLOB_NOTE =
  "Gli oggetti dei file nell'archivio li cancella il prossimo giro del cron dei referenti (giorni feriali, 9:00 UTC): questo script non ha accesso all'archivio.";

export const ERASE_REFERENT_DOSSIER_NOTE =
  "La persona è anche in un dossier: la sua riga in uc_contacts resta. Per anonimizzarla: uc-case-admin anonymize-contact (procedura dei dossier).";

/** Le letture prima del piano: il referente del workspace, se è solo dell'hub, le schede toccate, le richieste. */
export function eraseReferentReads(workspaceId: string, contactId: string): { contact: UcStatement; hubOnly: UcStatement; useCases: UcStatement; requests: UcStatement } {
  const ws = cast(uuidOf(workspaceId, "workspace"), "uuid");
  const c = cast(uuidOf(contactId, "referente"), "uuid");
  return {
    contact: toStatement(ucSql`SELECT id, anonymized_at IS NOT NULL AS anonymized FROM uc_contacts WHERE id = ${c} AND workspace_id = ${ws}`),
    hubOnly: contactHubOnlyReadSql(workspaceId, contactId),
    useCases: contactUseCasesSql(workspaceId, contactId),
    requests: toStatement(ucSql`SELECT r.id FROM use_case_referent_requests r WHERE r.workspace_id = ${ws} AND r.contact_id = ${c} ORDER BY r.created_at, r.id`),
  };
}

export interface EraseReferentFacts {
  hubOnly: boolean;
  anonymized: boolean;
  useCaseIds: readonly string[];
  requests: number;
}

export interface EraseReferentPlan {
  statements: UcStatement[];
  anonymizeContact: boolean;
  report: { useCase: number; richieste: number; anonimizza: boolean; note: string[] };
}

/** Il piano: gli statement in ordine (attore «sistema»), e un riepilogo senza dati della persona. */
export function eraseReferentPlan(workspaceId: string, contactId: string, facts: EraseReferentFacts): EraseReferentPlan {
  const anonymizeContact = facts.hubOnly && !facts.anonymized;
  const statements = referentEraseStatements({
    workspaceId,
    contactId,
    actorUserId: null,
    reason: "cancellazione",
    anonymizeContact,
    useCaseIds: facts.useCaseIds,
  });
  const note = [ERASE_REFERENT_BLOB_NOTE];
  if (!facts.hubOnly) note.push(ERASE_REFERENT_DOSSIER_NOTE);
  return { statements, anonymizeContact, report: { useCase: facts.useCaseIds.length, richieste: facts.requests, anonimizza: anonymizeContact, note } };
}
