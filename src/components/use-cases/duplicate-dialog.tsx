"use client";

import { useId, useState, type ReactNode } from "react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import {
  DIALOG_EXTRA_TEXT,
  dialogText,
  duplicateCandidates,
  typedDuplicateCode,
  type DecisionActionResult,
  type DuplicateCandidate,
  type PageDecision,
} from "@/lib/use-cases/decision-ui";
import { DecisionDialog } from "./reopen-dialog";

export interface DuplicateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** La scheda che si chiude come doppione: è esclusa dall'elenco. */
  self: Pick<DuplicateCandidate, "id" | "code">;
  /** Gli use case dello stesso workspace (codice e titolo), già proiettati per i revisori. */
  candidates?: readonly DuplicateCandidate[];
  pending: boolean;
  onSubmit: (decision: PageDecision) => Promise<DecisionActionResult>;
  /** In fondo al dialogo: la nota pubblica da aggiornare dopo una risposta a «Serve info» (D17). */
  extra?: ReactNode;
}

/**
 * «Doppione di…» (docs/use-case/DESIGN.md §3.7, §6.4, §14.3): «Di quale use case è un
 * doppione?», combobox «Cerca per titolo o codice» sugli use case dello stesso workspace,
 * esclusa la scheda stessa. Un codice scritto per intero si può usare anche se non è
 * nell'elenco: il servizio controlla che sia di questo workspace. Si chiude e chi lo segue
 * vede il codice dell'altro.
 */
export function DuplicateDialog({ open, onOpenChange, self, candidates = [], pending, onSubmit, extra }: DuplicateDialogProps) {
  const labelId = useId();
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const text = dialogText("doppione", self.code);
  const matches = duplicateCandidates(candidates, self, query);
  const typed = typedDuplicateCode(query, self);
  /** Il codice scritto per intero, quando non è già una riga dell'elenco. */
  const typedOffer = typed !== null && !matches.some((item) => item.code === typed) ? typed : null;

  function choose(code: string) {
    setChosen(code);
    setError(null);
  }

  async function confirm() {
    if (!chosen) {
      setError(DIALOG_EXTRA_TEXT.duplicateMissing);
      return;
    }
    setError(null);
    const result = await onSubmit({ type: "doppione", ofCode: chosen });
    if (!result.ok && result.fieldErrors) setError(result.fieldErrors.ofCode ?? Object.values(result.fieldErrors)[0] ?? null);
  }

  return (
    <DecisionDialog
      open={open}
      onOpenChange={onOpenChange}
      title={text.title}
      description={text.description}
      confirmLabel={text.confirm}
      pending={pending}
      error={error}
      onConfirm={confirm}
    >
      <Command shouldFilter={false} loop aria-labelledby={labelId} className="rounded-lg border border-border p-0">
        <span id={labelId} className="sr-only">
          {DIALOG_EXTRA_TEXT.duplicateSearch}
        </span>
        <CommandInput value={query} onValueChange={setQuery} placeholder={DIALOG_EXTRA_TEXT.duplicateSearch} aria-label={DIALOG_EXTRA_TEXT.duplicateSearch} />
        <CommandList className="max-h-60">
          <CommandEmpty>{DIALOG_EXTRA_TEXT.duplicateEmpty}</CommandEmpty>
          <CommandGroup>
            {typedOffer ? (
              <CommandItem value={`codice-${typedOffer}`} data-checked={chosen === typedOffer} className="min-h-11 sm:min-h-8" onSelect={() => choose(typedOffer)}>
                <span className="text-sm">
                  {DIALOG_EXTRA_TEXT.duplicateUseTyped} <span className="font-mono">{typedOffer}</span>
                </span>
              </CommandItem>
            ) : null}
            {matches.map((item) => (
              <CommandItem key={item.id} value={item.id} data-checked={chosen === item.code} className="min-h-11 sm:min-h-8" onSelect={() => choose(item.code)}>
                <span className="w-20 shrink-0 font-mono text-xs text-muted-foreground">{item.code}</span>
                <span className="min-w-0 truncate">{item.title}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
      {extra}
    </DecisionDialog>
  );
}
