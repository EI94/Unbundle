"use client";

import { useActionState } from "react";
import { revokeAllTeamMcpTokensAction, type RevokeAllTeamMcpTokensData, type TeamMcpActionState } from "@/lib/actions/team-mcp-tokens";
import { CONFIRM_TEXT } from "@/lib/confirm-text";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, useSubmitConfirmation } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { SETTINGS_TEXT } from "./settings-text";

const T = SETTINGS_TEXT.links.accesses;
const INITIAL: TeamMcpActionState<RevokeAllTeamMcpTokensData> = { ok: true };

/**
 * Collegamenti › «Accessi del team e delle realizzazioni» › «Accessi del team» (docs/use-case/DESIGN.md §9.4; rilascio
 * 10, ondata 6b): quanti accessi personali a Claude («Unbundle Use case») sono attivi nel workspace e «Revoca tutti»,
 * solo a chi gestisce il workspace (la pagina lo monta solo per lui, con almeno un accesso attivo; l'azione lo
 * ricontrolla). Il proprio accesso, ognuno lo crea e lo revoca in «Il tuo account › Claude e terminale». «Revoca tutti»
 * è bordato nella riga; il rosso sta solo nella finestra di conferma.
 */
export function TeamTokensRevokeAll({ workspaceId, activeCount }: { workspaceId: string; activeCount: number }) {
  const [state, action, pending] = useActionState(async () => revokeAllTeamMcpTokensAction(workspaceId), INITIAL);
  const revoking = useSubmitConfirmation();
  return (
    <div className="space-y-2" data-team-mcp-workspace>
      <p className="text-sm font-medium">{T.team}</p>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm">{T.teamLine(activeCount)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{T.teamHint}</p>
        </div>
        <form
          action={action}
          onSubmit={(event) => {
            revoking.ask(event, true);
          }}
        >
          {/* Bordato nella riga: il rosso solo nella finestra di conferma. */}
          <Button type="submit" variant="outline" className="h-11 sm:h-8" disabled={pending}>
            Revoca tutti
          </Button>
        </form>
      </div>
      <ConfirmDialog
        open={revoking.open}
        onOpenChange={revoking.onOpenChange}
        title={CONFIRM_TEXT.claude.revokeAllTitle(activeCount)}
        description={CONFIRM_TEXT.claude.revokeAllBody}
        confirmLabel={CONFIRM_TEXT.claude.revokeAll}
        destructive
        onConfirm={revoking.confirm}
      />
      {state.message ? (
        <p role="status" className={cn("text-sm", state.ok ? "text-uc-verde" : "text-destructive")} data-team-mcp-status>
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
