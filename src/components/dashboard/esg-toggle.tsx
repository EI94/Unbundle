"use client";

import { useState, useTransition } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { toggleEsgAction } from "@/lib/actions/use-cases";
import { CONFIRM_TEXT } from "@/lib/confirm-text";

const ASK = CONFIRM_TEXT.esg;

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
  // Il nuovo stato aspetta la conferma nella finestra; l'interruttore intanto resta com'è.
  const [asking, setAsking] = useState<boolean | null>(null);

  const handleToggle = (checked: boolean) => {
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
        onCheckedChange={(checked) => setAsking(checked)}
        disabled={!canManage || isPending}
      />
      {asking !== null ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setAsking(null);
          }}
          title={asking ? ASK.onTitle : ASK.offTitle}
          description={asking ? ASK.onBody : ASK.offBody}
          confirmLabel={asking ? ASK.on : ASK.off}
          onConfirm={() => {
            setAsking(null);
            handleToggle(asking);
          }}
        />
      ) : null}
    </div>
  );
}
