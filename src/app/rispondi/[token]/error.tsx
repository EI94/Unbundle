"use client";

import { ErrorCard } from "@/components/use-cases/referent-public/error-card";
import { PublicShell } from "@/components/use-cases/referent-public/state-card";

/**
 * Errore imprevisto nella pagina del referente. (Rilascio 10, §3.11) La scheda unica di un errore: «Questa pagina non si
 * è caricata.» e il solo «Riprova» (`retry` di Next 16 rilegge i dati), senza dettagli tecnici né dati della richiesta.
 */
export default function ReferentAskError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <PublicShell>
      <ErrorCard retry={retry} />
    </PublicShell>
  );
}
