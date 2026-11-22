"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { settingsAnchorTarget, type SettingsTab } from "./settings-view";

/**
 * Le ancore di prima delle Impostazioni (rilascio 10, ondata 6b, §2.4): all'arrivo, e quando l'ancora cambia, una
 * ancora che sta in un'altra scheda porta a quella scheda, con l'ancora; `#granola-regole` porta alle regole delle call
 * in Contesto › Fonti. `#cli` e `#granola` le apre il foglio «Il tuo account», da sé. L'indirizzo si sostituisce (il
 * vecchio non resta nella cronologia) e la pagina va all'ancora, nella sua scheda.
 */
export function SettingsAnchor({ workspaceId, current, visible }: { workspaceId: string; current: SettingsTab; visible: readonly SettingsTab[] }) {
  const router = useRouter();
  const key = visible.join("|");
  useEffect(() => {
    const tabs = key.split("|") as SettingsTab[];
    const go = () => {
      const target = settingsAnchorTarget({ hash: window.location.hash, current, visible: tabs, workspaceId });
      if (target) router.replace(target);
    };
    go();
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, [current, key, router, workspaceId]);
  return null;
}
