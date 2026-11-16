"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { closeCommitmentAction, closeQuestionAction, reopenCommitmentAction } from "@/lib/actions/context";
import { CONTEXT_TEXT } from "@/lib/context/text";
import type { CommitmentView, QuestionView } from "@/lib/db/queries/context-memory";
import { LsLock } from "./fact-row";
import { dueText } from "./view-model";

const T = CONTEXT_TEXT;

/**
 * «Prossimi passi» (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §7.2): gli impegni aperti, «Nostri» e «Del
 * cliente», per scadenza. Ogni riga: la frase, il ruolo, «entro il 30 nov» («scaduto il 30 nov» se è passato). Per
 * Lateral Space «Fatto»; il messaggio che segue offre «Riapri». Gli impegni valgono per ruolo e per parte, mai per
 * persona.
 */
export function NextSteps({
  workspaceId,
  today,
  nostri,
  cliente,
  canEdit,
}: {
  workspaceId: string;
  today: string;
  nostri: readonly CommitmentView[];
  cliente: readonly CommitmentView[];
  canEdit: boolean;
}) {
  if (nostri.length === 0 && cliente.length === 0) return null;
  return (
    <section aria-labelledby="contesto-prossimi-passi" className="space-y-3">
      <h2 id="contesto-prossimi-passi" className="text-base font-semibold">
        {T.sections.prossimiPassi}
      </h2>
      {[
        { key: "nostri", label: T.nextSteps.ours, items: nostri },
        { key: "cliente", label: T.nextSteps.theirs, items: cliente },
      ]
        .filter((group) => group.items.length > 0)
        .map((group) => (
          <div key={group.key} className="space-y-1">
            <h3 className="px-3 text-xs font-medium text-muted-foreground">{group.label}</h3>
            <ul className="divide-y rounded-xl border">
              {group.items.map((commitment) => (
                <CommitmentRow key={commitment.id} workspaceId={workspaceId} today={today} commitment={commitment} canEdit={canEdit} />
              ))}
            </ul>
          </div>
        ))}
    </section>
  );
}

function CommitmentRow({ workspaceId, today, commitment, canEdit }: { workspaceId: string; today: string; commitment: CommitmentView; canEdit: boolean }) {
  const [pending, startTransition] = useTransition();
  const due = dueText(commitment, today);
  const done = () =>
    startTransition(async () => {
      const result = await closeCommitmentAction(workspaceId, commitment.id, commitment.version);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(T.nextSteps.closed, {
        action: {
          label: T.nextSteps.reopen,
          onClick: () => {
            void reopenCommitmentAction(workspaceId, commitment.id, commitment.version + 1).then((reopened) => {
              if (!reopened.ok) toast.error(reopened.message);
            });
          },
        },
      });
    });
  return (
    <li className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm leading-relaxed break-words">{commitment.statement}</p>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          {commitment.roleLabel ? <span>{commitment.roleLabel}</span> : null}
          {due ? <span className={commitment.overdue ? "font-medium text-foreground" : undefined}>{due}</span> : null}
          {commitment.visibility === "ls" ? <LsLock /> : null}
        </p>
      </div>
      {canEdit ? (
        <Button type="button" variant="outline" className="min-h-11 shrink-0 sm:min-h-8" disabled={pending} onClick={done}>
          {T.nextSteps.done}
        </Button>
      ) : null}
    </li>
  );
}

/** «Domande aperte»: la domanda e «Da chiedere a: {ruolo}». Per Lateral Space «Chiusa». */
export function OpenQuestions({ workspaceId, questions, canEdit }: { workspaceId: string; questions: readonly QuestionView[]; canEdit: boolean }) {
  if (questions.length === 0) return null;
  return (
    <section aria-labelledby="contesto-domande" className="space-y-2">
      <h2 id="contesto-domande" className="text-base font-semibold">
        {T.sections.domande}
      </h2>
      <ul className="divide-y rounded-xl border">
        {questions.map((question) => (
          <QuestionRow key={question.id} workspaceId={workspaceId} question={question} canEdit={canEdit} />
        ))}
      </ul>
    </section>
  );
}

function QuestionRow({ workspaceId, question, canEdit }: { workspaceId: string; question: QuestionView; canEdit: boolean }) {
  const [pending, startTransition] = useTransition();
  const close = () =>
    startTransition(async () => {
      const result = await closeQuestionAction(workspaceId, question.id, question.version);
      if (result.ok) toast.success(T.questions.closed);
      else toast.error(result.message);
    });
  return (
    <li className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm leading-relaxed break-words">{question.question}</p>
        {question.askWhom || question.visibility === "ls" ? (
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            {question.askWhom ? <span>{T.questions.askWhom(question.askWhom)}</span> : null}
            {question.visibility === "ls" ? <LsLock /> : null}
          </p>
        ) : null}
      </div>
      {canEdit ? (
        <Button type="button" variant="outline" className="min-h-11 shrink-0 sm:min-h-8" disabled={pending} onClick={close}>
          {T.questions.close}
        </Button>
      ) : null}
    </li>
  );
}
