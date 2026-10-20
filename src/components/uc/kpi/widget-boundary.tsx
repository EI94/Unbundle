"use client";

import { useEffect } from "react";
import { unstable_catchError, type ErrorInfo } from "next/error";
import { Button } from "@/components/ui/button";

/**
 * Un riquadro pesante che non si carica non fa cadere la pagina (DESIGN §3.14):
 * resta il resto, con «Riprova». Si registra solo il codice dell'errore.
 */
function WidgetError({ title }: { title: string }, { error, unstable_retry }: ErrorInfo) {
  const digest = (error as Error & { digest?: string }).digest;
  useEffect(() => {
    console.error("[uc] riquadro non caricato", digest ?? "senza codice");
  }, [digest]);
  return (
    <div role="alert" className="space-y-2 rounded-xl p-4 ring-1 ring-foreground/10">
      <p className="text-sm font-medium">{title}</p>
      <p className="text-sm text-muted-foreground">Ciò che hai salvato resta salvato.</p>
      <Button type="button" variant="outline" className="min-h-11 sm:min-h-8" onClick={() => unstable_retry()}>
        Riprova
      </Button>
    </div>
  );
}

export const WidgetBoundary = unstable_catchError(WidgetError);
