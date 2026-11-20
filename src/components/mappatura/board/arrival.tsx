"use client";

/**
 * «Mappatura board»: il passo da aprire all'arrivo (rilascio 10, docs/ui-10/PROPOSTA-10.md §8.2). `?apri=<passo>` lo
 * legge la pagina; la board lo dà alla vista della scheda aperta, che apre il suo drawer, una volta. Cambiare scheda lo
 * lascia cadere: il drawer di un passo si apre dalla sua scheda.
 */
import { createContext, useContext } from "react";

export const ArrivalStep = createContext<string | null>(null);

/** Il passo dell'indirizzo, per la vista che apre il drawer; null senza. */
export function useArrivalStep(): string | null {
  return useContext(ArrivalStep);
}
