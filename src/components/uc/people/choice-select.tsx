"use client";

import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * Una scelta da un elenco con il `Select` di shadcn (DESIGN §5.4: nel dashboard
 * niente `select` nativi). Il valore vuoto è `""`; le opzioni si possono
 * raggruppare («Con questo ruolo», «Altri referenti»).
 */
export interface ChoiceOption {
  value: string;
  label: string;
  /** (8.0c) Si vede ma non si sceglie: chi o che cosa il server rifiuterebbe. */
  disabled?: boolean;
  /** (8.0c) Il perché, sotto l'etichetta, in piccolo («serve il ruolo di Analista»). */
  note?: string;
}

export interface ChoiceGroup {
  label?: string;
  options: readonly ChoiceOption[];
}

const NONE = "__nessuno__";

/** L'etichetta, e sotto il perché (va a capo nella larghezza del menu, anche a 390 px). */
function OptionText({ option }: { option: ChoiceOption }) {
  if (!option.note) return <>{option.label}</>;
  return (
    <span className="flex min-w-0 flex-col">
      <span>{option.label}</span>
      <span className="text-xs whitespace-normal text-muted-foreground">{option.note}</span>
    </span>
  );
}

export function ChoiceSelect({
  id,
  value,
  onChange,
  groups,
  placeholder,
  disabled,
  className,
  ariaLabel,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  groups: readonly ChoiceGroup[];
  /** Testo del valore vuoto: «Scegli». */
  placeholder: string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const items = [{ value: NONE, label: placeholder }, ...groups.flatMap((g) => g.options)];
  return (
    <Select items={items} value={value || NONE} disabled={disabled} onValueChange={(v) => onChange(v && v !== NONE ? String(v) : "")}>
      <SelectTrigger id={id} aria-label={ariaLabel} className={cn("min-h-11 w-full min-w-0 sm:min-h-8", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{placeholder}</SelectItem>
        {groups.map((g, i) =>
          g.label ? (
            <SelectGroup key={g.label}>
              <SelectLabel>{g.label}</SelectLabel>
              {g.options.map((o) => (
                <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
                  <OptionText option={o} />
                </SelectItem>
              ))}
            </SelectGroup>
          ) : (
            g.options.map((o) => (
              <SelectItem key={`${i}-${o.value}`} value={o.value} disabled={o.disabled}>
                <OptionText option={o} />
              </SelectItem>
            ))
          ),
        )}
      </SelectContent>
    </Select>
  );
}
