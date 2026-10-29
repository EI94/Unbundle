"use client";

import { useEffect } from "react";
import { catchError, type ErrorInfo } from "next/error";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { digestOf } from "@/lib/uc/log";

export function GraphFallback(props: { label?: string }, { error, retry }: ErrorInfo) {
  // Da Next 16.3 `ErrorInfo.error` è `unknown` (si può lanciare qualsiasi valore, anche `null`).
  const digest = digestOf(error);
  useEffect(() => {
    console.error("uc: la vista di analisi della mappa non si è caricata", digest ?? (error instanceof Error ? error.message : String(error)));
  }, [digest, error]);
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-xl p-4 text-sm ring-1 ring-foreground/10 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="font-medium">{props.label ?? "La vista di analisi non si è caricata"}</p>
        <p className="text-muted-foreground">Spegni «Vista di analisi» per vedere l&apos;elenco dei passi.</p>
        {digest && <p className="mt-1 text-xs text-muted-foreground">Codice: {digest}</p>}
      </div>
      <Button variant="outline" onClick={() => retry()} className="min-h-11 shrink-0 sm:min-h-8">
        <RotateCcw aria-hidden />
        Riprova
      </Button>
    </div>
  );
}

/**
 * Il grafo della Mappa è un widget pesante (DESIGN §3.14): un errore nel
 * disegno non fa cadere la pagina, resta un riquadro con «Riprova».
 */
export const GraphBoundary = catchError(GraphFallback);
