"use client";

import type { ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** Un campo delle finestre di «Chiedi al referente»: etichetta, controllo, suggerimento ed errore. */
export function Field({ id, label, hint, error, children, className }: { id: string; label: string; hint?: string | null; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? (
        <p id={`${id}-aiuto`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-errore`} className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Le descrizioni di un controllo: suggerimento ed errore, se ci sono. */
export function describedBy(id: string, hint?: string | null, error?: string | null): string | undefined {
  const ids = [hint ? `${id}-aiuto` : null, error ? `${id}-errore` : null].filter(Boolean);
  return ids.length ? ids.join(" ") : undefined;
}

/** Un elenco di domande da spuntare, con il titolo di ogni esigenza. */
export function NeedChecklist({
  labelledBy,
  items,
  selected,
  onChange,
  disabledIds,
  invalid,
}: {
  labelledBy: string;
  items: ReadonlyArray<{ id: string; title: string }>;
  selected: readonly string[];
  onChange: (next: string[]) => void;
  disabledIds?: ReadonlySet<string>;
  invalid?: boolean;
}) {
  const chosen = new Set(selected);
  return (
    <ul role="group" aria-labelledby={labelledBy} className={cn("max-h-64 space-y-0.5 overflow-y-auto rounded-lg border p-1", invalid && "border-destructive")}>
      {items.map((item) => {
        const checked = chosen.has(item.id);
        const disabled = disabledIds?.has(item.id) && !checked;
        return (
          <li key={item.id}>
            <label className={cn("flex min-h-11 cursor-pointer items-start gap-2.5 rounded-md px-2 py-2 text-sm hover:bg-muted/50 sm:min-h-9 sm:py-1.5", disabled && "cursor-not-allowed opacity-60")}>
              <Checkbox
                className="mt-0.5"
                checked={checked}
                disabled={disabled}
                onCheckedChange={(next) => onChange(next === true ? items.map((i) => i.id).filter((id) => chosen.has(id) || id === item.id) : selected.filter((id) => id !== item.id))}
              />
              <span className="min-w-0 break-words">{item.title}</span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}
