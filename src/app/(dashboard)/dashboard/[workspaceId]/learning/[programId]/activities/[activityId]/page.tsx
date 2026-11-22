import { getLearningActivity } from "@/lib/learning/server";
import { activityWatchFrom, notOpenSentence } from "@/lib/learning/exercise-view";
import { LEARNING_TEXT } from "@/lib/learning/text";
import { ActivityPlayer } from "@/components/learning/activity-player";
import { LearningShell } from "@/components/learning/learning-shell";
import { LiveRefresh } from "@/components/learning/live-refresh";

// L'istante della lettura si prende qui, fuori dal render.
async function loadActivity(workspaceId: string, programId: string, activityId: string) {
  const data = await getLearningActivity(workspaceId, programId, activityId);
  return { ...data, now: Date.now() };
}

/**
 * L'esercizio. (Rilascio 10, ondata 7a, audit Fuori §4.3) Non ancora aperto: una frase sola («Si apre alle 15:00, quando
 * chi tiene il corso dà il via.»), il controllo da solo ogni 15 secondi al posto di «Aggiorna», un solo ritorno al corso.
 */
export default async function ActivityPage({ params }: { params: Promise<{ workspaceId: string; programId: string; activityId: string }> }) {
  const { workspaceId, programId, activityId } = await params;
  const data = await loadActivity(workspaceId, programId, activityId);
  const base = `/dashboard/${workspaceId}/learning/${programId}`;
  const watch = data.activity ? null : activityWatchFrom(data.availability, data.now);
  return <LearningShell workspaceId={workspaceId} title={data.activityTitle} back={{ href: base, label: LEARNING_TEXT.backToCourse }} size="narrow">
    {!data.activity ? <>
      {watch !== null ? <LiveRefresh from={watch} /> : null}
      <p data-testid="learning-not-open" className="rounded-xl border bg-card p-4 text-base">{notOpenSentence(data.availability, data.now)}</p>
    </> : <ActivityPlayer key={`${workspaceId}:${programId}:${activityId}:${data.userId}`} userId={data.userId} workspaceId={workspaceId} programId={programId} version={data.program.version} activity={data.activity} initialAttempt={data.attempt} />}
  </LearningShell>;
}
