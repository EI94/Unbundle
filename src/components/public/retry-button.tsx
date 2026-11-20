"use client";

import { Button } from "@/components/ui/button";
import { PUBLIC_TEXT } from "@/lib/public/text";
import { cn } from "@/lib/utils";
import { PUBLIC_PRIMARY } from "./classes";

/**
 * «Riprova», il solo pulsante della scheda d'errore delle pagine pubbliche (rilascio 10, ondata 4, PROPOSTA-10 §3.11):
 * pieno, a tutta larghezza, 48 px. Con `retry` (gli `error.tsx`, Next 16) rilegge la pagina dal server; senza (una scheda
 * resa dal server, dove non c'è un confine d'errore, per esempio «servizio non disponibile» su `/r`) ricarica la pagina.
 * È del client solo per il tocco: la scheda resta resa dal server.
 */
export function PublicRetryButton({ retry, className }: { retry?: () => void; className?: string }) {
  return (
    <Button type="button" className={cn(PUBLIC_PRIMARY, className)} onClick={() => (retry ? retry() : window.location.reload())}>
      {PUBLIC_TEXT.error.retry}
    </Button>
  );
}
