"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DIALOG_COMMON_TEXT,
  dialogText,
  type DecisionActionResult,
  type DecisionKey,
  type PageDecision,
  type ReopenDestination,
} from "@/lib/use-cases/decision-ui";
import { keepTogether } from "@/lib/use-cases/line-breaks";
import { cn } from "@/lib/utils";

/**
 * «Riapri» (docs/use-case/DESIGN.md §6.4, §14.3) e i pezzi che hanno tutti i dialoghi delle
 * decisioni: il dialogo di conferma (`DecisionDialog`) e l'elenco di scelte
 * (`DecisionChoiceGroup`). Stanno qui perché «Riapri» è il dialogo più semplice: una conferma.
 *
 * Un dialogo non chiama le action: riceve `onSubmit` da chi lo apre (`decision-buttons.tsx`,
 * `when-control.tsx`), che manda la decisione, mostra il toast e chiude il dialogo se va bene.
 * Se il servizio risponde con l'errore di un campo, il dialogo lo mostra e resta aperto, con
 * quello che si è scritto. Il pulsante di conferma non si spegne mai: mentre la decisione
 * parte, un secondo clic non fa niente.
 */

export interface DecisionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string | null;
  confirmLabel: string;
  /** Una decisione sta partendo: la conferma non riparte. */
  pending: boolean;
  /** L'errore da mostrare sotto il contenuto: un campo mancante o l'errore del servizio per un campo. */
  error?: string | null;
  onConfirm: () => void;
  children?: ReactNode;
  className?: string;
}

/** Il dialogo di una decisione: titolo, testo, contenuto, «Annulla» e il pulsante della decisione. */
export function DecisionDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pending,
  error,
  onConfirm,
  children,
  className,
}: DecisionDialogProps) {
  const errorId = useId();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pending) onConfirm();
  }
  return (
    <Dialog open={open} onOpenChange={(next) => onOpenChange(next)}>
      <DialogContent showCloseButton={false} data-slot="decision-dialog" className={cn("max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md", className)}>
        <form onSubmit={submit} noValidate aria-describedby={error ? errorId : undefined} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{keepTogether(description)}</DialogDescription> : null}
          </DialogHeader>
          {children}
          {error ? (
            <p id={errorId} role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" className="min-h-11 sm:min-h-8" />}>{DIALOG_COMMON_TEXT.cancel}</DialogClose>
            <Button type="submit" aria-busy={pending || undefined} className="min-h-11 sm:min-h-8">
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export interface DecisionChoice<T extends string> {
  value: T;
  label: string;
}

export interface DecisionChoiceGroupProps<T extends string> {
  /** L'id dell'etichetta del gruppo (la domanda del dialogo). */
  labelledBy?: string;
  options: readonly DecisionChoice<T>[];
  value: T | null;
  onChange: (value: T) => void;
  invalid?: boolean;
  className?: string;
}

/** Le scelte di un dialogo (Quando, Rimanda, motivo di Archivia): una sola, con il testo intero. */
export function DecisionChoiceGroup<T extends string>({ labelledBy, options, value, onChange, invalid, className }: DecisionChoiceGroupProps<T>) {
  return (
    <RadioGroup<string | null>
      value={value}
      onValueChange={(next) => {
        const match = options.find((option) => option.value === next);
        if (match) onChange(match.value);
      }}
      aria-labelledby={labelledBy}
      aria-invalid={invalid || undefined}
      className={cn("grid gap-0.5", className)}
    >
      {options.map((option) => (
        <label key={option.value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/50 sm:min-h-9">
          <Radio.Root
            value={option.value}
            className="flex size-4 shrink-0 items-center justify-center rounded-full border-2 border-muted-foreground/70 bg-background outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 data-checked:border-primary data-checked:bg-primary"
          >
            <Radio.Indicator className="size-1.5 rounded-full bg-primary-foreground" />
          </Radio.Root>
          <span className="min-w-0 text-sm">{option.label}</span>
        </label>
      ))}
    </RadioGroup>
  );
}

/** Il primo errore di un campo restituito dal servizio, per i dialoghi con un solo campo. */
export function firstFieldError(result: DecisionActionResult): string | null {
  if (result.ok || !result.fieldErrors) return null;
  return Object.values(result.fieldErrors)[0] ?? null;
}

export interface ConfirmDecisionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Riapri, Segna come diffusa, Segna come realizzato, Segna come in realizzazione: testi di §14.3. */
  decision: Extract<DecisionKey, "riapri" | "segna_diffusa" | "segna_realizzato"> | "segna_in_realizzazione";
  code: string | null;
  /** Solo «Riapri»: dove torna la scheda (`reopenDestination`); il testo lo dice solo per «Da decidere». */
  reopensTo?: ReopenDestination | null;
  pending: boolean;
  onSubmit: () => Promise<DecisionActionResult>;
}

/** Una decisione che chiede solo una conferma. */
export function ConfirmDecisionDialog({ open, onOpenChange, decision, code, reopensTo, pending, onSubmit }: ConfirmDecisionDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const text = dialogText(decision, code, { reopensTo });
  async function confirm() {
    setError(null);
    setError(firstFieldError(await onSubmit()));
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
    />
  );
}

export interface ReopenDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  code: string | null;
  /** Dove torna la scheda (`reopenDestination` dello use case); null se non si sa. */
  reopensTo: ReopenDestination | null;
  pending: boolean;
  onSubmit: (decision: PageDecision) => Promise<DecisionActionResult>;
}

/**
 * «Riaprire XX-0012?» · «Torna in «Da decidere».» · Riapri. Il testo solo se la scheda torna
 * davvero in «Da decidere»: un'archiviata da Approvato, In realizzazione o Realizzato torna lì.
 */
export function ReopenDialog({ onSubmit, ...props }: ReopenDialogProps) {
  return <ConfirmDecisionDialog {...props} decision="riapri" onSubmit={() => onSubmit({ type: "riapri" })} />;
}
