import Link from "next/link";
import { getLearningActivity } from "@/lib/learning/server";
import { ActivityPlayer } from "@/components/learning/activity-player";
import { LearningShell } from "@/components/learning/learning-shell";
import { LearningRefresh } from "@/components/learning/learning-refresh";

export default async function ActivityPage({ params }: { params: Promise<{ workspaceId: string; programId: string; activityId: string }> }) {
  const { workspaceId, programId, activityId } = await params;
  const data = await getLearningActivity(workspaceId, programId, activityId);
  return <LearningShell workspaceId={workspaceId} title={data.activityTitle}>
    {!data.activity ? <section className="space-y-4 rounded-xl border p-5">
      <h2 className="text-lg font-semibold">{data.availability.state === "scheduled" ? "Attività in programma" : "Attività non aperta"}</h2>
      <p>{data.availability.reason}</p>
      <p>Non è stato avviato alcun tentativo. Puoi aggiornare questa pagina quando arriva l’orario previsto o il formatore apre il turno.</p>
      <div className="flex flex-wrap items-center gap-4"><LearningRefresh label="Verifica disponibilità" /><Link className="underline" href={`/dashboard/${workspaceId}/learning/${programId}`}>Torna al percorso</Link></div>
    </section> : <ActivityPlayer key={`${workspaceId}:${programId}:${activityId}:${data.userId}`} userId={data.userId} workspaceId={workspaceId} programId={programId} version={data.program.version} activity={data.activity} initialAttempt={data.attempt} />}
  </LearningShell>;
}
