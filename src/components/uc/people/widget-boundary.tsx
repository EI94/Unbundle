"use client";

import { catchError, type ErrorInfo } from "next/error";
import { Button } from "@/components/ui/button";
import { digestOf } from "@/lib/uc/log";

/** Il riquadro al posto del widget; il valore lanciato può non essere un `Error`, anche `null`. */
export function WidgetFallback({ title }: { title: string }, { error, retry }: ErrorInfo) {
  const digest = digestOf(error);
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
