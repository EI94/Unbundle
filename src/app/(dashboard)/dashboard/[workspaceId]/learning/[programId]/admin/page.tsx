import { getLearningAdminDetail } from "@/lib/learning/admin";
import { LearningShell } from "@/components/learning/learning-shell";
import { LearningAdminProgram } from "@/components/learning/admin-program";

export default async function LearningProgramAdminPage({ params }: { params: Promise<{ workspaceId: string; programId: string }> }) {
  const { workspaceId, programId } = await params;
  const data = await getLearningAdminDetail(workspaceId, programId);
  return <LearningShell workspaceId={workspaceId} title="Gestisci corso"><LearningAdminProgram workspaceId={workspaceId} initial={data} /></LearningShell>;
}
