"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Dopo un comando testata e pagina del dossier mostrano subito i dati nuovi.
 *
 * `router.refresh()` e le server action che invalidano il layout del caso
 * (`revalidatePath(…, "layout")`) rendono di nuovo testata e pagina dentro una
 * transizione. La risposta arriva a pezzi; se React sospende su un pezzo che
 * si risolve mentre sta ancora rendendo, la sua «ping» va persa (React 19,
 * `pingSuspendedRoot` nella fase di render con la radice già «sospesa con
 * ritardo»: lo dice il TODO nel sorgente). Succede solo nel build di
 * produzione e solo sul guscio del dossier, dove nessun confine di caricamento
 * può mostrarsi: la transizione resta in attesa con tutti i dati già arrivati,
 * il pulsante dice «Un momento…» e testata e Panoramica restano quelle di
 * prima fino alla navigazione successiva.
 *
 * Qualunque aggiornamento sulla radice libera le corsie sospese e React
 * conclude la transizione. `DossierTransitionRetry` (montato una volta nel
 * layout del caso) lo dà: dopo `retryDossierTransition()` si rende di nuovo,
 * vuoto, prima spesso e poi più di rado, finché il layout reso dal server non
 * arriva (le sue props cambiano a ogni resa) o per al massimo 30 secondi, così
 * regge anche una risposta lenta. Lo chiamano `useUcAction` dopo
 * ogni comando, chi chiama una server action del caso fuori da `useUcAction` e,
 * con `refreshDossier`, chi aggiorna la pagina con `router.refresh()`. Fuori dal
 * dossier non c'è nessuno in ascolto e la chiamata non fa nulla.
 */

/** Quando ritentare, in ms dopo il comando: presto per i casi comuni, poi a intervalli più larghi per le risposte lente. */
const RETRY_DELAYS_MS: readonly number[] = [60, 200, 500, 1_000, 1_500, 2_000, 3_000, 4_000, 6_000, 8_000, 11_000, 15_000, 20_000, 25_000, 30_000];

const listeners = new Set<() => void>();

/** Chiede al dossier aperto di concludere un aggiornamento rimasto sospeso (vedi sopra). */
export function retryDossierTransition(): void {
  for (const listener of listeners) listener();
}

/** `router.refresh()` dentro il dossier: la pagina si rilegge e l'aggiornamento si conclude (vedi sopra). */
export function refreshDossier(router: { refresh(): void }): void {
  router.refresh();
  retryDossierTransition();
}

function clearTimers(timers: { current: number[] }): void {
  for (const t of timers.current) window.clearTimeout(t);
  timers.current = [];
}

export function DossierTransitionRetry(props: Record<string, never>) {
  const [, setTick] = useState(0);
  const timers = useRef<number[]>([]);
  const seen = useRef(props);
  useEffect(() => {
    const start = () => {
      clearTimers(timers);
      timers.current = RETRY_DELAYS_MS.map((ms) => window.setTimeout(() => setTick((n) => n + 1), ms));
    };
    listeners.add(start);
    return () => {
      listeners.delete(start);
      clearTimers(timers);
    };
  }, []);
  // Props nuove = il layout reso dal server è arrivato sullo schermo: l'aggiornamento è concluso.
  useEffect(() => {
    if (seen.current === props) return;
    seen.current = props;
    clearTimers(timers);
  });
  return null;
}
