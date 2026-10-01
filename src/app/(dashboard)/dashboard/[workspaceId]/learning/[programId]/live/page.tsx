import { getLearningLive } from "@/lib/learning/server";
import { LearningShell } from "@/components/learning/learning-shell";
export default async function LivePage({ params }: { params: Promise<{ workspaceId: string; programId: string }> }) {
  const { workspaceId, programId } = await params;
  const data = await getLearningLive(workspaceId, programId);
  return <LearningShell workspaceId={workspaceId} title={`In aula · ${data.program.title}`}>
    <p>Solo dati aggregati nel perimetro autorizzato. Nessun nominativo, testo libero o classifica.</p>
    {data.suppressed ? <p className="rounded-lg border p-5">Gruppo sotto la soglia minima di {data.minimum}: dettagli non disponibili.</p> : <><p>Iscritti: {data.enrolled}. Si considera la prima consegna per attività, senza attribuire zero a chi non ha risposto.</p><div className="grid gap-4 sm:grid-cols-3">{data.activities.map((activity) => <section key={activity.id} className="space-y-3 rounded-xl border p-5"><h2 className="font-semibold">{activity.title}</h2><p>Consegne: {activity.submitted ?? "Dettaglio soppresso"}</p><p>Esiti consolidati: {activity.consolidated ?? "Dettaglio soppresso"}</p></section>)}</div></>}
    <p className="text-sm text-muted-foreground">Soglia {data.minimum}; anche i sottogruppi piccoli vengono soppressi. Aggiorna la pagina per ricevere nuove consegne. Il dato descrive queste prove, non le capacità professionali delle persone.</p>
  </LearningShell>;
}
