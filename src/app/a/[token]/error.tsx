"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * Rete che cade a metà, invio fallito, errore transitorio del server: senza
 * questo boundary Next mostra al dipendente la schermata "Application error",
 * che non spiega nulla e non dice che le risposte sono al sicuro sul suo
 * dispositivo. Qui invece diamo una via d'uscita.
 */
export default function SurveyError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[survey]", error);
  }, [error]);

  return (
    <main
      id="survey-root"
      className="flex min-h-screen items-center justify-center bg-background px-4 py-8 text-foreground"
    >
      <div className="w-full max-w-lg rounded-[32px] border bg-card p-8 text-center">
        <h1 className="text-2xl font-semibold">Qualcosa non ha funzionato</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">
          Può essere un problema momentaneo di connessione.{" "}
          <span className="font-medium text-foreground">
            Le risposte che hai già dato sono salvate su questo dispositivo:
          </span>{" "}
          riprova e le ritrovi al loro posto.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button type="button" onClick={reset}>
            Riprova
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => window.location.reload()}
          >
            Ricarica la pagina
          </Button>
        </div>
        <p className="mt-6 text-xs text-muted-foreground">
          Se il problema continua, avvisa il referente interno del progetto.
        </p>
      </div>
    </main>
  );
}
