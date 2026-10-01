import { getMyLearningIdea } from "@/lib/learning/ideas";
import { requireLearningEnrollment } from "@/lib/learning/server";
import { IdeaForm } from "@/components/learning/idea-form";
import { LearningShell } from "@/components/learning/learning-shell";
export default async function IdeasPage({ params }: { params: Promise<{ workspaceId: string; programId: string }> }) {
  const { workspaceId, programId } = await params;
  const { userId } = await requireLearningEnrollment(workspaceId, programId);
  const idea = await getMyLearningIdea(workspaceId, programId);
  return <LearningShell workspaceId={workspaceId} title="Dal corso al tuo lavoro"><IdeaForm workspaceId={workspaceId} programId={programId} userId={userId} initial={idea} /></LearningShell>;
}
