/**
 * Conservazione e cancellazione dei Casi d'uso (DESIGN §7.1 P0-8).
 *
 * - `expireRetainedFiles`: la pulizia notturna del cron `uc-freshness`. I file
 *   di un caso chiuso si tengono 30 giorni dopo la chiusura (`retention_until`,
 *   se registrata, vince: PIANO b14); poi l'oggetto si toglie dal suo archivio
 *   (standard o zona personale) e la riga resta senza percorsi, con
 *   `file.cancellato` motivo `conservazione_scaduta`. Restano le prove scritte
 *   usate dal caso (designazione dei firmatari, blocchi, gate): si tolgono solo
 *   con la cancellazione del caso.
 * - `loadPurgePlan` / `purgeCase`: `uc-case-admin purge-case`. Cancella il caso
 *   in cascata (tutte le tabelle uc con `case_id`) dopo aver tolto i suoi
 *   oggetti dai due archivi, revoca i token MCP del caso e anonimizza i
 *   referenti del caso che nessun altro caso del workspace usa (dopo la purge
 *   non resterebbe nessuna pagina da cui farlo). Restano gli eventi di
 *   `uc_events` (a sola aggiunta: l'audit sopravvive al caso, con gli id degli
 *   attori, `ip_hash` e `user_agent`; RUNBOOK §7.3) e i referenti usati da altri
 *   casi.
 *
 * Modulo senza import dell'app (`@/…`, `server-only`): lo usano il cron (con
 * l'esecutore dell'app) e lo script operatore (con `ucExecutorForUrl`).
 */
import { UC_TABLES } from "../../uc/ddl.ts";
import { caseScopeMarker } from "../../uc/mcp-access.ts";
import { rowNumber, rowString } from "../../uc/sql/readiness.ts";
import {
  contactAnonymizeSql,
  contactHasNoOpenRequestsSql,
  contactNotDesignatedSql,
  contactNotificationsCancelSql,
  contactTokensRevokeSql,
} from "../../uc/sql/request-commands.ts";
import { cast, raw, requireRows, toStatement, ucSql, type SqlFragment, type UcStatement } from "../../uc/sql/statement.ts";
import { deleteUcObjects, pathBelongsToZone, storeConfigured, ucStore, type UcStorageEnv } from "../../uc/storage.ts";
import type { StorageZone } from "../../uc/vocab.ts";
import { runUcBatch, type UcExecutor } from "../uc-executor.ts";
import { eventInsertFromSql } from "./uc-events.ts";
import { UUID } from "../../uc/ids.ts";

function uuid(value: string, what: string): string {
  if (!UUID.test(value)) throw new Error(`${what} non valido`);
  return value.toLowerCase();
}

/** Giorni di conservazione dei file dopo la chiusura del caso (PIANO b14). */
export const FILE_RETENTION_DAYS = 30;

// ── Pulizia notturna ──────────────────────────────────────────────────

/** Il file è una prova scritta usata dal caso (alias `f` del file, `c` del caso). */
const IS_WRITTEN_PROOF: SqlFragment = raw(`(
  EXISTS (SELECT 1 FROM jsonb_each(CASE WHEN jsonb_typeof(c.signers_designation) = 'object' THEN c.signers_designation ELSE '{}'::jsonb END) d
    WHERE jsonb_typeof(d.value) = 'object' AND d.value ->> 'evidence_file_id' = f.id::text)
  OR EXISTS (SELECT 1 FROM uc_blockers b WHERE b.case_id = c.id AND jsonb_typeof(b.evidence) = 'object' AND b.evidence ->> 'file_id' = f.id::text)
  OR EXISTS (SELECT 1 FROM uc_gate_reviews g WHERE g.case_id = c.id AND g.written_evidence_file_id = f.id)
)`);

/** Righe oltre la conservazione (alias `f`, `c`): casi chiusi, giorno di Roma, file non cancellato e non prova scritta. */
function retainedWhere(now: Date, workspaceId: string | null | undefined): SqlFragment {
  const ws = workspaceId ? ucSql` AND c.workspace_id = ${cast(uuid(workspaceId, "workspace"), "uuid")}` : raw("");
  return ucSql`f.deleted_at IS NULL AND c.status = 'chiuso'
  AND coalesce(f.retention_until, (coalesce(c.closed_at, c.status_changed_at, c.updated_at) AT TIME ZONE 'Europe/Rome')::date + ${cast(FILE_RETENTION_DAYS, "int")})
    < (${cast(now.toISOString(), "timestamptz")} AT TIME ZONE 'Europe/Rome')::date
  AND NOT ${IS_WRITTEN_PROOF}${ws}`;
}

