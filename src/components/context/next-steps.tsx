"use client";

import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { TOAST_UNDO_MS } from "@/components/ui-10/toast";
import { Button } from "@/components/ui/button";
import { closeCommitmentAction, closeQuestionAction, reopenCommitmentAction } from "@/lib/actions/context";
import { CONTEXT_TEXT } from "@/lib/context/text";
import type { CommitmentView, QuestionView } from "@/lib/db/queries/context-memory";
import { cn } from "@/lib/utils";
import { LsLock } from "./fact-row";
import { commitmentParty, dueText, firstRows, memoryCommitments } from "./view-model";

const T = CONTEXT_TEXT;

/**
 * «Impegni» (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §7.2; rilascio 10, §3.7 e prototipo S6): gli impegni
 * aperti in una lista sola, prima gli scaduti e poi per scadenza. Ogni riga: di chi è («Nostri», «Del cliente»), la
 * frase, il ruolo, «entro il 30 nov» («scaduto il 30 nov» se è passato). Al massimo tre in vista, poi «Vedi tutti (N)».
 * Per Lateral Space «Fatto» (fantasma), con la frase per i lettori di schermo; il messaggio che segue offre «Riapri».
 * Gli impegni valgono per ruolo e per parte, mai per persona.
 */
export function Commitments({
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
  const [all, setAll] = useState(false);
  const listId = useId();
  const items = memoryCommitments(nostri, cliente);
  if (items.length === 0) return null;
  const { shown, rest } = firstRows(items);
  return (
    <section aria-labelledby="contesto-impegni" className="space-y-2">
      <h2 id="contesto-impegni" className="text-base font-semibold">
        {T.sections.prossimiPassi}
      </h2>
      <ul id={listId} className="divide-y rounded-xl border">
        {(all ? items : shown).map((commitment) => (
          <CommitmentRow key={commitment.id} workspaceId={workspaceId} today={today} commitment={commitment} canEdit={canEdit} />
        ))}
      </ul>
      {rest > 0 ? (
        <button
          type="button"
          aria-expanded={all}
          aria-controls={listId}
          onClick={() => setAll(!all)}
          className="inline-flex min-h-11 items-center rounded-md text-sm font-medium underline decoration-foreground/40 underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-8"
        >
          {all ? T.page.showLess : T.page.showAll(items.length)}
        </button>
      ) : null}
    </section>
  );
}

function CommitmentRow({ workspaceId, today, commitment, canEdit }: { workspaceId: string; today: string; commitment: CommitmentView; canEdit: boolean }) {
  const [pending, startTransition] = useTransition();
  const statementId = useId();
  const due = dueText(commitment, today);
  const done = () =>
    startTransition(async () => {
      const result = await closeCommitmentAction(workspaceId, commitment.id, commitment.version);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(T.nextSteps.closed, {
        duration: TOAST_UNDO_MS,
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
    <li className="flex items-start justify-between gap-3 px-3 py-2.5">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm leading-relaxed break-words">
          <span className="text-muted-foreground">{commitmentParty(commitment)} · </span>
          <span id={statementId}>{commitment.statement}</span>
        </p>
        {commitment.roleLabel || due || commitment.visibility === "ls" ? (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            {commitment.roleLabel ? <span>{commitment.roleLabel}</span> : null}
            {due ? <span className={cn(commitment.overdue && "font-medium text-foreground")}>{due}</span> : null}
            {commitment.visibility === "ls" ? <LsLock /> : null}
          </p>
        ) : null}
      </div>
      {canEdit ? (
        <Button type="button" variant="ghost" className="-my-1 min-h-11 shrink-0 sm:min-h-8" disabled={pending} onClick={done} aria-describedby={statementId}>
          {T.nextSteps.done}
        </Button>
      ) : null}
    </li>
  );
}

/** «Domande aperte», dentro la sua sezione chiusa: la domanda e «Da chiedere a: {ruolo}». Per Lateral Space «Chiudi». */
export function OpenQuestions({ workspaceId, questions, canEdit }: { workspaceId: string; questions: readonly QuestionView[]; canEdit: boolean }) {
  if (questions.length === 0) return null;
  return (
    <ul className="divide-y rounded-xl border">
      {questions.map((question) => (
        <QuestionRow key={question.id} workspaceId={workspaceId} question={question} canEdit={canEdit} />
      ))}
    </ul>
  );
}

function QuestionRow({ workspaceId, question, canEdit }: { workspaceId: string; question: QuestionView; canEdit: boolean }) {
  const [pending, startTransition] = useTransition();
  const questionId = useId();
  const close = () =>
    startTransition(async () => {
      const result = await closeQuestionAction(workspaceId, question.id, question.version);
      if (result.ok) toast.success(T.questions.closed);
      else toast.error(result.message);
    });
  return (
    <li className="flex items-start justify-between gap-3 px-3 py-2.5">
      <div className="min-w-0 space-y-0.5">
        <p id={questionId} className="text-sm leading-relaxed break-words">
          {question.question}
        </p>
        {question.askWhom || question.visibility === "ls" ? (
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            {question.askWhom ? <span>{T.questions.askWhom(question.askWhom)}</span> : null}
            {question.visibility === "ls" ? <LsLock /> : null}
          </p>
        ) : null}
      </div>
      {canEdit ? (
        <Button type="button" variant="ghost" className="-my-1 min-h-11 shrink-0 sm:min-h-8" disabled={pending} onClick={close} aria-describedby={questionId}>
          {T.questions.close}
        </Button>
      ) : null}
    </li>
  );
}
