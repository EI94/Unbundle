"use client";

import { Button } from "@/components/ui/button";
import { PRIMARY_CLASS } from "@/components/uc/referente/screen";
import { REFERENT_PUBLIC_TEXT } from "@/lib/use-cases/referent/labels";
import { MessageCard } from "./message-card";

const X = REFERENT_PUBLIC_TEXT.error;

/**
 * (Rilascio 10, §3.11) La scheda unica di un errore della pagina del referente, con le parole di `/r`: «Questa pagina non
 * si è caricata.», «Le risposte che hai già inviato sono salve.» e un solo pulsante, «Riprova», a tutta larghezza e alto
 * 48 px al telefono. Con `retry` (`error.tsx`, Next 16) rilegge i dati
 * della pagina; senza (la pagina non disponibile, resa dal server) la ricarica. Senza dettagli tecnici né dati della
 * richiesta.
 */
export function ErrorCard({ retry }: { retry?: () => void }) {
  return (
    <MessageCard title={X.title} text={<p>{X.text}</p>}>
      <div className="mt-5">
        <Button type="button" className={PRIMARY_CLASS} onClick={() => (retry ? retry() : window.location.reload())}>
          {X.retry}
        </Button>
      </div>
    </MessageCard>
  );
}
