"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { COURSE_DOOR_CHECK_SECONDS } from "@/lib/public/course";

/**
 * (Rilascio 10, ondata 4, PROPOSTA-10 §3.11) Con l'ingresso chiuso la pagina controlla da sola ogni 10 secondi, e appena
 * si torna sulla scheda (dalla chat): appena il formatore apre la lezione compare il pulsante per entrare. Rilegge la
 * pagina dal server (`router.refresh`), senza ricaricarla; con la scheda nascosta non chiede niente.
 */
export function DoorWatch({ seconds = COURSE_DOOR_CHECK_SECONDS }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const check = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const id = window.setInterval(check, seconds * 1000);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", check);
    };
  }, [router, seconds]);
  return null;
}
