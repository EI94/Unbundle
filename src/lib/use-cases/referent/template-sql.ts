/**
 * «File da compilare» (RUNBOOK §10.21): i costruttori SQL puri di `queries/use-case-template-files.ts`. Restituiscono
 * `{ text, params }`; le prove (`template-files.test.ts`) leggono il testo per controllare che un file da compilare non
 * tocchi mai l'esigenza, le notifiche o gli avvisi.
 *
 * Regole:
 * - **Non è una risposta.** Le scritture toccano solo `TEMPLATE_WRITTEN_TABLES`: la riga del file, i legami con le
 *   esigenze, il primo download e la Storia. Mai `use_case_needs`, `use_case_notifications`, gli avvisi a chi ha
 *   chiesto, le richieste o le risposte.
 * - **Lo scope sta nel database e nell'SQL**: ogni riga ha workspace e use case presi dal database; un legame ha la
 *   chiave composta del suo file; un'esigenza va bene solo se è un requisito collegato allo use case.
 * - **Una versione nuova** («Sostituisci») prende i legami della vecchia solo quando è pulita (o accettata), con CAS
 *   sulla vecchia: due sostituzioni insieme non lasciano due versioni vive.
 *
 * Modulo puro: import relativi `.ts`.
 */
import { CLIENT_SIDE_SQL } from "../../db/use-case-hub-referents-ddl.ts";
import { cast, raw, requireRows, toStatement, ucSql, type SqlFragment, type UcStatement } from "../../uc/sql/statement.ts";
import { TEMPLATE_LIMITS } from "./contract.ts";
import { PENDING_QUARANTINE_MS } from "./files.ts";
import { TEMPLATE_NEED_STATUSES } from "./questions.ts";
import { referentEventOnceSql, referentEventSql, uuidOf, type ReferentActor } from "./sql.ts";

/** Le sole tabelle che le scritture dei file da compilare toccano. */
export const TEMPLATE_WRITTEN_TABLES = ["use_case_template_files", "use_case_template_links", "use_case_template_downloads", "use_case_events"] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
const id = (value: string, what: string) => cast(uuidOf(value, what), "uuid");
const personOf = (userId: string): ReferentActor => ({ kind: "persona", userId });

/** Un file vivo (alias `f`): non cancellato, non rifiutato, non una quarantena abbandonata (più di un'ora). */
const LIVE_TEMPLATE_SQL = ucSql`f.deleted_at IS NULL AND f.scan_status <> 'rifiutato'
  AND NOT (f.scan_status = 'in_quarantena' AND f.created_at <= now() - make_interval(secs => ${cast(PENDING_QUARANTINE_MS / 1000, "int")}))`;

/**
 * Un'esigenza `n` che accetta un file da compilare su questo use case: requisito collegato e non archiviato, dalla
 * parte del cliente, «Insieme» o di nessuno, ancora da chiedere, chiesta, mancante o parziale (`templateNeeds`).
 */
function templateNeedSql(useCaseId: string): SqlFragment {
  return ucSql`n.type = 'requisito' AND n.archived_at IS NULL AND ${raw(CLIENT_SIDE_SQL("n"))} AND n.status = ANY(${cast([...TEMPLATE_NEED_STATUSES], "text[]")})
  AND EXISTS (SELECT 1 FROM use_case_need_links nl WHERE nl.need_id = n.id AND nl.use_case_id = ${id(useCaseId, "use case")})`;
}

/** Un caricamento alla volta per use case: due file insieme non superano i limiti per esigenza. */
function lockStatement(useCaseId: string): UcStatement {
  return toStatement(ucSql`SELECT pg_advisory_xact_lock(hashtext('use_case_template_files'), hashtext(${cast(uuidOf(useCaseId, "use case"), "text")})) IS NULL AS locked`);
}

