import type { Metadata } from "next";
import { getLearningAdminDetail } from "@/lib/learning/admin";
import { adminTab } from "@/lib/learning/manage-view";
import { LEARNING_TEXT } from "@/lib/learning/text";
import { LearningShell } from "@/components/learning/learning-shell";
import { LearningAdminProgram } from "@/components/learning/admin-program";
import { LearningForbidden, isLearningForbidden } from "@/components/learning/learning-forbidden";

export const metadata: Metadata = { title: LEARNING_TEXT.manage.title };

// L'istante della lettura si prende qui, fuori dal render.
async function loadDetail(workspaceId: string, programId: string) {
  const data = await getLearningAdminDetail(workspaceId, programId);
  return { data, now: Date.now() };
}

/**
 * «Gestisci» un corso (rilascio 10, ondata 7a, §3.9): l'H1 è il titolo del corso; le quattro schede hanno il loro
 * indirizzo (`?scheda=lezioni|materiali|persone|impostazioni`, «Lezioni» senza parametro).
 */
export default async function LearningProgramAdminPage({ params, searchParams }: {
  params: Promise<{ workspaceId: string; programId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ workspaceId, programId }, query] = await Promise.all([params, searchParams]);
  let loaded: Awaited<ReturnType<typeof loadDetail>>;
  try {
    loaded = await loadDetail(workspaceId, programId);
  } catch (error) {
    // Senza il permesso di gestire il corso (anche chi amministra il workspace): la spiegazione, non l'errore.
    if (isLearningForbidden(error)) return <LearningForbidden workspaceId={workspaceId} title={LEARNING_TEXT.manage.title} message={LEARNING_TEXT.forbidden.manage} />;
    throw error;
  }
  const { data, now } = loaded;
  const raw = Array.isArray(query.scheda) ? query.scheda[0] : query.scheda;
  return <LearningShell workspaceId={workspaceId} title={data.program.title} back={{ href: `/dashboard/${workspaceId}/learning/${programId}`, label: LEARNING_TEXT.backToCourse }}>
    <LearningAdminProgram key={`${workspaceId}:${programId}:${data.userId}`} workspaceId={workspaceId} initial={data} initialTab={adminTab(raw)} initialNow={now} />
  </LearningShell>;
}
