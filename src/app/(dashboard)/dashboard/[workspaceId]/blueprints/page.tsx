import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { getWorkspaceById } from "@/lib/db/queries/workspaces";
import { BlueprintViewer } from "@/components/dashboard/blueprint-viewer";

export default async function BlueprintsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { workspaceId } = await params;
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) notFound();

  return (
    <div className="flex-1 p-6 lg:p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">
          Agent Blueprinting
        </h1>
        <p className="mt-1 text-muted-foreground">
          Blueprint tecnici per gli agenti AI che implementeranno i use case
        </p>
      </div>
      <BlueprintViewer workspaceId={workspaceId} />
    </div>
  );
}
