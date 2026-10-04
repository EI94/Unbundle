"use client";

import { useActionState } from "react";
import {
  acceptWorkspaceInvitationAction,
  type AcceptInviteFailure,
  type WorkspaceCollaborationActionState,
} from "@/lib/actions/workspace-collaboration";
import { Button } from "@/components/ui/button";

const INITIAL_STATE: WorkspaceCollaborationActionState<{ reason: AcceptInviteFailure }> = { ok: true };

export function WorkspaceInviteAcceptForm({ token, workspaceName }: { token: string; workspaceName: string }) {
  const action = acceptWorkspaceInvitationAction.bind(null, token);
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE);

  return (
    <form action={formAction} className="space-y-3" data-testid="invite-accept-form">
      {state.message ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200" role="alert">
          {state.message}
        </div>
      ) : null}
      <Button type="submit" size="lg" className="h-11 w-full" disabled={pending}>
        {pending ? "Ti porto nel workspace…" : `Accetta ed entra in ${workspaceName}`}
      </Button>
    </form>
  );
}
