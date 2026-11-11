"use server";

/**
 * «Proposte dei coding agent» nella scheda dello use case (rilascio 8.0b, RILASCIO-8.0b-COSTRUZIONE.md §7):
 * «Aggiungi a Cosa serve» e «Lascia stare». Le decide chi può aggiungere esigenze (`canEditNeeds`, riletto qui e
 * nel servizio). «Aggiungi» crea un requisito «da chiedere» del cliente, collegato allo use case, con lo stesso
 * servizio della pagina (`createNeed`, canale `pagina`): al referente lo manda poi una persona, come sempre.
 */
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireWorkspaceAccess } from "@/lib/auth/require-workspace";
import { ensureDbSchema } from "@/lib/db/ensure-schema";
import { cliStoreReady } from "@/lib/db/queries/use-case-cli-auth";
import { agentNeedExists, claimAgentQuestion, linkAgentQuestionNeed, needFromProposal, releaseAgentQuestion } from "@/lib/db/queries/use-case-agent-questions";
import { viewerFromSession } from "@/lib/db/queries/use-case-hub";
import { getAppUcExecutor } from "@/lib/db/uc-executor";
import { createNeed } from "@/lib/use-cases/needs-service";
import { abilitiesForUseCase } from "@/lib/use-cases/permissions";
import { isUseCaseHubWorkspace } from "@/lib/use-cases/rollout";
import type { WriteContext } from "@/lib/use-cases/service";

export type AgentQuestionActionResult = { ok: true; message: string } | { ok: false; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GONE: AgentQuestionActionResult = { ok: false, message: "Questa proposta è già stata decisa: ho ricaricato la pagina." };
const DENIED: AgentQuestionActionResult = { ok: false, message: "Le proposte le decide chi può aggiungere esigenze in «Cosa serve»." };

async function open(guard: Awaited<ReturnType<typeof requireWorkspaceAccess>>, workspaceId: string, useCaseId: string, questionId: string) {
  const { session, access } = guard;
  if (!UUID.test(useCaseId) || !UUID.test(questionId)) return { ok: false as const, result: GONE };
  if (!isUseCaseHubWorkspace(workspaceId)) return { ok: false as const, result: DENIED };
  const viewer = viewerFromSession(session.user, access.role);
  if (!abilitiesForUseCase(viewer).canEditNeeds) return { ok: false as const, result: DENIED };
  await ensureDbSchema();
  const executor = await getAppUcExecutor();
  if (!(await cliStoreReady(executor))) return { ok: false as const, result: { ok: false as const, message: "Non ancora disponibile: riprova tra qualche minuto." } };
  const ctx: WriteContext = { workspaceId, actor: { userId: session.user.id, role: access.role, isLateralSpace: viewer.isLateralSpace, kind: "persona" }, channel: "pagina" };
  return { ok: true as const, session, executor, ctx };
}

function refresh(workspaceId: string, useCaseId: string) {
  revalidatePath(`/dashboard/${workspaceId}/use-cases`);
  revalidatePath(`/dashboard/${workspaceId}/use-cases/${useCaseId.toLowerCase()}`);
}

/** «Aggiungi a Cosa serve»: la proposta diventa un requisito da chiedere al cliente. */
export async function addAgentQuestionAction(workspaceId: string, useCaseId: string, questionId: string): Promise<AgentQuestionActionResult> {
  const opened = await open(await requireWorkspaceAccess(workspaceId), workspaceId, useCaseId, questionId);
  if (!opened.ok) return opened.result;
  const { session, executor, ctx } = opened;
  const claimed = await claimAgentQuestion(executor, { workspaceId, useCaseId, questionId, userId: session.user.id, decision: "aggiunta" });
  if (!claimed) {
    refresh(workspaceId, useCaseId);
    return GONE;
  }
  // L'id dell'esigenza si decide qui: se l'esigenza nasce ma la risposta si perde, la si ritrova invece di rifarla.
  const needId = randomUUID();
  let created: Awaited<ReturnType<typeof createNeed>> | null = null;
  let thrown: unknown = null;
  try {
    created = await createNeed(ctx, needFromProposal(claimed), { useCaseIds: [useCaseId], id: needId });
  } catch (error) {
    thrown = error;
  }
  if (!created?.ok && !(await agentNeedExists(executor, { workspaceId, needId }))) {
    await releaseAgentQuestion(executor, { workspaceId, questionId });
    if (thrown) throw thrown;
    return { ok: false, message: (created && !created.ok ? created.message : null) ?? "Non è stato possibile aggiungerla: riprova." };
  }
  await linkAgentQuestionNeed(executor, { workspaceId, questionId, needId });
  refresh(workspaceId, useCaseId);
  return { ok: true, message: "Aggiunta a «Cosa serve»: la chiedi al referente quando vuoi." };
}

/** «Lascia stare»: la proposta non diventa niente. */
export async function dismissAgentQuestionAction(workspaceId: string, useCaseId: string, questionId: string): Promise<AgentQuestionActionResult> {
  const opened = await open(await requireWorkspaceAccess(workspaceId), workspaceId, useCaseId, questionId);
  if (!opened.ok) return opened.result;
  const claimed = await claimAgentQuestion(opened.executor, { workspaceId, useCaseId, questionId, userId: opened.session.user.id, decision: "scartata" });
  refresh(workspaceId, useCaseId);
  return claimed ? { ok: true, message: "Lasciata stare." } : GONE;
}
