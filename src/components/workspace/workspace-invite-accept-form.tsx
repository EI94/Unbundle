"use client";

import { useActionState } from "react";
import {
  acceptWorkspaceInvitationAction,
  type WorkspaceCollaborationActionState,
} from "@/lib/actions/workspace-collaboration";
import { Button } from "@/components/ui/button";

const INITIAL_STATE: WorkspaceCollaborationActionState = { ok: true };

export function WorkspaceInviteAcceptForm({ token }: { token: string }) {
  const action = acceptWorkspaceInvitationAction.bind(null, token);
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE);

  return (
    <form action={formAction} className="space-y-3">
      {state.message ? (
        <div
          className={`rounded-lg border px-3 py-2 text-sm ${
            state.ok
              ? "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300"
              : "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300"
          }`}
          role="status"
        >
          {state.message}
        </div>
      ) : null}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Apro il workspace..." : "Accetta e apri workspace"}
      </Button>
    </form>
  );
}
