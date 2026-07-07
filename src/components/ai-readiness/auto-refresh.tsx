"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Aggiorna la dashboard live mentre arrivano le risposte (survey aperta). */
export function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
