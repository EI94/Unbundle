"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * Rete che cade durante l'accesso, errore transitorio del server: senza questo
 * boundary la persona in aula vede "Application error", che non spiega nulla.
 * Qui invece sa che non ha rotto niente e che basta riprovare.
 */
export default function CourseJoinError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[course-join]", error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10 text-foreground">
      <div className="w-full max-w-lg rounded-[28px] border bg-card p-8 text-center">
        <h1 className="text-2xl font-semibold">Qualcosa non ha funzionato</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">
          Non è colpa tua e non hai perso nulla: se eri già iscritto al corso,
          lo resti. Riprova, e se continua avvisa il formatore.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
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
      </div>
    </main>
  );
}
