"use client";

import { PageContainer } from "@/components/dashboard/page-container";
import { Button } from "@/components/ui/button";
import { CONTEXT_TEXT } from "@/lib/context/text";

/** Errore inatteso in «Contesto»: il resto di Unbundle funziona e quello che è già salvato resta salvato. */
export default function ContextErrorPage({ retry }: { retry: () => void }) {
  return (
    <PageContainer size="narrow" className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">{CONTEXT_TEXT.page.errorTitle}</h1>
      <p className="text-sm text-muted-foreground">{CONTEXT_TEXT.page.errorBody}</p>
      <Button type="button" className="min-h-11 sm:min-h-8" onClick={() => retry()}>
        {CONTEXT_TEXT.page.retry}
      </Button>
    </PageContainer>
  );
}
