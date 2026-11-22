import { getMyLearningIdea } from "@/lib/learning/ideas";
import { requireLearningEnrollment } from "@/lib/learning/server";
import { IdeaForm } from "@/components/learning/idea-form";
import { LearningShell } from "@/components/learning/learning-shell";
import { LEARNING_TEXT } from "@/lib/learning/text";
export default async function IdeasPage({ params }: { params: Promise<{ workspaceId: string; programId: string }> }) {
  const { workspaceId, programId } = await params;
  const { userId, program } = await requireLearningEnrollment(workspaceId, programId);
  const idea = await getMyLearningIdea(workspaceId, programId);
  return <LearningShell workspaceId={workspaceId} title="Dal corso al tuo lavoro" back={{ href: `/dashboard/${workspaceId}/learning/${programId}`, label: LEARNING_TEXT.backToCourse }} size="narrow"><IdeaForm key={`${workspaceId}:${programId}:${userId}:${program.status}`} workspaceId={workspaceId} programId={programId} userId={userId} initial={idea} readOnly={program.status !== "published"} /></LearningShell>;
}
