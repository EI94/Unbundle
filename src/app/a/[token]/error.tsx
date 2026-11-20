"use client";

import { useEffect } from "react";
import { PublicErrorScreen } from "@/components/public/state-card";
import { SURVEY_TEXT } from "@/lib/public/survey";

/**
 * Rete che cade a metà, invio fallito, errore transitorio del server: senza questo boundary Next mostra al dipendente la
 * schermata "Application error", che non spiega nulla e non dice che le risposte sono al sicuro. (Rilascio 10, ondata 4,
 * PROPOSTA-10 §3.11) La scheda unica dell'errore, chiara, con il solo «Riprova»: `retry` rilegge la pagina dal server, e
 * le risposte salvate (sul server e sul dispositivo) tornano al loro posto.
 */
export default function SurveyError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error("[survey]", error);
  }, [error]);

  return <PublicErrorScreen retry={retry} body={SURVEY_TEXT.error} />;
}
