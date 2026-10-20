"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/dashboard/page-container";

/**
 * Una pagina del dossier non si è caricata (DESIGN §3.14). Sta dentro il
 * layout del caso: testata e schede restano. Si registra solo il codice
 * dell'errore (`digest`), mai il messaggio.
 */
export default function CasePageError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  useEffect(() => {
    console.error("[uc] pagina del dossier non caricata", error.digest ?? "senza codice");
  }, [error]);
  return (
    <PageContainer>
      <div role="alert" className="max-w-3xl space-y-3">
        <h2 className="text-lg font-semibold">Questa sezione non si è caricata</h2>
        <p className="text-sm text-muted-foreground">Ciò che hai salvato resta salvato.</p>
        <Button variant="outline" className="h-11 sm:h-8" onClick={() => unstable_retry()}>
          Riprova
        </Button>
        {error.digest && <p className="text-xs text-muted-foreground">Codice: {error.digest}</p>}
      </div>
    </PageContainer>
  );
}
