"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { answerInfoRequestAction } from "@/lib/actions/use-case-decisions";
import { ANSWER_MAX, ANSWER_TEXT, answerHint, groupedCount, parseAnswerText, questionLabel } from "@/lib/use-cases/answers";
import { ACTION_FAILED_MESSAGE } from "@/lib/use-cases/decision-ui";
import { cn } from "@/lib/utils";

export interface AnswerFormProps {
  workspaceId: string;
  useCaseId: string;
  /** La domanda: la nota pubblica di «Serve info», che chi ha proposto legge (D13). */
  question: string | null;
  /** Il nome del team che valuta, da solo (§14.2): «La domanda di AI Builder». */
  teamName: string;
  className?: string;
}

/**
 * «Rispondi» su «Serve info» (D17), per chi ha proposto: la domanda, il campo della
 * risposta (testo semplice, al massimo 2.000 caratteri) e «Invia la risposta». La risposta va al
 * servizio (`answerInfoRequestAction`) con la domanda letta, che controlla che la proposta sia di
 * chi scrive, che sia in «Serve info» e che la domanda sia ancora quella; poi la pagina si
 * rilegge e la fase torna «Da valutare». Se la domanda è cambiata, il testo resta nel campo e la
 * pagina si rilegge con la domanda nuova. Sta nel pannello e
 * nella scheda del contributore.
 */
export function AnswerForm({ workspaceId, useCaseId, question, teamName, className }: AnswerFormProps) {
  const baseId = `risposta-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const length = [...text].length;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const parsed = parseAnswerText(text);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        // La domanda letta va con la risposta: se nel frattempo è cambiata, niente si salva (§6.8).
        const result = await answerInfoRequestAction(workspaceId, useCaseId, parsed.value, question);
        if (result.ok) {
          setText("");
          toast.success(result.message ?? ANSWER_TEXT.toast);
        } else if (result.fieldErrors?.risposta) {
          setError(result.fieldErrors.risposta);
        } else {
          toast.error(result.message);
        }
      } catch {
        toast.error(ACTION_FAILED_MESSAGE);
      }
    });
  }

  return (
    <form data-slot="answer-form" onSubmit={submit} noValidate className={cn("space-y-3", className)}>
      {question ? (
        <div className="space-y-1">
          <p className="text-sm font-medium">{questionLabel(teamName)}</p>
          <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm whitespace-pre-line">{question}</p>
        </div>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor={`${baseId}-campo`}>{ANSWER_TEXT.label}</Label>
        <Textarea
          id={`${baseId}-campo`}
          name="risposta"
          value={text}
          rows={4}
          maxLength={ANSWER_MAX}
          placeholder={ANSWER_TEXT.placeholder}
          disabled={pending}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${baseId}-aiuto ${baseId}-errore` : `${baseId}-aiuto`}
          onChange={(event) => {
            setText(event.target.value);
            if (error) setError(null);
          }}
        />
        <div className="flex items-start justify-between gap-3 text-xs text-muted-foreground">
          <p id={`${baseId}-aiuto`}>{answerHint(teamName)}</p>
          <span className="shrink-0 tabular-nums">
            {groupedCount(length)} / {groupedCount(ANSWER_MAX)}
          </span>
        </div>
        {error ? (
          <p id={`${baseId}-errore`} role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      <Button type="submit" aria-busy={pending || undefined} disabled={pending} className="min-h-11 sm:min-h-8">
        {pending ? ANSWER_TEXT.sending : ANSWER_TEXT.submit}
      </Button>
    </form>
  );
}
