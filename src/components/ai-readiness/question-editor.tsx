"use client";

import { useActionState, useState } from "react";
import {
  customizeAssessmentQuestionAction,
  type AiReadinessActionState,
} from "@/lib/actions/ai-readiness";
import type { AiReadinessQuestion } from "@/lib/ai-readiness/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";

const INITIAL: AiReadinessActionState = { ok: true };

type SectionView = {
  id: string;
  title: string;
  pillarTitle: string;
  description?: string;
  audience?: "everyone" | "internal";
};

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
  const action = customizeAssessmentQuestionAction.bind(
    null,
    workspaceId,
    assessmentId
  );
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingSection, setAddingSection] = useState<string | null>(null);
  const edited = new Set(editedIds);

  return (
    <div className="space-y-6">
      {hasResponses && (
        <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          ⚠️ Ci sono già risposte inviate: modificare le domande ora ricalcola
          gli score solo sulle domande attuali. L&apos;ideale è chiudere la
          personalizzazione prima di condividere i link.
        </p>
      )}
      {state.message && (
        <p
          className={`rounded-2xl border p-3 text-sm ${
            state.ok
              ? "border-emerald-500/40 bg-emerald-500/10"
              : "border-destructive/40 bg-destructive/10"
          }`}
          role="status"
        >
          {state.message}
        </p>
      )}

      {sections.map((section) => {
        const sectionQuestions = questions.filter(
          (question) => question.sectionId === section.id
        );
        return (
          <section key={section.id} className="rounded-[28px] border bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                {section.pillarTitle}
              </div>
              <Badge
                variant={section.audience === "internal" ? "secondary" : "outline"}
                className="text-[10px]"
              >
                {section.audience === "internal"
                  ? "Scheda referenti (IT/HR/business)"
                  : "Survey per tutta l'organizzazione"}
              </Badge>
            </div>
            <h2 className="mt-1 text-lg font-semibold">{section.title}</h2>
            {section.description && (
              <p className="mt-1 text-xs text-muted-foreground">{section.description}</p>
            )}
            <div className="mt-4 space-y-2">
              {sectionQuestions.map((question, index) =>
                editingId === question.id ? (
                  <form
                    key={question.id}
                    action={formAction}
                    className="space-y-3 rounded-2xl border border-emerald-500/40 p-4"
                    onSubmit={() => setEditingId(null)}
                  >
                    <input type="hidden" name="op" value="edit" />
                    <input type="hidden" name="questionId" value={question.id} />
                    <div className="space-y-1.5">
                      <Label>Testo domanda</Label>
                      <Textarea name="label" defaultValue={question.label} required rows={2} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Descrizione / aiuto (opzionale)</Label>
                      <Input name="description" defaultValue={question.description ?? ""} />
                    </div>
                    {question.answerType === "scale" && (
                      <div className="space-y-2">
                        <Label>Cosa significa ogni livello (1–5)</Label>
                        {[1, 2, 3, 4, 5].map((value) => (
                          <div key={value} className="flex items-center gap-2">
                            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                              {value}
                            </span>
                            <Input
                              name={`level${value}`}
                              defaultValue={
                                question.levels?.find((l) => l.value === value)?.label ?? ""
                              }
                              placeholder={`Descrizione del livello ${value}`}
                            />
                          </div>
                        ))}
                        <p className="text-xs text-muted-foreground">
                          L&apos;opzione «Non so / non applicabile» (vale 0,5) è sempre disponibile.
                        </p>
                      </div>
                    )}
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="required" defaultChecked={question.required} />
                      Risposta obbligatoria
                    </label>
                    <div className="flex gap-2">
                      <Button type="submit" size="sm" disabled={pending}>Salva</Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => setEditingId(null)}>
                        Annulla
                      </Button>
                    </div>
                  </form>
                ) : (
                  <div
                    key={question.id}
                    className="flex flex-wrap items-start justify-between gap-2 rounded-2xl border p-3"
                    data-testid="question-row"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm leading-6">
                        <span className="text-muted-foreground">{index + 1}.</span>{" "}
                        {question.label}
                      </div>
                      {question.description && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {question.description}
                        </p>
                      )}
                      {question.answerType === "scale" && question.levels?.length ? (
                        <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                          {question.levels.map((level) => (
                            <li key={level.value}>
                              <span className="font-medium text-foreground/70">{level.value}</span>{" "}
                              = {level.label}
                            </li>
                          ))}
                          {question.allowUnsure && (
                            <li><span className="font-medium text-foreground/70">?</span> = Non so / non applicabile (vale 0,5)</li>
                          )}
                        </ul>
                      ) : null}
                      {question.answerType === "single_choice" && question.options?.length ? (
                        <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                          {question.options.map((option) => (
                            <li key={option.value}>• {option.label}</li>
                          ))}
                        </ul>
                      ) : null}
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <Badge variant="outline" className="text-[10px]">
                          {question.answerType === "scale"
                            ? "Scala 0–5"
                            : question.answerType === "single_choice"
                              ? "Scelta singola"
                              : "Testo libero"}
                        </Badge>
                        {question.required && (
                          <Badge variant="outline" className="text-[10px]">Obbligatoria</Badge>
                        )}
                        {question.id.startsWith("custom-") && (
                          <Badge variant="secondary" className="text-[10px]">Aggiunta da voi</Badge>
                        )}
                        {edited.has(question.id) && (
                          <Badge variant="secondary" className="text-[10px]">Modificata</Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditingId(question.id)}
                        aria-label="Modifica domanda"
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <form
                        action={formAction}
                        onSubmit={(event) => {
                          if (
                            !window.confirm(
                              "Rimuovere questa domanda dalla survey di questo assessment?"
                            )
                          )
                            event.preventDefault();
                        }}
                      >
                        <input type="hidden" name="op" value="remove" />
                        <input type="hidden" name="questionId" value={question.id} />
                        <Button
                          type="submit"
                          size="sm"
                          variant="ghost"
                          disabled={pending}
                          className="text-destructive hover:text-destructive"
                          aria-label="Elimina domanda"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </form>
                    </div>
                  </div>
                )
              )}
            </div>

            {addingSection === section.id ? (
              <form
                action={formAction}
                className="mt-3 space-y-3 rounded-2xl border border-dashed p-4"
                onSubmit={() => setAddingSection(null)}
              >
                <input type="hidden" name="op" value="add" />
                <input type="hidden" name="sectionId" value={section.id} />
                <div className="space-y-1.5">
                  <Label>Nuova domanda</Label>
                  <Textarea name="label" placeholder="Es. Quanto è chiaro il processo di onboarding clienti?" required rows={2} />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Descrizione (opzionale)</Label>
                    <Input name="description" placeholder="Testo di aiuto sotto la domanda" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Tipo di risposta</Label>
                    <select name="answerType" className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm">
                      <option value="scale">Scala 0–5 (entra nello score)</option>
                      <option value="text">Testo libero (qualitativa)</option>
                    </select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Livelli 1–5 (se scala; lascia vuoto per usare quelli generici)</Label>
                  {[1, 2, 3, 4, 5].map((value) => (
                    <div key={value} className="flex items-center gap-2">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                        {value}
                      </span>
                      <Input name={`level${value}`} placeholder={`Descrizione del livello ${value}`} />
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button type="submit" size="sm" disabled={pending}>Aggiungi</Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => setAddingSection(null)}>
                    Annulla
                  </Button>
                </div>
              </form>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => setAddingSection(section.id)}
                data-testid={`add-question-${section.id}`}
              >
                <Plus className="mr-1 size-3.5" /> Aggiungi domanda
              </Button>
            )}
          </section>
        );
      })}

      {removedQuestions.length > 0 && (
        <section className="rounded-[28px] border border-dashed bg-muted/20 p-5">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Domande rimosse ({removedQuestions.length})
          </h2>
          <div className="mt-3 space-y-2">
            {removedQuestions.map((question) => (
              <div
                key={question.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border p-3 text-sm text-muted-foreground"
              >
                <span className="line-through">{question.label}</span>
                <form action={formAction}>
                  <input type="hidden" name="op" value="restore" />
                  <input type="hidden" name="questionId" value={question.id} />
                  <Button type="submit" size="sm" variant="outline" disabled={pending}>
                    <RotateCcw className="mr-1 size-3.5" /> Ripristina
                  </Button>
                </form>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
