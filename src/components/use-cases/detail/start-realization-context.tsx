"use client";

import { createContext, useContext, type MouseEvent } from "react";
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
 * Il clic su un link «Avvia la realizzazione»: con i dati del dialogo lo apre al posto della pagina di ripiego; con un
 * tasto premuto (una nuova scheda) o senza il dialogo il link fa il suo lavoro. Senza JavaScript resta il link.
 */
export function startClickHandler(open: OpenStart | null): ((event: MouseEvent<HTMLElement>) => void) | undefined {
  if (!open) return undefined;
  return (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    open();
  };
}

/**
 * Il pulsante «Avvia la realizzazione» della piega «Realizzazione» (bordato: il pieno è del riquadro «Prossimo
 * passo»): il link alla pagina di ripiego, che con i dati del dialogo apre il dialogo.
 */
export function StartRealizationButton({ href, label, className }: { href: string; label: string; className?: string }) {
  const open = useStartRealization();
  return (
    <Button render={<Link href={href} onClick={startClickHandler(open)} />} nativeButton={false} variant="outline" className={className} data-action={open ? "start-dialog" : undefined}>
      {label}
    </Button>
  );
}
