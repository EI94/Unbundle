"use client";

import { useActionState, useId, useState } from "react";
import { ChevronRight, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import {
  customizeAssessmentQuestionAction,
  type AiReadinessActionState,
} from "@/lib/actions/ai-readiness";
import { READINESS_TEXT } from "@/lib/ai-readiness/dashboard-text";
import type { AiReadinessQuestion } from "@/lib/ai-readiness/types";
import { CONFIRM_TEXT } from "@/lib/confirm-text";
import { ActionMenu } from "@/components/uc/ui/action-menu";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, useSubmitConfirmation } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Fold } from "@/components/ui-10/fold";
import { cn } from "@/lib/utils";
import { downloadFile } from "./assessment-actions";

const INITIAL: AiReadinessActionState = { ok: true };
const ASK = CONFIRM_TEXT.aiReadiness;
const Q = READINESS_TEXT.questions;
const FIELD = "h-11 text-base sm:h-9 sm:text-sm";

type SectionView = {
  id: string;
  title: string;
  area: string;
  description?: string;
};

/** «Scarica ▾» della pagina «Domande»: i cinque file di oggi, in un menu (audit «Fuori» AD-14). */
export function QuestionDownloads({ assessmentId }: { assessmentId: string }) {
  const base = `/api/ai-readiness/assessments/${assessmentId}/questions-export`;
  const D = Q.downloads;
  return (
    <ActionMenu
      trigger="altro"
      label={Q.download}
      items={[
        { label: D.everyonePdf, onSelect: () => downloadFile(`${base}?track=everyone&format=pdf`) },
        { label: D.everyoneXlsx, onSelect: () => downloadFile(`${base}?track=everyone&format=xlsx`) },
        { label: D.internalPdf, onSelect: () => downloadFile(`${base}?track=internal&format=pdf`) },
        { label: D.internalXlsx, onSelect: () => downloadFile(`${base}?track=internal&format=xlsx`) },
        { label: D.useCasePdf, onSelect: () => downloadFile(`${base}?track=use_case&format=pdf`) },
      ]}
    />
  );
}

function kindOf(question: AiReadinessQuestion): string {
  return question.answerType === "scale" ? Q.scale : question.answerType === "single_choice" ? Q.choice : Q.text;
}

/**
 * Le domande di una rilevazione (rilascio 10, ondata 7b, §3.9; audit «Fuori» AD-14, §8.4): righe chiuse, una per
 * domanda, con il tipo e i segni («obbligatoria», «aggiunta», «modificata»); aperta, la riga mostra i livelli e
 * «Modifica» e «Rimuovi». Rimuovere chiede prima nella finestra dell'app e si annulla con «Ripristina» dalle domande
 * rimosse. Ogni campo ha la sua etichetta. Le azioni sono quelle di oggi.
 */
