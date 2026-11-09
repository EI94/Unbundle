"use client";

import { Button } from "@/components/ui/button";

/** Errore inatteso in «Programma»: il resto di Unbundle funziona e nessun dato si perde. */
export default function ProgramErrorPage({ retry }: { retry: () => void }) {
  return (
    <main className="mx-auto w-full max-w-3xl space-y-4 px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-semibold">Programma non disponibile</h1>
      <p className="text-sm text-muted-foreground">La pagina non si è caricata. Riprova tra poco: quello che hai già salvato resta salvato.</p>
      <Button onClick={retry}>Riprova</Button>
    </main>
  );
}
