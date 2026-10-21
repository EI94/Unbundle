"use client";

import { PageContainer } from "@/components/dashboard/page-container";
import { Button } from "@/components/ui/button";

/**
 * Errore inatteso nella pagina «Use case» (docs/use-case/DESIGN.md §4.9): «Non riusciamo a
 * caricare gli use case.» [Riprova]. Il resto di Unbundle funziona e nessun dato si perde.
 * `unstable_retry` rilegge i dati del segmento e lo rende di nuovo (guida di Next
 * `03-file-conventions/error.md`).
 */
export default function UseCasesError({ unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return (
    <PageContainer size="default">
      <div role="alert" className="flex flex-col items-start gap-3">
        <p className="text-base font-medium">Non riusciamo a caricare gli use case.</p>
        <Button className="min-h-11 sm:min-h-8" onClick={() => unstable_retry()}>
          Riprova
        </Button>
      </div>
    </PageContainer>
  );
}
