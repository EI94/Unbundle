import { getLearningActivity } from "@/lib/learning/server";
import { ActivityPlayer } from "@/components/learning/activity-player";
import { LearningShell } from "@/components/learning/learning-shell";
export default async function ActivityPage({ params }: { params: Promise<{ workspaceId: string; programId: string; activityId: string }> }) {
  const { workspaceId, programId, activityId } = await params;
  const data = await getLearningActivity(workspaceId, programId, activityId);
  return <LearningShell workspaceId={workspaceId} title={data.activity.title}><ActivityPlayer key={`${workspaceId}:${programId}:${activityId}:${data.userId}`} userId={data.userId} workspaceId={workspaceId} programId={programId} version={data.program.version} activity={data.activity} initialAttempt={data.attempt} /></LearningShell>;
}
