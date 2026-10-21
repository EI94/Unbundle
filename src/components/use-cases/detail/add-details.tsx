"use client";

import { useId, useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/** Il testo del pulsante (H4p). */
export const ADD_DETAILS_TEXT = "Aggiungi altri campi";

/**
 * I campi vuoti di «Cos'è» dietro un solo «Aggiungi altri campi» (H4p), invece di una fila di «+
 * Aggiungi …». Non «Aggiungi dettagli»: si confonderebbe con «Dettagli», in fondo al capitolo
 * (H7). Un clic li mostra, ciascuno con il suo «+ Aggiungi …», e il primo che si apre
 * prende la riga. Si apre una volta e resta aperto.
 */
export function AddDetails({ children, className }: { children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div data-slot="add-details" className={cn("space-y-1", className)}>
      {open ? null : (
        <button
          type="button"
          aria-expanded={false}
          aria-controls={id}
          className="-ml-1 inline-flex min-h-11 items-center gap-1 rounded-md px-1 text-sm font-medium text-primary underline underline-offset-4 outline-none hover:decoration-2 focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-8"
          onClick={() => setOpen(true)}
        >
          <Plus aria-hidden className="size-4" />
          {ADD_DETAILS_TEXT}
        </button>
      )}
      <div id={id} hidden={!open} className="flex flex-wrap items-start gap-x-4 gap-y-1">
        {children}
      </div>
    </div>
  );
}
