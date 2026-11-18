"use client";

import { catchError, type ErrorInfo } from "next/error";
import { Button } from "@/components/ui/button";
import { digestOf } from "@/lib/uc/log";

/**
 * Il riquadro al posto del widget; il valore lanciato può non essere un `Error`, anche `null`. (Ondata 0) Il codice
 * dell'errore solo con `showCode`, cioè a Lateral Space.
 */
export function WidgetFallback({ title, showCode = false }: { title: string; showCode?: boolean }, { error, retry }: ErrorInfo) {
  const digest = showCode ? digestOf(error) : null;
  return (
    <div role="alert" className="space-y-2 rounded-xl p-4 ring-1 ring-foreground/10">
      <p className="text-sm font-medium">{title} non si è caricato.</p>
      <p className="text-xs text-muted-foreground">Ciò che hai salvato resta salvato.</p>
      {digest && <p className="text-xs text-muted-foreground">Codice: {digest}</p>}
      <Button variant="outline" size="sm" className="min-h-11 sm:min-h-7" onClick={() => retry()}>
        Riprova
      </Button>
    </div>
  );
}

/**
 * Isola un widget pesante della pagina (DESIGN §3.14: il pannello d'invio):
 * se si rompe, la pagina resta in piedi e il widget offre «Riprova».
 */
export const WidgetBoundary = catchError(WidgetFallback);
