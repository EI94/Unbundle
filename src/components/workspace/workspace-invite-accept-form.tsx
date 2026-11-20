"use client";

import { useActionState } from "react";
import {
  acceptWorkspaceInvitationAction,
  type AcceptInviteFailure,
  type WorkspaceCollaborationActionState,
} from "@/lib/actions/workspace-collaboration";
import { INVITE_TEXT, fillInvite } from "@/lib/public/invite";
import { PUBLIC_PRIMARY } from "@/components/public/classes";
import { Button } from "@/components/ui/button";

const INITIAL_STATE: WorkspaceCollaborationActionState<{ reason: AcceptInviteFailure }> = { ok: true };

/**
 * «Accetta ed entra in {workspace}» dell'invito (`/invite/<token>`). (Rilascio 10, ondata 4, PROPOSTA-10 §3.11) Il pulsante
 * principale delle pagine pubbliche, pieno, a tutta larghezza e alto 48 px; l'errore in linea con i colori del tema
 * chiaro. I testi stanno in `src/lib/public/invite.ts`.
 */
export function WorkspaceInviteAcceptForm({ token, workspaceName }: { token: string; workspaceName: string }) {
  const action = acceptWorkspaceInvitationAction.bind(null, token);
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE);

  return (
    <form action={formAction} className="space-y-3" data-testid="invite-accept-form">
      {state.message ? (
        <p className="rounded-xl bg-destructive/10 px-4 py-3 text-destructive" role="alert">
          {state.message}
        </p>
      ) : null}
      <Button type="submit" className={PUBLIC_PRIMARY} disabled={pending}>
        {pending ? INVITE_TEXT.accepting : fillInvite(INVITE_TEXT.accept, { Workspace: workspaceName })}
      </Button>
    </form>
  );
}
