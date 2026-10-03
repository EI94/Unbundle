import Link from "next/link";
import { getLearningProgram, requireLearningEnrollment } from "@/lib/learning/server";
import { LearningShell, outcomeLabel } from "@/components/learning/learning-shell";
import { LearningRefresh } from "@/components/learning/learning-refresh";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
export default async function ProgressPage({ params }: { params: Promise<{ workspaceId: string; programId: string }> }) {
  const { workspaceId, programId } = await params;
  await requireLearningEnrollment(workspaceId, programId);
  const program = await getLearningProgram(workspaceId, programId);
  const completed = new Set(program.history.filter(attempt => attempt.status === "submitted").map(attempt => attempt.activityId));
  const m1Module = program.modules.find(module => module.id === "m1");
  return <LearningShell workspaceId={workspaceId} title="I miei progressi">
    <LearningRefresh />
    <Card><CardHeader><CardTitle>Attività ed esito</CardTitle></CardHeader><CardContent className="space-y-3">
      <p>Attività richieste consegnate: {Number(completed.has("m1-case")) + Number(completed.has("m1-exit-a") || completed.has("m1-exit-b"))}/2. Il checkpoint è formativo.</p>
      {m1Module?.learningOutcome && <p className="font-medium">Esito del modulo: {outcomeLabel(m1Module.learningOutcome)}</p>}
      <p>Il completamento registra la consegna; l’esito indica i punti consolidati e quelli da riprendere. Presenza e fiducia personale non sono voti.</p>
      <p>Il primo tentativo resta conservato. Il recupero usa una variante didattica: non è una misura validata del miglioramento.</p>
    </CardContent></Card>
    {program.history.length === 0 ? <p>Nessun tentativo ancora iniziato.</p> : <ol className="space-y-3">{program.history.map(attempt => <li className="space-y-2 rounded-lg border p-4" key={attempt.id}>
      <p className="font-medium">{attempt.activityTitle} · Tentativo {attempt.attemptNumber}</p>
      <p>{outcomeLabel(attempt.status)}{attempt.result ? ` · ${outcomeLabel(attempt.result.status)} · ${attempt.result.correct}/${attempt.result.total}` : ""}</p>
      <Link className="inline-block underline" href={`/dashboard/${workspaceId}/learning/${programId}/attempts/${attempt.id}`}>{attempt.status === "submitted" ? "Leggi il feedback di questo tentativo" : "Apri questa bozza"}</Link>
    </li>)}</ol>}
  </LearningShell>;
}
