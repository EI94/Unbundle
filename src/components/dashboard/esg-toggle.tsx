"use client";

import { useState, useTransition } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Leaf } from "lucide-react";
import { toast } from "sonner";
import { toggleEsgAction } from "@/lib/actions/use-cases";

export function EsgToggle({
  workspaceId,
  initialEnabled,
}: {
  workspaceId: string;
  initialEnabled: boolean;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [isPending, startTransition] = useTransition();

  const handleToggle = (checked: boolean) => {
    const confirmed = window.confirm(
      checked
        ? "Attivare lo scoring ESG? La modifica vale per tutto il team: i prossimi use case includeranno la dimensione ESG nella valutazione."
        : "Disattivare lo scoring ESG? La modifica vale per tutto il team: la dimensione ESG non sarà più inclusa nella valutazione dei nuovi use case."
    );
    if (!confirmed) return;
    setEnabled(checked);
    startTransition(async () => {
      try {
        await toggleEsgAction(workspaceId, checked);
        toast.success(
          checked
            ? "Scoring ESG attivato per i prossimi use case"
            : "Scoring ESG disattivato"
        );
      } catch {
        setEnabled(!checked);
        toast.error("Errore nell'aggiornamento");
      }
    });
  };

  return (
    <div className="flex items-center gap-2">
      <Leaf className="h-4 w-4 text-green-400" />
      <Label
        htmlFor="esg-toggle"
        className="text-sm text-muted-foreground cursor-pointer"
      >
        ESG
      </Label>
      <Switch
        id="esg-toggle"
        checked={enabled}
        onCheckedChange={handleToggle}
        disabled={isPending}
      />
    </div>
  );
}
