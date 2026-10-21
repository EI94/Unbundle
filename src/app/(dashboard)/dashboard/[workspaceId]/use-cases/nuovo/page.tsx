import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { PageContainer } from "@/components/dashboard/page-container";
import { UseCaseForm } from "@/components/use-cases/use-case-form";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { viewerFromSession } from "@/lib/db/queries/use-case-hub";
import { FORM_TEXT, defaultOriginFor, formSubtitle } from "@/lib/use-cases/create";
import { newUseCaseFormContext } from "@/lib/use-cases/create-data";
import { abilitiesForUseCase } from "@/lib/use-cases/permissions";
import { isUseCaseHubWorkspace } from "@/lib/use-cases/rollout";

/**
 * `/use-cases/nuovo`: il modulo completo di «Nuovo use case» (docs/use-case/DESIGN.md §2.2,
 * §5.1, §5.3). Lo usano gli AI Builder del cliente e i contributori; Lateral Space lo apre dal
 * link del pannello rapido. Con l'area spenta per il workspace: `notFound()`.
 */
export default async function NewUseCasePage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  if (!isUseCaseHubWorkspace(workspaceId)) notFound();

  const { session, access } = await requireWorkspacePage(workspaceId);
  const viewer = viewerFromSession(session.user, access.role);
  const abilities = abilitiesForUseCase(viewer);
  if (!abilities.canOpenArea) notFound();

  const context = await newUseCaseFormContext(workspaceId);

  return (
    <PageContainer size="narrow">
      <Link
        href={`/dashboard/${workspaceId}/use-cases`}
        className="-ml-1 inline-flex min-h-11 items-center gap-0.5 rounded-md px-1 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-8"
      >
        <ChevronLeft aria-hidden className="size-4" />
        {FORM_TEXT.back}
      </Link>
      <header className="mt-2 mb-8 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{FORM_TEXT.heading}</h1>
        <p className="text-muted-foreground">{formSubtitle(context.teamName)}</p>
      </header>
      <UseCaseForm
        workspaceId={workspaceId}
        isReviewer={abilities.isReviewer}
        defaultOrigin={defaultOriginFor("modulo_completo", abilities)}
        esgEnabled={context.esgEnabled}
        // Le fasce (con gli euro) solo a chi valuta: il contributore non ha il campo costo e
        // nemmeno una cifra nella pagina (D4, PIANO-LAVORI §5.7).
        costBands={abilities.isReviewer ? context.costBands : undefined}
      />
    </PageContainer>
  );
}
