"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { PUBLIC_LABEL, PUBLIC_PRIMARY, PUBLIC_SECONDARY } from "@/components/public/classes";
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
 * - (Rilascio 10, ondata 4) Nel guscio delle pagine pubbliche: «Collega questa CLI», il pulsante principale, pieno, a
 *   tutta larghezza e alto 48 px; «Non l'ho chiesto io» bordato sotto, alla stessa misura; il campo a 44 px e 16 px.
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
    <Button type="button" variant="outline" className={PUBLIC_SECONDARY} disabled={!ready || pending} onClick={() => start(async () => setResult(await denyCliLoginAction(userCode)))}>
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
        <div className="space-y-2">{deny}</div>
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
          <Label htmlFor="cli-workspace" className={PUBLIC_LABEL}>
            Per quale workspace
          </Label>
          <select
            id="cli-workspace"
            name="workspaceId"
            defaultValue={workspaces[0].id}
            className="h-11 w-full rounded-lg border border-input bg-background px-3 text-base"
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
      <div className="space-y-2">
        <Button type="submit" className={PUBLIC_PRIMARY} disabled={!ready || pending}>
          Collega questa CLI
        </Button>
        {deny}
      </div>
    </form>
  );
}
