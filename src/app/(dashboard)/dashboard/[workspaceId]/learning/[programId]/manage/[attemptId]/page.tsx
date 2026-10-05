import { Check, EyeOff, Sparkles, X } from "lucide-react";
import { getLearningReviewAttempt } from "@/lib/learning/server";
import { LearningShell, outcomeLabel } from "@/components/learning/learning-shell";
import { ImportantTag } from "@/components/learning/results-charts";
import { dateTimeLabel, modeLabel, outcomeTone } from "@/components/learning/results-format";
import { resultsHref } from "@/components/learning/results-nav";
import { cn } from "@/lib/utils";

/**
 * Le risposte consegnate da una persona: domanda per domanda, che cosa ha
 * scelto, quale era la risposta giusta e perché. Poi le sue riflessioni e come
 * ha lavorato. Si arriva qui da «Risultati individuali».
 */
export default async function ReviewAttemptPage({ params, searchParams }: {
  params: Promise<{ workspaceId: string; programId: string; attemptId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ workspaceId, programId, attemptId }, query] = await Promise.all([params, searchParams]);
  // Il turno scelto nei Risultati, per tornare alla stessa lista.
  const turnoParam = Array.isArray(query.turno) ? query.turno[0] : query.turno;
  const turno = turnoParam ? turnoParam.slice(0, 100) : null;
  const { participant, attempt } = await getLearningReviewAttempt(workspaceId, programId, attemptId);
  const base = `/dashboard/${workspaceId}/learning/${programId}`;
  const result = attempt.result;
  const itemOf = (itemId: string) => attempt.activity.items.find((item) => item.id === itemId);
  const optionText = (itemId: string, optionId: string | null | undefined) =>
    (optionId && itemOf(itemId)?.options.find((option) => option.id === optionId)?.text) || "—";
  const essentialErrors = result?.essential_errors.length ?? 0;
  const mode = modeLabel(attempt.responses.mode);
  const fields = attempt.activity.requiredTextFields;

  return <LearningShell workspaceId={workspaceId} title={participant.name} back={{ href: resultsHref(base, "individuali", turno), label: "Risultati individuali" }}>
    <p className="flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-200">
      <EyeOff aria-hidden className="size-4 shrink-0" /> Vista con i nomi: non proiettarla in aula.
    </p>

    <section data-testid="attempt-summary" className="space-y-4 rounded-2xl border bg-card p-5 sm:p-6">
      <div className="space-y-1">
        {participant.email !== participant.name && <p className="break-words text-sm text-muted-foreground">{participant.email}</p>}
        <h2 className="text-xl font-semibold leading-snug">{attempt.activity.title}</h2>
        <p className="text-sm text-muted-foreground">
          Prova {attempt.attemptNumber}{attempt.submittedAt ? ` · Consegnato il ${dateTimeLabel(attempt.submittedAt)}` : ""}
        </p>
      </div>
      {result ? <div className="flex flex-wrap items-center gap-3">
        <p className="text-2xl font-semibold tabular-nums">{result.correct} {result.correct === 1 ? "risposta giusta" : "risposte giuste"} su {result.total}</p>
        <span className={cn("rounded-full border px-3 py-1 text-sm font-medium", outcomeTone(result.status))}>{outcomeLabel(result.status)}</span>
      </div> : <p className="text-muted-foreground">Risultato non disponibile.</p>}
      {essentialErrors > 0 && <p className="text-sm text-amber-200">
        {essentialErrors === 1 ? "1 domanda importante sbagliata: è la prima cosa da ripassare." : `${essentialErrors} domande importanti sbagliate: sono la prima cosa da ripassare.`}
      </p>}
    </section>

    {result && result.items.length > 0 && <section className="space-y-3">
      <h2 className="text-lg font-semibold">Le risposte</h2>
      <ol className="space-y-3">
        {result.items.map((answer, index) => {
          const item = itemOf(answer.itemId);
          const right = attempt.answerKey?.[answer.itemId];
          return <li key={answer.itemId} data-testid="attempt-answer" className="space-y-3 rounded-2xl border bg-card p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <span className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-full", answer.correct ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-200")}>
                {answer.correct ? <Check aria-hidden className="size-4" /> : <X aria-hidden className="size-4" />}
                <span className="sr-only">{answer.correct ? "Giusta" : "Sbagliata"}</span>
              </span>
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium uppercase tracking-wide">Domanda {index + 1}</span>
                  {answer.critical && <ImportantTag />}
                </div>
                <p className="font-medium leading-snug">{item?.prompt ?? "Domanda non più disponibile"}</p>
              </div>
            </div>
            <dl className="space-y-1.5 text-sm sm:pl-11">
              <div>
                <dt className="inline text-muted-foreground">Ha risposto: </dt>
                <dd className={cn("inline font-medium", answer.correct ? "text-emerald-300" : "text-amber-200")}>{optionText(answer.itemId, answer.selectedOptionId)}</dd>
              </div>
              {!answer.correct && <div>
                <dt className="inline text-muted-foreground">Risposta giusta: </dt>
                <dd className="inline font-medium text-emerald-300">{optionText(answer.itemId, right)}</dd>
              </div>}
            </dl>
            {answer.feedback && <p className="rounded-xl bg-muted/60 p-3 text-sm leading-relaxed sm:ml-11">
              <span className="font-medium">Perché: </span>{answer.feedback}
            </p>}
          </li>;
        })}
      </ol>
    </section>}

    {fields.length > 0 && <section className="space-y-3">
      <h2 className="text-lg font-semibold">Che cosa ha scritto</h2>
      {fields.map((field) => {
        const text = attempt.responses.fields[field.id]?.trim();
        return <div key={field.id} className="space-y-2 rounded-2xl border bg-card p-4 sm:p-5">
          <h3 className="text-sm font-medium text-muted-foreground">{field.label}</h3>
          {text ? <p className="whitespace-pre-wrap break-words leading-relaxed">{text}</p> : <p className="text-muted-foreground">Nessun testo.</p>}
        </div>;
      })}
    </section>}

    {mode && <p className="flex items-center gap-2 rounded-2xl border bg-card p-4 text-sm">
      <Sparkles aria-hidden className="size-4 shrink-0 text-sky-300" />
      <span><span className="text-muted-foreground">Come ha lavorato: </span><span className="font-medium">{mode}</span></span>
    </p>}
  </LearningShell>;
}
