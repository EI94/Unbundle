"use client";

import { Button } from "@/components/ui/button";
import { MessageCard, PublicShell } from "@/components/use-cases/referent-public/state-card";
import { REFERENT_PUBLIC_EXTRA_TEXT as X } from "@/components/use-cases/referent-public/texts";

/**
 * Errore imprevisto nella pagina del referente: una scheda chiara con «Riprova», senza dettagli tecnici
 * né dati della richiesta. Le risposte già inviate restano salve.
 */
export default function ReferentAskError({ unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return (
    <PublicShell>
      <MessageCard title={X.errorTitle} text={<p>{X.errorText}</p>}>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button type="button" className="min-h-11 text-base" onClick={() => unstable_retry()}>
            {X.retry}
          </Button>
          <Button type="button" variant="outline" className="min-h-11 text-base" onClick={() => window.location.reload()}>
            {X.reload}
          </Button>
        </div>
      </MessageCard>
    </PublicShell>
  );
}
