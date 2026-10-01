import Link from "next/link";
import { getLearningManage } from "@/lib/learning/server";
import { LearningShell, outcomeLabel } from "@/components/learning/learning-shell";
import { LearningExportButton } from "@/components/learning/export-button";
export default async function ManagePage({ params }: { params: Promise<{ workspaceId: string; programId: string }> }) {
  const { workspaceId, programId } = await params;
  const data = await getLearningManage(workspaceId, programId);
  const base = `/dashboard/${workspaceId}/learning/${programId}`;
  return <LearningShell workspaceId={workspaceId} title={`Formatori · ${data.program.title}`}>
    <p>Vista nominativa riservata alle coorti autorizzate. Non proiettare questa pagina. Le bozze personali non sono consultabili.</p>
    {data.program.canAggregate && <Link className="underline" href={`${base}/live`}>Apri vista aggregata per l’aula</Link>}
    <p>Iscritti nel tuo perimetro: {data.participants.length}. Le persone senza consegna non sono conteggiate come zero nelle verifiche.</p>
    {data.program.canExport && <LearningExportButton workspaceId={workspaceId} programId={programId} />}
    <div className="space-y-4">{data.participants.map((participant) => <section key={participant.userId} className="space-y-3 rounded-xl border p-5"><h2 className="font-semibold">{participant.name}</h2><p className="break-words text-sm">{participant.email} · {participant.cohortId}</p>{participant.attempts.length === 0 ? <p>Non iniziato</p> : <ul className="space-y-2">{participant.attempts.map((attempt) => <li key={attempt.id} className="border-t pt-2"><p>{attempt.activityId} · Tentativo {attempt.attemptNumber} · {outcomeLabel(attempt.status)}</p>{attempt.result && <p>{outcomeLabel(attempt.result.status)} · {attempt.result.correct}/{attempt.result.total} · Punti essenziali da riprendere: {attempt.result.essentialErrors}</p>}{attempt.status === "submitted" && <Link className="underline" href={`${base}/manage/${attempt.id}`}>Leggi evidenze e feedback</Link>}</li>)}</ul>}</section>)}</div>
  </LearningShell>;
}