/** Ogni percorso della riga sta in un archivio configurato (la quarantena è sempre nello standard). */
function reachable(zones: readonly StorageZone[]): SqlFragment {
  return ucSql`(f.blob_path IS NULL OR f.storage_zone = ANY(${cast([...zones], "text[]")}))
  AND (f.quarantine_path IS NULL OR ${cast(zones.includes("standard"), "boolean")})`;
}

/**
 * File da togliere: casi chiusi, conservazione finita (giorno di Roma), file non
 * ancora cancellato e non usato come prova scritta. Con `zones` solo le righe i
 * cui archivi sono configurati: quelle di un archivio tolto non occupano il
 * limite della notte (si contano con `unreachableRetainedFilesSql`).
 */
export function retainedFilesSql(now: Date, o: { limit?: number; workspaceId?: string | null; zones?: readonly StorageZone[] } = {}): UcStatement {
  const limit = Math.max(1, Math.min(Math.trunc(o.limit ?? 500), 2000));
  const zones = o.zones ? ucSql` AND ${reachable(o.zones)}` : raw("");
  return toStatement(ucSql`SELECT f.id, f.workspace_id, f.case_id, f.storage_zone, f.blob_path, f.quarantine_path
FROM uc_files f JOIN uc_cases c ON c.id = f.case_id AND c.workspace_id = f.workspace_id
WHERE ${retainedWhere(now, o.workspaceId)}${zones}
ORDER BY f.created_at, f.id
LIMIT ${cast(limit, "int")}`);
}

/** File oltre la conservazione con un percorso in un archivio non configurato (RUNBOOK §6.2). */
export function unreachableRetainedFilesSql(now: Date, o: { workspaceId?: string | null; zones: readonly StorageZone[] }): UcStatement {
  return toStatement(ucSql`SELECT count(*)::int AS n
FROM uc_files f JOIN uc_cases c ON c.id = f.case_id AND c.workspace_id = f.workspace_id
WHERE ${retainedWhere(now, o.workspaceId)} AND NOT (${reachable(o.zones)})`);
}

/** La riga resta senza percorsi, con l'evento `file.cancellato` (attore: sistema). */
export function expireRetainedFileSql(i: { workspaceId: string; caseId: string; fileId: string; zone: StorageZone }): UcStatement {
  const ev = eventInsertFromSql({
    type: "file.cancellato",
    workspaceId: i.workspaceId,
    caseId: i.caseId,
    actor: { type: "sistema" },
    targetType: "file",
    from: "u",
    targetIdColumn: "u.id",
    payload: { motivo: "conservazione_scaduta", zona: i.zone },
  });
  return toStatement(ucSql`WITH u AS (
  UPDATE uc_files f SET blob_path = NULL, quarantine_path = NULL, preview = NULL, extracted_text = NULL, deleted_at = now(), deletion_reason = 'conservazione_scaduta'
  WHERE f.id = ${cast(uuid(i.fileId, "file"), "uuid")} AND f.case_id = ${cast(uuid(i.caseId, "caso"), "uuid")}
    AND f.workspace_id = ${cast(uuid(i.workspaceId, "workspace"), "uuid")} AND f.deleted_at IS NULL
  RETURNING f.id
), ev AS (${ev})
SELECT count(*)::int AS updated FROM u`);
}

export interface RetentionSummary {
  /** File chiusi (riga senza percorsi). */
  files: number;
  /** Oggetti tolti dagli archivi. */
  objects: number;
  /** File lasciati al giro dopo perché l'archivio non ha risposto. */
  failed: number;
  /** File con un percorso in un archivio non configurato: la pulizia li salta (RUNBOOK §6.2). */
  unreachable: number;
  deferred: boolean;
}

/**
 * Pulizia notturna dei file oltre la conservazione. Prima l'oggetto, poi la
 * riga: se l'archivio non risponde la riga resta com'è e il giro dopo riprova.
 * Le righe di un archivio non configurato (per esempio lo store della zona
 * personale tolto dopo la perdita della chiave) si saltano e si contano a parte,
 * così non tengono ferma la pulizia degli altri file.
 */
