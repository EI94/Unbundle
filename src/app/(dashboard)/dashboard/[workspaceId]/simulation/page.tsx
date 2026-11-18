import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { notFound } from "next/navigation";
import { getWorkspaceById } from "@/lib/db/queries/workspaces";
import { SimulationViewer } from "@/components/dashboard/simulation-viewer";
import { PAGE_TITLE_CLASS, PageContainer } from "@/components/dashboard/page-container";

export default async function SimulationPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {

  const { workspaceId } = await params;

  await requireWorkspacePage(workspaceId);
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) notFound();

  return (
    <PageContainer>
      <div className="mb-8">
        <h1 className={PAGE_TITLE_CLASS}>
          Simulazione &amp; Org Redesign
        </h1>
        <p className="mt-1 text-muted-foreground">
          Scenari &quot;what if&quot;, impatto su ruoli e AI OS implications
        </p>
      </div>
      <SimulationViewer workspaceId={workspaceId} />
    </PageContainer>
  );
}
