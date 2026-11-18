import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { getLatestBlueprints } from "@/lib/actions/blueprints";
import { canReviewWorkspacePortfolio } from "@/lib/workspace-permissions";
import { notFound } from "next/navigation";
import { getWorkspaceById } from "@/lib/db/queries/workspaces";
import { BlueprintViewer } from "@/components/dashboard/blueprint-viewer";
import { PAGE_TITLE_CLASS, PageContainer } from "@/components/dashboard/page-container";

export default async function BlueprintsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {

  const { workspaceId } = await params;

  const { access } = await requireWorkspacePage(workspaceId);
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) notFound();

  return (
    <PageContainer>
      <div className="mb-8">
        <h1 className={PAGE_TITLE_CLASS}>
          Agent Blueprinting
        </h1>
        <p className="mt-1 text-muted-foreground">
          Blueprint tecnici per gli agenti AI che implementeranno i use case
        </p>
      </div>
      <BlueprintViewer
        workspaceId={workspaceId}
        canGenerate={canReviewWorkspacePortfolio(access.role)}
        initialBlueprints={(await getLatestBlueprints(workspaceId)) ?? []}
      />
    </PageContainer>
  );
}
