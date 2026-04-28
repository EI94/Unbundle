import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { getWorkspaceAccessForUser } from "@/lib/workspace-access";
import {
  buildPortfolioSharePath,
  parsePortfolioReviewPath,
} from "@/lib/portfolio/share-link";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
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
  const session = await auth();
  if (!session?.user?.id) {
    const shareFallback = await portfolioReviewShareFallback(workspaceId);
    if (shareFallback) redirect(shareFallback);
    redirect("/login");
  }

  const access = await getWorkspaceAccessForUser(session.user.id, workspaceId);
  if (!access) {
    const shareFallback = await portfolioReviewShareFallback(workspaceId);
    if (shareFallback) redirect(shareFallback);
    notFound();
  }
  const { workspace } = access;

  return (
    <SidebarProvider>
      <AppSidebar
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
