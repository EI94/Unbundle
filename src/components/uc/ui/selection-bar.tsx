"use client";

import { Button } from "@/components/ui/button";
import { formatCountIt } from "@/lib/uc/views/format";
import { ActionMenu, type ActionMenuItem } from "./action-menu";

/**
 * Barra della selezione in Domande (DESIGN §5.1): «N selezionate», l'azione
 * principale, le altre nel menu «Altro», «Seleziona tutte» e «Annulla». Resta
 * in fondo allo schermo mentre si scorre; senza selezione non c'è.
 */
export interface SelectionBarProps {
  count: number;
  total: number;
  primary: React.ReactNode;
  more: readonly ActionMenuItem[];
  onCancel: () => void;
  onSelectAll: () => void;
}

export function SelectionBar({ count, total, primary, more, onCancel, onSelectAll }: SelectionBarProps) {
  if (count <= 0) return null;
  const all = count >= total;
  return (
    <div
      data-slot="selection-bar"
      role="region"
      aria-label="Domande selezionate"
      className="sticky bottom-3 z-30 mx-auto flex w-full max-w-3xl flex-wrap items-center gap-2 rounded-xl bg-popover p-2 text-sm shadow-lg ring-1 ring-foreground/10 sm:flex-nowrap sm:pl-4"
    >
      <p className="min-w-0 flex-1 font-medium tabular-nums" aria-live="polite">
        {count === 1 ? "1 selezionata" : `${formatCountIt(count)} selezionate`}
        {!all && (
          <Button type="button" variant="link" className="ml-1 h-auto min-h-11 px-1 sm:min-h-0" onClick={onSelectAll}>
            Seleziona tutte ({formatCountIt(total)})
          </Button>
        )}
      </p>
      <div className="flex items-center gap-2">
        {primary}
        <ActionMenu items={more} trigger="altro" />
        <Button type="button" variant="ghost" className="min-h-11 sm:min-h-8" onClick={onCancel}>
          Annulla
        </Button>
      </div>
    </div>
  );
}
