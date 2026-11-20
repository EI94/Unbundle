import { requireSession } from "@/lib/auth/redirect-to-login";
import { headers } from "next/headers";
import { after } from "next/server";
import { redirect, notFound } from "next/navigation";
import { getWorkspaceAccessForUser } from "@/lib/workspace-access";
import { WorkspaceShell } from "@/components/shell/workspace-shell";
import { workspaceNav } from "@/components/shell/sidebar-model";
import { isLearnerOnly, learnerRedirect } from "@/lib/learning/learner-scope";
import { caseOnlyRedirect, isCaseOnly, workspaceDoor } from "@/lib/auth/case-only";
import { WorkspaceBell } from "@/components/portfolio/workspace-topbar";
import { isUseCaseHubWorkspace } from "@/lib/use-cases/rollout";
import { canReviewWorkspacePortfolio, isCollaboratorRole } from "@/lib/workspace-permissions";
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
  // (8.0d-1) Per elenco, come le porte (`workspaceDoor`): i collaboratori, chi segue un corso e «Solo questo use case»,
  // ognuno nel suo perimetro; un ruolo che il codice non conosce riceve 404.
  if (workspaceDoor(access.role, { allowLearner: true, allowCaseOnly: true }) !== "aperta") notFound();
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
  const learnerOnly = isLearnerOnly(access.role);
  // (8.0d-1) «Solo questo use case» resta dentro l'Agent Factory e il progetto del suo caso (`caseOnlyRedirect`, per
  // segmenti): fuori torna all'Agent Factory. Ogni pagina del perimetro ricontrolla da sé (porta e predicato).
  const caseOnlyDestination = caseOnlyRedirect({ role: access.role, pathname, workspaceId });
  if (caseOnlyDestination) redirect(caseOnlyDestination);
  const caseOnly = isCaseOnly(access.role);
  const collaborator = isCollaboratorRole(access.role);

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
  // `/casi-duso` esatto va alla Panoramica solo quando ogni dossier completo ha la sua scheda
  // (`dossierLinksReady`). Finché no, o se la lettura non riesce, la voce resta: un dossier
  // senza scheda non sta né su una scheda né nella Panoramica. Il redirect sta qui e non in
  // pagina: sotto `casi-duso/loading.tsx` risponderebbe 200 con una meta refresh (H6a).
  const ucOn = process.env.UC_ENABLED === "true";
  let dossierLinksAreReady = false;
  if (useCaseHub && ucOn && collaborator) {
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
  const learningAvailable = process.env.LEARNING_ENABLED === "true" && !caseOnly
    ? await (await import("@/lib/learning/server")).hasLearningForWorkspace(workspaceId)
    : false;

  // Off by default (UC_ENABLED): the uc tables are read only when the section is on, behind to_regclass.
  const casesAvailable = ucOn && collaborator && !(useCaseHub && dossierLinksAreReady)
    ? await (await import("@/lib/db/queries/uc-nav")).ucCasesNavVisible({ userId: session.user.id, workspaceId, role: access.role })
    : false;

  // (8.1a) «Agent Factory»: chi costruisce in un caso del workspace, o il manager di Lateral Space. (8.0c) Anche chi
  // costruisce da fuori Lateral Space e oggi lo può fare: il predicato unico, con i domini di Lateral Space.
  // (8.0d) «Solo questo use case» ha sempre la sua voce sola (`workspaceNav`): qui non serve leggere niente.
  let factoryAvailable = false;
  if (useCaseHub && ucOn && collaborator) {
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
  // (8.0d) La campanella di «Solo questo use case» ha solo i tipi di chi costruisce, dei suoi casi (`loadBellPayload`).
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
      accountData={collaborator}
    >
      {children}
    </WorkspaceShell>
  );
}
