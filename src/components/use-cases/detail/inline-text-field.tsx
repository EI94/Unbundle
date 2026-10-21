"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { updateUseCaseFieldAction, type EditableUseCaseField } from "@/lib/actions/use-case-edit";
import type { DecisionItem } from "@/lib/use-cases/decision-ui";
import { cn } from "@/lib/utils";
import { useDecisionRunner } from "../decision-buttons";

export interface InlineTextFieldProps {
  workspaceId: string;
  /** La scheda: id e la `version` letta con la pagina (§6.8). */
  item: Pick<DecisionItem, "id" | "version">;
  field: EditableUseCaseField;
  /** L'etichetta del campo per il tipo della scheda (§6.2, `WHAT_FIELD_LABEL`). */
  label: string;
  value: string | null;
  /** Lunghezza massima in caratteri (§6.2, `TEXT_LIMITS`). */
  max: number;
  /** Testi lunghi: Invio salva, Maiusc+Invio va a capo. */
  multiline?: boolean;
  /**
   * Un elenco chiuso (le aree della guida del connettore): una scelta al posto del testo. Si salva
   * `value` (l'id della guida, che il servizio controlla), si mostra `label` (il titolo).
   */
  options?: readonly InlineFieldOption[] | null;
  /** Revisori (`canEditWhat`): gli altri leggono, e un campo vuoto non c'è. */
  canEdit: boolean;
  /** Codici («Possibile doppione di»): monospazio. */
  mono?: boolean;
  /**
   * Il campo sta nella riga compatta dei campi vuoti (§6.2), fuori dal `<dl>`: finché è vuoto e
   * chiuso è solo «+ Aggiungi …», senza la riga dell'etichetta; aperto prende tutta la riga.
   */
  compact?: boolean;
  placeholder?: string;
  /**
   * `titolo`: il titolo della scheda nella testata (H1), una volta sola (H4p). Chiuso è l'H1 con
   * la matita; aperto è il campo «Titolo», come gli altri.
   */
  variant?: "campo" | "titolo";
  className?: string;
}

export interface InlineFieldOption {
  value: string;
  label: string;
}

/** Il testo da mostrare per un valore salvato: il titolo della scelta, altrimenti il testo com'è. */
export function optionLabelOf(value: string | null, options: readonly InlineFieldOption[] | null | undefined): string | null {
  if (value === null) return null;
  return options?.find((option) => option.value === value)?.label ?? value;
}

const TEXT = Object.freeze({
  edit: "Modifica",
  add: "Aggiungi",
  save: "Salva",
  cancel: "Annulla",
});

/** «+ Aggiungi problema»: l'etichetta con l'iniziale minuscola, tranne le sigle («AI Lab»). */
export function addLabelOf(label: string): string {
  const lower = /^[A-Z]{2}/.test(label) ? label : label.charAt(0).toLocaleLowerCase("it-IT") + label.slice(1);
  return `+ ${TEXT.add} ${lower}`;
}

/** Cosa fa un tasto nel campo: Esc annulla; Invio salva; Maiusc+Invio va a capo nei testi lunghi. */
export function inlineKeyAction(key: string, opts: { shiftKey: boolean; multiline: boolean; composing?: boolean }): "salva" | "annulla" | null {
  if (opts.composing) return null;
  if (key === "Escape") return "annulla";
  if (key === "Enter" && !(opts.multiline && opts.shiftKey)) return "salva";
  return null;
}

/** Il testo da salvare è uguale a quello salvato? Spazi in testa e in coda non contano (il servizio li toglie). */
export function sameFieldText(draft: string, saved: string | null): boolean {
  return draft.trim() === (saved ?? "").trim();
}

/**
 * Un campo di «Cosa è» modificato sul posto (docs/use-case/DESIGN.md §6.2, §6.8): la matita al
 * passaggio del mouse (sempre visibile sul telefono), Esc annulla, Invio salva, Maiusc+Invio va
 * a capo nei testi lunghi. Un campo vuoto si vede solo a chi può modificarlo, come «+ Aggiungi
 * …» (nella riga compatta, `compact`, senza la riga dell'etichetta): mai «Vuoto.». Il salvataggio porta la `version` letta con la pagina (o lasciata
 * dall'ultima scrittura della pagina, `useDecisionRunner`): se qualcuno ha appena modificato lo
 * use case, il toast lo dice, la pagina si ricarica e il testo scritto resta nel campo.
 */
