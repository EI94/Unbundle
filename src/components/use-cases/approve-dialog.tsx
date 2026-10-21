"use client";

import { useId, useState, type ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { DECISION_MESSAGES } from "@/lib/use-cases/decisions";
import {
  DIALOG_EXTRA_TEXT,
  dialogText,
  instantOfDay,
  teamValuationMissing,
  whenOptions,
  type DecisionActionResult,
  type DecisionItem,
  type PageDecision,
} from "@/lib/use-cases/decision-ui";
import type { WhenChoice } from "@/lib/use-cases/types";
import { DecisionChoiceGroup, DecisionDialog } from "./reopen-dialog";

export interface ApproveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: Pick<DecisionItem, "code" | "hiddenFromSearch" | "value" | "cost">;
  /** Oggi a Roma (`AAAA-MM-GG`), letto sul server: le etichette dei trimestri. */
  today: string;
  /** La scelta di «Quando» già fatta (il `Select` in riga di «Priorità»). */
  defaultWhen?: WhenChoice | null;
  pending: boolean;
  onSubmit: (decision: PageDecision) => Promise<DecisionActionResult>;
  /** In fondo al dialogo: la nota pubblica da aggiornare dopo una risposta a «Serve info» (D17). */
  extra?: ReactNode;
}

/**
 * «Approva XX-0012» (docs/use-case/DESIGN.md §6.4, §14.3, §1.2 punto 4, §8.6): «Quando lo
 * facciamo?» con le tre scelte. Senza valutazione del team, l'avviso non bloccante «Valore e
 * Costo non sono ancora valutati dal team.». Per una scheda nascosta alla ricerca, la casella
 * «Mostralo ai colleghi», non spuntata.
 */
export function ApproveDialog({ open, onOpenChange, item, today, defaultWhen = null, pending, onSubmit, extra }: ApproveDialogProps) {
  const questionId = useId();
  const [when, setWhen] = useState<WhenChoice | null>(defaultWhen);
  const [showToColleagues, setShowToColleagues] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const text = dialogText("approva", item.code);
  const options = whenOptions(instantOfDay(today)).map((option) => ({ value: option.choice, label: option.label }));

  async function confirm() {
    if (!when) {
      setError(DECISION_MESSAGES.whenInvalid);
      return;
    }
    setError(null);
    const decision: PageDecision = item.hiddenFromSearch && showToColleagues
      ? { type: "approva", quando: when, showToColleagues: true }
      : { type: "approva", quando: when };
    const result = await onSubmit(decision);
    if (!result.ok && result.fieldErrors) setError(result.fieldErrors.quando ?? Object.values(result.fieldErrors)[0] ?? null);
  }

  return (
    <DecisionDialog
      open={open}
      onOpenChange={onOpenChange}
      title={text.title}
      confirmLabel={text.confirm}
      pending={pending}
      error={error}
      onConfirm={confirm}
    >
      <div className="grid gap-2">
        <p id={questionId} className="text-sm font-medium">
          {text.description}
        </p>
        <DecisionChoiceGroup
          labelledBy={questionId}
          options={options}
          value={when}
          invalid={Boolean(error)}
          onChange={(next) => {
            setWhen(next);
            setError(null);
          }}
        />
      </div>
      {teamValuationMissing(item) ? (
        <p data-slot="approve-warning" className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-100">
          {DIALOG_EXTRA_TEXT.approveNoValuation}
        </p>
      ) : null}
      {item.hiddenFromSearch ? (
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm sm:min-h-9">
          <Checkbox checked={showToColleagues} onCheckedChange={(checked) => setShowToColleagues(checked === true)} />
          <span>{DIALOG_EXTRA_TEXT.approveShowToColleagues}</span>
        </label>
      ) : null}
      {extra}
    </DecisionDialog>
  );
}
