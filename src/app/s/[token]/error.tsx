"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * Rete che cade a metà, errore transitorio del server: senza questo boundary
 * Next mostra al dipendente la schermata "Application error", che non spiega
 * nulla. Qui invece diamo una via d'uscita. (Ondata 0) Su questa pagina non ci
 * sono ancora risposte: niente frase sulle risposte salvate. «Riprova» rilegge
 * la pagina dal server (`retry`, guida di Next `03-file-conventions/error.md`).
 */
export default function SurveyError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
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
        <h1 className="text-2xl font-semibold">Questa pagina non si è caricata.</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">
          Può essere un problema momentaneo di connessione: riprova tra poco.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button type="button" onClick={() => retry()}>
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
