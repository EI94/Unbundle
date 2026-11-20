import { notFound } from "next/navigation";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { isCaseOnly } from "@/lib/auth/case-only";
import { dossierStateForUseCase } from "@/lib/db/queries/use-case-dossiers";
import { RedirectKeepingHash } from "@/components/use-cases/redirect-keeping-hash";

/**
 * L'indirizzo breve di «Progetto dell'agente» per uno use case (rilascio 8.0a): lo usano le notifiche della
 * campanella e la CLI, che conoscono lo use case e non il dossier. Porta al progetto del suo dossier tenendo l'ancora
 * (`#compiti`, `#banco`), che `redirect()` qui perderebbe: la pagina è in streaming per il `loading.tsx` dello use
 * case. Senza dossier, o con la sezione «Casi d'uso» spenta, «non trovata». I permessi li controlla la pagina del
 * dossier.
 *
 * (8.0d) Una porta di «Solo questo use case» (`CASE_ONLY_SURFACES`): la sua campanella porta qui. Prima di portare al
 * dossier ricontrolla il predicato per quel caso: per un caso fuori «non trovata», senza dire quale sia il dossier.
 */
export default async function UseCaseAgentProjectRedirect({ params }: { params: Promise<{ workspaceId: string; useCaseId: string }> }) {
  const { workspaceId, useCaseId } = await params;
  const { session, access } = await requireWorkspacePage(workspaceId, { allowCaseOnly: true });
  const read = await dossierStateForUseCase(workspaceId, useCaseId);
  if (!read.ok || !read.dossier) notFound();
  if (isCaseOnly(access.role) && !(await caseOnlyBuilds(read.dossier.caseId, session.user.id))) notFound();
  return <RedirectKeepingHash href={`/dashboard/${encodeURIComponent(workspaceId)}/casi-duso/${encodeURIComponent(read.dossier.caseId)}/progetto`} label="Apri il progetto dell'agente" />;
}

/** (8.0d) Il predicato unico di chi costruisce da fuori, per il dossier dello use case; una lettura che non riesce vale «no». */
async function caseOnlyBuilds(caseId: string, userId: string): Promise<boolean> {
  try {
    const [{ isExternalBuilderOfCase }, { getAppUcExecutor }, { ucLsDomains }] = await Promise.all([
      import("@/lib/db/queries/use-case-builders"),
      import("@/lib/db/uc-executor"),
      import("@/lib/db/queries/uc-access"),
    ]);
    return await isExternalBuilderOfCase(await getAppUcExecutor(), { caseId, userId, lsDomains: ucLsDomains() });
  } catch {
    return false;
  }
}
