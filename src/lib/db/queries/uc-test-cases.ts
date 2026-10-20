/**
 * Import dei casi di prova da file (PIANO §3.11, §5.1 «Prova sul passato», WP12b).
 *
 * `importTestCases` legge e valida il file (`parseTestCases` con la scansione
 * del testo `caso_prova`), poi un batch con le guardie `uc_require`, l'upsert in
 * `uc_test_cases` e l'evento `casi_prova.importati` (`sql/test-cases.ts`).
 *
 * Modulo senza import dell'app (`@/…`, `server-only`), come `uc-cases.ts`:
 * l'esecutore arriva da fuori; l'accesso al workspace e al caso lo controlla il
 * chiamante (route handler: `requireWorkspaceAccess` e `openUcCase`).
 */
import { testCasesImportStatements, testCasesImportSummary } from "../../uc/sql/test-cases.ts";
import { cast, toStatement, ucSql } from "../../uc/sql/statement.ts";
import { parseTestCases, type TestCaseIssue } from "../../uc/test-cases.ts";
import { scanText } from "../../uc/text/scan.ts";
import { fail, ok } from "../../uc/types.ts";
import { actorRoles, actorUserId, isUuid, runCommand, type UcCommandContext } from "./uc-cases.ts";
import type { UcExecutor } from "../uc-executor.ts";

const CASE_NOT_FOUND = "Caso non trovato.";

export const TEST_CASES_MESSAGES: Readonly<Record<string, string>> = {
  caso_chiuso: "Il caso è chiuso: non si modifica più.",
  attore_non_ammesso: "I casi di prova li importa solo il Responsabile del caso.",
  a8_non_sciolto: "I casi pseudonimizzati si caricano solo dopo l'approvazione della scheda A.8.",
  conflitto: "Qualcuno ha appena importato gli stessi casi di prova. Aggiorna la pagina e riprova.",
};

export interface ImportTestCasesSummary {
  total: number;
  inserted: number;
  updated: number;
  unchanged: number;
  /** Avvisi della scansione: riga, campo e categoria, mai il testo. */
  warnings: TestCaseIssue[];
}

export type ImportTestCasesResult =
  | { ok: true; value: ImportTestCasesSummary }
  | { ok: false; code: string; message: string; errors?: TestCaseIssue[] };

/**
 * Import da file (solo ls_lead, caso non chiuso). Il file si legge tutto prima
 * di scrivere: o entrano tutte le righe valide, o nessuna. Errori e avvisi
 * riportano riga, campo e categoria, mai il testo del caso.
 */
export async function importTestCases(executor: UcExecutor, ctx: UcCommandContext, i: { text: string; format?: "json" | "csv" }): Promise<ImportTestCasesResult> {
  const userId = actorUserId(ctx);
  if (!userId || !actorRoles(ctx).includes("ls_lead")) return fail("attore_non_ammesso", TEST_CASES_MESSAGES.attore_non_ammesso);
  if (!isUuid(ctx.workspaceId) || !isUuid(ctx.caseId)) return fail("non_trovato", CASE_NOT_FOUND);
  const c = cast(ctx.caseId, "uuid");
  const [caseRows, a8Rows, keyRows] = await executor.batch([
    toStatement(ucSql`SELECT status FROM uc_cases WHERE id = ${c} AND workspace_id = ${cast(ctx.workspaceId, "uuid")} AND setup_completed_at IS NOT NULL`),
    toStatement(ucSql`SELECT status FROM uc_blockers WHERE case_id = ${c} AND key = 'a8'`),
    toStatement(ucSql`SELECT key FROM uc_items WHERE case_id = ${c} AND deleted_at IS NULL`),
  ]);
  const caseStatus = caseRows[0]?.status;
  if (typeof caseStatus !== "string") return fail("non_trovato", CASE_NOT_FOUND);
  if (caseStatus === "chiuso") return fail("caso_chiuso", TEST_CASES_MESSAGES.caso_chiuso);
  const a8Resolved = a8Rows[0]?.status === "sciolto";
  const knownItemKeys = new Set(keyRows.map((r) => String(r.key)));

  const parsed = parseTestCases(i.text, {
    ...(i.format ? { format: i.format } : {}),
    a8Resolved,
    scan: (text, opts) => scanText(text, opts),
    knownItemKeys,
  });
  if (!parsed.ok) return { ok: false, code: parsed.code, message: parsed.message, errors: parsed.errors };

  const format = i.format ?? (/^﻿?\s*[[{]/.test(i.text) ? "json" : "csv");
  const run = await runCommand(
    executor,
    testCasesImportStatements({ workspaceId: ctx.workspaceId, caseId: ctx.caseId, actorUserId: userId, rows: parsed.value, format }),
    TEST_CASES_MESSAGES,
  );
  if (!run.ok) return run;
  const summary = testCasesImportSummary(run.value[run.value.length - 1], parsed.value.length);
  return ok({ ...summary, warnings: parsed.warnings });
}
