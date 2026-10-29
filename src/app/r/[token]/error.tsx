"use client";

import { Button } from "@/components/ui/button";
import { LinkCard, ReferentShell } from "@/components/uc/referente/link-card";

/**
 * Errore imprevisto nella pagina del referente: una scheda chiara (dentro il
 * layout `.survey-light`) con «Riprova», senza dettagli tecnici né dati della
 * richiesta. Le risposte inviate restano salve; le bozze non inviate restano
 * anche sul dispositivo, salvo le voci personali.
 */
export default function ReferentLinkError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <ReferentShell>
      <LinkCard title="Qualcosa non ha funzionato" body="Può essere un problema momentaneo di connessione. Le risposte che hai già inviato sono salve: riprova tra poco.">
        <div className="mt-5 flex flex-wrap gap-2">
          <Button type="button" className="min-h-11" onClick={() => retry()}>
            Riprova
          </Button>
          <Button type="button" variant="outline" className="min-h-11" onClick={() => window.location.reload()}>
            Ricarica la pagina
          </Button>
        </div>
      </LinkCard>
    </ReferentShell>
  );
}
