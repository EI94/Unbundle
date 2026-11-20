"use client";

import { createContext, useContext } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * (Rilascio 10, §3.5) Il contesto del dialogo «Avvia la realizzazione» della scheda e il pulsante della piega
 * «Realizzazione»: un modulo a parte, senza l'azione del server, così il riquadro «Prossimo passo» e la piega lo usano
 * senza portarsi dietro il dialogo (`start-realization-dialog.tsx`, che lo fornisce).
 */

/** Apre il dialogo «Avvia la realizzazione»; null senza i suoi dati (allora il pulsante porta alla pagina di ripiego). */
type OpenStart = () => void;

export const StartContext = createContext<OpenStart | null>(null);

/** La funzione che apre il dialogo della scheda; null fuori dalla scheda o senza i dati del dialogo. */
export function useStartRealization(): OpenStart | null {
  return useContext(StartContext);
}

/**
 * Il pulsante «Avvia la realizzazione» della piega «Realizzazione» (bordato: il pieno è del riquadro «Prossimo
 * passo»). Con i dati del dialogo lo apre; senza, porta alla pagina di ripiego.
 */
export function StartRealizationButton({ href, label, className }: { href: string; label: string; className?: string }) {
  const open = useStartRealization();
  if (open) {
    return (
      <Button type="button" variant="outline" className={className} onClick={open}>
        {label}
      </Button>
    );
  }
  return (
    <Button render={<Link href={href} />} nativeButton={false} variant="outline" className={className}>
      {label}
    </Button>
  );
}
