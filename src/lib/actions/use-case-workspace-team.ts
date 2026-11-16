"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { dispatchDue } from "@/lib/db/queries/uc-notifications-dispatch";
import { requireWorkspaceAccess } from "@/lib/auth/require-workspace";
import { ucLsDomains } from "@/lib/db/queries/uc-access";
import { viewerFromSession } from "@/lib/db/queries/use-case-hub";
import { readExternalGrant } from "@/lib/db/queries/use-case-builders";
import { addExternalBuilder, addWorkspaceTeamMember, removeExternalBuilder, removeWorkspaceTeamMember } from "@/lib/db/queries/use-case-workspace-team";
import { getAppUcExecutor } from "@/lib/db/uc-executor";
import { ucLogError } from "@/lib/uc/log";
import { EXTERNAL_BUILDER_ROLE } from "@/lib/use-cases/factory/builders";
import { externalAddedText, externalRemovedText, lsAddedText, lsRemovedText } from "@/lib/use-cases/factory/builders-text";
import { isUseCaseHubWorkspace } from "@/lib/use-cases/rollout";
import { canReviewWorkspacePortfolio } from "@/lib/workspace-permissions";
import { fromResult, ucFailure, ucSectionAvailable, type UcActionResult } from "./uc-action-context";

type WorkspaceAccess = Awaited<ReturnType<typeof requireWorkspaceAccess>>;

/**
 * «Chi costruisce» i casi del cliente (rilascio 8.1b; 8.0c anche da fuori Lateral Space), dalla pagina «Agent Factory»:
 * aggiungere una persona, cambiarle il «Dove», toglierla. Lo fa il manager di Lateral Space del workspace; un esterno
 * non aggiunge mai un esterno. Nei casi lo scrivono i comandi del dossier, con i ruoli di chi agisce
 * (`use-case-workspace-team.ts`). L'accesso al workspace lo verifica ogni azione per prima cosa (`requireWorkspaceAccess`,
 * la regola di src/lib/auth/workspace-isolation.test.ts) e lo passa qui, per il resto dei controlli.
 */
async function guard(
  workspaceId: string,
  { session, access }: WorkspaceAccess,
): Promise<{ ok: true; actorUserId: string } | { ok: false; result: UcActionResult<never> }> {
  if (!isUseCaseHubWorkspace(workspaceId) || process.env.UC_ENABLED !== "true") return { ok: false, result: ucFailure("non_disponibile", "Non disponibile in questo workspace.") };
  const available = await ucSectionAvailable(workspaceId);
  if (!available.ok) return { ok: false, result: available };
  const viewer = viewerFromSession(session.user, access.role);
  if (!(viewer.isLateralSpace && canReviewWorkspacePortfolio(access.role))) {
    return { ok: false, result: ucFailure("permesso_negato", "Chi costruisce i casi del cliente lo decide il manager di Lateral Space del workspace.") };
  }
  return { ok: true, actorUserId: session.user.id };
}

/**
 * L'e-mail di chi entra o esce, subito dopo la risposta (come «CLI collegata»): senza l'ok ai sub-responsabili del cliente
 * resta in coda (o si annulla) e la riprende il cron.
 */
function sendAfter(workspaceId: string, noticeId: string | null): void {
  if (!noticeId) return;
  after(async () => {
    try {
      await dispatchDue({ notificationId: noticeId });
    } catch (error) {
      ucLogError({ area: "uc", op: "chi_costruisce_email", workspaceId }, error);
    }
  });
}

/**
 * «Aggiungi» a chi costruisce: la persona dall'elenco dei collaboratori, il ruolo, e per chi viene da fuori il «Dove»
 * (`"tutti"` o gli use case scelti). Una persona già presente da fuori: cambia il «Dove».
 */
export async function addBuilderAction(workspaceId: string, input: unknown): Promise<UcActionResult<{ userId: string }>> {
  const workspace = await requireWorkspaceAccess(workspaceId);
  const g = await guard(workspaceId, workspace);
  if (!g.ok) return g.result;
  const i = (input ?? {}) as Record<string, unknown>;
  try {
    const executor = await getAppUcExecutor();
    const lsDomains = ucLsDomains();
    if (i.role === EXTERNAL_BUILDER_ROLE) {
      const result = await addExternalBuilder(executor, { workspaceId, actorUserId: g.actorUserId, userId: i.userId, where: i.where, lsDomains });
      if (!result.ok) return fromResult(result);
      revalidatePath(`/dashboard/${workspaceId}/agent-factory`);
      sendAfter(workspaceId, result.value.noticeId);
      return fromResult({ ok: true, value: { userId: result.value.userId } }, undefined, externalAddedText(result.value));
    }
    const result = await addWorkspaceTeamMember(executor, { workspaceId, actorUserId: g.actorUserId, userId: i.userId, role: i.role, lsDomains });
    if (!result.ok) return fromResult(result);
    revalidatePath(`/dashboard/${workspaceId}/agent-factory`);
    return fromResult({ ok: true, value: { userId: result.value.userId } }, undefined, lsAddedText(result.value));
  } catch (error) {
    ucLogError({ area: "uc", op: "chi_costruisce_aggiungi", workspaceId }, error);
    return ucFailure("non_riuscito", "Non è stato possibile aggiungere la persona: riprova tra poco.");
  }
}

/**
 * «Togli» da chi costruisce. Da fuori: da subito non scrive più (concessioni, token, compiti che tornano da prendere),
 * poi esce dai casi. Di Lateral Space: esce dai casi aperti dal ruolo del team e i suoi compiti lì tornano da prendere.
 */
export async function removeBuilderAction(workspaceId: string, userId: string): Promise<UcActionResult<{ cases: number }>> {
  const workspace = await requireWorkspaceAccess(workspaceId);
  const g = await guard(workspaceId, workspace);
  if (!g.ok) return g.result;
  try {
    const executor = await getAppUcExecutor();
    const lsDomains = ucLsDomains();
    if (typeof userId === "string" && (await readExternalGrant(executor, workspaceId, userId))) {
      const result = await removeExternalBuilder(executor, { workspaceId, actorUserId: g.actorUserId, userId, lsDomains });
      if (!result.ok) return fromResult(result);
      revalidatePath(`/dashboard/${workspaceId}/agent-factory`);
      sendAfter(workspaceId, result.value.noticeId);
      return fromResult({ ok: true, value: { cases: result.value.left.length } }, undefined, externalRemovedText(result.value));
    }
    const result = await removeWorkspaceTeamMember(executor, { workspaceId, actorUserId: g.actorUserId, userId, lsDomains });
    if (!result.ok) return fromResult(result);
    revalidatePath(`/dashboard/${workspaceId}/agent-factory`);
    return fromResult({ ok: true, value: { cases: result.value.done.length } }, undefined, lsRemovedText(result.value));
  } catch (error) {
    ucLogError({ area: "uc", op: "chi_costruisce_togli", workspaceId }, error);
    return ucFailure("non_riuscito", "Non è stato possibile togliere la persona: riprova tra poco.");
  }
}