export async function expireRetainedFiles(
  executor: UcExecutor,
  env: UcStorageEnv,
  o: { now?: Date; workspaceId?: string | null; limit?: number; timeLeft?: () => boolean } = {},
): Promise<RetentionSummary> {
  const now = o.now ?? new Date();
  const s: RetentionSummary = { files: 0, objects: 0, failed: 0, unreachable: 0, deferred: false };
  const zones = (["standard", "personale"] as const).filter((zone) => storeConfigured(zone, env));
  const [rows, [unreachable]] = await executor.batch([
    retainedFilesSql(now, { limit: o.limit, workspaceId: o.workspaceId, zones }),
    unreachableRetainedFilesSql(now, { workspaceId: o.workspaceId, zones }),
  ]);
  s.unreachable = rowNumber(unreachable?.n) ?? 0;
  for (const r of rows) {
    if (o.timeLeft && !o.timeLeft()) {
      s.deferred = true;
      break;
    }
    const fileId = rowString(r.id);
    const caseId = rowString(r.case_id);
    const workspaceId = rowString(r.workspace_id);
    if (!fileId || !caseId || !workspaceId || !UUID.test(fileId)) continue;
    const zone: StorageZone = rowString(r.storage_zone) === "personale" ? "personale" : "standard";
    const groups: Record<StorageZone, string[]> = { standard: [], personale: [] };
    const blobPath = rowString(r.blob_path);
    const quarantinePath = rowString(r.quarantine_path);
    if (blobPath) groups[zone].push(blobPath);
    if (quarantinePath) groups.standard.push(quarantinePath);
    const count = groups.standard.length + groups.personale.length;
    if (count > 0) {
      const removed = await deleteUcObjects(groups, env);
      if (removed.failed > 0) {
        s.failed++;
        continue;
      }
      s.objects += removed.deleted;
    }
    const [res] = await executor.batch([expireRetainedFileSql({ workspaceId, caseId, fileId, zone })]);
    if ((rowNumber(res[0]?.updated) ?? 0) > 0) s.files++;
  }
  return s;
}

// ── Cancellazione di un caso ──────────────────────────────────────────

/** Tabelle uc con `case_id` (dal DDL), escluso l'audit che sopravvive al caso. */
export const PURGE_CASE_TABLES: readonly string[] = UC_TABLES.filter((t) => t.name !== "uc_events" && t.columns.some((c) => c.name === "case_id")).map((t) => t.name);

/** Tabelle senza `case_id` che dipendono dalle voci del caso. */
const ITEM_TABLES: readonly string[] = ["uc_item_blockers"];

const CONTACT_COLUMN = /(^|_)contact_id$/;
const UUID_SQL = raw("'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'");

/** Colonne che legano un referente a un caso (dal DDL): ogni `*contact_id` del caso e delle sue tabelle, audit escluso. */
export const CASE_CONTACT_COLUMNS: readonly { table: string; column: string }[] = UC_TABLES.filter(
  (t) => t.name !== "uc_events" && (t.name === "uc_cases" || t.columns.some((c) => c.name === "case_id")),
).flatMap((t) => t.columns.filter((c) => CONTACT_COLUMN.test(c.name)).map((c) => ({ table: t.name, column: c.name })));

/**
 * Coppie (caso, referente) dei casi di un workspace: le colonne di
 * `CASE_CONTACT_COLUMNS` e i firmatari designati (`signers_designation`).
 * L'audit non conta: resta per sempre e terrebbe in vita ogni referente.
 * Esportata per «Chiedi al referente» (`src/lib/use-cases/referent/erase.ts`): lo stesso elenco dice
 * se un referente è usato solo dagli use case.
 */
