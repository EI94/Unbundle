import { requireSession } from "@/lib/auth/redirect-to-login";
import { headers } from "next/headers";
import { after } from "next/server";
import { redirect, notFound } from "next/navigation";
import { getWorkspaceAccessForUser } from "@/lib/workspace-access";
import { WorkspaceShell } from "@/components/shell/workspace-shell";
import { workspaceNav } from "@/components/shell/sidebar-model";
import { learnerRedirect } from "@/lib/learning/learner-scope";
import { WorkspaceBell } from "@/components/portfolio/workspace-topbar";
import { isUseCaseHubWorkspace } from "@/lib/use-cases/rollout";
import { canReviewWorkspacePortfolio } from "@/lib/workspace-permissions";

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

  // (Rilascio 10, D9 (a), si chiude P0-16) Con l'area accesa la lista `/casi-duso` è in ritiro: le realizzazioni
  // stanno in Use case › Panoramica › «In realizzazione», e `src/proxy.ts` risponde 307 verso la Panoramica. La voce
  // «Casi d'uso» resta solo nella barra di prima, con l'area spenta, dove la lista c'è ancora.
  const ucOn = process.env.UC_ENABLED === "true";

  // Off by default: existing workspaces do not query the additive training tables.
  const learningAvailable = process.env.LEARNING_ENABLED === "true"
    ? await (await import("@/lib/learning/server")).hasLearningForWorkspace(workspaceId)
    : false;

  // Off by default (UC_ENABLED): the uc tables are read only when the section is on, behind to_regclass. Only the
  // old sidebar (area off) has the list's entry.
  const casesAvailable = ucOn && !learnerOnly && !useCaseHub
    ? await (await import("@/lib/db/queries/uc-nav")).ucCasesNavVisible({ userId: session.user.id, workspaceId, role: access.role })
    : false;

  // (8.1a) «Agent Factory»: chi costruisce in un caso del workspace, o il manager di Lateral Space. (8.0c) Anche chi
  // costruisce da fuori Lateral Space e oggi lo può fare: il predicato unico, con i domini di Lateral Space.
  let factoryAvailable = false;
  if (useCaseHub && ucOn && !learnerOnly) {
    const [{ factoryNavVisible }, { viewerFromSession }, { getAppUcExecutor }, { ucLsDomains }] = await Promise.all([
      import("@/lib/db/queries/use-case-factory-line"),
      import("@/lib/db/queries/use-case-hub"),
      import("@/lib/db/uc-executor"),
      import("@/lib/db/queries/uc-access"),
    ]);
    const lsManager = viewerFromSession(session.user, access.role).isLateralSpace && canReviewWorkspacePortfolio(access.role);
    factoryAvailable = await factoryNavVisible(await getAppUcExecutor(), { workspaceId, userId: session.user.id, lsManager, lsDomains: ucLsDomains() });
  }

  // (Rilascio 10, ondata 2a «Cornice», docs/ui-10/PROPOSTA-10.md §2.1-§2.2) Le voci della barra per chi guarda, e la
  // campanella (non per chi segue solo un corso: mostra titoli e descrizioni del portfolio), che la cornice mette nella
  // testata della barra su desktop e nella barra in alto del telefono. La campanella è un elemento del server: si legge
  // insieme alla pagina, e la cornice non la aspetta.
  const nav = workspaceNav({ workspaceId: workspace.id, role: access.role, useCaseHub, learningAvailable, casesAvailable, factoryAvailable });
  const bell = learnerOnly ? null : <WorkspaceBell workspaceId={workspaceId} role={access.role} userId={session.user.id} useCaseHub={useCaseHub} />;

  return (
    <WorkspaceShell
      nav={nav}
      workspaceId={workspace.id}
      workspaceName={workspace.name}
      user={{
        name: session.user.name,
        email: session.user.email,
        image: session.user.image,
      }}
      bell={bell}
      accountData={!learnerOnly}
    >
      {children}
    </WorkspaceShell>
  );
}
