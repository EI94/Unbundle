"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { DOOR_CHECK_PROBE, doorCheckAfter, doorCheckDelayMs, doorCheckRuns } from "./door-check";

/**
 * (Rilascio 10, ondata 4, PROPOSTA-10 §3.11) Con l'ingresso chiuso la pagina controlla da sola se la lezione si è aperta:
 * ogni 10 secondi, appena si torna sulla scheda (dalla chat) e appena torna la rete. Rilegge la pagina dal server
 * (`router.refresh`) solo se la rete arriva al sito: senza rete, o con il sito che non risponde, aspetta di più (il ritmo
 * sta in `./door-check.ts`), così il browser non finisce sulla sua pagina «offline». Con la scheda nascosta non chiede
 * niente.
 */
export function DoorWatch() {
  const router = useRouter();
  useEffect(() => {
    let failures = 0;
    let stopped = false;
    let running = false;
    let timer: number | undefined;

    const schedule = () => {
      window.clearTimeout(timer);
      if (!stopped) timer = window.setTimeout(() => void check(), doorCheckDelayMs(failures));
    };

    /** La rete arriva al sito? Un file piccolo, mai dalla cache. */
    const reachable = async () => {
      try {
        const res = await fetch(DOOR_CHECK_PROBE, { method: "HEAD", cache: "no-store" });
        return res.ok;
      } catch {
        return false;
      }
    };

    const check = async () => {
      if (stopped || running) return;
      if (!doorCheckRuns({ online: navigator.onLine, visible: document.visibilityState === "visible" })) {
        schedule();
        return;
      }
      running = true;
      const next = doorCheckAfter(failures, await reachable());
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
  }, [router]);
  return null;
}
