"use client";

import { ReferentShell } from "@/components/uc/referente/link-card";
import { ErrorCard } from "@/components/uc/referente/screen";

/**
 * Errore imprevisto nella pagina del referente: la scheda unica dell'errore (rilascio 10, §3.11), chiara (dentro il
 * layout `.survey-light`), con il solo «Riprova»: `retry()` di Next 16 rilegge i dati e ridisegna la pagina. Senza
 * dettagli tecnici né dati della richiesta. Le risposte inviate restano salve; le bozze non inviate restano anche sul
 * dispositivo, salvo le voci personali.
 */
export default function ReferentLinkError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <ReferentShell>
      <ErrorCard retry={retry} />
    </ReferentShell>
  );
}
