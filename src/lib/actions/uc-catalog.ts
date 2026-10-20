"use server";

import type { Session } from "@/lib/auth";
import { requireWorkspaceAccess } from "@/lib/auth/require-workspace";
import {
  addComment,
  markMissing,
  markPartial,
  proposeFallback,
  proposeNa,
  proposeWaiver,
  recordLsAnswer,
  rejectNa,
  reopenItem,
  requestClarification,
  resolveComment,
  setItemsDue,
  signFallback,
  signNa,
  signWaiver,
  transitionItems,
  validateItem,
  type AppliedTransitions,
} from "@/lib/db/queries/uc-items";
import type { Result } from "@/lib/uc/types";
import type { CaseRole, ItemStatus } from "@/lib/uc/vocab";
import type { WorkspaceAccess } from "@/lib/workspace-access";
import { finishUcCommand, fromResult, openUcCase, type OpenedUcCase, type UcActionResult } from "./uc-action-context";

/**
 * Server action sul catalogo delle voci (PIANO §5.3, `uc-catalog.ts`). Prima
 * `requireWorkspaceAccess(workspaceId)`, poi i ruoli di caso, poi il comando in
 * `queries/uc-items.ts`: ogni cambio di stato passa da `checkItemTransition` e
 * da un CAS con `uc_require`, con l'evento nello stesso batch.
 */

const LS: readonly CaseRole[] = ["ls_lead", "ls_analista"];
const SIGNERS: readonly CaseRole[] = ["ls_lead", "owner_cliente"];

/** Esito delle transizioni per l'interfaccia: chiavi e stati, nient'altro. */
export type TransitionSummary = { items: { itemId: string; key: string; from: ItemStatus; to: ItemStatus }[]; gateReconfirm: boolean };

function summary(value: AppliedTransitions): TransitionSummary {
  return { items: value.applied.map(({ itemId, key, from, to }) => ({ itemId, key, from, to })), gateReconfirm: value.gateReconfirm };
}

async function onCase<T, U = T>(
  guard: { session: Session; access: WorkspaceAccess },
  workspaceId: string,
  caseId: string,
  allow: readonly CaseRole[],
  command: (o: OpenedUcCase) => Promise<Result<T>>,
  map?: (value: T) => U,
): Promise<UcActionResult<U>> {
  const opened = await openUcCase({ ...guard, workspaceId, caseId, allow });
  if (!opened.ok) return opened.result;
  const result = await command(opened.value);
  if (result.ok) finishUcCommand({ workspaceId, caseId });
  return fromResult(result, map);
}

/** «Imposta scadenza (proposta)» su più voci. */
export async function setItemsDueAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<{ count: number }>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  return onCase({ session, access }, workspaceId, caseId, ["ls_lead"], (o) => setItemsDue(o.executor, o.ctx, input));
}

/** Esiti in blocco: mancante, parziale, riapertura. */
export async function transitionItemsAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<TransitionSummary>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  return onCase({ session, access }, workspaceId, caseId, LS, (o) => transitionItems(o.executor, o.ctx, input), summary);
}

/** Validazione con i quattro occhi (chi ha risposto non valida). */
export async function validateItemAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<TransitionSummary>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  return onCase({ session, access }, workspaceId, caseId, LS, (o) => validateItem(o.executor, o.ctx, input), summary);
}

/** Chiarimento al referente: la voce torna «chiesta» e l'email va in coda. */
export async function requestClarificationAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<TransitionSummary & { commentId: string }>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  return onCase({ session, access }, workspaceId, caseId, LS, (o) => requestClarification(o.executor, o.ctx, input), (v) => ({ ...summary(v), commentId: v.commentId }));
}

/** Esito «parziale», con il motivo. */
export async function markPartialAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<TransitionSummary>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  return onCase({ session, access }, workspaceId, caseId, LS, (o) => markPartial(o.executor, o.ctx, input), summary);
}

/** Esito «mancante», con il motivo sempre visibile. */
export async function markMissingAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<TransitionSummary>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  return onCase({ session, access }, workspaceId, caseId, LS, (o) => markMissing(o.executor, o.ctx, input), summary);
}

/** Proposta «non applicabile» di Lateral Space (servono poi le due firme). */
export async function proposeNaAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<{ itemId: string }>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  return onCase({ session, access }, workspaceId, caseId, LS, (o) => proposeNa(o.executor, o.ctx, input));
}

/** Firma «non applicabile» (Lateral Space o Owner del cliente). */
export async function signNaAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<{ itemId: string; complete: boolean }>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  return onCase({ session, access }, workspaceId, caseId, SIGNERS, (o) => signNa(o.executor, o.ctx, input));
}

/** Proposta «non applicabile» respinta, con il motivo. */
export async function rejectNaAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<{ itemId: string }>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  return onCase({ session, access }, workspaceId, caseId, SIGNERS, (o) => rejectNa(o.executor, o.ctx, input));
}

/** Proposta di deroga (entro il 10% delle voci richieste). */
export async function proposeWaiverAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<{ itemId: string }>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  return onCase({ session, access }, workspaceId, caseId, LS, (o) => proposeWaiver(o.executor, o.ctx, input));
}

/** Firma di una deroga (Lateral Space o Owner del cliente). */
export async function signWaiverAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<{ itemId: string; complete: boolean }>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  return onCase({ session, access }, workspaceId, caseId, SIGNERS, (o) => signWaiver(o.executor, o.ctx, input));
}

/** Proposta di ripiego su una voce bloccata (solo per lo sviluppo). */
export async function proposeFallbackAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<{ itemId: string }>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  return onCase({ session, access }, workspaceId, caseId, LS, (o) => proposeFallback(o.executor, o.ctx, input));
}

/** Firma di un ripiego (Lateral Space o Owner del cliente). */
export async function signFallbackAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<{ itemId: string; complete: boolean }>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  return onCase({ session, access }, workspaceId, caseId, SIGNERS, (o) => signFallback(o.executor, o.ctx, input));
}

/** Riapre una voce non applicabile, con il motivo. */
export async function reopenItemAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<TransitionSummary>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  return onCase({ session, access }, workspaceId, caseId, ["ls_lead"], (o) => reopenItem(o.executor, o.ctx, input), summary);
}

/** Valore inserito da Lateral Space da una fonte nota (poi lo valida un'altra persona). */
export async function recordLsAnswerAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<TransitionSummary & { answerId: string }>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  return onCase({ session, access }, workspaceId, caseId, LS, (o) => recordLsAnswer(o.executor, o.ctx, input), (v) => ({ ...summary(v), answerId: v.answerId }));
}

/** Commento su una voce (interno di Lateral Space o condiviso). */
export async function addCommentAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<{ commentId: string }>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  return onCase({ session, access }, workspaceId, caseId, ["ls_lead", "ls_analista", "ls_sviluppatore", "owner_cliente"], (o) => addComment(o.executor, o.ctx, input));
}

/** Chiarimento risolto. */
export async function resolveCommentAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<{ commentId: string }>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  return onCase({ session, access }, workspaceId, caseId, LS, (o) => resolveComment(o.executor, o.ctx, input));
}
