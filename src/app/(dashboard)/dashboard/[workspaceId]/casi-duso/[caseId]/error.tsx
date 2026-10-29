"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/dashboard/page-container";
import { digestOf } from "@/lib/uc/log";

/**
 * Una pagina del dossier non si è caricata (DESIGN §3.14). Sta dentro il
 * layout del caso: testata e schede restano. Si registra solo il codice
 * dell'errore (`digest`), mai il messaggio. Next passa il valore lanciato così
 * com'è: da un Client Component può non essere un `Error`, anche `null`.
 */
export default function CasePageError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = digestOf(error);
  useEffect(() => {
    console.error("[uc] pagina del dossier non caricata", digest ?? "senza codice");
  }, [digest]);
  return (
    <PageContainer>
      <div role="alert" className="max-w-3xl space-y-3">
        <h2 className="text-lg font-semibold">Questa sezione non si è caricata</h2>
        <p className="text-sm text-muted-foreground">Ciò che hai salvato resta salvato.</p>
        <Button variant="outline" className="h-11 sm:h-8" onClick={() => retry()}>
          Riprova
        </Button>
        {digest && <p className="text-xs text-muted-foreground">Codice: {digest}</p>}
      </div>
    </PageContainer>
  );
}
