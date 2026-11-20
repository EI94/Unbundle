"use client";

import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Al massimo tre righe in vista (rilascio 10, §1 regola 4). */
export const ROWS_SHOWN = 3;

/**
 * Le righe di un elenco di Valore (leve, costi): le prime tre, poi «Vedi tutti (N)», che apre le altre sul posto. Le
 * righe arrivano già fatte dal server; qui c'è solo il conto di quante se ne vedono.
 */
export function RowsToggle({ items, label, showAll, showFewer, className }: { items: ReactNode[]; label: string; showAll: string; showFewer: string; className?: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, ROWS_SHOWN);
  return (
    <>
      <ul aria-label={label} className={cn("divide-y overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10", className)}>
        {shown}
      </ul>
      {items.length > ROWS_SHOWN && (
        <button
          type="button"
          aria-expanded={all}
          onClick={() => setAll(!all)}
          className="inline-flex min-h-11 items-center gap-0.5 rounded-md text-sm text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:min-h-8"
        >
          {all ? showFewer : showAll}
          <ChevronRight className={cn("size-3.5 transition-transform", all && "-rotate-90")} aria-hidden />
        </button>
      )}
    </>
  );
}
