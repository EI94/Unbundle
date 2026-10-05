import Link from "next/link";
import { getLearningProgram, requireLearningEnrollment } from "@/lib/learning/server";
import { LearningShell, outcomeLabel } from "@/components/learning/learning-shell";
import { LearningRefresh } from "@/components/learning/learning-refresh";
import { LearnerResultSummary } from "@/components/learning/program-overview";

export default async function ProgressPage({ params }: { params: Promise<{ workspaceId: string; programId: string }> }) {
  const { workspaceId, programId } = await params;
  await requireLearningEnrollment(workspaceId, programId);
  const program = await getLearningProgram(workspaceId, programId);
  const base = `/dashboard/${workspaceId}/learning/${programId}`;
  const ownModule = program.modules.find((module) => module.id === program.ownSession?.moduleId) ?? program.modules.find((module) => module.id === "m1");
  const history = [...program.history].reverse();
  return <LearningShell workspaceId={workspaceId} title="Il mio risultato" back={{ href: base, label: "Torna al percorso" }}>
    <LearningRefresh label="Aggiorna" />
    {ownModule && <LearnerResultSummary module={ownModule} history={program.history} base={base} emptyText="Non hai ancora inviato risposte. Inizia dal percorso." />}
    <section aria-labelledby="learning-history" className="space-y-3">
      <h2 id="learning-history" className="text-lg font-semibold">Tutte le prove</h2>
      {history.length === 0 ? <p className="text-sm text-muted-foreground">Ancora nessuna prova.</p> : <ol className="space-y-2">{history.map((attempt) => {
        const parts = [attempt.activityTitle, `${attempt.attemptNumber}ª prova`];
        if (attempt.result) parts.push(`${attempt.result.correct}/${attempt.result.total} giuste`, outcomeLabel(attempt.result.status));
        else parts.push(outcomeLabel(attempt.status));
        return <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl border p-3" key={attempt.id}>
          <p className="min-w-0 flex-1">{parts.join(" · ")}</p>
          <Link className="inline-flex min-h-10 items-center text-sm underline underline-offset-4" href={`${base}/attempts/${attempt.id}`}>
            {attempt.status === "submitted" ? "Rivedi" : "Continua"}<span className="sr-only">: {attempt.activityTitle}, {attempt.attemptNumber}ª prova</span>
          </Link>
        </li>;
      })}</ol>}
    </section>
  </LearningShell>;
}
