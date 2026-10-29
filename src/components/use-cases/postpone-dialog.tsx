"use client";

import { useId, useState, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DIALOG_EXTRA_TEXT,
  checkPostponeDate,
  dialogText,
  instantOfDay,
  minPostponeDate,
  postponeOptions,
  type DecisionActionResult,
  type PageDecision,
  type PostponeKey,
} from "@/lib/use-cases/decision-ui";
import { keepTogether } from "@/lib/use-cases/line-breaks";
import { DecisionChoiceGroup, DecisionDialog } from "./reopen-dialog";

export interface PostponeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  code: string | null;
  /** Oggi a Roma (`AAAA-MM-GG`), letto sul server: le date proposte. */
  today: string;
  pending: boolean;
  onSubmit: (decision: PageDecision) => Promise<DecisionActionResult>;
  /** In fondo al dialogo: la nota pubblica da aggiornare dopo una risposta a «Serve info» (D17). */
  extra?: ReactNode;
}

/**
 * «Rimanda XX-0012» (docs/use-case/DESIGN.md §3.6, §6.4, §14.3): «Quando lo riguardiamo?» con
 * «Tra un mese», «Tra tre mesi», «All'inizio del prossimo trimestre» (date calcolate a Roma) o
 * «Scegli una data». La data è obbligatoria e futura; fino ad allora la scheda resta fuori da
 * «Da decidere» e chi l'ha proposta vede «Valutata, da decidere».
 */
export function PostponeDialog({ open, onOpenChange, code, today, pending, onSubmit, extra }: PostponeDialogProps) {
  const questionId = useId();
  const dateId = useId();
  const now = instantOfDay(today);
  const options = postponeOptions(now);
  const [choice, setChoice] = useState<PostponeKey | null>(null);
  const [customDate, setCustomDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const text = dialogText("rimanda", code);

  async function confirm() {
    const picked = options.find((option) => option.key === choice);
    const checked = checkPostponeDate(picked?.date ?? (choice === "data" ? customDate : null), now);
    if (!checked.ok) {
      setError(checked.message);
      return;
    }
    setError(null);
    const result = await onSubmit({ type: "rimanda", reviewBy: checked.date });
    if (!result.ok && result.fieldErrors) setError(result.fieldErrors.reviewBy ?? Object.values(result.fieldErrors)[0] ?? null);
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
          options={options.map((option) => ({ value: option.key, label: option.label }))}
          value={choice}
          invalid={Boolean(error)}
          onChange={(next) => {
            setChoice(next);
            setError(null);
          }}
        />
        {choice === "data" ? (
          <div className="grid gap-1.5 pl-9">
            <Label htmlFor={dateId}>{DIALOG_EXTRA_TEXT.postponeDateLabel}</Label>
            <Input
              id={dateId}
              type="date"
              min={minPostponeDate(now)}
              value={customDate}
              aria-invalid={error ? true : undefined}
              className="min-h-11 w-full max-w-48 sm:min-h-8"
              onChange={(event) => {
                setCustomDate(event.target.value);
                setError(null);
              }}
            />
          </div>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground">{keepTogether(DIALOG_EXTRA_TEXT.postponeNote)}</p>
      {extra}
    </DecisionDialog>
  );
}
