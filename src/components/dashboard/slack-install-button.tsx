"use client";

import { Button } from "@/components/ui/button";
import { MessageSquare } from "lucide-react";

export function SlackInstallButton({ workspaceId }: { workspaceId: string }) {
  return (
    <Button
      variant="outline"
      className="h-10 gap-2 sm:h-8"
      onClick={() => {
        window.location.href = `/api/slack/install?workspaceId=${workspaceId}`;
      }}
    >
      <MessageSquare className="h-4 w-4" />
      Collega Slack
    </Button>
  );
}
