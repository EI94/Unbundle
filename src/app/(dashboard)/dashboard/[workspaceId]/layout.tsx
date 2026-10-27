import { requireSession } from "@/lib/auth/redirect-to-login";
import { headers } from "next/headers";
import { after } from "next/server";
import { redirect, notFound } from "next/navigation";
import { getWorkspaceAccessForUser } from "@/lib/workspace-access";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { learnerRedirect } from "@/lib/learning/learner-scope";
import { WorkspaceTopbar } from "@/components/portfolio/workspace-topbar";
import { isUseCaseHubWorkspace } from "@/lib/use-cases/rollout";
import { legacyRouteRedirect, stubLogEntry } from "@/lib/use-cases/legacy-routes";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  // Nessun link di condivisione generato qui: chi non ha una sessione va al
  // login, chi non ha accesso a questo workspace riceve 404. Un link pubblico
  // lo crea solo la piattaforma quando lo manda su Slack.
  const session = await requireSession();

  const access = await getWorkspaceAccessForUser(session.user.id, workspaceId);
  if (!access) notFound();
  const { workspace } = access;

  // Chi entra da un link di corso ha il solo ruolo `learner`: va tenuto dentro
  // l'area Formazione. Senza questo la barra laterale gli aprirebbe Strategia,
  // Report, Blueprints e Intelligence, cioe' il piano di trasformazione del suo
  // datore di lavoro.
  const pathname = (await headers()).get("x-unbundle-pathname") ?? "";
  const learnerDestination = learnerRedirect({
    role: access.role,
    pathname,
    workspaceId,
  });
  if (learnerDestination) redirect(learnerDestination);
  const learnerOnly = access.role === "learner";

  // Area «Use case» (docs/use-case/DESIGN.md §2.1, §12.1): una voce sola al posto di quattro.
  const useCaseHub = isUseCaseHubWorkspace(workspaceId);
  // I prerequisiti dell'area (riga di config, modello v2 se non ci sono use case), dopo la
  // risposta: un workspace di prima o una creazione in cui non erano riusciti si sistema alla
  // prima visita. Idempotente; un workspace già a posto non si rilegge (src/lib/use-cases/provisioning.ts).
  if (useCaseHub) {
    after(async () => {
      const { provisionUseCaseWorkspaceSafely } = await import("@/lib/db/queries/use-case-provisioning");
      await provisionUseCaseWorkspaceSafely(workspace.id);
    });
  }

  // P0-16 (docs/casi-duso/RUNBOOK.md §1): con l'area accesa «Casi d'uso» esce dalla barra e
  // `/casi-duso` esatto va alla Roadmap solo quando ogni dossier completo ha la sua scheda
  // (`dossierLinksReady`). Finché no, o se la lettura non riesce, la voce resta: un dossier
  // senza scheda non sta né su una scheda né sulla Roadmap. Il redirect sta qui e non in
  // pagina: sotto `casi-duso/loading.tsx` risponderebbe 200 con una meta refresh (H6a).
  const ucOn = process.env.UC_ENABLED === "true";
  let dossierLinksAreReady = false;
  if (useCaseHub && ucOn && !learnerOnly) {
    const { dossierLinksReady } = await import("@/lib/db/queries/use-case-dossiers");
    const links = await dossierLinksReady(workspaceId);
    dossierLinksAreReady = links.ok && links.ready;
    const legacy = dossierLinksAreReady && /^\/dashboard\/[^/]+\/casi-duso\/?$/.test(pathname)
      ? legacyRouteRedirect(`/dashboard/${workspaceId}/casi-duso`, undefined, { dossierLinksReady: true })
      : null;
    if (legacy) {
      console.info(JSON.stringify(stubLogEntry(legacy.from)));
      redirect(legacy.to);
    }
  }

  // Off by default: existing workspaces do not query the additive training tables.
  const learningAvailable = process.env.LEARNING_ENABLED === "true"
    ? await (await import("@/lib/learning/server")).hasLearningForWorkspace(workspaceId)
    : false;

  // Off by default (UC_ENABLED): the uc tables are read only when the section is on, behind to_regclass.
  const casesAvailable = ucOn && !learnerOnly && !(useCaseHub && dossierLinksAreReady)
    ? await (await import("@/lib/db/queries/uc-nav")).ucCasesNavVisible({ userId: session.user.id, workspaceId, role: access.role })
    : false;

  return (
    <SidebarProvider>
      <AppSidebar
        learnerOnly={learnerOnly}
        learningAvailable={learningAvailable}
        casesAvailable={casesAvailable}
        useCaseHub={useCaseHub}
        workspaceId={workspace.id}
        workspaceName={workspace.name}
        user={{
          name: session.user.name,
          email: session.user.email,
          image: session.user.image,
        }}
      />
      <SidebarInset>
        {/* La campanella mostra titoli e descrizioni del portfolio: non è per chi segue solo un corso. */}
        <WorkspaceTopbar workspaceId={workspaceId} role={access.role} userId={session.user.id} showNotifications={!learnerOnly} useCaseHub={useCaseHub} />
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
