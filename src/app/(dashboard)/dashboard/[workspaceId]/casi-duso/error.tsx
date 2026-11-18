"use client";

import { PageLoadError } from "@/components/dashboard/page-load-error";

/**
 * Errore inatteso tra le realizzazioni: il resto di Unbundle funziona e nessun dato si perde. (Rilascio 10, §4)
 * Le parole di ogni pagina che non si carica: «Questa pagina non si è caricata.» e «Riprova».
 */
export default function CasesErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  return <PageLoadError error={error} retry={retry} area="uc" />;
}
