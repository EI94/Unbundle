"use client";

import { useState, useTransition } from "react";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { toggleEsgAction } from "@/lib/actions/use-cases";

export function EsgToggle({
  workspaceId,
  initialEnabled,
  canManage,
  showLabel = false,
}: {
  workspaceId: string;
  initialEnabled: boolean;
  /** Fuori dalle Impostazioni l'interruttore non ha un titolo accanto: lo porta con sé. */
  showLabel?: boolean;
  /** Solo chi amministra il workspace cambia i criteri: per gli altri il valore è in sola lettura. */
  canManage: boolean;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [isPending, startTransition] = useTransition();

  const handleToggle = (checked: boolean) => {
    const confirmed = window.confirm(
      checked
        ? "Attivare i criteri ESG? Vale per tutto il team: i prossimi use case saranno valutati anche su ambiente, impatto sociale e governance."
        : "Disattivare i criteri ESG? Vale per tutto il team: i nuovi use case non saranno più valutati su questi criteri."
    );
    if (!confirmed) return;
    setEnabled(checked);
    startTransition(async () => {
      try {
        await toggleEsgAction(workspaceId, checked);
        toast.success(checked ? "Criteri ESG attivati per i prossimi use case" : "Criteri ESG disattivati");
      } catch {
        setEnabled(!checked);
        toast.error("Modifica non salvata. Riprova.");
      }
    });
  };

  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-muted-foreground" aria-hidden>
        {showLabel ? `Criteri ESG ${enabled ? "attivi" : "spenti"}` : enabled ? "Attivi" : "Spenti"}
      </span>
      <Switch
        id="esg-toggle"
        aria-label="Criteri ESG nella valutazione degli use case"
        checked={enabled}
        onCheckedChange={handleToggle}
        disabled={!canManage || isPending}
      />
    </div>
  );
}
