"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Issue } from "@/lib/uc/answers/issues";
import type { ReferentItemView } from "@/lib/uc/public-view";
import { fieldIssues, otherIssues, type ReferentForm } from "@/lib/uc/views/referente-form";
import { referentHash } from "@/lib/uc/views/referente-plan";
import { AnswerInput } from "./answer-input";
import type { AttachmentRef } from "./attachment-field";
import { Field, FieldErrors, TextAreaControl } from "./inputs/fields";
import { BackLink, PRIMARY_CLASS, ScreenTitle } from "./screen";
import { ActionBar } from "./step-bar";

/**
 * R8 · Chiarimento (DESIGN §4.3, `#/chiarimento/<id>`; i link delle email
 * arrivano qui): la domanda di Lateral Space in un riquadro giallo tenue, la
 * risposta di prima, la risposta al chiarimento (obbligatoria) e, se serve, il
 * valore corretto. Parte da sola, senza riepilogo.
 */
export function ClarificationScreen({
  item,
  token,
  form,
  attachments,
  issues,
  busy,
  narrow,
  onForm,
  onAttachments,
  onSend,
}: {
  item: ReferentItemView;
  token: string;
  form: ReferentForm;
  attachments: AttachmentRef[];
  issues: readonly Issue[];
  busy: boolean;
  narrow: boolean;
  onForm: (next: ReferentForm) => void;
  onAttachments: (next: AttachmentRef[]) => void;
  onSend: () => void;
}) {
  const [correct, setCorrect] = useState(false);
  const id = `uc-${item.id}`;
  const noteIssues = fieldIssues(issues, "note");
  const valueIssues = otherIssues(
    issues.filter((i) => i.field),
    ["note"],
  );
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) onSend();
      }}
    >
      <section aria-labelledby="uc-r-titolo" className="mt-2 space-y-5">
        <BackLink href={referentHash({ screen: "home" })}>Argomenti</BackLink>
        <ScreenTitle size="question">{item.title}</ScreenTitle>
        <div className="space-y-1 rounded-xl bg-uc-giallo-bg px-4 py-3">
          <p className="text-sm font-medium">Lateral Space ti chiede</p>
          <p className="text-base break-words">{item.clarification}</p>
        </div>
        {item.ownAnswer?.display ? (
          <p className="text-base break-words">
            <span className="text-muted-foreground">La tua risposta di prima: </span>
            {item.ownAnswer.display}
          </p>
        ) : null}
        <Field label="La tua risposta" htmlFor={`${id}-reply`} issues={noteIssues}>
          <TextAreaControl id={`${id}-reply`} value={form.note} onChange={(v) => onForm({ ...form, note: v })} disabled={busy} invalid={noteIssues.length > 0} rows={3} />
        </Field>
        {correct ? (
          <div className="space-y-2">
            <p className="text-base font-medium">Il valore corretto</p>
            <AnswerInput
              type={item.responseType}
              id={id}
              config={item.config}
              value={form.value}
              onChange={(value) => onForm({ ...form, value })}
              issues={valueIssues}
              disabled={busy}
              label={`${item.title}: valore corretto`}
              token={token}
              itemId={item.id}
              attachments={attachments}
              onAttachmentsChange={onAttachments}
              attachmentHint={item.attachmentHint}
              personal={item.personal}
              tableLayout={narrow ? "cards" : "grid"}
            />
          </div>
        ) : (
          <button type="button" className="inline-flex min-h-11 items-center gap-1 text-base text-primary underline-offset-4 hover:underline" onClick={() => setCorrect(true)}>
            Correggi anche il valore
            <ChevronRight className="size-4" aria-hidden />
          </button>
        )}
        <FieldErrors issues={issues.filter((i) => !i.field || (!correct && i.field !== "note"))} />
        <ActionBar>
          <Button type="submit" className={PRIMARY_CLASS} disabled={busy}>
            Invia la risposta
          </Button>
        </ActionBar>
      </section>
    </form>
  );
}
