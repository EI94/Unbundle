"use client";

import { useActionState } from "react";
import {
  disablePortfolioShareLinksAction,
  type WorkspaceCollaborationActionState,
} from "@/lib/actions/workspace-collaboration";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, useSubmitConfirmation } from "@/components/ui/confirm-dialog";
import { CONFIRM_TEXT } from "@/lib/confirm-text";

const INITIAL: WorkspaceCollaborationActionState = { ok: true };
const ASK = CONFIRM_TEXT.shareLinks;

/** Disattiva in un colpo i link pubblici al portfolio già mandati su Slack o via webhook. Chiede prima, nella finestra dell'app. */
export function DisableShareLinksButton({ workspaceId }: { workspaceId: string }) {
  const [state, action, pending] = useActionState(disablePortfolioShareLinksAction.bind(null, workspaceId), INITIAL);
  const confirmation = useSubmitConfirmation();
  return (
    <>
      <form
        action={action}
        className="space-y-2"
        onSubmit={(event) => {
          confirmation.ask(event, true);
        }}
      >
        <Button type="submit" variant="outline" className="h-11 sm:h-8" disabled={pending} data-testid="disable-share-links">
          {pending ? "Disattivo…" : "Disattiva i link già condivisi"}
        </Button>
        {state.message && (
          <p role={state.ok ? "status" : "alert"} className={`text-xs ${state.ok ? "text-emerald-300" : "text-red-300"}`}>
            {state.message}
          </p>
        )}
      </form>
      <ConfirmDialog
        open={confirmation.open}
        onOpenChange={confirmation.onOpenChange}
        title={ASK.title}
        description={ASK.body}
        confirmLabel={ASK.confirm}
        destructive
        onConfirm={confirmation.confirm}
      />
    </>
  );
}