export function contactRefsSql(workspaceId: string): SqlFragment {
  const ws = () => cast(uuid(workspaceId, "workspace"), "uuid");
  const parts: SqlFragment[] = CASE_CONTACT_COLUMNS.map(({ table, column }) =>
    table === "uc_cases"
      ? ucSql`SELECT x.id AS case_id, x.${raw(column)} AS contact_id FROM uc_cases x WHERE x.${raw(column)} IS NOT NULL AND x.workspace_id = ${ws()}`
      : ucSql`SELECT x.case_id, x.${raw(column)} AS contact_id FROM ${raw(table)} x
    WHERE x.${raw(column)} IS NOT NULL AND x.case_id IN (SELECT w.id FROM uc_cases w WHERE w.workspace_id = ${ws()})`,
  );
  parts.push(ucSql`SELECT x.id AS case_id, (d.value ->> 'contact_id')::uuid AS contact_id
    FROM uc_cases x CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(x.signers_designation) = 'object' THEN x.signers_designation ELSE '{}'::jsonb END) d
    WHERE x.workspace_id = ${ws()} AND jsonb_typeof(d.value) = 'object' AND (d.value ->> 'contact_id') ~ ${UUID_SQL}`);
  let body = parts[0];
  for (const p of parts.slice(1)) body = ucSql`${body}
  UNION ALL ${p}`;
  return body;
}

/**
 * Referenti da anonimizzare con la purge del caso: legati al caso (anche solo
 * come attori del suo audit), non ancora anonimizzati e senza legami con altri
 * casi del workspace.
 */
export function orphanContactsSql(workspaceId: string, caseId: string): UcStatement {
  const id = () => cast(uuid(caseId, "caso"), "uuid");
  return toStatement(ucSql`WITH refs AS (
  ${contactRefsSql(workspaceId)}
)
SELECT k.id FROM uc_contacts k
WHERE k.workspace_id = ${cast(uuid(workspaceId, "workspace"), "uuid")} AND k.anonymized_at IS NULL
  AND (k.id IN (SELECT r.contact_id FROM refs r WHERE r.case_id = ${id()})
    OR k.id IN (SELECT e.actor_contact_id FROM uc_events e WHERE e.case_id = ${id()} AND e.actor_contact_id IS NOT NULL))
  AND k.id NOT IN (SELECT r.contact_id FROM refs r WHERE r.case_id <> ${id()})
ORDER BY k.id`);
}

/** Nella transazione della purge: i referenti del piano non hanno preso legami con altri casi. */
function contactsStillOrphanSql(workspaceId: string, caseId: string, contactIds: readonly string[]): UcStatement {
  return toStatement(ucSql`WITH refs AS (
  ${contactRefsSql(workspaceId)}
)
SELECT uc_require(NOT EXISTS (SELECT 1 FROM refs r WHERE r.case_id <> ${cast(uuid(caseId, "caso"), "uuid")}
  AND r.contact_id = ANY(${cast(contactIds.map((c) => uuid(c, "referente")), "uuid[]")})), 'referenti_cambiati') AS ok`);
}

export interface PurgeCasePlan {
  caseId: string;
  workspaceId: string;
  code: string;
  status: string;
  /** Righe per tabella che la cascata cancella (caso compreso). */
  rows: Record<string, number>;
  totalRows: number;
  /** Eventi di audit che restano (senza valori). */
  eventsKept: number;
  /** Percorsi registrati nelle righe dei file, per archivio. */
  objects: Record<StorageZone, string[]>;
  /** Token MCP del caso ancora attivi. */
  activeTokens: number;
  /** Referenti del caso che nessun altro caso usa: la purge li anonimizza. */
  contactsToAnonymize: string[];
}

function countsSql(caseId: string): UcStatement {
  const id = cast(uuid(caseId, "caso"), "uuid");
  const parts: SqlFragment[] = [ucSql`SELECT 'uc_cases' AS t, count(*)::int AS n FROM uc_cases WHERE id = ${id}`];
  for (const table of PURGE_CASE_TABLES) parts.push(ucSql`SELECT ${cast(table, "text")} AS t, count(*)::int AS n FROM ${raw(table)} WHERE case_id = ${id}`);
  for (const table of ITEM_TABLES) {
    parts.push(ucSql`SELECT ${cast(table, "text")} AS t, count(*)::int AS n FROM ${raw(table)} x WHERE x.item_id IN (SELECT i.id FROM uc_items i WHERE i.case_id = ${id})`);
  }
  parts.push(ucSql`SELECT 'uc_events' AS t, count(*)::int AS n FROM uc_events WHERE case_id = ${id}`);
  let body: SqlFragment = parts[0];
  for (const p of parts.slice(1)) body = ucSql`${body}
UNION ALL ${p}`;
  return toStatement(body);
}

function caseRowSql(caseId: string): UcStatement {
  return toStatement(ucSql`SELECT c.id, c.workspace_id, c.code, c.status FROM uc_cases c WHERE c.id = ${cast(uuid(caseId, "caso"), "uuid")}`);
}

