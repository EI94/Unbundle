import type { Metadata } from "next";
import { getTrainingRegister, listRegisterExports, requireRegisterAccess } from "@/lib/learning/register";
import { LearningError, learningEnabled } from "@/lib/learning/server";
import { LEARNING_TEXT } from "@/lib/learning/text";
import { LearningShell, LearningUnavailable } from "@/components/learning/learning-shell";
import { RegisterConsole } from "@/components/learning/register-console";

const G = LEARNING_TEXT.register;

export const metadata: Metadata = { title: G.title };

/**
 * Il «Registro della formazione AI» (rilascio 10, ondata 7a, §3.9): a schermo «AI»; il PDF e l'Excel tengono il loro
 * titolo e la loro norma. Si apre da «Gestisci formazione», dove si torna.
 */
export default async function TrainingRegisterPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const back = { href: `/dashboard/${workspaceId}/learning/admin`, label: G.back };
  if (!learningEnabled()) return <LearningShell workspaceId={workspaceId} title={G.title} back={back}><LearningUnavailable message={G.off} /></LearningShell>;
  let access: Awaited<ReturnType<typeof requireRegisterAccess>>;
  try {
    access = await requireRegisterAccess(workspaceId);
  } catch (error) {
    if (!(error instanceof LearningError)) throw error;
    return <LearningShell workspaceId={workspaceId} title={G.title} back={back}>
      <LearningUnavailable message={G.denied} />
    </LearningShell>;
  }
  const [register, exports] = await Promise.all([getTrainingRegister(access), listRegisterExports(workspaceId)]);
  return <LearningShell workspaceId={workspaceId} title={G.title} back={back}>
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
