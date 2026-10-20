/**
 * Import dei casi di prova in `uc_test_cases` (PIANO §3.11, §5.1 «Prova sul
 * passato», WP12b). Un solo batch:
 *
 * 1. guardie con `uc_require`: caso del workspace, completo e non chiuso;
 *    l'attore è ancora ls_lead del caso; con casi `pseudonimizzato`, il blocco
 *    `a8` è ancora sciolto (una riattivazione concorrente annulla tutto);
 * 2. upsert su `(case_id, key)`: le righe nuove si inseriscono; una riga già
 *    presente si aggiorna solo se il contenuto cambia, e allora esito, ultima
 *    esecuzione e approvazione del cliente si azzerano (valevano per il testo
 *    di prima); le righe uguali restano come sono;
 * 3. nella stessa istruzione l'evento `casi_prova.importati` con i soli
 *    conteggi (nuovi, aggiornati, invariati) e il formato: mai i testi.
 *
 * L'import non tocca il catalogo: niente `catalog_revision` né prontezza.
 * Modulo puro: solo costruttori `{ text, params }`.
 */
import { eventInsertFromSql, type EventActor } from "../../db/queries/uc-events.ts";
import type { TestCaseRow } from "../test-cases.ts";
import { cast, jsonb, toStatement, ucSql, type UcStatement } from "./statement.ts";

export interface TestCasesImportInput {
  workspaceId: string;
  caseId: string;
  actorUserId: string;
  rows: readonly TestCaseRow[];
  format: "json" | "csv";
}

/** Righe per `jsonb_to_recordset`, nell'ordine del file. */
function recordset(rows: readonly TestCaseRow[]) {
  return rows.map((r) => ({ key: r.key, kind: r.kind, input: r.input, expected: r.expected, covers: r.covers, serve_per: r.serve_per }));
}

export function testCasesImportStatements(i: TestCasesImportInput): UcStatement[] {
  if (i.rows.length === 0) throw new Error("Nessun caso di prova da importare");
  const ws = cast(i.workspaceId, "uuid");
  const c = cast(i.caseId, "uuid");
  const user = cast(i.actorUserId, "uuid");
  const statements: UcStatement[] = [
    toStatement(ucSql`SELECT uc_require(EXISTS (
  SELECT 1 FROM uc_cases WHERE id = ${c} AND workspace_id = ${ws} AND setup_completed_at IS NOT NULL AND status <> 'chiuso'
), 'caso_chiuso') AS ok`),
    toStatement(ucSql`SELECT uc_require(EXISTS (
  SELECT 1 FROM uc_case_members WHERE case_id = ${c} AND user_id = ${user} AND role = 'ls_lead'
), 'attore_non_ammesso') AS ok`),
  ];
  if (i.rows.some((r) => r.kind === "pseudonimizzato")) {
    statements.push(
      toStatement(ucSql`SELECT uc_require(EXISTS (
  SELECT 1 FROM uc_blockers WHERE case_id = ${c} AND key = 'a8' AND status = 'sciolto'
), 'a8_non_sciolto') AS ok`),
    );
  }
  const actor: EventActor = { type: "utente", userId: i.actorUserId };
  const event = eventInsertFromSql({
    type: "casi_prova.importati",
    workspaceId: i.workspaceId,
    caseId: i.caseId,
    actor,
    targetType: "caso",
    from: "s",
    targetIdColumn: "s.case_id",
    payload: { count: i.rows.length, format: i.format },
    rowPayload: { counts: "s.counts" },
  });
  statements.push(
    toStatement(ucSql`WITH incoming AS (
  SELECT r.key, r.kind, r.input, r.expected, r.covers, r.serve_per
  FROM jsonb_to_recordset(${jsonb(recordset(i.rows))}) AS r(key text, kind text, input jsonb, expected jsonb, covers jsonb, serve_per jsonb)
), up AS (
  INSERT INTO uc_test_cases AS t (case_id, key, kind, input, expected, covers, serve_per, created_by_user_id)
  SELECT ${c}, incoming.key, incoming.kind, incoming.input, incoming.expected, incoming.covers, incoming.serve_per, ${user} FROM incoming
  ON CONFLICT (case_id, key) DO UPDATE SET
    kind = EXCLUDED.kind, input = EXCLUDED.input, expected = EXCLUDED.expected, covers = EXCLUDED.covers, serve_per = EXCLUDED.serve_per,
    last_result = 'non_eseguito', last_run_id = NULL, approved_by_contact_id = NULL, approved_at = NULL, updated_at = now()
  WHERE (t.kind, t.input, t.expected, t.covers, t.serve_per) IS DISTINCT FROM (EXCLUDED.kind, EXCLUDED.input, EXCLUDED.expected, EXCLUDED.covers, EXCLUDED.serve_per)
  RETURNING (t.xmax = 0) AS inserted
), s AS (
  SELECT ${c} AS case_id,
    count(*) FILTER (WHERE inserted)::int AS inserted,
    count(*) FILTER (WHERE NOT inserted)::int AS updated,
    jsonb_build_object(
      'nuovi', count(*) FILTER (WHERE inserted),
      'aggiornati', count(*) FILTER (WHERE NOT inserted),
      'invariati', ${cast(i.rows.length, "int")} - count(*)
    ) AS counts
  FROM up
), ev AS (
  ${event}
)
SELECT s.inserted, s.updated FROM s`),
  );
  return statements;
}

/** Esito dell'ultima istruzione del batch. */
export function testCasesImportSummary(rows: readonly Record<string, unknown>[] | undefined, total: number): { total: number; inserted: number; updated: number; unchanged: number } {
  const row = rows?.[0] ?? {};
  const inserted = Number(row.inserted ?? 0) || 0;
  const updated = Number(row.updated ?? 0) || 0;
  return { total, inserted, updated, unchanged: Math.max(0, total - inserted - updated) };
}