function filePathsSql(caseId: string): UcStatement {
  return toStatement(ucSql`SELECT storage_zone, blob_path, quarantine_path FROM uc_files
WHERE case_id = ${cast(uuid(caseId, "caso"), "uuid")} AND (blob_path IS NOT NULL OR quarantine_path IS NOT NULL)`);
}

function activeTokensSql(workspaceId: string, caseId: string): UcStatement {
  return toStatement(ucSql`SELECT count(*)::int AS n FROM workspace_integration_tokens
WHERE workspace_id = ${cast(uuid(workspaceId, "workspace"), "uuid")} AND scopes ? ${cast(caseScopeMarker(caseId), "text")} AND revoked_at IS NULL`);
}

/** Piano della cancellazione, in sola lettura: null se il caso non c'è. */
export async function loadPurgePlan(executor: UcExecutor, caseId: string): Promise<PurgeCasePlan | null> {
  const [[row]] = await executor.batch([caseRowSql(caseId)]);
  if (!row) return null;
  const workspaceId = String(row.workspace_id);
  const [counts, paths, [tokens], orphans] = await executor.batch([
    countsSql(caseId),
    filePathsSql(caseId),
    activeTokensSql(workspaceId, caseId),
    orphanContactsSql(workspaceId, caseId),
  ]);
  const rows: Record<string, number> = {};
  let eventsKept = 0;
  for (const c of counts) {
    const table = String(c.t);
    const n = rowNumber(c.n) ?? 0;
    if (table === "uc_events") eventsKept = n;
    else rows[table] = n;
  }
  const objects: Record<StorageZone, string[]> = { standard: [], personale: [] };
  for (const p of paths) {
    const zone: StorageZone = rowString(p.storage_zone) === "personale" ? "personale" : "standard";
    const blob = rowString(p.blob_path);
    const quarantine = rowString(p.quarantine_path);
    if (blob && pathBelongsToZone(blob, zone)) objects[zone].push(blob);
    if (quarantine && pathBelongsToZone(quarantine, "standard")) objects.standard.push(quarantine);
  }
  return {
    caseId: String(row.id),
    workspaceId,
    code: String(row.code),
    status: String(row.status),
    rows,
    totalRows: Object.values(rows).reduce((a, b) => a + b, 0),
    eventsKept,
    objects,
    activeTokens: rowNumber(tokens?.n) ?? 0,
    contactsToAnonymize: orphans.map((r) => rowString(r.id)).filter((id): id is string => !!id && UUID.test(id)),
  };
}

/** Prefissi d'archivio del caso: `uc/q|s/<ws>/<caso>/` nello standard, `uc/p/<ws>/<caso>/` nella zona personale. */
export function casePrefixes(workspaceId: string, caseId: string): Record<StorageZone, string[]> {
  const ws = uuid(workspaceId, "workspace");
  const id = uuid(caseId, "caso");
  return { standard: [`uc/q/${ws}/${id}/`, `uc/s/${ws}/${id}/`], personale: [`uc/p/${ws}/${id}/`] };
}

export type PurgeCaseResult =
  | {
      ok: true;
      rowsDeleted: number;
      objectsDeleted: number;
      tokensRevoked: number;
      contactsAnonymized: number;
      remaining: Record<string, number>;
      eventsKept: number;
    }
  | { ok: false; code: "archivio" | "caso_cambiato" | "referenti_cambiati"; message: string; objectsDeleted: number };

/**
 * Cancella il caso del piano. Prima gli oggetti (registrati nelle righe e
 * trovati sotto i prefissi del caso, nei due archivi); se un archivio non
 * risponde si ferma senza toccare il database, così si può rilanciare. Poi, in
 * una sola transazione: revoca i token MCP del caso; cancella il caso, e la
 * cascata porta via tutte le tabelle uc del caso, comprese le richieste e i link
 * dei referenti; anonimizza i referenti del piano che ancora nessun altro caso
 * usa (come «Anonimizza» in Persone) e annulla la loro coda.
 */
