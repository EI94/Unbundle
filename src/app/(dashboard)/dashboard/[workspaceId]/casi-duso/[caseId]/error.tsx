"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/dashboard/page-container";
import { PAGE_ERROR_TEXT } from "@/components/dashboard/page-load-error";
import { useLateralSpaceViewer } from "@/components/uc/shell/viewer-context";
import { digestOf } from "@/lib/uc/log";

/**
 * Una pagina del dossier non si è caricata (DESIGN §3.14). Sta dentro il
 * layout del caso: testata e schede restano. Si registra solo il codice
 * dell'errore (`digest`), mai il messaggio. Next passa il valore lanciato così
 * com'è: da un Client Component può non essere un `Error`, anche `null`.
 * (Ondata 0) Il codice a schermo lo vede solo Lateral Space (`viewer-context`).
 */
export default function CasePageError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = digestOf(error);
  const lateralSpace = useLateralSpaceViewer();
  useEffect(() => {
    console.error("[uc] pagina della realizzazione non caricata", digest ?? "senza codice");
  }, [digest]);
  return (
    <PageContainer>
      <div role="alert" className="max-w-3xl space-y-3">
        {/* (Rilascio 10, §4) Le parole di ogni pagina che non si carica. */}
        <h2 className="text-lg font-semibold">{PAGE_ERROR_TEXT.title}</h2>
        <p className="text-sm text-muted-foreground">{PAGE_ERROR_TEXT.body}</p>
        <Button variant="outline" className="h-11 sm:h-8" onClick={() => retry()}>
          {PAGE_ERROR_TEXT.retry}
        </Button>
        {lateralSpace && digest && <p className="text-xs text-muted-foreground">Codice: {digest}</p>}
      </div>
    </PageContainer>
  );
}
