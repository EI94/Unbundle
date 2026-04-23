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
            ? "Canale notifiche salvato. Assicurati che il bot sia membro del canale."
            : "Notifiche canale disattivate."
        );
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Errore");
      }
    });
  };

  return (
    <div className="mt-4 space-y-3 rounded-lg border border-border bg-background/50 p-4">
      <div>
        <Label htmlFor="slack-notify-channel" className="text-sm font-medium">
          Canale per notifiche admin
        </Label>
        <p className="mt-1 text-xs text-muted-foreground">
          Incolla l&apos;ID del canale Slack (inizia con <span className="font-mono">C</span> o{" "}
          <span className="font-mono">G</span>). In Slack: nome canale → tre puntini →{" "}
          <em>Informazioni sul canale</em> → in basso compare l&apos;ID, oppure dal link del
          canale (la parte dopo l&apos;ultimo <span className="font-mono">/</span> che inizia con
          C…). Invita il bot nel canale con <span className="font-mono">/invite @Unbundle</span>{" "}
          (o il nome della tua app).
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <Input
          id="slack-notify-channel"
          className="font-mono text-sm sm:max-w-md"
          placeholder="C01234567890"
          value={value}
          disabled={pending}
          onChange={(e) => setValue(e.target.value)}
        />
        <Button type="button" size="sm" disabled={pending} onClick={save}>
          {pending ? "Salvataggio…" : "Salva"}
        </Button>
      </div>
    </div>
  );
}
