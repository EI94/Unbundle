import { notFound, redirect } from "next/navigation";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { dossierStateForUseCase } from "@/lib/db/queries/use-case-dossiers";

/**
 * L'indirizzo breve di «Progetto dell'agente» per uno use case (rilascio 8.0a): lo usano le notifiche della
 * campanella, che conoscono lo use case e non il dossier. Porta al progetto del suo dossier; senza dossier, o con
 * la sezione «Casi d'uso» spenta, «non trovata». I permessi li controlla la pagina del dossier.
 */
export default async function UseCaseAgentProjectRedirect({ params }: { params: Promise<{ workspaceId: string; useCaseId: string }> }) {
  const { workspaceId, useCaseId } = await params;
  await requireWorkspacePage(workspaceId);
  const read = await dossierStateForUseCase(workspaceId, useCaseId);
  if (!read.ok || !read.dossier) notFound();
  redirect(`/dashboard/${encodeURIComponent(workspaceId)}/casi-duso/${encodeURIComponent(read.dossier.caseId)}/progetto`);
}
