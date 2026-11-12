"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { confirmCliLoginAction, denyCliLoginAction, type CliLoginDecision } from "@/lib/actions/cli-login";

const noSubscription = () => () => {};

/**
 * La scelta del workspace e i due pulsanti della conferma del login della CLI.
 *
 * - **Pulsanti spenti finché la pagina non è pronta.** Prima, un clic arrivato mentre la pagina finiva di caricarsi
 *   andava perso senza dirlo (12/11, il primo login in produzione).
 * - **Il workspace si legge dal modulo al clic**, non da uno stato: una scelta fatta prima che la pagina fosse pronta
 *   resta quella che si vede.
 * - Senza workspace resta «Non l'ho chiesto io», per annullare un codice che non si è chiesto.
 */
export function CliLoginConfirm({ userCode, workspaces }: { userCode: string; workspaces: { id: string; label: string }[] }) {
  const ready = useSyncExternalStore(noSubscription, () => true, () => false);
  const [result, setResult] = useState<CliLoginDecision | null>(null);
  const [pending, start] = useTransition();
  if (result?.ok) {
    return (
      <p role="status" className="text-sm">
        {result.message}
      </p>
    );
  }
  const deny = (
    <Button type="button" variant="outline" className="h-11 sm:h-9" disabled={!ready || pending} onClick={() => start(async () => setResult(await denyCliLoginAction(userCode)))}>
      {"Non l'ho chiesto io"}
    </Button>
  );
  const error = result && !result.ok ? (
    <p role="alert" className="text-sm text-destructive">
      {result.message}
    </p>
  ) : null;
  if (workspaces.length === 0) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">La CLI serve nei casi dove sei nel team, e non sei nel team di nessun caso: chiedi al responsabile del caso di aggiungerti.</p>
        {error}
        <div className="flex flex-col gap-2 sm:flex-row-reverse">{deny}</div>
      </div>
    );
  }
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const chosen = String(new FormData(e.currentTarget).get("workspaceId") ?? "");
        if (!chosen) {
          setResult({ ok: false, message: "Scegli il workspace." });
          return;
        }
        start(async () => setResult(await confirmCliLoginAction(userCode, chosen)));
      }}
    >
      {workspaces.length > 1 ? (
        <div className="space-y-1.5">
          <Label htmlFor="cli-workspace">Per quale workspace</Label>
          <select
            id="cli-workspace"
            name="workspaceId"
            defaultValue={workspaces[0].id}
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-base sm:h-9 sm:text-sm"
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.label}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <>
          <input type="hidden" name="workspaceId" value={workspaces[0].id} />
          <p className="text-sm text-muted-foreground">Workspace: {workspaces[0].label}</p>
        </>
      )}
      {error}
      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        <Button type="submit" className="h-11 sm:h-9" disabled={!ready || pending}>
          Collega questa CLI
        </Button>
        {deny}
      </div>
    </form>
  );
}
