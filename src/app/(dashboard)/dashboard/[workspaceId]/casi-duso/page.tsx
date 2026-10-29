import { notFound } from "next/navigation";
import { PageContainer } from "@/components/dashboard/page-container";
import { DossierCardList, DossierColumnEmpty, DossierReadOnlyNotice } from "@/components/uc/shell/case-card";
import { SectionUnavailable } from "@/components/uc/shell/section-unavailable";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { SubprocessorsLsNotice, subprocessorsPendingForLs } from "@/components/workspace/subprocessors-notice";
import { UcAccessError, ensureUcAvailable, isUcEnabledFor, isUcLsConfigured } from "@/lib/db/queries/uc-access";
import { dossierCardsForWorkspace } from "@/lib/db/queries/uc-nav";
import { canManageWorkspaceSettings } from "@/lib/workspace-permissions";

/**
 * Lista di ripiego dei dossier (DESIGN §2.1, §3.1, «La pagina /casi-duso di
 * oggi»): non si ridisegna e resta raggiungibile dalla barra di ripiego finché
 * manca P0-16; poi il layout del workspace la reindirizza alla Panoramica (H6a,
 * non qui). Usa la stessa card della colonna «In realizzazione», senza «Nuovo
 * caso»: un dossier parte solo dalla scheda di uno use case.
 *
 * Mostra i dossier che chi guarda apre (membro, o chi gestisce il workspace in
 * sola lettura). Sezione spenta per il workspace: 404; chi partecipa solo ai
 * corsi resta nella Formazione (layout del workspace).
 */
export default async function CasesPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const { session, access } = await requireWorkspacePage(workspaceId);
  if (!isUcEnabledFor(workspaceId)) notFound();
  try {
    await ensureUcAvailable(workspaceId);
  } catch (error) {
    if (error instanceof UcAccessError && error.code === "non_disponibile") return <SectionUnavailable />;
    if (error instanceof UcAccessError && error.code === "disattivata") notFound();
    throw error;
  }
  const [cards, subprocessorsPending] = await Promise.all([
    dossierCardsForWorkspace({ workspaceId, userId: session.user.id, role: access.role }),
    subprocessorsPendingForLs(workspaceId, session.user.id),
  ]);
  const readOnlyNotice = canManageWorkspaceSettings(access.role) && !isUcLsConfigured();

  return (
    <PageContainer>
      <div className="mb-6 min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Casi d&apos;uso</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">I dossier in realizzazione: ognuno nasce dalla scheda di uno use case.</p>
      </div>
      {subprocessorsPending && <SubprocessorsLsNotice workspaceId={workspaceId} workspaceName={access.workspace.name} className="mb-4" />}
      {readOnlyNotice && <DossierReadOnlyNotice />}
      <div className={readOnlyNotice ? "mt-4" : undefined}>
        {cards.length === 0 ? <DossierColumnEmpty variant="page" /> : <DossierCardList cards={cards} className="md:grid-cols-2" />}
      </div>
    </PageContainer>
  );
}
