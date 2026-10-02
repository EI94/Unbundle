import { auth } from "@/lib/auth";
import { LearningSessionBoundary } from "@/components/learning/session-boundary";

export default async function LearningLayout({ children, params }: { children: React.ReactNode; params: Promise<{ workspaceId: string }> }) {
  const [{ workspaceId }, session] = await Promise.all([params, auth()]);
  // The existing dashboard handles missing-session redirects. All Learning
  // reads/actions still enforce their own membership, object and role checks.
  if (!session) return children;
  return <LearningSessionBoundary key={`${workspaceId}:${session.user.id}`} workspaceId={workspaceId} expectedUserId={session.user.id}>{children}</LearningSessionBoundary>;
}