export async function purgeCase(executor: UcExecutor, plan: PurgeCasePlan, env: UcStorageEnv): Promise<PurgeCaseResult> {
  const groups: Record<StorageZone, Set<string>> = { standard: new Set(plan.objects.standard), personale: new Set(plan.objects.personale) };
  const prefixes = casePrefixes(plan.workspaceId, plan.caseId);
  for (const zone of ["standard", "personale"] as const) {
    const store = ucStore(zone, env);
    if (!store) {
      if (groups[zone].size > 0) return { ok: false, code: "archivio", message: `Archivio ${zone} non configurato: i file del caso non si possono togliere.`, objectsDeleted: 0 };
      continue;
    }
    for (const prefix of prefixes[zone]) {
      for (const o of await store.list(prefix, 10_000)) groups[zone].add(o.path);
    }
  }
  const removed = await deleteUcObjects({ standard: [...groups.standard], personale: [...groups.personale] }, env);
  if (removed.failed > 0) {
    return { ok: false, code: "archivio", message: "Un archivio non ha risposto: nessuna riga cancellata, rilancia il comando.", objectsDeleted: removed.deleted };
  }

  const id = cast(uuid(plan.caseId, "caso"), "uuid");
  const ws = cast(uuid(plan.workspaceId, "workspace"), "uuid");
  const contacts: UcStatement[] =
    plan.contactsToAnonymize.length === 0
      ? []
      : [
          contactsStillOrphanSql(plan.workspaceId, plan.caseId, plan.contactsToAnonymize),
          ...plan.contactsToAnonymize.flatMap((contactId) => [contactAnonymizeSql({ workspaceId: plan.workspaceId, contactId }), contactNotificationsCancelSql(contactId)]),
        ];
  // Una transazione: se il caso non c'è più (o ha cambiato codice), o un referente del piano ha
  // preso legami con un altro caso, anche la revoca dei token e l'anonimizzazione si annullano.
  const run = await runUcBatch(executor, [
    toStatement(ucSql`UPDATE workspace_integration_tokens SET revoked_at = now() AT TIME ZONE 'UTC', updated_at = now() AT TIME ZONE 'UTC'
WHERE workspace_id = ${ws} AND scopes ? ${cast(caseScopeMarker(plan.caseId), "text")} AND revoked_at IS NULL
RETURNING id`),
    toStatement(requireRows(ucSql`DELETE FROM uc_cases WHERE id = ${id} AND workspace_id = ${ws} AND code = ${cast(plan.code, "text")} RETURNING id`, 1, "caso_cambiato")),
    ...contacts,
  ]);
  if (!run.ok) {
    return run.code === "caso_cambiato"
      ? { ok: false, code: "caso_cambiato", message: "Il caso non c'è più o ha cambiato codice: nessuna riga cancellata.", objectsDeleted: removed.deleted }
      : { ok: false, code: "referenti_cambiati", message: "I referenti del caso sono cambiati dopo il piano: nessuna riga cancellata, rilancia il comando.", objectsDeleted: removed.deleted };
  }
  const revoked = run.rows[0];

  const [counts] = await executor.batch([countsSql(plan.caseId)]);
  const remaining: Record<string, number> = {};
  let eventsKept = 0;
  for (const c of counts) {
    const n = rowNumber(c.n) ?? 0;
    if (String(c.t) === "uc_events") eventsKept = n;
    else if (n > 0) remaining[String(c.t)] = n;
  }
  return {
    ok: true,
    rowsDeleted: plan.totalRows,
    objectsDeleted: removed.deleted,
    tokensRevoked: revoked.length,
    contactsAnonymized: plan.contactsToAnonymize.length,
    remaining,
    eventsKept,
  };
}

// ── Anonimizzazione di un referente da operatore ──────────────────────

const OPERATOR_ANONYMIZE_MESSAGES: Readonly<Record<string, string>> = {
  richieste_aperte: "Il referente ha richieste ancora aperte: prima «Revoca» o «Revoca tutti i link» nel caso.",
  firmatario_designato: "Il referente è firmatario designato di un caso non chiuso: prima cambia la designazione.",
  conflitto: "Referente non trovato nel workspace del caso, oppure già anonimizzato.",
};

/**
 * `uc-case-admin anonymize-contact`: anonimizza un referente del workspace del
 * caso per una richiesta dell'interessato quando «Anonimizza» in Persone non si
 * può usare (la pagina vuole un caso aperto). Stesse regole e stesse istruzioni
 * della pagina: niente richieste aperte, non firmatario designato di un caso
 * non chiuso; il nome diventa l'etichetta del ruolo, email, telefono e account
 * si tolgono, i suoi link si revocano e la sua coda si annulla.
 */