export function QuestionEditor({
  workspaceId,
  assessmentId,
  sections,
  questions,
  removedQuestions,
  editedIds,
  hasResponses,
}: {
  workspaceId: string;
  assessmentId: string;
  sections: SectionView[];
  questions: AiReadinessQuestion[];
  removedQuestions: AiReadinessQuestion[];
  editedIds: string[];
  hasResponses: boolean;
}) {
  const action = customizeAssessmentQuestionAction.bind(null, workspaceId, assessmentId);
  const [state, formAction, pending] = useActionState(action, INITIAL);
  // «Rimuovi» chiede prima, nella finestra dell'app; la conferma rimanda il modulo di quella domanda.
  const removal = useSubmitConfirmation();
  const [openId, setOpenId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingSection, setAddingSection] = useState<string | null>(null);
  const edited = new Set(editedIds);
  // Il numero di ogni domanda, nell'ordine delle sezioni.
  const numbers = new Map(sections.flatMap((section) => questions.filter((q) => q.sectionId === section.id)).map((q, index) => [q.id, index + 1]));

  return (
    <div className="space-y-8">
      {hasResponses ? <p className="text-sm text-muted-foreground">{Q.hasAnswers}</p> : null}
      {state.message ? (
        <p className={cn("text-sm", state.ok ? "text-muted-foreground" : "text-destructive")} role="status">
          {state.message}
        </p>
      ) : null}

      {sections.map((section) => {
        const sectionQuestions = questions.filter((question) => question.sectionId === section.id);
        return (
          <section key={section.id} aria-labelledby={`sezione-${section.id}`} className="space-y-2">
            <h2 id={`sezione-${section.id}`} className="flex flex-wrap items-baseline gap-x-2 text-base font-semibold">
              {section.title}
              <span className="text-xs font-normal text-muted-foreground">{section.area}</span>
            </h2>
            <ul className="divide-y overflow-hidden rounded-xl border bg-card">
              {sectionQuestions.map((question) => {
                const open = openId === question.id;
                const marks = [question.required ? Q.required : null, question.id.startsWith("custom-") ? Q.added : null, edited.has(question.id) ? Q.edited : null].filter(Boolean);
                if (editingId === question.id) {
                  return (
                    <li key={question.id} className="p-4">
                      <QuestionForm op="edit" question={question} formAction={formAction} pending={pending} onDone={() => setEditingId(null)} />
                    </li>
                  );
                }
                return (
                  <li key={question.id} data-testid="question-row">
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-controls={`domanda-${question.id}`}
                      onClick={() => setOpenId(open ? null : question.id)}
                      className="flex min-h-11 w-full items-start gap-3 px-4 py-3 text-left text-sm outline-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50 sm:min-h-12"
                    >
                      <span className="shrink-0 tabular-nums text-muted-foreground">{numbers.get(question.id)}.</span>
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="break-words">{question.label}</span>
                        <span className="text-xs text-muted-foreground">{[kindOf(question), ...marks].join(" · ")}</span>
                      </span>
                      <ChevronRight aria-hidden className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none", open && "rotate-90")} />
                    </button>
                    <div id={`domanda-${question.id}`} hidden={!open} className="space-y-3 px-4 pb-4 pl-11 text-sm">
                      {question.description ? <p className="text-muted-foreground">{question.description}</p> : null}
                      {question.answerType === "scale" && question.levels?.length ? (
                        <ol className="space-y-0.5 text-muted-foreground">
                          {question.levels.map((level) => (
                            <li key={level.value}>
                              <span className="font-medium text-foreground">{level.value}</span> · {level.label}
                            </li>
                          ))}
                        </ol>
                      ) : null}
                      {question.answerType === "scale" && question.allowUnsure ? <p className="text-xs text-muted-foreground">{Q.unsure}</p> : null}
                      {question.answerType === "single_choice" && question.options?.length ? (
                        <ul className="list-inside list-disc text-muted-foreground">
                          {question.options.map((option) => (
                            <li key={option.value}>{option.label}</li>
                          ))}
                        </ul>
                      ) : null}
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="outline" className="min-h-11 sm:min-h-8" onClick={() => setEditingId(question.id)}>
                          <Pencil aria-hidden data-icon="inline-start" />
                          {Q.edit}
                        </Button>
                        <form
                          action={formAction}
                          onSubmit={(event) => {
                            removal.ask(event, true);
                          }}
                        >
                          <input type="hidden" name="op" value="remove" />
                          <input type="hidden" name="questionId" value={question.id} />
                          <Button type="submit" variant="ghost" className="min-h-11 sm:min-h-8" disabled={pending}>
                            <Trash2 aria-hidden data-icon="inline-start" />
                            {Q.remove}
                          </Button>
                        </form>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            {addingSection === section.id ? (
              <div className="rounded-xl border border-dashed p-4">
                <QuestionForm op="add" sectionId={section.id} formAction={formAction} pending={pending} onDone={() => setAddingSection(null)} />
              </div>
            ) : (
              <Button type="button" variant="ghost" className="min-h-11 sm:min-h-8" onClick={() => setAddingSection(section.id)} data-testid={`add-question-${section.id}`}>
                <Plus aria-hidden data-icon="inline-start" />
                {Q.add}
              </Button>
            )}
          </section>
        );
      })}

      {removedQuestions.length > 0 ? (
        <div>
          <Fold id="domande-rimosse" title={Q.removed(removedQuestions.length)}>
            <ul className="mb-4 divide-y rounded-xl border">
              {removedQuestions.map((question) => (
                <li key={question.id} className="flex min-h-11 flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm text-muted-foreground">
                  <span className="min-w-0 break-words">{question.label}</span>
                  <form action={formAction}>
                    <input type="hidden" name="op" value="restore" />
                    <input type="hidden" name="questionId" value={question.id} />
                    <Button type="submit" variant="outline" className="min-h-11 sm:min-h-8" disabled={pending}>
                      <RotateCcw aria-hidden data-icon="inline-start" />
                      {Q.restore}
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          </Fold>
        </div>
      ) : null}
      <ConfirmDialog
        open={removal.open}
        onOpenChange={removal.onOpenChange}
        title={ASK.removeQuestionTitle}
        description={ASK.removeQuestionBody}
        confirmLabel={ASK.removeQuestion}
        destructive
        onConfirm={removal.confirm}
      />
    </div>
  );
}

/** Il modulo di una domanda: modificarne una («edit») o aggiungerne una a una sezione («add»). Ogni campo ha la sua etichetta. */
function QuestionForm({
  op,
  question,
  sectionId,
  formAction,
  pending,
  onDone,
}: {
  op: "edit" | "add";
  question?: AiReadinessQuestion;
  sectionId?: string;
  formAction: (formData: FormData) => void;
  pending: boolean;
  onDone: () => void;
}) {
  const id = useId();
  const [type, setType] = useState<"scale" | "text">(question?.answerType === "text" ? "text" : "scale");
  const showLevels = op === "edit" ? question?.answerType === "scale" : type === "scale";
  return (
    <form action={formAction} onSubmit={onDone} className="space-y-3">
      <input type="hidden" name="op" value={op} />
      {question ? <input type="hidden" name="questionId" value={question.id} /> : null}
      {sectionId ? <input type="hidden" name="sectionId" value={sectionId} /> : null}
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-testo`}>{Q.label}</Label>
        <Textarea id={`${id}-testo`} name="label" defaultValue={question?.label ?? ""} placeholder={op === "add" ? Q.newPlaceholder : undefined} required rows={2} className="text-base sm:text-sm" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-aiuto`}>{Q.help}</Label>
        <Input id={`${id}-aiuto`} name="description" defaultValue={question?.description ?? ""} className={FIELD} />
      </div>
      {op === "add" ? (
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-tipo`}>{Q.type}</Label>
          <select
            id={`${id}-tipo`}
            name="answerType"
            value={type}
            onChange={(event) => setType(event.target.value === "text" ? "text" : "scale")}
            className="h-11 w-full rounded-lg border border-input bg-background px-2 text-base sm:h-9 sm:text-sm"
          >
            <option value="scale">{Q.typeScale}</option>
            <option value="text">{Q.typeText}</option>
          </select>
        </div>
      ) : null}
      {showLevels ? (
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">{op === "add" ? Q.levelsNew : Q.levels}</legend>
          {[1, 2, 3, 4, 5].map((value) => (
            <div key={value} className="grid gap-1 sm:grid-cols-[6rem_minmax(0,1fr)] sm:items-center">
              <Label htmlFor={`${id}-livello-${value}`} className="text-muted-foreground">
                {Q.level(value)}
              </Label>
              <Input id={`${id}-livello-${value}`} name={`level${value}`} defaultValue={question?.levels?.find((l) => l.value === value)?.label ?? ""} className={FIELD} />
            </div>
          ))}
          <p className="text-xs text-muted-foreground">{Q.unsure}</p>
        </fieldset>
      ) : null}
      {op === "edit" ? (
        <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
          <input type="checkbox" name="required" defaultChecked={question?.required} className="size-4" />
          {Q.requiredField}
        </label>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" variant="outline" className="min-h-11 sm:min-h-8" disabled={pending}>
          {op === "add" ? Q.addSubmit : Q.save}
        </Button>
        <Button type="button" variant="ghost" className="min-h-11 sm:min-h-8" onClick={onDone}>
          {Q.cancel}
        </Button>
      </div>
    </form>
  );
}