/** Le esigenze di un file nuovo (1–50 uuid distinti) o la versione da sostituire; null se la richiesta non è valida. */
export function templateTargetOf(body: unknown): { needIds: string[]; replacesId: string | null } | null {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const replaces = b.replacesId;
  if (replaces !== undefined && replaces !== null && replaces !== "") {
    return isUuid(replaces) ? { needIds: [], replacesId: replaces.toLowerCase() } : null;
  }
  let list = b.needIds;
  if (typeof list === "string") {
    try {
      list = JSON.parse(list);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(list) || list.length === 0 || list.length > TEMPLATE_LIMITS.needsPerFile || !list.every(isUuid)) return null;
  return { needIds: [...new Set(list.map((needId) => (needId as string).toLowerCase()))], replacesId: null };
}

export interface TemplateInsertInput {
  fileId: string;
  workspaceId: string;
  useCaseId: string;
  userId: string;
  /** Le esigenze di un file nuovo; [] per una versione nuova («Sostituisci»), che prende i legami della vecchia. */
  needIds: readonly string[];
  replacesId: string | null;
  fileName: string;
  kind: string;
  maxBytes: number;
  mode: "server" | "client";
  quarantinePath: string | null;
}

function insertFileSql(i: TemplateInsertInput): SqlFragment {
  return ucSql`INSERT INTO use_case_template_files (id, workspace_id, use_case_id, replaces_id, uploaded_by_user_id, file_name, kind, max_bytes, upload_mode, quarantine_path)
SELECT ${id(i.fileId, "file")}, u.workspace_id, u.id, ${i.replacesId ? id(i.replacesId, "file") : cast(null, "uuid")}, ${id(i.userId, "persona")}, ${cast(i.fileName.slice(0, 255), "text")},
  ${cast(i.kind, "text")}, ${cast(i.maxBytes, "int")}, ${cast(i.mode, "text")}, ${cast(i.quarantinePath, "text")}
FROM use_cases u WHERE u.id = ${id(i.useCaseId, "use case")} AND u.workspace_id = ${id(i.workspaceId, "workspace")}
RETURNING id`;
}

/**
 * La riga in quarantena e (file nuovo) i suoi legami, con gli id dal database, in un batch sotto il lock dello use
 * case. Fallisce con `domanda_non_disponibile` (un'esigenza che non accetta file da compilare), `troppi_file` (un'esigenza
 * ne ha già 5), `file_non_trovato` (la versione da sostituire non c'è più) o `conflitto` (una versione nuova è già in
 * controllo).
 */
export function templateInsertStatements(i: TemplateInsertInput): UcStatement[] {
  const ws = id(i.workspaceId, "workspace");
  const uc = id(i.useCaseId, "use case");
  if (i.replacesId) {
    const old = id(i.replacesId, "file");
    return [
      lockStatement(i.useCaseId),
      // La versione da sostituire: viva, di questo use case, ancora legata a un'esigenza (una versione corrente).
      toStatement(ucSql`SELECT uc_require(EXISTS (SELECT 1 FROM use_case_template_files o
  WHERE o.id = ${old} AND o.workspace_id = ${ws} AND o.use_case_id = ${uc} AND o.deleted_at IS NULL AND o.scan_status IN ('pulito', 'in_revisione')
    AND EXISTS (SELECT 1 FROM use_case_template_links l WHERE l.file_id = o.id)), 'file_non_trovato') AS ok`),
      // Una versione nuova alla volta: un'altra già in controllo (o in quarantena da meno di un'ora) la blocca.
      toStatement(ucSql`SELECT uc_require(NOT EXISTS (SELECT 1 FROM use_case_template_files p
  WHERE p.replaces_id = ${old} AND p.workspace_id = ${ws} AND p.deleted_at IS NULL
    AND (p.scan_status = 'in_revisione' OR (p.scan_status = 'in_quarantena' AND p.created_at > now() - make_interval(secs => ${cast(PENDING_QUARANTINE_MS / 1000, "int")})))), 'conflitto') AS ok`),
      toStatement(requireRows(insertFileSql(i), 1, "file_non_trovato")),
    ];
  }
  const needs = [...new Set(i.needIds.map((needId) => uuidOf(needId, "esigenza")))];
  return [
    lockStatement(i.useCaseId),
    toStatement(ucSql`SELECT uc_require((SELECT count(*) FROM use_case_needs n
  WHERE n.id = ANY(${cast(needs, "uuid[]")}) AND n.workspace_id = ${ws} AND ${templateNeedSql(i.useCaseId)}) = ${cast(needs.length, "int")}, 'domanda_non_disponibile') AS ok`),
    toStatement(ucSql`SELECT uc_require(NOT EXISTS (SELECT 1 FROM unnest(${cast(needs, "uuid[]")}) AS x(id)
  WHERE (SELECT count(*) FROM use_case_template_links l JOIN use_case_template_files f ON f.id = l.file_id
         WHERE l.need_id = x.id AND l.use_case_id = ${uc} AND ${LIVE_TEMPLATE_SQL}) >= ${cast(TEMPLATE_LIMITS.filesPerNeed, "int")}), 'troppi_file') AS ok`),
    toStatement(requireRows(insertFileSql(i), 1, "domanda_non_disponibile")),
    toStatement(ucSql`INSERT INTO use_case_template_links (file_id, need_id, workspace_id, use_case_id)
SELECT ${id(i.fileId, "file")}, x.id, ${ws}, ${uc} FROM unnest(${cast(needs, "uuid[]")}) AS x(id)`),
  ];
}

/**
 * Una versione nuova prende il posto della vecchia: la vecchia si cancella (`sostituito`, solo se è ancora viva: CAS)
 * e i suoi legami passano alla nuova, nello stesso batch. Il referente con il link scarica la nuova da subito.
 */
export function templateReplaceStatements(i: { workspaceId: string; oldId: string; newId: string }): UcStatement[] {
  const ws = id(i.workspaceId, "workspace");
  return [
    toStatement(
      requireRows(
        ucSql`UPDATE use_case_template_files SET deleted_at = now(), deleted_reason = 'sostituito'
WHERE id = ${id(i.oldId, "file")} AND workspace_id = ${ws} AND deleted_at IS NULL RETURNING id`,
        1,
        "conflitto",
      ),
    ),
    toStatement(ucSql`UPDATE use_case_template_links SET file_id = ${id(i.newId, "file")} WHERE file_id = ${id(i.oldId, "file")} AND workspace_id = ${ws}`),
  ];
}

/** I legami di un file che non arriverà mai al referente (rifiutato dopo il controllo): l'esigenza non lo mostra più. */
export function templateUnlinkAllStatement(i: { workspaceId: string; fileId: string }): UcStatement {
  return toStatement(ucSql`DELETE FROM use_case_template_links WHERE file_id = ${id(i.fileId, "file")} AND workspace_id = ${id(i.workspaceId, "workspace")}`);
}

/**
 * Gli effetti di un file controllato, nello stesso batch dell'esito. Mai l'esigenza, mai notifiche o avvisi:
 * - pulito, file nuovo: «file da compilare aggiunto»;
 * - pulito, versione nuova: la vecchia si cancella, i legami passano alla nuova, «file da compilare sostituito»;
 * - in revisione, file nuovo: «file da compilare aggiunto» (il referente non lo vede finché non è accettato);
 * - in revisione, versione nuova: niente finché non è accettata (la vecchia resta).
 */
export function templateCheckedEffects(i: { workspaceId: string; useCaseId: string; fileId: string; replacesId: string | null; userId: string; outcome: "pulito" | "in_revisione" }): UcStatement[] {
  const event = (code: "da_compilare_aggiunto" | "da_compilare_sostituito") => referentEventSql({ workspaceId: i.workspaceId, useCaseId: i.useCaseId, code, actor: personOf(i.userId) });
  if (!i.replacesId) return [event("da_compilare_aggiunto")];
  if (i.outcome !== "pulito") return [];
  return [...templateReplaceStatements({ workspaceId: i.workspaceId, oldId: i.replacesId, newId: i.fileId }), event("da_compilare_sostituito")];
}

/**
 * Un PDF da compilare accettato da un'altra persona: pulito, «file accettato dopo il controllo» e, per una versione
 * nuova, la sostituzione. Come un file del team accettato, ma senza effetti sull'esigenza.
 */
export function templateAcceptedStatements(i: { workspaceId: string; useCaseId: string; fileId: string; replacesId: string | null; reviewerUserId: string }): UcStatement[] {
  const actor = personOf(i.reviewerUserId);
  return [
    toStatement(
      requireRows(
        ucSql`UPDATE use_case_template_files SET scan_status = 'pulito', reviewed_at = now(), reviewed_by_user_id = ${id(i.reviewerUserId, "persona")}, checked_at = now()
WHERE id = ${id(i.fileId, "file")} AND workspace_id = ${id(i.workspaceId, "workspace")} AND scan_status = 'in_revisione' AND deleted_at IS NULL RETURNING id`,
        1,
        "conflitto",
      ),
    ),
    referentEventSql({ workspaceId: i.workspaceId, useCaseId: i.useCaseId, code: "file_accettato", actor }),
    ...(i.replacesId
      ? [...templateReplaceStatements({ workspaceId: i.workspaceId, oldId: i.replacesId, newId: i.fileId }), referentEventSql({ workspaceId: i.workspaceId, useCaseId: i.useCaseId, code: "da_compilare_sostituito", actor })]
      : []),
  ];
}

/** Un PDF da compilare rifiutato da un'altra persona: senza oggetto (cancellato prima) e senza legami. */
export function templateRejectedStatements(i: { workspaceId: string; useCaseId: string; fileId: string; reviewerUserId: string }): UcStatement[] {
  return [
    toStatement(
      requireRows(
        ucSql`UPDATE use_case_template_files SET scan_status = 'rifiutato', rejection_reason = 'revisione_rifiutata', blob_path = NULL, reviewed_at = now(), reviewed_by_user_id = ${id(i.reviewerUserId, "persona")}
WHERE id = ${id(i.fileId, "file")} AND workspace_id = ${id(i.workspaceId, "workspace")} AND scan_status = 'in_revisione' AND deleted_at IS NULL RETURNING id`,
        1,
        "conflitto",
      ),
    ),
    templateUnlinkAllStatement({ workspaceId: i.workspaceId, fileId: i.fileId }),
    referentEventSql({ workspaceId: i.workspaceId, useCaseId: i.useCaseId, code: "file_rifiutato", actor: personOf(i.reviewerUserId) }),
  ];
}

/**
 * «Togli» su un'esigenza: il legame se ne va; dall'ultima esigenza il file si cancella (`tolto`) con le sue versioni
 * nuove ancora in controllo. Una riga «file da compilare tolto» nella Storia. L'esigenza non cambia.
 */
export function templateRemoveStatements(i: { workspaceId: string; useCaseId: string; fileId: string; needId: string; userId: string }): UcStatement[] {
  const ws = id(i.workspaceId, "workspace");
  const file = id(i.fileId, "file");
  return [
    lockStatement(i.useCaseId),
    toStatement(
      requireRows(
        ucSql`DELETE FROM use_case_template_links WHERE file_id = ${file} AND need_id = ${id(i.needId, "esigenza")} AND workspace_id = ${ws} AND use_case_id = ${id(i.useCaseId, "use case")} RETURNING file_id`,
        1,
        "file_non_trovato",
      ),
    ),
    toStatement(ucSql`UPDATE use_case_template_files SET deleted_at = now(), deleted_reason = 'tolto'
WHERE workspace_id = ${ws} AND deleted_at IS NULL AND (id = ${file} OR replaces_id = ${file})
  AND NOT EXISTS (SELECT 1 FROM use_case_template_links l WHERE l.file_id = ${file})`),
    referentEventSql({ workspaceId: i.workspaceId, useCaseId: i.useCaseId, code: "da_compilare_tolto", actor: personOf(i.userId) }),
  ];
}

/** La riga della Storia del primo download di questa versione per questa richiesta (due download insieme: una riga). */
export function templateFirstDownloadStatement(link: { workspaceId: string; useCaseId: string; requestId: string }, fileId: string): UcStatement {
  return referentEventOnceSql({
    workspaceId: link.workspaceId,
    useCaseId: link.useCaseId,
    code: "da_compilare_scaricato",
    actor: { kind: "referente" },
    once: ucSql`INSERT INTO use_case_template_downloads (file_id, request_id, workspace_id)
SELECT f.id, r.id, r.workspace_id FROM use_case_template_files f
JOIN use_case_referent_requests r ON r.id = ${id(link.requestId, "richiesta")} AND r.workspace_id = f.workspace_id AND r.use_case_id = f.use_case_id
WHERE f.id = ${id(fileId, "file")} AND f.workspace_id = ${id(link.workspaceId, "workspace")}
ON CONFLICT (file_id, request_id) DO NOTHING
RETURNING 1`,
  });
}

/**
 * La pagina del referente: i file da compilare non cancellati legati alle esigenze delle domande di questa richiesta,
 * su questo use case, con lo stato del controllo (la vista offre solo i puliti: `offeredTemplates`).
 */
export function requestTemplatesStatement(link: { workspaceId: string; useCaseId: string; requestId: string }): UcStatement {
  return toStatement(ucSql`SELECT l.need_id, f.id, f.file_name, f.size_bytes, f.scan_status
FROM use_case_template_links l
JOIN use_case_template_files f ON f.id = l.file_id AND f.workspace_id = l.workspace_id AND f.use_case_id = l.use_case_id
WHERE l.workspace_id = ${id(link.workspaceId, "workspace")} AND l.use_case_id = ${id(link.useCaseId, "use case")} AND f.deleted_at IS NULL
  AND l.need_id IN (SELECT i.need_id FROM use_case_referent_request_items i WHERE i.request_id = ${id(link.requestId, "richiesta")})
ORDER BY f.created_at, f.id`);
}

/**
 * (Email) Quante domande della richiesta `r` hanno un file da compilare pulito su questo use case: la riga «Alcune
 * domande hanno un file da compilare» dell'email. `items` filtra le domande (alias `x`): tutte, o solo quelle nuove.
 */
export function fillInQuestionsSql(request: string, items: SqlFragment = raw("TRUE")): SqlFragment {
  if (!/^[a-z_][a-z0-9_]{0,30}$/.test(request)) throw new Error("Alias non valido");
  const r = raw(request);
  return ucSql`(SELECT count(DISTINCT x.need_id)::int FROM use_case_referent_request_items x
  JOIN use_case_template_links tl ON tl.need_id = x.need_id AND tl.workspace_id = ${r}.workspace_id AND tl.use_case_id = ${r}.use_case_id
  JOIN use_case_template_files tf ON tf.id = tl.file_id AND tf.workspace_id = tl.workspace_id AND tf.use_case_id = tl.use_case_id
  WHERE x.request_id = ${r}.id AND tf.deleted_at IS NULL AND tf.scan_status = 'pulito' AND (${items}))`;
}
