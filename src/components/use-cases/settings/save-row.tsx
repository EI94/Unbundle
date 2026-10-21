"use client";

import { Button } from "@/components/ui/button";
import { VALUATION_SETTINGS_TEXT } from "@/lib/use-cases/settings";

/**
 * Salva e Annulla di un campo di Impostazioni › Valutazione: compaiono solo quando c'è una
 * modifica. Pulsanti bordati, mai pieni: nella pagina il pulsante pieno resta uno solo (§5.7).
 */
export function SaveRow({ label, pending, onCancel, children }: { label: string; pending: boolean; onCancel?: () => void; children?: React.ReactNode }) {
  return (
    <div className="space-y-3 pt-1" data-slot="settings-save-row">
      {children}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? VALUATION_SETTINGS_TEXT.saving : label}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>
            {VALUATION_SETTINGS_TEXT.cancel}
          </Button>
        )}
      </div>
    </div>
  );
}
