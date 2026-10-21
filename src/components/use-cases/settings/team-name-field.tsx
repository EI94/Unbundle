"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveReviewTeamNameAction } from "@/lib/actions/use-case-settings";
import { TEAM_NAME_MAX, VALUATION_SETTINGS_TEXT, parseTeamName, teamNameHelp } from "@/lib/use-cases/settings";
import { SaveRow } from "./save-row";

const TEXT = VALUATION_SETTINGS_TEXT.teamName;

function savedForm(text: string): string | null {
  const parsed = parseTeamName(text);
  return parsed.ok ? parsed.value : text;
}

/**
 * «Nome del team che valuta» (docs/use-case/DESIGN.md §14.2, §14.3; D2). L'aiuto dice il nome
 * predefinito interpolando la costante (`teamNameHelp`); il segnaposto non lo ripete.
 */
export function TeamNameField({ workspaceId, initialName }: { workspaceId: string; initialName: string }) {
  const baseId = `nome-team-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const [saved, setSaved] = useState(initialName);
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = savedForm(name) !== savedForm(saved);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseTeamName(name);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    startTransition(async () => {
      try {
        const result = await saveReviewTeamNameAction(workspaceId, name);
        if (result.ok) {
          setError(null);
          setSaved(result.value.teamName ?? "");
          setName(result.value.teamName ?? "");
          toast.success(TEXT.saved);
        } else {
          setError(result.fieldErrors?.teamName ?? result.message);
        }
      } catch {
        toast.error(VALUATION_SETTINGS_TEXT.failed);
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-2" data-slot="team-name-field" noValidate>
      <Label htmlFor={`${baseId}-campo`}>{TEXT.label}</Label>
      <Input
        id={`${baseId}-campo`}
        name="teamName"
        value={name}
        maxLength={TEAM_NAME_MAX + 20}
        autoComplete="off"
        placeholder={TEXT.placeholder}
        aria-describedby={error ? `${baseId}-aiuto ${baseId}-errore` : `${baseId}-aiuto`}
        aria-invalid={error ? true : undefined}
        className="max-w-md"
        onChange={(event) => {
          setName(event.target.value);
          setError(null);
        }}
      />
      <p id={`${baseId}-aiuto`} className="text-sm text-muted-foreground">
        {teamNameHelp()}
      </p>
      {error && (
        <p id={`${baseId}-errore`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {dirty && (
        <SaveRow
          label={TEXT.save}
          pending={pending}
          onCancel={() => {
            setName(saved);
            setError(null);
          }}
        />
      )}
    </form>
  );
}
