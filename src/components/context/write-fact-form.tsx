"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { editFactAction, writeFactAction } from "@/lib/actions/context";
import { CONTEXT_TEXT } from "@/lib/context/text";
import { CONTEXT_LIMITS, CONTEXT_SECTIONS, CONTEXT_VISIBILITIES, type ContextSection, type ContextVisibility } from "@/lib/context/vocab";
import { ChoiceSelect, Field, UseCasePicker, type UseCaseOption } from "./fields";
import { sectionLabel, visibilityLabel } from "./view-model";

const T = CONTEXT_TEXT;

export const SECTION_ITEMS = CONTEXT_SECTIONS.map((section) => ({ value: section, label: sectionLabel(section) }));
export const VISIBILITY_ITEMS = CONTEXT_VISIBILITIES.map((visibility) => ({ value: visibility, label: visibilityLabel(visibility) }));

export interface FactFormValue {
  statement: string;
  section: ContextSection;
  visibility: ContextVisibility;
  useCaseIds: string[];
}

/** Il fatto che si sta modificando, con la versione letta (per non sovrascrivere una modifica di un altro). */
export interface EditedFact extends FactFormValue {
  id: string;
  version: number;
}

/**
 * «Scrivi un fatto» e «Modifica» (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §7.2): una frase, la sezione,
 * chi lo vede, gli use case. Le persone si indicano per ruolo: il controllo dei testi ferma i nomi (sul server, con il
 * suo messaggio). Un testo nuovo crea una versione nuova; la vecchia resta nella storia.
 */
export function WriteFactForm({
  workspaceId,
  useCaseOptions,
  editing,
  onDone,
  onCancel,
}: {
  workspaceId: string;
  useCaseOptions: readonly UseCaseOption[];
  /** Il fatto da modificare; senza, un fatto nuovo. */
  editing?: EditedFact | null;
  onDone: (factId: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState<FactFormValue>(() =>
    editing ? { statement: editing.statement, section: editing.section, visibility: editing.visibility, useCaseIds: [...editing.useCaseIds] } : { statement: "", section: "azienda", visibility: "tutti", useCaseIds: [] },
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    const statement = value.statement.replace(/\s+/g, " ").trim();
    const local: Record<string, string> = {};
    if (statement.length < CONTEXT_LIMITS.statementMin) local.statement = T.errors.statementTooShort;
    else if (statement.length > CONTEXT_LIMITS.statementMax) local.statement = T.errors.statementTooLong;
    setErrors(local);
    setFailed(null);
    if (Object.keys(local).length > 0) return;
    startTransition(async () => {
      const result = editing
        ? await editFactAction(workspaceId, editing.id, editing.version, {
            ...(statement !== editing.statement ? { statement } : {}),
            ...(value.section !== editing.section ? { section: value.section } : {}),
            ...(value.visibility !== editing.visibility ? { visibility: value.visibility } : {}),
            ...(sameIds(value.useCaseIds, editing.useCaseIds) ? {} : { useCaseIds: value.useCaseIds }),
          })
        : await writeFactAction(workspaceId, { statement, section: value.section, visibility: value.visibility, useCaseIds: value.useCaseIds });
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        setFailed(result.fieldErrors && Object.keys(result.fieldErrors).length > 0 ? null : result.message);
        return;
      }
      toast.success(T.fact.saved);
      onDone(result.value.factId);
    });
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Field id="fatto-frase" label={T.writeFact.statementLabel} hint={T.writeFact.hint} error={errors.statement}>
        <Textarea
          id="fatto-frase"
          value={value.statement}
          onChange={(event) => setValue((v) => ({ ...v, statement: event.target.value }))}
          placeholder={T.writeFact.statementPlaceholder}
          maxLength={CONTEXT_LIMITS.statementMax + 50}
          rows={3}
          aria-invalid={errors.statement ? true : undefined}
          aria-describedby={errors.statement ? "fatto-frase-errore" : undefined}
          disabled={pending}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="fatto-sezione" label={T.writeFact.section} error={errors.section}>
          <ChoiceSelect id="fatto-sezione" value={value.section} items={SECTION_ITEMS} disabled={pending} onChange={(section) => setValue((v) => ({ ...v, section }))} />
        </Field>
        <Field id="fatto-visibilita" label={T.writeFact.visibility} error={errors.visibility}>
          <ChoiceSelect id="fatto-visibilita" value={value.visibility} items={VISIBILITY_ITEMS} disabled={pending} onChange={(visibility) => setValue((v) => ({ ...v, visibility }))} />
        </Field>
      </div>
      {useCaseOptions.length > 0 || value.useCaseIds.length > 0 ? (
        <Field id="fatto-use-case" label={T.fact.useCases} error={errors.useCaseIds} optional>
          <UseCasePicker id="fatto-use-case" value={value.useCaseIds} options={useCaseOptions} disabled={pending} onChange={(useCaseIds) => setValue((v) => ({ ...v, useCaseIds }))} />
        </Field>
      ) : null}
      {failed ? (
        <p role="alert" className="text-sm text-destructive">
          {failed}
        </p>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" className="min-h-11 sm:min-h-8" disabled={pending} onClick={onCancel}>
          {T.writeFact.cancel}
        </Button>
        <Button type="submit" className="min-h-11 sm:min-h-8" disabled={pending}>
          {T.writeFact.save}
        </Button>
      </div>
    </form>
  );
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}
