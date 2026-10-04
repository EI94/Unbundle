import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { redirect } from "next/navigation";

/** Anteprima e modifica sono state unificate nella pagina "Domande e anteprima". */
export default async function AiReadinessSurveyPreviewPage({
  params,
}: {
  params: Promise<{ workspaceId: string; assessmentId: string }>;
}) {
  const { workspaceId, assessmentId } = await params;
  await requireWorkspacePage(workspaceId);
  redirect(`/dashboard/${workspaceId}/ai-readiness/questions/${assessmentId}`);
}
