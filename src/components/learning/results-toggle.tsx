"use client";

import { cn } from "@/lib/utils";

/** Un interruttore grande e leggibile sullo sfondo scuro, con l'etichetta accanto. */
export function ResultsToggle({ checked, onChange, label, testId }: {
  checked: boolean; onChange: (checked: boolean) => void; label: string; testId?: string;
}) {
  return <button
    type="button"
    role="switch"
    aria-checked={checked}
    data-testid={testId}
    onClick={() => onChange(!checked)}
    className="inline-flex min-h-10 items-center gap-2.5 rounded-lg px-2 text-left text-sm text-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
  >
    <span aria-hidden className={cn("relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors", checked ? "bg-emerald-500" : "bg-muted-foreground/40")}>
      <span className={cn("size-4 rounded-full bg-white shadow transition-transform", checked ? "translate-x-[18px]" : "translate-x-0.5")} />
    </span>
    <span>{label}</span>
  </button>;
}
