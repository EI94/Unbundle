"use client";

import { PublicStateCard } from "@/components/public";
import { PUBLIC_TEXT } from "@/lib/public/text";

/**
 * (Rilascio 10, §3.11) La scheda unica di un errore della pagina del referente, con le parole di `/r`: «Questa pagina non
 * si è caricata.», «Le risposte che hai già inviato sono salve.» e un solo pulsante, «Riprova», a tutta larghezza e alto
 * 48 px al telefono. Con `retry` (`error.tsx`, Next 16) rilegge i dati
 * della pagina; senza (la pagina non disponibile, resa dal server) la ricarica. Senza dettagli tecnici né dati della
 * richiesta.
 */
export function ErrorCard({ retry }: { retry?: () => void }) {
  return <PublicStateCard kind="error" retry={retry} body={PUBLIC_TEXT.error.saved} />;
}
