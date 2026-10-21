"use client";

import { useEffect, useId, useState } from "react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { savePublicNoteAction } from "@/lib/actions/use-case-decisions";
import {
  PUBLIC_NOTE_MAX,
  PUBLIC_NOTE_TEXT,
  followPageNote,
  lastSavedNote,
  publicNoteChange,
  publicNoteCounter,
  publicNoteFieldState,
  publicNoteHints,
  type DecisionItem,
} from "@/lib/use-cases/decision-ui";
import { cn } from "@/lib/utils";
import { useDecisionRunner, usePublicNoteDraft } from "../decision-buttons";

export interface PublicNoteFieldProps {
  workspaceId: string;
  item: Pick<DecisionItem, "id" | "version" | "publicNote" | "hiddenFromSearch">;
  /** Chi decide la modifica (`canDecide`); gli altri la leggono, se c'è. */
  canEdit: boolean;
  className?: string;
}

/**
 * «Nota pubblica» del capitolo «Decisione» (docs/use-case/DESIGN.md §6.4, §6.8, §14.3): un
 * campo di al massimo 1.000 caratteri con il contatore e l'avviso fisso «Chi conosce il codice
 * la legge tramite Claude. Non scrivere dati personali.»; per una scheda nascosta alla ricerca
 * la seconda riga. Si salva all'uscita dal campo, con la `version` letta con la pagina (o
 * lasciata dall'ultima scrittura della pagina). Se qualcuno ha appena modificato lo use case,
 * il toast lo dice, la pagina si ricarica e il testo scritto resta nel campo. Il testo del
 * campo è anche quello con cui si aprono «Serve info» e «Non avviare» (`PublicNoteDraftProvider`).
 */
export function PublicNoteField({ workspaceId, item, canEdit, className }: PublicNoteFieldProps) {
  const fieldId = useId();
  const hintId = useId();
  const [field, setField] = useState(() => publicNoteFieldState(item.publicNote));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const { run } = useDecisionRunner();
  const shared = usePublicNoteDraft();
  const draft = field.draft;

  // La nota cambiata da un dialogo («Serve info», «Non avviare») o da un'altra persona arriva
  // nel campo solo se non lo si sta scrivendo: il testo scritto resta (§6.8).
  const followed = followPageNote(field, item.publicNote);
  if (followed !== field) setField(followed);

  // Il testo del campo per i dialoghi di «Serve info» e «Non avviare».
  useEffect(() => {
    if (!shared || !canEdit) return;
    shared.set(draft);
    return () => shared.set(null);
  }, [shared, canEdit, draft]);

  if (!canEdit) {
    if (!item.publicNote?.trim()) return null;
    return (
      <div data-slot="public-note-field" className={cn("space-y-1.5", className)}>
        <h3 className="text-sm font-medium">{PUBLIC_NOTE_TEXT.label}</h3>
        <p className="text-sm whitespace-pre-line">{item.publicNote}</p>
      </div>
    );
  }

  async function save() {
    const change = publicNoteChange(lastSavedNote(field), draft);
    if ("error" in change) {
      setError(change.error);
      return;
    }
    if (!change.change) return;
    setError(null);
    const result = await run(item, (version) => savePublicNoteAction(workspaceId, item.id, version, change.value ?? ""));
    if (result.ok) {
      setSaved(true);
      setField((current) => ({ ...current, ownSave: change.value }));
    } else if (result.fieldErrors) setError(result.fieldErrors.publicNote ?? Object.values(result.fieldErrors)[0] ?? null);
  }

  return (
    <div data-slot="public-note-field" className={cn("space-y-1.5", className)}>
      {/* Facoltativa: «Approva» non la chiede; «Serve info» e «Non avviare» la chiedono nel loro dialogo. */}
      <Label htmlFor={fieldId}>{PUBLIC_NOTE_TEXT.optionalLabel}</Label>
      <Textarea
        id={fieldId}
        value={draft}
        maxLength={PUBLIC_NOTE_MAX}
        rows={3}
        aria-describedby={hintId}
        aria-invalid={error ? true : undefined}
        onChange={(event) => {
          const text = event.target.value;
          setField((current) => ({ ...current, draft: text }));
          setError(null);
          setSaved(false);
        }}
        onBlur={() => void save()}
      />
      <div id={hintId} className="flex items-start justify-between gap-3 text-xs text-muted-foreground">
        <div className="grid gap-1">
          {publicNoteHints(item.hiddenFromSearch).map((hint) => (
            <p key={hint}>{hint}</p>
          ))}
        </div>
        <span className="shrink-0 tabular-nums">{publicNoteCounter(draft)}</span>
      </div>
      <p aria-live="polite" className={cn("text-xs", error ? "text-destructive" : "text-muted-foreground")}>
        {error ?? (saved ? PUBLIC_NOTE_TEXT.saved : null)}
      </p>
    </div>
  );
}
