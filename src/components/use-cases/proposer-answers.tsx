import { ANSWER_TEXT, type InfoAnswer } from "@/lib/use-cases/answers";
import { formatDate } from "@/lib/use-cases/format";
import { cn } from "@/lib/utils";

export interface ProposerAnswersProps {
  /** Le risposte di `intake.risposte` (`answersOf`), dalla più vecchia. */
  answers: readonly InfoAnswer[];
  /**
   * `tutte` (scheda, capitolo «Decisione»): ogni risposta, dalla più recente, sotto «Risposte di
   * chi ha proposto». `ultima` (pannello laterale): solo l'ultima, sotto «Risposta di chi ha
   * proposto».
   */
  show?: "tutte" | "ultima";
  className?: string;
}

/**
 * Le risposte di chi ha proposto a «Serve info» (D17), per i revisori: data e testo. Mai chi le
 * ha scritte (è chi ha proposto, che la Storia non nomina, §10.3). Stanno dopo la domanda del
 * team (la nota pubblica): prima la domanda, poi la risposta. Nella scheda (capitolo
 * «Decisione») e nel pannello laterale, dove una risposta ricevuta riporta lo use case in «Da
 * decidere» con la pillola «Nuova».
 */
export function ProposerAnswers({ answers, show = "tutte", className }: ProposerAnswersProps) {
  if (!answers.length) return null;
  const shown = show === "ultima" ? answers.slice(-1) : [...answers].reverse();
  return (
    <div data-slot="proposer-answers" className={cn("space-y-2", className)}>
      <p className="text-sm font-medium">{show === "ultima" ? ANSWER_TEXT.reviewerLatestTitle : ANSWER_TEXT.reviewerTitle}</p>
      <ol className="space-y-2">
        {shown.map((answer) => (
          <li key={`${answer.at}-${answer.text.length}`} className="space-y-0.5 rounded-lg bg-muted/60 px-3 py-2 text-sm">
            <p className="text-xs text-muted-foreground">
              {ANSWER_TEXT.answeredOn} {formatDate(answer.at) ?? ""}
            </p>
            <p className="whitespace-pre-line break-words">{answer.text}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * La propria risposta a «Serve info», per chi ha proposto (D17): sotto la domanda, finché
 * nessuno decide. Nel pannello e nella scheda del contributore.
 */
export function OwnAnswer({ answer, className }: { answer: InfoAnswer; className?: string }) {
  return (
    <div data-slot="own-answer" className={cn("space-y-1", className)}>
      <p className="text-sm font-medium">{ANSWER_TEXT.label}</p>
      <div className="space-y-0.5 rounded-lg bg-muted/60 px-3 py-2 text-sm">
        <p className="text-xs text-muted-foreground">
          {ANSWER_TEXT.answeredOn} {formatDate(answer.at) ?? ""}
        </p>
        <p className="whitespace-pre-line break-words">{answer.text}</p>
      </div>
    </div>
  );
}
