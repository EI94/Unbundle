"use client";

import { PageLoadError } from "@/components/dashboard/page-load-error";

/**
 * Errore inatteso nella pagina «Use case» (docs/use-case/DESIGN.md §4.9). (Rilascio 10, §4) Le parole di ogni
 * pagina che non si carica: «Questa pagina non si è caricata.» e «Riprova» (`PageLoadError`). Il resto di
 * Unbundle funziona e nessun dato si perde. `retry` rilegge i dati del segmento e lo rende di nuovo (guida di
 * Next `03-file-conventions/error.md`).
 */
export default function UseCasesError({ error, retry }: { error: unknown; retry: () => void }) {
  return <PageLoadError error={error} retry={retry} area="use-cases" />;
}
