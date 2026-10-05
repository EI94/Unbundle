import Link from "next/link";
import { getLearningActivity } from "@/lib/learning/server";
import { ActivityPlayer } from "@/components/learning/activity-player";
import { LearningShell } from "@/components/learning/learning-shell";
import { LearningRefresh } from "@/components/learning/learning-refresh";

export default async function ActivityPage({ params }: { params: Promise<{ workspaceId: string; programId: string; activityId: string }> }) {
  const { workspaceId, programId, activityId } = await params;
  const data = await getLearningActivity(workspaceId, programId, activityId);
  const base = `/dashboard/${workspaceId}/learning/${programId}`;
  const scheduled = data.availability.state === "scheduled";
  return <LearningShell workspaceId={workspaceId} title={data.activityTitle} back={{ href: base, label: "Torna al percorso" }}>
    {!data.activity ? <section className="space-y-4 rounded-2xl border bg-card p-5 sm:p-6">
      <h2 className="text-lg font-semibold">{scheduled ? "Si apre durante la lezione" : "Per ora non è aperta"}</h2>
      {data.availability.reason && <p>{data.availability.reason}</p>}
      {scheduled && <p className="text-sm text-muted-foreground">Quando il formatore la apre, premi Aggiorna.</p>}
      <div className="flex flex-wrap items-center gap-4"><LearningRefresh label="Aggiorna" /><Link className="inline-flex min-h-10 items-center underline underline-offset-4" href={base}>Torna al percorso</Link></div>
    </section> : <ActivityPlayer key={`${workspaceId}:${programId}:${activityId}:${data.userId}`} userId={data.userId} workspaceId={workspaceId} programId={programId} version={data.program.version} activity={data.activity} initialAttempt={data.attempt} />}
  </LearningShell>;
}
