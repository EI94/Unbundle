"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { readinessAnchorTarget, type ReadinessTab } from "@/lib/ai-readiness/dashboard-view";

/**
 * Le ancore della dashboard AI Readiness (rilascio 10, ondata 7b): all'arrivo, e quando l'ancora cambia, un'ancora di
 * un'altra scheda porta a quella scheda. Quelle di prima restano: `#respondents` («Invita una persona», la raccolta) apre
 * «Raccolta» su «Persone», `#intelligence` apre «Insight». L'indirizzo si sostituisce: il vecchio non resta nella
 * cronologia.
 */
export function ReadinessAnchor({ workspaceId, assessmentId, current, visible }: { workspaceId: string; assessmentId: string | null; current: ReadinessTab; visible: readonly ReadinessTab[] }) {
  const router = useRouter();
  const key = visible.join("|");
  useEffect(() => {
    const tabs = key.split("|") as ReadinessTab[];
    const go = () => {
      const target = readinessAnchorTarget({ hash: window.location.hash, current, visible: tabs, workspaceId, assessmentId });
      if (target) router.replace(target);
    };
    go();
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, [assessmentId, current, key, router, workspaceId]);
  return null;
}
