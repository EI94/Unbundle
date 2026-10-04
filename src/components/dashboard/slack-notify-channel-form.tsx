"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { setSlackNotifyChannelAction } from "@/lib/actions/slack-settings";

export function SlackNotifyChannelForm({
  workspaceId,
  initialChannelId,
}: {
  workspaceId: string;
  initialChannelId: string | null;
}) {
  const [value, setValue] = useState(initialChannelId ?? "");
  const [pending, startTransition] = useTransition();

  const save = () => {
    startTransition(async () => {
      try {
        await setSlackNotifyChannelAction(workspaceId, value);
        toast.success(
          value.trim()
            ? "Canale salvato. Ricordati di aggiungere il bot al canale."
            : "Notifiche nel canale disattivate."
        );
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Salvataggio non riuscito. Riprova.");
      }
    });
  };

  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor="slack-notify-channel" className="text-sm font-medium">
          Canale per le notifiche agli amministratori
        </Label>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Incolla l&apos;ID del canale (es. <span className="font-mono">C01234567890</span>): in Slack apri il
          canale, tocca il suo nome e lo trovi in fondo alla scheda «Informazioni». Poi aggiungi il bot al canale
          scrivendo <span className="font-mono">/invite @Unbundle</span>. Lascia vuoto per non ricevere notifiche.
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          id="slack-notify-channel"
          className="h-10 font-mono text-base sm:h-8 sm:max-w-xs sm:text-sm"
          placeholder="C01234567890"
          value={value}
          disabled={pending}
          onChange={(e) => setValue(e.target.value)}
        />
        <Button type="button" className="h-10 sm:h-8" disabled={pending} onClick={save}>
          {pending ? "Salvataggio…" : "Salva"}
        </Button>
      </div>
    </div>
  );
}
