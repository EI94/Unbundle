"use client";

import { Button } from "@/components/ui/button";
import { MessageSquare } from "lucide-react";

export function SlackInstallButton({ workspaceId }: { workspaceId: string }) {
  return (
    <Button
      variant="outline"
      className="h-10 gap-2 sm:h-8"
      onClick={() => {
        // Una rotta API, non una pagina: risponde con il redirect all'OAuth di Slack, che il router di Next non può seguire.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- navigazione intera verso /api/slack/install
        window.location.href = `/api/slack/install?workspaceId=${workspaceId}`;
      }}
    >
      <MessageSquare className="h-4 w-4" />
      Collega Slack
    </Button>
  );
}