export async function anonymizeContactAsOperator(
  executor: UcExecutor,
  i: { caseId: string; contactId: string },
): Promise<{ ok: true; workspaceId: string } | { ok: false; code: string; message: string }> {
  const [[row]] = await executor.batch([caseRowSql(i.caseId)]);
  if (!row) return { ok: false, code: "caso_non_trovato", message: "Caso non trovato in questo database." };
  const workspaceId = String(row.workspace_id);
  const contactId = uuid(i.contactId, "referente");
  const run = await runUcBatch(executor, [
    contactHasNoOpenRequestsSql(contactId),
    contactNotDesignatedSql(workspaceId, contactId),
    contactAnonymizeSql({ workspaceId, contactId }),
    contactTokensRevokeSql(contactId),
    contactNotificationsCancelSql(contactId),
  ]);
  if (run.ok) return { ok: true, workspaceId };
  return { ok: false, code: run.code, message: OPERATOR_ANONYMIZE_MESSAGES[run.code] ?? run.message };
}

// ── File di uno store della zona personale tolto ──────────────────────

/** Casi con file della zona personale che hanno ancora un percorso. */
function personalFileCasesSql(): UcStatement {
  return toStatement(ucSql`SELECT f.workspace_id, f.case_id, count(*)::int AS n FROM uc_files f
WHERE f.storage_zone = 'personale' AND f.deleted_at IS NULL AND f.blob_path IS NOT NULL
GROUP BY f.workspace_id, f.case_id
ORDER BY f.workspace_id, f.case_id`);
}

/** I file personali del caso restano senza percorso, con `file.cancellato` motivo `archivio_rimosso` (attore: sistema). */
function forgetPersonalFilesSql(i: { workspaceId: string; caseId: string }): UcStatement {
  const ev = eventInsertFromSql({
    type: "file.cancellato",
    workspaceId: i.workspaceId,
    caseId: i.caseId,
    actor: { type: "sistema" },
    targetType: "file",
    from: "u",
    targetIdColumn: "u.id",
    payload: { motivo: "archivio_rimosso", zona: "personale" },
  });
  return toStatement(ucSql`WITH u AS (
  UPDATE uc_files f SET blob_path = NULL, preview = NULL, extracted_text = NULL, deleted_at = now(), deletion_reason = 'archivio_rimosso'
  WHERE f.case_id = ${cast(uuid(i.caseId, "caso"), "uuid")} AND f.workspace_id = ${cast(uuid(i.workspaceId, "workspace"), "uuid")}
    AND f.storage_zone = 'personale' AND f.deleted_at IS NULL AND f.blob_path IS NOT NULL
  RETURNING f.id
), ev AS (${ev})
SELECT count(*)::int AS updated FROM u`);
}

export interface PersonalFilesPlan {
  cases: { workspaceId: string; caseId: string; files: number }[];
  files: number;
}

/** Piano di `uc-case-admin forget-personal-files`, in sola lettura. */
export async function loadPersonalFilesPlan(executor: UcExecutor): Promise<PersonalFilesPlan> {
  const [rows] = await executor.batch([personalFileCasesSql()]);
  const cases = rows
    .map((r) => ({ workspaceId: rowString(r.workspace_id) ?? "", caseId: rowString(r.case_id) ?? "", files: rowNumber(r.n) ?? 0 }))
    .filter((c) => UUID.test(c.workspaceId) && UUID.test(c.caseId));
  return { cases, files: cases.reduce((a, c) => a + c.files, 0) };
}

/**
 * Dopo la perdita della chiave della zona personale e la cancellazione del suo
 * store (RUNBOOK §6.2): le righe dei file personali non hanno più un oggetto.
 * In una transazione restano senza percorso, cancellate con `archivio_rimosso`,
 * così la pulizia notturna non le conta più e `purge-case` non chiede lo store.
 * Il chiamante si accerta prima che lo store non sia configurato.
 */
export async function forgetPersonalFiles(executor: UcExecutor, plan: PersonalFilesPlan): Promise<number> {
  if (plan.cases.length === 0) return 0;
  const rows = await executor.batch(plan.cases.map((c) => forgetPersonalFilesSql(c)));
  return rows.reduce((a, r) => a + (rowNumber(r[0]?.updated) ?? 0), 0);
}