export function InlineTextField({
  workspaceId,
  item,
  field,
  label,
  value,
  max,
  multiline = false,
  options,
  canEdit,
  mono = false,
  compact = false,
  placeholder,
  variant = "campo",
  className,
}: InlineTextFieldProps) {
  const inputId = useId();
  const errorId = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Il valore appena salvato, finché la pagina non porta quello nuovo: niente lampo del vecchio.
  const [saved, setSaved] = useState<{ base: string | null; text: string | null } | null>(null);
  const { run, pending } = useDecisionRunner();
  const editButton = useRef<HTMLButtonElement | null>(null);
  const shown = saved && saved.base === value ? saved.text : value;
  const hasValue = typeof shown === "string" && shown.trim() !== "";
  const choices = options && options.length ? options : null;

  if (!canEdit && !hasValue) return null;

  // Fuori dal `<dl>` (riga compatta) etichetta e valore non sono `dt` e `dd`.
  const LabelTag = compact ? "div" : "dt";
  const ValueTag = compact ? "div" : "dd";
  const addButton = (
    <button
      ref={editButton}
      type="button"
      className="-ml-1 inline-flex min-h-11 items-center rounded-md px-1 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-8"
      onClick={start}
    >
      {addLabelOf(label)}
    </button>
  );
  // Campo vuoto e chiuso nella riga compatta: solo «+ Aggiungi …» (§6.2).
  if (compact && !editing && !hasValue) {
    return (
      <div data-slot="inline-text-field" data-field={field} className={cn("min-w-0", className)}>
        {addButton}
      </div>
    );
  }

  function start() {
    setDraft(shown ?? "");
    setError(null);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setError(null);
    // Il fuoco torna dove era, sulla matita o su «+ Aggiungi».
    requestAnimationFrame(() => editButton.current?.focus());
  }

  async function save() {
    if (pending) return;
    if (sameFieldText(draft, shown)) {
      cancel();
      return;
    }
    setError(null);
    const text = draft;
    const result = await run(item, (version) => updateUseCaseFieldAction(workspaceId, item.id, version, field, text));
    if (result.ok) {
      setSaved({ base: value, text: text.trim() ? text.trim() : null });
      setEditing(false);
      requestAnimationFrame(() => editButton.current?.focus());
    } else if (result.fieldErrors) {
      setError(result.fieldErrors[field] ?? Object.values(result.fieldErrors)[0] ?? null);
    }
    // Versione superata e ogni altro errore: il toast lo dice (`useDecisionRunner`), il testo resta.
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const action = inlineKeyAction(event.key, { shiftKey: event.shiftKey, multiline, composing: event.nativeEvent.isComposing });
    if (!action) return;
    event.preventDefault();
    if (action === "annulla") cancel();
    else void save();
  }

  // Il titolo nella testata: chiuso è l'H1, con la matita per chi può modificarlo.
  if (variant === "titolo" && !editing) {
    return (
      <div data-slot="inline-text-field" data-field={field} className={cn("group flex min-w-0 items-start gap-1.5", className)}>
        <h1 className="min-w-0 text-2xl font-semibold tracking-tight break-words">{shown}</h1>
        {canEdit ? (
          <Button
            ref={editButton}
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`${TEXT.edit} ${label.toLocaleLowerCase("it-IT")}`}
            title={TEXT.edit}
            className="mt-0.5 size-11 shrink-0 text-muted-foreground transition-opacity sm:size-7 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 md:focus-visible:opacity-100"
            onClick={start}
          >
            <Pencil aria-hidden />
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div data-slot="inline-text-field" data-field={field} className={cn("group min-w-0 space-y-1", compact && "basis-full", className)}>
      <LabelTag className="text-sm text-muted-foreground">{editing ? <label htmlFor={inputId}>{label}</label> : label}</LabelTag>
      <ValueTag className="min-w-0">
        {editing ? (
          <div className="space-y-2">
            {choices ? (
              <Select
                items={choices.map((choice) => ({ value: choice.value, label: choice.label }))}
                value={draft || null}
                onValueChange={(next) => {
                  setDraft(typeof next === "string" ? next : "");
                  setError(null);
                }}
              >
                <SelectTrigger id={inputId} aria-describedby={error ? errorId : undefined} aria-invalid={error ? true : undefined} className="min-h-11 w-full sm:min-h-8 sm:w-72">
                  <SelectValue placeholder={label} />
                </SelectTrigger>
                <SelectContent>
                  {choices.map((choice) => (
                    <SelectItem key={choice.value} value={choice.value}>
                      {choice.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : multiline ? (
              <Textarea
                id={inputId}
                autoFocus
                value={draft}
                maxLength={max}
                rows={4}
                placeholder={placeholder}
                aria-describedby={error ? errorId : undefined}
                aria-invalid={error ? true : undefined}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setError(null);
                }}
                onKeyDown={onKeyDown}
              />
            ) : (
              <Input
                id={inputId}
                autoFocus
                value={draft}
                maxLength={max}
                placeholder={placeholder}
                autoComplete="off"
                aria-describedby={error ? errorId : undefined}
                aria-invalid={error ? true : undefined}
                className={cn(mono && "font-mono")}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setError(null);
                }}
                onKeyDown={onKeyDown}
              />
            )}
            {error ? (
              <p id={errorId} role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="secondary" size="sm" aria-busy={pending || undefined} className="min-h-11 sm:min-h-7" onClick={() => void save()}>
                {TEXT.save}
              </Button>
              <Button type="button" variant="ghost" size="sm" className="min-h-11 sm:min-h-7" onClick={cancel}>
                {TEXT.cancel}
              </Button>
            </div>
          </div>
        ) : hasValue ? (
          <div className="flex min-w-0 items-start gap-1.5">
            <p className={cn("min-w-0 flex-1 text-sm break-words whitespace-pre-line", mono && "font-mono")}>{optionLabelOf(shown, choices)}</p>
            {canEdit ? (
              <Button
                ref={editButton}
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`${TEXT.edit} ${label.toLocaleLowerCase("it-IT")}`}
                title={TEXT.edit}
                className="size-11 shrink-0 text-muted-foreground transition-opacity sm:size-7 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 md:focus-visible:opacity-100"
                onClick={start}
              >
                <Pencil aria-hidden />
              </Button>
            ) : null}
          </div>
        ) : (
          addButton
        )}
      </ValueTag>
    </div>
  );
}
