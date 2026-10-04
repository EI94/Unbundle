import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/auth/redirect-to-login";
import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { getWorkspaceAccessForUser } from "@/lib/workspace-access";
import {
  buildPortfolioSharePath,
  parsePortfolioReviewPath,
} from "@/lib/portfolio/share-link";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { learnerRedirect } from "@/lib/learning/learner-scope";
import { WorkspaceTopbar } from "@/components/portfolio/workspace-topbar";

async function portfolioReviewShareFallback(workspaceId: string) {
  const pathname = (await headers()).get("x-unbundle-pathname") ?? "";
  const reviewPath = parsePortfolioReviewPath(pathname);
  if (!reviewPath || reviewPath.workspaceId !== workspaceId) return null;
  try {
    return buildPortfolioSharePath(workspaceId, reviewPath.useCaseId);
  } catch {
    return null;
  }
}

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  let session = await auth();
  if (!session?.user?.id) {
    const shareFallback = await portfolioReviewShareFallback(workspaceId);
    if (shareFallback) redirect(shareFallback);
    session = await requireSession();
  }

  const access = await getWorkspaceAccessForUser(session.user.id, workspaceId);
  if (!access) {
    const shareFallback = await portfolioReviewShareFallback(workspaceId);
    if (shareFallback) redirect(shareFallback);
    notFound();
  }
  const { workspace } = access;

  // Chi entra da un link di corso ha il solo ruolo `learner`: va tenuto dentro
  // l'area Formazione. Senza questo la barra laterale gli aprirebbe Strategia,
  // Report, Blueprints e Intelligence, cioe' il piano di trasformazione del suo
  // datore di lavoro.
  const learnerDestination = learnerRedirect({
    role: access.role,
    pathname: (await headers()).get("x-unbundle-pathname") ?? "",
    workspaceId,
  });
  if (learnerDestination) redirect(learnerDestination);

  const learnerOnly = access.role === "learner";

  // Off by default: existing workspaces do not query the additive training tables.
  const learningAvailable = process.env.LEARNING_ENABLED === "true"
    ? await (await import("@/lib/learning/server")).hasLearningForWorkspace(workspaceId)
    : false;

  return (
    <SidebarProvider>
      <AppSidebar
        learnerOnly={learnerOnly}
        learningAvailable={learningAvailable}
        workspaceId={workspace.id}
        workspaceName={workspace.name}
        user={{
          name: session.user.name,
          email: session.user.email,
          image: session.user.image,
        }}
      />
      <SidebarInset>
        <WorkspaceTopbar workspaceId={workspaceId} />
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
