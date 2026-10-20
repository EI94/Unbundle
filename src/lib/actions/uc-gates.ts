"use server";

import type { Session } from "@/lib/auth";
import { requireWorkspaceAccess } from "@/lib/auth/require-workspace";
import { proposeGate, reactivateBlocker, rejectGate, resolveBlocker, signGate, type ResolveBlockerResult, type SignGateResult } from "@/lib/db/queries/uc-gates";
import type { Result } from "@/lib/uc/types";
import { viaFailureMessage, type ViaCommand } from "@/lib/uc/views/progress";
import type { CaseRole } from "@/lib/uc/vocab";
import type { WorkspaceAccess } from "@/lib/workspace-access";
import { finishUcCommand, fromResult, openUcCase, type OpenedUcCase, type UcActionResult } from "./uc-action-context";

/**
 * Server action su via allo sviluppo e blocchi (PIANO §5.3, `uc-gates.ts`):
 * proposta e firme del via con il congelamento del catalogo, scioglimento dei
 * blocchi con le firme (per la scheda privacy due) e riattivazione. Prima
 * `requireWorkspaceAccess(workspaceId)`, poi i ruoli di caso, poi il comando in
 * `queries/uc-gates.ts`.
 *
 * Le risposte di proposta, firma e rifiuto arrivano anche al responsabile del
 * cliente: i loro messaggi parlano di «via allo sviluppo» (DESIGN §2.6), mai di
 * gate, G1 o «Owner».
 */

/** L'esito di un'action del via con il messaggio nelle parole di §2.6 (`viaFailureMessage`). */
function viaMessage<T>(command: ViaCommand, result: UcActionResult<T>): UcActionResult<T> {
  return result.ok ? result : { ...result, message: viaFailureMessage(command, result) };
}

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

/** «Proponi il via allo sviluppo» (responsabile Lateral Space, via pronto). */
export async function proposeGateAction(
  workspaceId: string,
  caseId: string,
  input: unknown,
): Promise<UcActionResult<{ reviewId: string; summaryTextHash: string; ownerDesignated: boolean }>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  return viaMessage("proponi", await onCase({ session, access }, workspaceId, caseId, ["ls_lead"], (o) => proposeGate(o.executor, o.ctx, input)));
}

/** Firma della proposta (responsabile del cliente da account; Lateral Space se manca la sua firma). */
export async function signGateAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<SignGateResult>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  return viaMessage("firma", await onCase({ session, access }, workspaceId, caseId, ["ls_lead", "owner_cliente"], (o) => signGate(o.executor, o.ctx, input)));
}

/** «Non approvo» del cliente o proposta ritirata da Lateral Space, con il motivo. */
export async function rejectGateAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<{ reviewId: string }>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  return viaMessage("rifiuta", await onCase({ session, access }, workspaceId, caseId, ["ls_lead", "owner_cliente"], (o) => rejectGate(o.executor, o.ctx, input)));
}

/** Scioglimento di un blocco con prove e firme; con lo scioglimento le domande si sbloccano da sole. */
export async function resolveBlockerAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<ResolveBlockerResult>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  return onCase({ session, access }, workspaceId, caseId, ["ls_lead", "approvatore_privacy"], (o) => resolveBlocker(o.executor, o.ctx, input));
}

/** Riattivazione di un blocco sciolto (le domande tornano bloccate). */
export async function reactivateBlockerAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<{ blockerId: string; blockedItems: number }>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  return onCase({ session, access }, workspaceId, caseId, ["ls_lead"], (o) => reactivateBlocker(o.executor, o.ctx, input));
}
