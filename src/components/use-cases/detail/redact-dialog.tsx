"use client";

import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { redactTextAction } from "@/lib/actions/use-case-edit";
import type { DecisionItem } from "@/lib/use-cases/decision-ui";
import type { RedactableField } from "@/lib/use-cases/service";
import { useDecisionRunner } from "../decision-buttons";

/** I testi esatti del dialogo (§6.8, §14.3). */
export const REDACT_TEXT = Object.freeze({
  menu: "Oscura testo",
  title: "Oscura un testo",
  description:
    "Il testo scelto si sostituisce con «[testo rimosso]» e non si conserva in Unbundle. Non si torna indietro. I messaggi già mandati su Slack o per email non cambiano. Il dossier, se avviato, e il questionario AI Readiness da cui è nato lo use case hanno una loro copia: questa azione non la cambia.",
  confirm: "Oscura",
  cancel: "Annulla",
  missing: "Scegli almeno un testo.",
});

/** Un testo che si può oscurare: il campo del servizio e la sua etichetta per il tipo della scheda. */
export interface RedactOption {
  field: RedactableField;
  label: string;
}

export interface RedactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  item: Pick<DecisionItem, "id" | "version">;
  /** Solo i campi che hanno un testo (calcolati sul server, senza i testi). */
  options: readonly RedactOption[];
}

/**
 * «Oscura testo» (docs/use-case/DESIGN.md §6.8, §11): le caselle dei testi che ci sono (titolo, i
 * testi di «Cosa è», nota pubblica, dati raccolti da Claude, motivazione dell'AI), il testo esatto
 * di §14.3 e il pulsante distruttivo «Oscura». Lo usano Lateral Space con ruolo da revisore e chi
 * gestisce il workspace. Non esiste via MCP.
 */
export function RedactDialog({ open, onOpenChange, workspaceId, item, options }: RedactDialogProps) {
  const groupId = useId();
  const errorId = useId();
  const [chosen, setChosen] = useState<ReadonlySet<RedactableField>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const { run, pending } = useDecisionRunner();

  function toggle(field: RedactableField, checked: boolean) {
    setChosen((current) => {
      const next = new Set(current);
      if (checked) next.add(field);
      else next.delete(field);
      return next;
    });
    setError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (chosen.size === 0) {
      setError(REDACT_TEXT.missing);
      return;
    }
    setError(null);
    const fields = options.map((option) => option.field).filter((field) => chosen.has(field));
    const result = await run(item, (version) => redactTextAction(workspaceId, item.id, version, fields));
    if (result.ok) onOpenChange(false);
    else if (result.fieldErrors) setError(result.fieldErrors.fields ?? Object.values(result.fieldErrors)[0] ?? null);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => onOpenChange(next)}>
      <DialogContent showCloseButton={false} data-slot="redact-dialog" className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <form onSubmit={submit} noValidate aria-describedby={error ? errorId : undefined} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{REDACT_TEXT.title}</DialogTitle>
            <DialogDescription>{REDACT_TEXT.description}</DialogDescription>
          </DialogHeader>
          <div role="group" aria-labelledby={groupId} className="grid gap-0.5">
            <span id={groupId} className="sr-only">
              {REDACT_TEXT.title}
            </span>
            {options.map((option) => (
              <label key={option.field} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/50 sm:min-h-9">
                <Checkbox checked={chosen.has(option.field)} onCheckedChange={(checked) => toggle(option.field, checked === true)} />
                <span className="min-w-0 text-sm">{option.label}</span>
              </label>
            ))}
          </div>
          {error ? (
            <p id={errorId} role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" className="min-h-11 sm:min-h-8" />}>{REDACT_TEXT.cancel}</DialogClose>
            <Button type="submit" variant="destructive" aria-busy={pending || undefined} className="min-h-11 sm:min-h-8">
              {REDACT_TEXT.confirm}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
