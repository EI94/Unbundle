import Link from "next/link";
import { getLearningReviewAttempt } from "@/lib/learning/server";
import { LearningShell, outcomeLabel } from "@/components/learning/learning-shell";
export default async function ReviewPage({ params }: { params: Promise<{ workspaceId: string; programId: string; attemptId: string }> }) {
  const { workspaceId, programId, attemptId } = await params;
  const { participant, attempt } = await getLearningReviewAttempt(workspaceId, programId, attemptId);
  return <LearningShell workspaceId={workspaceId} title={`Evidenze · ${participant.name}`}>
    <Link className="underline" href={`/dashboard/${workspaceId}/learning/${programId}/manage`}>Torna alla vista formatori</Link>
    <p>Vista riservata. {attempt.activity.title} · Tentativo {attempt.attemptNumber} · Versione {attempt.version}</p>
    <p>{outcomeLabel(attempt.result?.status)} · {attempt.result?.correct}/{attempt.result?.total}</p>
    {attempt.result?.items.map((result) => {
      const item = attempt.activity.items.find((item) => item.id === result.itemId);
      return <section key={result.itemId} className="space-y-2 rounded-lg border p-4"><h2 className="font-medium">{item?.prompt}</h2><p>Risposta: {item?.options.find((option) => option.id === result.selectedOptionId)?.text}</p><p>{result.correct ? "Corretto" : "Da riprendere"}{result.critical ? " · punto essenziale" : ""}</p><p>{result.feedback}</p></section>;
    })}
    {attempt.activity.requiredTextFields.map((field) => <section className="rounded-lg border p-4" key={field.id}><h2 className="font-medium">{field.label}</h2><p className="whitespace-pre-wrap break-words">{attempt.responses.fields[field.id]}</p><p className="text-sm text-muted-foreground">Riflessione non valutata automaticamente.</p></section>)}
    {attempt.responses.mode && <p>Modalità dichiarata: {attempt.responses.mode === "review_reference_output" ? "Analisi dell’esempio preparato" : "Assistente autorizzato"}.</p>}
  </LearningShell>;
}
