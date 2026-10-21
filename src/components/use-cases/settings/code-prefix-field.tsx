"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveCodePrefixAction } from "@/lib/actions/use-case-settings";
import { CODE_PREFIX_MAX, VALUATION_SETTINGS_TEXT, codePrefixInputText, codePrefixNotes, parseCodePrefix } from "@/lib/use-cases/settings";
import { SaveRow } from "./save-row";

const TEXT = VALUATION_SETTINGS_TEXT.codes;

/**
 * «Codici degli use case › Prefisso» (docs/use-case/DESIGN.md §10.6, §14.3; D6): 2-4 lettere
 * maiuscole. I codici già assegnati non cambiano; con il connettore acceso c'è l'avviso dei
 * due prefissi. Un workspace senza la riga di configurazione parte dal prefisso proposto dal
 * nome, e i codici partono quando lo salva.
 */
export function CodePrefixField({
  workspaceId,
  initialPrefix,
  saved: initiallySaved,
  connectorEnabled: initialConnectorEnabled,
}: {
  workspaceId: string;
  initialPrefix: string;
  /** Vero se il workspace ha già la riga di configurazione dei codici. */
  saved: boolean;
  connectorEnabled: boolean;
}) {
  const baseId = `prefisso-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const [saved, setSaved] = useState({ prefix: initialPrefix, exists: initiallySaved, connectorEnabled: initialConnectorEnabled });
  const [prefix, setPrefix] = useState(initialPrefix);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = !saved.exists || codePrefixInputText(prefix) !== saved.prefix;
  const notes = codePrefixNotes(saved.connectorEnabled);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseCodePrefix(prefix);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    startTransition(async () => {
      try {
        const result = await saveCodePrefixAction(workspaceId, parsed.value);
        if (result.ok) {
          setError(null);
          setSaved({ prefix: result.value.prefix, exists: true, connectorEnabled: result.value.connectorEnabled });
          setPrefix(result.value.prefix);
          toast.success(TEXT.saved);
        } else {
          setError(result.fieldErrors?.prefix ?? result.message);
        }
      } catch {
        toast.error(VALUATION_SETTINGS_TEXT.failed);
      }
    });
  }

  const describedBy = [`${baseId}-aiuto`, error ? `${baseId}-errore` : null].filter(Boolean).join(" ");

  return (
    <form onSubmit={submit} className="space-y-3" data-slot="code-prefix-field" noValidate>
      <h3 className="text-sm font-semibold">{TEXT.title}</h3>
      <div className="space-y-2">
        <Label htmlFor={`${baseId}-campo`}>{TEXT.label}</Label>
        <Input
          id={`${baseId}-campo`}
          name="prefix"
          value={prefix}
          maxLength={CODE_PREFIX_MAX}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className="w-24 font-mono uppercase"
          onChange={(event) => {
            setPrefix(codePrefixInputText(event.target.value));
            setError(null);
          }}
        />
        <div id={`${baseId}-aiuto`} className="space-y-1 text-sm text-muted-foreground">
          {!saved.exists && <p>{TEXT.proposed}</p>}
          {notes.map((note) => (
            <p key={note} className={note === TEXT.connector ? "text-amber-600 dark:text-amber-400" : undefined}>
              {note}
            </p>
          ))}
        </div>
        {error && (
          <p id={`${baseId}-errore`} role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      {dirty && (
        <SaveRow
          label={TEXT.save}
          pending={pending}
          onCancel={
            saved.exists
              ? () => {
                  setPrefix(saved.prefix);
                  setError(null);
                }
              : undefined
          }
        />
      )}
    </form>
  );
}
