"use client";

import type { ReactNode } from "react";
import { XIcon } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CONTEXT_TEXT } from "@/lib/context/text";
import { cn } from "@/lib/utils";

/**
 * I pezzi dei moduli di «Contesto» (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §7): un campo con la sua
 * etichetta e il suo errore, una scelta da un elenco, gli use case collegati. Ogni cosa che si tocca è alta almeno
 * 44 px sul telefono (`min-h-11`).
 */

export interface UseCaseOption {
  id: string;
  code: string | null;
  title: string;
}

/** Come si chiama uno use case in una riga: il codice, se c'è; altrimenti il titolo. */
export function nameOfUseCase(useCase: Pick<UseCaseOption, "code" | "title">): string {
  return useCase.code ?? useCase.title;
}

/** Un campo: l'etichetta, il controllo, un suggerimento e l'errore (letto dai lettori di schermo). */
export function Field({ id, label, hint, error, optional, children }: { id: string; label: string; hint?: string; error?: string | null; optional?: boolean; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="flex items-baseline gap-1.5 text-sm font-medium">
        {label}
        {optional ? <span className="text-xs font-normal text-muted-foreground">({CONTEXT_TEXT.add.optional})</span> : null}
      </label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? (
        <p id={`${id}-errore`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Una scelta da un elenco breve (sezione, chi lo vede, di chi è un impegno). */
export function ChoiceSelect<T extends string>({
  id,
  value,
  onChange,
  items,
  disabled,
  placeholder,
  ariaLabel,
}: {
  id: string;
  value: T | null;
  onChange: (value: T) => void;
  items: readonly { value: T; label: string }[];
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
}) {
  return (
    <Select items={items} value={value} onValueChange={(next) => next !== null && onChange(next as T)} disabled={disabled}>
      <SelectTrigger id={id} aria-label={ariaLabel} className="min-h-11 w-full sm:min-h-8">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Gli use case collegati: una pastiglia per use case, con «Togli», e «Collega uno use case» per aggiungerne uno.
 * L'elenco arriva dalla pagina (solo per Lateral Space).
 */
export function UseCasePicker({ id, value, onChange, options, disabled }: { id: string; value: readonly string[]; onChange: (ids: string[]) => void; options: readonly UseCaseOption[]; disabled?: boolean }) {
  const byId = new Map(options.map((option) => [option.id, option]));
  const free = options.filter((option) => !value.includes(option.id));
  return (
    <div className="space-y-2">
      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {value.map((useCaseId) => {
            const option = byId.get(useCaseId);
            const name = option ? nameOfUseCase(option) : useCaseId.slice(0, 8);
            return (
              <li key={useCaseId} className="inline-flex items-center gap-0.5 rounded-full border bg-muted/40 py-0.5 pl-2.5 text-xs">
                <span title={option?.title}>{name}</span>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange(value.filter((other) => other !== useCaseId))}
                  className="inline-flex size-11 items-center justify-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 sm:size-7"
                >
                  <XIcon aria-hidden className="size-3.5" />
                  <span className="sr-only">{`${CONTEXT_TEXT.notes.remove} ${name}`}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {free.length > 0 ? (
        <ChoiceSelect
          id={id}
          value={null}
          placeholder={CONTEXT_TEXT.confirm.linkUseCase}
          ariaLabel={CONTEXT_TEXT.confirm.linkUseCase}
          disabled={disabled}
          items={free.map((option) => ({ value: option.id, label: option.code ? `${option.code} · ${option.title}` : option.title }))}
          onChange={(useCaseId) => onChange([...value, useCaseId])}
        />
      ) : null}
    </div>
  );
}

/** Una pastiglia piccola: «dedotto», «da verificare», «Nuovo», «Cambiato». */
export function Mark({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs text-muted-foreground", className)}>{children}</span>;
}
