"use client";

import { useId, useState, type ReactNode } from "react";
import {
  ARCHIVE_OPTIONS,
  DIALOG_EXTRA_TEXT,
  dialogText,
  type DecisionActionResult,
  type PageDecision,
} from "@/lib/use-cases/decision-ui";
import type { ArchiveReason } from "@/lib/use-cases/types";
import { DecisionChoiceGroup, DecisionDialog } from "./reopen-dialog";

export interface ArchiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  code: string | null;
  pending: boolean;
  onSubmit: (decision: PageDecision) => Promise<DecisionActionResult>;
  /** In fondo al dialogo: la nota pubblica da aggiornare dopo una risposta a «Serve info» (D17). */
  extra?: ReactNode;
}

/**
 * «Archivia» (docs/use-case/DESIGN.md §3.7, §6.4, §14.3): «Perché lo archivi?» con il motivo
 * obbligatorio: Superato da altro, Ritirato da chi l'ha proposto, Fuori dal perimetro, Altro
 * motivo. Non si cancella niente: si può riaprire. Con un dossier attivo il servizio risponde
 * «Per archiviarlo, chiudi prima il dossier.».
 */
export function ArchiveDialog({ open, onOpenChange, code, pending, onSubmit, extra }: ArchiveDialogProps) {
  const questionId = useId();
  const [reason, setReason] = useState<ArchiveReason | null>(null);
  const [error, setError] = useState<string | null>(null);
  const text = dialogText("archivia", code);

  async function confirm() {
    if (!reason) {
      setError(DIALOG_EXTRA_TEXT.archiveMissing);
      return;
    }
    setError(null);
    const result = await onSubmit({ type: "archivia", reason });
    if (!result.ok && result.fieldErrors) setError(result.fieldErrors.reason ?? Object.values(result.fieldErrors)[0] ?? null);
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
      <span id={questionId} className="sr-only">
        {text.title}
      </span>
      <DecisionChoiceGroup
        labelledBy={questionId}
        options={ARCHIVE_OPTIONS.map((option) => ({ value: option.reason, label: option.label }))}
        value={reason}
        invalid={Boolean(error)}
        onChange={(next) => {
          setReason(next);
          setError(null);
        }}
      />
      {extra}
    </DecisionDialog>
  );
}
