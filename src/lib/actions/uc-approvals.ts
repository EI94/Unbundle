"use server";

import { decideCaseApproval, loadCaseApprovals, type CaseApprovalDecision } from "@/lib/db/queries/uc-approvals";
import { APPROVAL_SIGNER_ROLES, type ApprovalStep } from "@/lib/uc/views/approvals";
import { requireWorkspaceAccess } from "@/lib/auth/require-workspace";
import { finishUcCommand, fromResult, openUcCase, ucFailure, type UcActionResult } from "./uc-action-context";

/**
 * Firme dalla pagina `/firme` del dossier (DESIGN §3.11, WP9). Il corpo è lo
 * stesso del link di approvazione (`{kind, target_id, decision, read: true,
 * text_hash, reason?}`): il server ricontrolla il testo letto e poi firma con i
 * comandi delle action di oggi (`signGateAction`, `signNaAction`,
 * `signWaiverAction`, `signFallbackAction`, `resolveBlockerAction`,
 * `signPersonalZoneAccessAction`, e per «Non approvo» `rejectNaAction` e
 * `rejectGateAction`), con gli stessi ruoli ammessi per ogni decisione
 * (`APPROVAL_DECISION_ROLES`).
 */
export async function decideApprovalAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<CaseApprovalDecision>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  const opened = await openUcCase({ session, access, workspaceId, caseId, allow: APPROVAL_SIGNER_ROLES });
  if (!opened.ok) return opened.result;
  const result = await decideCaseApproval(opened.value.executor, opened.value.ctx, input);
  if (result.ok) finishUcCommand({ workspaceId, caseId });
  return fromResult(result);
}

/**
 * Le firme in attesa di chi guarda, rilette da `/firme` dopo «testo cambiato»
 * o «non aspetta più», come `refresh()` sul link: il passo aperto riprende il
 * testo di adesso con la sua impronta, e la decisione presa altrove esce
 * dall'elenco. Stessi ruoli e stessa lettura della pagina; in pausa o a caso
 * chiuso non c'è nulla da firmare.
 */
export async function loadApprovalsAction(workspaceId: string, caseId: string): Promise<UcActionResult<ApprovalStep[]>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  const opened = await openUcCase({ session, access, workspaceId, caseId, allow: APPROVAL_SIGNER_ROLES });
  if (!opened.ok) return opened.result;
  const loaded = await loadCaseApprovals(opened.value.executor, { workspaceId, caseId, roles: opened.value.caseAccess.roles });
  if (!loaded) return ucFailure("non_trovato", "Caso non trovato o non accessibile.");
  return { ok: true, data: loaded.status === "sospeso" || loaded.status === "chiuso" ? [] : loaded.approvals };
}
