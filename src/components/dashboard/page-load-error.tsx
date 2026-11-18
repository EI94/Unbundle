"use client";

import { useEffect } from "react";
import { PageContainer } from "@/components/dashboard/page-container";
import { Button } from "@/components/ui/button";
import { digestOf } from "@/lib/uc/log";

/** Le parole di una pagina che non si è caricata (docs/ui-10/PROPOSTA-10.md §4.1, «Gli errori»). */
export const PAGE_ERROR_TEXT = Object.freeze({
  title: "Questa pagina non si è caricata.",
  body: "Quello che hai già salvato resta salvato.",
  retry: "Riprova",
});

/**
 * (Ondata 0) Il riquadro delle pagine che non si caricano, per `error.tsx` del workspace (dentro la cornice: barra
 * laterale e barra in alto restano) e di `/dashboard`. «Riprova» rilegge la pagina dal server e la rende di nuovo
 * (`retry`, guida di Next `03-file-conventions/error.md`). Si registra solo il codice dell'errore (`digest`), mai il
 * messaggio; Next passa il valore lanciato così com'è, anche `null`.
 */
export function PageLoadError({ error, retry, area }: { error: unknown; retry: () => void; area: string }) {
  const digest = digestOf(error);
  useEffect(() => {
    console.error(`[${area}] pagina non caricata`, digest ?? "senza codice");
  }, [area, digest]);
  return (
    <PageContainer size="narrow">
      <div role="alert" className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">{PAGE_ERROR_TEXT.title}</h1>
        <p className="text-sm text-muted-foreground">{PAGE_ERROR_TEXT.body}</p>
        <Button type="button" className="min-h-11 sm:min-h-8" onClick={() => retry()}>
          {PAGE_ERROR_TEXT.retry}
        </Button>
      </div>
    </PageContainer>
  );
}
