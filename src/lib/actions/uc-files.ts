"use server";

import type { Session } from "@/lib/auth";
import { requireWorkspaceAccess } from "@/lib/auth/require-workspace";
import { createDataset, deleteCaseFile, reviewQuarantinedFile, validateDataset } from "@/lib/db/queries/uc-files";
import type { Result } from "@/lib/uc/types";
import type { CaseRole } from "@/lib/uc/vocab";
import type { WorkspaceAccess } from "@/lib/workspace-access";
import { finishUcCommand, fromResult, openUcCase, type OpenedUcCase, type UcActionResult } from "./uc-action-context";

/**
 * Server action sui file e sui dataset dei casi d'uso (PIANO §5.3, §6):
 * revisione manuale dei PDF in quarantena, cancellazione, schede dataset e
 * loro verifica. Il caricamento non passa da qui (limite di 1 MB delle server
 * action): è nei route handler `…/casi-duso/[caseId]/files/upload*`.
 *
 * Prima `requireWorkspaceAccess(workspaceId)`, poi i ruoli di caso, poi il
 * comando in `queries/uc-files.ts`, che ricontrolla chi è Lateral Space e i
 * quattro occhi (chi ha caricato non rivede né valida).
 */

async function onCase<T>(
  guard: { session: Session; access: WorkspaceAccess },
  workspaceId: string,
  caseId: string,
  allow: readonly CaseRole[],
  command: (o: OpenedUcCase) => Promise<Result<T>>,
): Promise<UcActionResult<T>> {
  const opened = await openUcCase({ ...guard, workspaceId, caseId, allow });
  if (!opened.ok) return opened.result;
  const result = await command(opened.value);
  if (result.ok) finishUcCommand({ workspaceId, caseId });
  return fromResult(result);
}

/** Revisione di un PDF in quarantena: «È pulito» o «Rifiuta» (Lateral Space, non chi l'ha caricato). */
export async function reviewQuarantinedFileAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<{ fileId: string; outcome: "pulito" | "rifiutato" }>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  return onCase({ session, access }, workspaceId, caseId, ["ls_lead", "ls_analista"], (o) => reviewQuarantinedFile(o.executor, o.ctx, input, process.env));
}

/** Cancella un file del caso (Responsabile del caso), salvo le prove usate dal caso. */
export async function deleteFileAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<{ fileId: string }>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  return onCase({ session, access }, workspaceId, caseId, ["ls_lead"], (o) => deleteCaseFile(o.executor, o.ctx, input, process.env));
}

/** Crea la scheda dataset da un CSV o XLSX utilizzabile: periodo, estrazione, titolare dei dati. */
export async function createDatasetAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<{ datasetId: string; version: number; rows: number }>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  return onCase({ session, access }, workspaceId, caseId, ["ls_lead", "ls_analista"], (o) => createDataset(o.executor, o.ctx, input, process.env));
}

/** Verifica della scheda dataset: «Valida» o «Rifiuta» (Lateral Space, non chi ha caricato il file). */
export async function validateDatasetAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<{ datasetId: string; status: "validato" | "rifiutato" }>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  return onCase({ session, access }, workspaceId, caseId, ["ls_lead", "ls_analista"], (o) => validateDataset(o.executor, o.ctx, input));
}
