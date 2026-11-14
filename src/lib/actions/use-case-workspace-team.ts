"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspaceAccess } from "@/lib/auth/require-workspace";
import { ucLsDomains } from "@/lib/db/queries/uc-access";
import { viewerFromSession } from "@/lib/db/queries/use-case-hub";
import { addWorkspaceTeamMember, removeWorkspaceTeamMember, type TeamApplyResult } from "@/lib/db/queries/use-case-workspace-team";
import { getAppUcExecutor } from "@/lib/db/uc-executor";
import { ucLogError } from "@/lib/uc/log";
import { isUseCaseHubWorkspace } from "@/lib/use-cases/rollout";
import { canReviewWorkspacePortfolio } from "@/lib/workspace-permissions";
import { fromResult, ucFailure, ucSectionAvailable, type UcActionResult } from "./uc-action-context";

/**
 * Il team di Lateral Space del cliente (rilascio 8.1b), dalla pagina «Agent Factory»: aggiungere una persona a tutti i
 * casi del workspace (anche a quelli che si apriranno) o toglierla. Lo fa il manager di Lateral Space del workspace;
 * nei casi lo scrivono i comandi del dossier, con i ruoli di chi agisce (`use-case-workspace-team.ts`).
 */
async function guard(workspaceId: string): Promise<{ ok: true; actorUserId: string } | { ok: false; result: UcActionResult<never> }> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  if (!isUseCaseHubWorkspace(workspaceId) || process.env.UC_ENABLED !== "true") return { ok: false, result: ucFailure("non_disponibile", "Non disponibile in questo workspace.") };
  const available = await ucSectionAvailable(workspaceId);
  if (!available.ok) return { ok: false, result: available };
  const viewer = viewerFromSession(session.user, access.role);
  if (!(viewer.isLateralSpace && canReviewWorkspacePortfolio(access.role))) {
    return { ok: false, result: ucFailure("permesso_negato", "Il team del cliente lo gestisce il manager di Lateral Space del workspace.") };
  }
  return { ok: true, actorUserId: session.user.id };
}

const cases = (n: number) => (n === 1 ? "1 caso" : `${n} casi`);

const REASON: Record<string, string> = {
  attore_non_ammesso: "lì non sei responsabile",
  ultimo_ls_lead: "è l'unico responsabile",
  caso_chiuso: "il caso è chiuso",
  non_collaboratore: "non è collaboratore del workspace",
  conflitto_ruoli: "ha già un ruolo del cliente",
};

/** I casi saltati, ognuno con il suo motivo (al massimo 5 per nome). */
function skippedText(r: TeamApplyResult): string {
  if (!r.skipped.length) return "";
  const shown = r.skipped.slice(0, 5).map((s) => `${s.code} (${REASON[s.reason] ?? "non riuscito"})`);
  const more = r.skipped.length > 5 ? ` e altri ${r.skipped.length - 5}` : "";
  return ` Saltati: ${shown.join(", ")}${more}. Si cambia dal team del dossier.`;
}

/** «Aggiungi a tutti i casi»: e-mail e ruolo. */
export async function addWorkspaceTeamMemberAction(workspaceId: string, input: unknown): Promise<UcActionResult<{ userId: string }>> {
  const g = await guard(workspaceId);
  if (!g.ok) return g.result;
  const i = (input ?? {}) as Record<string, unknown>;
  try {
    const result = await addWorkspaceTeamMember(await getAppUcExecutor(), { workspaceId, actorUserId: g.actorUserId, email: i.email, role: i.role, lsDomains: ucLsDomains() });
    if (!result.ok) return fromResult(result);
    revalidatePath(`/dashboard/${workspaceId}/agent-factory`);
    const r = result.value;
    const msg = `Nel team del cliente: entrerà anche nei casi nuovi. Aggiunta in ${cases(r.done.length)}${r.unchanged.length ? `, c'era già in ${cases(r.unchanged.length)}` : ""}.${skippedText(r)}`;
    return fromResult({ ok: true, value: { userId: r.userId } }, undefined, msg);
  } catch (error) {
    ucLogError({ area: "uc", op: "team_workspace_aggiungi", workspaceId }, error);
    return ucFailure("non_riuscito", "Non sono riuscito ad aggiungerla. Riprova tra poco.");
  }
}

/** «Togli»: non entra più nei casi nuovi ed esce da quelli aperti dove ha il ruolo del team. */
export async function removeWorkspaceTeamMemberAction(workspaceId: string, userId: string): Promise<UcActionResult<{ cases: number }>> {
  const g = await guard(workspaceId);
  if (!g.ok) return g.result;
  try {
    const result = await removeWorkspaceTeamMember(await getAppUcExecutor(), { workspaceId, actorUserId: g.actorUserId, userId, lsDomains: ucLsDomains() });
    if (!result.ok) return fromResult(result);
    revalidatePath(`/dashboard/${workspaceId}/agent-factory`);
    const r = result.value;
    return fromResult({ ok: true, value: { cases: r.done.length } }, undefined, `Tolta dal team del cliente: esce da ${cases(r.done.length)} e non entra nei casi nuovi.${skippedText(r)}`);
  } catch (error) {
    ucLogError({ area: "uc", op: "team_workspace_togli", workspaceId }, error);
    return ucFailure("non_riuscito", "Non sono riuscito a toglierla. Riprova tra poco.");
  }
}
