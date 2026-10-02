import { getLearningAttempt } from "@/lib/learning/server";
import { ActivityPlayer } from "@/components/learning/activity-player";
import { LearningShell } from "@/components/learning/learning-shell";
export default async function AttemptPage({ params }: { params: Promise<{ workspaceId: string; programId: string; attemptId: string }> }) {
  const { workspaceId, programId, attemptId } = await params;
  const attempt = await getLearningAttempt(workspaceId, programId, attemptId);
  return <LearningShell workspaceId={workspaceId} title={attempt.activity.title}><ActivityPlayer key={attempt.id} userId={attempt.userId} workspaceId={workspaceId} programId={programId} version={attempt.version} activity={attempt.activity} initialAttempt={attempt} /></LearningShell>;
}
