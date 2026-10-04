"use client";

import { useActionState } from "react";
import {
  disablePortfolioShareLinksAction,
  type WorkspaceCollaborationActionState,
} from "@/lib/actions/workspace-collaboration";
import { Button } from "@/components/ui/button";

const INITIAL: WorkspaceCollaborationActionState = { ok: true };

/** Disattiva in un colpo i link pubblici al portfolio già mandati su Slack o via webhook. */
export function DisableShareLinksButton({ workspaceId }: { workspaceId: string }) {
  const [state, action, pending] = useActionState(disablePortfolioShareLinksAction.bind(null, workspaceId), INITIAL);
  return (
    <form
      action={action}
      className="space-y-2"
      onSubmit={(event) => {
        if (!window.confirm("Disattivare tutti i link pubblici al portfolio già condivisi? Chi ha un account con accesso continuerà a entrare dal login.")) {
          event.preventDefault();
        }
      }}
    >
      <Button type="submit" variant="outline" className="h-10 sm:h-8" disabled={pending} data-testid="disable-share-links">
        {pending ? "Disattivo…" : "Disattiva i link già condivisi"}
      </Button>
      {state.message && (
        <p role={state.ok ? "status" : "alert"} className={`text-xs ${state.ok ? "text-emerald-300" : "text-red-300"}`}>
          {state.message}
        </p>
      )}
    </form>
  );
}
