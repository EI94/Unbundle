"use client";

import { useEffect } from "react";
import { PublicErrorScreen } from "@/components/public/state-card";

/**
 * (Rilascio 10, ondata 4, PROPOSTA-10 §3.11) L'invito che non si carica: la scheda unica dell'errore, chiara, con il solo
 * «Riprova» (`retry` rilegge la pagina dal server). Prima qui non c'era un confine, e l'errore finiva sulla rete di
 * `global-error.tsx`.
 */
export default function InviteError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error("[invite]", error);
  }, [error]);

  return <PublicErrorScreen retry={retry} />;
}
