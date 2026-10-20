/**
 * Dati della testata del dossier (DESIGN §3.3), in un solo giro: un batch con
 * i campi del caso, la prontezza in cache (`uc_cases.readiness`), id, codice e
 * titolo della scheda madre (`use_cases`, via `portfolio_use_case_id`), il
 * prossimo passo e le firme in attesa di chi guarda.
 *
 * La testata legge la prontezza in cache: la cache si aggiorna dopo ogni
 * comando, dopo le risposte dei referenti e ogni notte. Dopo un comando però
 * si ricalcola in `after()`, cioè dopo la risposta che ridisegna questa
 * testata, e un layout non si riesegue nelle navigazioni interne: se la cache
 * è indietro rispetto a `catalog_revision` (o manca), la testata calcola la
 * prontezza dal vivo, con un giro in più solo allora.
 *
 * Il codice della scheda madre si legge con `to_jsonb(u) ->> 'code'`: sui rami
 * senza la colonna `use_cases.code` (prima della 0019) vale NULL e la query non
 * si rompe; la testata mostra allora il titolo della scheda.
 *
 * I ruoli arrivano dal controllo d'accesso, già fatto dal chiamante; le pagine
 * leggono queste righe insieme alla riga dell'accesso (`uc-dossier-base.ts`).
 * Modulo senza import dell'app, come `uc-cases.ts`.
 */
import type { Readiness } from "../../uc/semaforo.ts";
import { rowNumber, rowString, rowVocab } from "../../uc/sql/readiness.ts";
import { cast, toStatement, ucSql, type UcStatement } from "../../uc/sql/statement.ts";
import type { NextStepInput } from "../../uc/views/next-step.ts";
import { CASE_STATUSES, type CaseRole, type CaseStatus } from "../../uc/vocab.ts";
import type { UcExecutor, UcRow } from "../uc-executor.ts";
import { loadCaseReadiness } from "./uc-cases.ts";
import { lowerId, nextStepStatements, parseNextStepRows } from "./uc-next-step.ts";
import type { CaseSignature } from "./uc-signatures.ts";
import { UUID } from "../../uc/ids.ts";

export interface CaseHeaderData {
  case: {
    id: string;
    /** Il codice del dossier: si mostra quello della scheda madre, questo resta per i dettagli tecnici. */
    code: string;
    title: string;
    oneLiner: string | null;
    status: CaseStatus;
    statusBeforeSuspension: CaseStatus | null;
    catalogVersion: number;
  };
  /** La scheda madre; `code` è null senza la colonna o senza codice assegnato. */
  parent: { id: string; code: string | null; title: string } | null;
  /** Indispensabili a posto (dalla cache) e in verifica; null se la cache manca. */
  progress: { ok: number; required: number; inReview: number } | null;
  readiness: Readiness | null;
  nextStep: NextStepInput;
  /** Firme in attesa di chi guarda. */
  signatures: CaseSignature[];
}

/** Caso e scheda madre, nel workspace. */
export function caseHeaderSql(workspaceId: string, caseId: string): UcStatement {
  return toStatement(ucSql`SELECT c.id, c.code, c.title, c.one_liner, c.status, c.status_before_suspension, c.catalog_version,
  u.id AS parent_id, to_jsonb(u) ->> 'code' AS parent_code, u.title AS parent_title
FROM uc_cases c
LEFT JOIN use_cases u ON u.id = c.portfolio_use_case_id AND u.workspace_id = c.workspace_id
WHERE c.id = ${cast(caseId, "uuid")} AND c.workspace_id = ${cast(workspaceId, "uuid")} AND c.setup_completed_at IS NOT NULL`);
}

/** Le istruzioni della testata, per un batch (anche insieme all'accesso, `uc-dossier-base.ts`). Id già controllati. */
export function caseHeaderStatements(i: { workspaceId: string; caseId: string; userId: string }): UcStatement[] {
  // Un URL con l'uuid in maiuscolo apre lo stesso dossier: gli id si confrontano come li scrive Postgres.
  const [workspaceId, caseId, userId] = [lowerId(i.workspaceId), lowerId(i.caseId), lowerId(i.userId)];
  return [caseHeaderSql(workspaceId, caseId), ...nextStepStatements({ workspaceId, caseIds: [caseId], userId })];
}

/**
 * La testata per chi guarda, in un solo giro (un batch: una richiesta, una
 * transazione), due se la cache della prontezza è indietro. Null se il
 * dossier non c'è o non è di questo workspace.
 */
export async function loadCaseHeader(
  executor: UcExecutor,
  i: { workspaceId: string; caseId: string; userId: string; roles: readonly CaseRole[]; now?: Date },
): Promise<CaseHeaderData | null> {
  if (!UUID.test(i.workspaceId) || !UUID.test(i.caseId) || !UUID.test(i.userId)) return null;
  return caseHeaderFromRows(executor, await executor.batch(caseHeaderStatements(i)), i);
}

/**
 * La testata dalle righe di `caseHeaderStatements`. Con la cache della
 * prontezza indietro, un giro in più per la prontezza dal vivo.
 */
export async function caseHeaderFromRows(
  executor: UcExecutor,
  rows: UcRow[][],
  i: { workspaceId: string; caseId: string; roles: readonly CaseRole[]; now?: Date },
): Promise<CaseHeaderData | null> {
  const now = i.now ?? new Date();
  const [workspaceId, caseId] = [lowerId(i.workspaceId), lowerId(i.caseId)];
  const [head, ...rest] = rows;
  const row = head?.[0];
  const status = row ? rowVocab(CASE_STATUSES, row.status) : null;
  if (!row || !status) return null;
  const parse = (live?: Readiness) =>
    parseNextStepRows(rest, { caseIds: [caseId], rolesByCase: new Map([[caseId, i.roles]]), now, liveReadiness: live ? new Map([[caseId, live]]) : undefined }).get(caseId);
  let read = parse();
  if (!read) return null;
  if (read.stale) {
    // Il comando appena fatto ha cambiato il catalogo e la cache non c'è ancora: avanzamento, via pronto e riconferma dal vivo.
    const live = await loadCaseReadiness(executor, workspaceId, caseId, now);
    if (live) read = parse(live.readiness) ?? read;
  }
  const parentId = rowString(row.parent_id);
  const g1 = read.input.g1;
  return {
    case: {
      id: String(row.id),
      code: String(row.code),
      title: String(row.title),
      oneLiner: rowString(row.one_liner),
      status,
      statusBeforeSuspension: rowVocab(CASE_STATUSES, row.status_before_suspension),
      catalogVersion: rowNumber(row.catalog_version) ?? 0,
    },
    parent: parentId ? { id: parentId, code: rowString(row.parent_code)?.trim() || null, title: rowString(row.parent_title) ?? "" } : null,
    progress: read.readiness ? { ok: g1.ok, required: g1.required, inReview: g1.byGroup.da_verificare ?? 0 } : null,
    readiness: read.readiness,
    nextStep: read.input,
    signatures: read.signatures,
  };
}
