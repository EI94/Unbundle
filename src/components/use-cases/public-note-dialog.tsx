"use client";

import { useId, useState } from "react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  PUBLIC_NOTE_MAX,
  PUBLIC_NOTE_TEXT,
  checkDecisionNote,
  dialogText,
  publicNoteCounter,
  publicNoteHints,
  publicNotePrefill,
  type DecisionActionResult,
  type PageDecision,
} from "@/lib/use-cases/decision-ui";
import { DecisionDialog } from "./reopen-dialog";

export interface PublicNoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** «Serve info» («Cosa serve sapere?») o «Non avviare» («Perché non lo avviamo?»). */
  decision: "serve_info" | "non_avviare";
  /** La nota pubblica salvata: il campo parte da lì. */
  publicNote: string | null;
  hiddenFromSearch: boolean;
  pending: boolean;
  onSubmit: (decision: PageDecision) => Promise<DecisionActionResult>;
}

/**
 * «Serve info» e «Non avviare» (docs/use-case/DESIGN.md §3.7, §6.4, §14.3): la nota pubblica è
 * obbligatoria, precompilata con quella esistente, al massimo 1.000 caratteri, con l'avviso
 * fisso (e la seconda riga per una scheda nascosta alla ricerca). Chi conosce il codice la
 * legge tramite Claude; chi ha proposto la scheda anche in Unbundle (D13).
 */
export function PublicNoteDialog({ open, onOpenChange, decision, publicNote, hiddenFromSearch, pending, onSubmit }: PublicNoteDialogProps) {
  const noteId = useId();
  const hintId = useId();
  const [note, setNote] = useState(() => publicNotePrefill(publicNote));
  const [error, setError] = useState<string | null>(null);
  const text = dialogText(decision, null);

  async function confirm() {
    const checked = checkDecisionNote(note);
    if (!checked.ok) {
      setError(checked.message);
      return;
    }
    setError(null);
    const result = await onSubmit({ type: decision, publicNote: checked.value });
    if (!result.ok && result.fieldErrors) setError(result.fieldErrors.publicNote ?? Object.values(result.fieldErrors)[0] ?? null);
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
      <div className="grid gap-1.5">
        <Label htmlFor={noteId}>{PUBLIC_NOTE_TEXT.label}</Label>
        <Textarea
          id={noteId}
          value={note}
          maxLength={PUBLIC_NOTE_MAX}
          rows={4}
          aria-describedby={hintId}
          aria-invalid={error ? true : undefined}
          className="min-h-24"
          onChange={(event) => {
            setNote(event.target.value);
            setError(null);
          }}
        />
        <div id={hintId} className="flex items-start justify-between gap-3 text-xs text-muted-foreground">
          <div className="grid gap-1">
            {publicNoteHints(hiddenFromSearch).map((hint) => (
              <p key={hint}>{hint}</p>
            ))}
          </div>
          <span className="shrink-0 tabular-nums">{publicNoteCounter(note)}</span>
        </div>
      </div>
    </DecisionDialog>
  );
}
