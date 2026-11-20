"use client";

import { useEffect } from "react";
import { PublicErrorScreen } from "@/components/public/state-card";

/**
 * Rete che cade, errore transitorio del server: senza questo boundary Next mostra al dipendente la schermata
 * "Application error", che non spiega nulla. (Ondata 0) Su questa pagina non ci sono ancora risposte: niente frase sulle
 * risposte salvate. (Rilascio 10, ondata 4, PROPOSTA-10 §3.11) La scheda unica dell'errore, chiara, con il solo «Riprova»:
 * `retry` rilegge la pagina dal server (guida di Next `03-file-conventions/error.md`).
 */
export default function SurveyError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error("[survey]", error);
  }, [error]);

  return <PublicErrorScreen retry={retry} />;
}
