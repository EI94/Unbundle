import type { Metadata } from "next";
import { getTrainingRegister, listRegisterExports, requireRegisterAccess } from "@/lib/learning/register";
import { LearningError, learningEnabled } from "@/lib/learning/server";
import { LearningShell, LearningUnavailable } from "@/components/learning/learning-shell";
import { RegisterConsole } from "@/components/learning/register-console";

export const metadata: Metadata = { title: "Registro della formazione IA" };

export default async function TrainingRegisterPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const title = "Registro della formazione IA";
  if (!learningEnabled()) return <LearningShell workspaceId={workspaceId} title={title}><LearningUnavailable message="La formazione non è attiva in questo ambiente." /></LearningShell>;
  let access: Awaited<ReturnType<typeof requireRegisterAccess>>;
  try {
    access = await requireRegisterAccess(workspaceId);
  } catch (error) {
    if (!(error instanceof LearningError)) throw error;
    return <LearningShell workspaceId={workspaceId} title={title}>
      <LearningUnavailable message="Il registro è consultabile da chi amministra il workspace o gestisce un corso. Se ti serve, chiedilo al responsabile della formazione." />
    </LearningShell>;
  }
  const [register, exports] = await Promise.all([getTrainingRegister(access), listRegisterExports(workspaceId)]);
  return <LearningShell workspaceId={workspaceId} title={title}>
    <RegisterConsole
      key={`${workspaceId}:${access.userId}`}
      workspaceId={workspaceId}
      userId={access.userId}
      canEditSettings={access.canEditSettings}
      register={register}
      exports={exports}
    />
  </LearningShell>;
}
