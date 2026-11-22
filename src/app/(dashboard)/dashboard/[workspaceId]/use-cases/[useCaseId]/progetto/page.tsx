import { notFound } from "next/navigation";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { dossierStateForUseCase } from "@/lib/db/queries/use-case-dossiers";
import { RedirectKeepingHash } from "@/components/use-cases/redirect-keeping-hash";

/**
 * L'indirizzo breve di «Progetto dell'agente» per uno use case (rilascio 8.0a): lo usano le notifiche della
 * campanella, la CLI e il MCP (`…/progetto#banco` delle evals), che conoscono lo use case e non il dossier. Porta alla
 * Costruzione della sua realizzazione (rilascio 10, §3.5: il progetto dell'agente è la Costruzione) tenendo l'ancora
 * (`#compiti`, `#banco`, `#contesto`: la Costruzione ha ancora quegli id), che `redirect()` qui perderebbe: la pagina
 * è in streaming per il `loading.tsx` dello use case. Dritto alla Costruzione, senza passare dal 308 di `/progetto`.
 * Senza dossier, o con la sezione «Casi d'uso» spenta, «non trovata». I permessi li controlla la Costruzione.
 */
export default async function UseCaseAgentProjectRedirect({ params }: { params: Promise<{ workspaceId: string; useCaseId: string }> }) {
  const { workspaceId, useCaseId } = await params;
  await requireWorkspacePage(workspaceId);
  const read = await dossierStateForUseCase(workspaceId, useCaseId);
  if (!read.ok || !read.dossier) notFound();
  return <RedirectKeepingHash href={`/dashboard/${encodeURIComponent(workspaceId)}/casi-duso/${encodeURIComponent(read.dossier.caseId)}/costruzione`} label="Apri la costruzione" />;
}
