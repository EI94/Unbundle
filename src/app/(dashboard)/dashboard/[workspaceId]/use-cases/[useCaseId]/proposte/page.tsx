import { redirect } from "next/navigation";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { cosaServeHref } from "@/lib/use-cases/referent/contract";

/**
 * L'indirizzo breve delle «Proposte dei coding agent» di uno use case (rilascio 8.0b): lo usa l'e-mail al
 * responsabile, che non può avere parametri. Porta a «Cosa serve», sulle proposte. I permessi li controlla la scheda.
 */
export default async function AgentProposalsRedirect({ params }: { params: Promise<{ workspaceId: string; useCaseId: string }> }) {
  const { workspaceId, useCaseId } = await params;
  await requireWorkspacePage(workspaceId);
  redirect(`${cosaServeHref(encodeURIComponent(workspaceId), encodeURIComponent(useCaseId))}#proposte-agenti`);
}
