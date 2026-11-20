"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LIVE_REFRESH_PROBE, liveRefreshAfter, liveRefreshDelayMs, liveRefreshRuns } from "@/lib/learning/live-refresh";
import { learningLeave } from "./use-unsaved-changes";

/**
 * (Rilascio 10, ondata 7a, PROPOSTA-10 §3.9) In lezione la pagina del corso si rilegge da sola ogni 15 secondi, appena
 * si torna sulla scheda e appena torna la rete: un esercizio che si apre, o che chi tiene il corso apre, compare senza
 * premere niente. Rilegge la pagina dal server (`router.refresh`) solo se la rete arriva al sito; senza rete, con il
 * sito che non risponde, con la scheda nascosta o con modifiche non salvate in un modulo, aspetta (il ritmo sta in
 * `@/lib/learning/live-refresh`), così il browser non finisce sulla sua pagina «offline». Prima di `from` (l'istante
 * da cui la lezione conta, deciso dal server con `liveRefreshFrom`) aspetta soltanto. I Risultati la usano con il loro
 * ritmo di sempre (`seconds={10}`). Non disegna niente.
 */
export function LiveRefresh({ from, seconds }: { from: number; seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    let failures = 0;
    let stopped = false;
    let running = false;
    let timer: number | undefined;

    const schedule = () => {
      window.clearTimeout(timer);
      if (!stopped) timer = window.setTimeout(() => void check(), Math.max(from - Date.now(), liveRefreshDelayMs(failures, seconds)));
    };

    /** La rete arriva al sito? Un file piccolo, mai dalla cache. */
    const reachable = async () => {
      try {
        const res = await fetch(LIVE_REFRESH_PROBE, { method: "HEAD", cache: "no-store" });
        return res.ok;
      } catch {
        return false;
      }
    };

    const check = async () => {
      if (stopped || running) return;
      if (Date.now() < from || !liveRefreshRuns({ online: navigator.onLine, visible: document.visibilityState === "visible", editing: learningLeave.blocksUnload() })) {
        schedule();
        return;
      }
      running = true;
      const next = liveRefreshAfter(failures, await reachable());
      running = false;
      if (stopped) return;
      failures = next.failures;
      if (next.refresh) router.refresh();
      schedule();
    };

    const now = () => {
      window.clearTimeout(timer);
      void check();
    };
    const onOnline = () => {
      failures = 0;
      now();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") now();
    };

    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    schedule();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, from, seconds]);
  return null;
}
