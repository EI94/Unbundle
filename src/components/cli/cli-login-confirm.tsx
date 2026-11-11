"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { confirmCliLoginAction, denyCliLoginAction, type CliLoginDecision } from "@/lib/actions/cli-login";

/** La scelta del workspace e i due pulsanti della conferma del login della CLI. */
export function CliLoginConfirm({ userCode, workspaces }: { userCode: string; workspaces: { id: string; name: string; organization: string }[] }) {
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? "");
  const [result, setResult] = useState<CliLoginDecision | null>(null);
  const [pending, start] = useTransition();
  if (result?.ok) {
    return (
      <p role="status" className="text-sm">
        {result.message}
      </p>
    );
  }
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => setResult(await confirmCliLoginAction(userCode, workspaceId)));
      }}
    >
      {workspaces.length > 1 ? (
        <div className="space-y-1.5">
          <Label htmlFor="cli-workspace">Per quale workspace</Label>
          <select
            id="cli-workspace"
            value={workspaceId}
            onChange={(e) => setWorkspaceId(e.target.value)}
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-base sm:h-9 sm:text-sm"
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
                {w.organization && w.organization !== w.name ? ` · ${w.organization}` : ""}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Workspace: {workspaces[0]?.name}</p>
      )}
      {result && !result.ok ? (
        <p role="alert" className="text-sm text-destructive">
          {result.message}
        </p>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        <Button type="submit" className="h-11 sm:h-9" disabled={pending || !workspaceId}>
          Collega questa CLI
        </Button>
        <Button type="button" variant="outline" className="h-11 sm:h-9" disabled={pending} onClick={() => start(async () => setResult(await denyCliLoginAction(userCode)))}>
          {"Non l'ho chiesto io"}
        </Button>
      </div>
    </form>
  );
}
