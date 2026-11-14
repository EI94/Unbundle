"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUcAction } from "@/components/uc/catalog/use-uc-action";
import { addWorkspaceTeamMemberAction, removeWorkspaceTeamMemberAction } from "@/lib/actions/use-case-workspace-team";

const ROLES = [
  { value: "ls_sviluppatore", label: "Sviluppatore" },
  { value: "ls_analista", label: "Analista" },
  { value: "ls_lead", label: "Responsabile" },
] as const;

/** (8.1b) Aggiunge una persona di Lateral Space a tutti i casi del cliente, con un ruolo. */
export function AddWorkspaceTeamMember({ workspaceId }: { workspaceId: string }) {
  const { pending, run } = useUcAction();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof ROLES)[number]["value"]>("ls_sviluppatore");
  return (
    <form
      className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => addWorkspaceTeamMemberAction(workspaceId, { email, role }), { onSuccess: () => setEmail("") });
      }}
    >
      <div className="min-w-0 flex-1">
        <Label htmlFor="team-email" className="text-xs">
          E-mail di Lateral Space
        </Label>
        <Input id="team-email" type="email" required autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@lateralspace.ai" className="mt-1 h-11 text-base sm:h-9 sm:text-sm" />
      </div>
      <div>
        <Label htmlFor="team-role" className="text-xs">
          Ruolo nei casi
        </Label>
        <select
          id="team-role"
          value={role}
          onChange={(e) => setRole(e.target.value as (typeof ROLES)[number]["value"])}
          className="mt-1 block h-11 w-full rounded-md border bg-background px-3 text-base sm:h-9 sm:w-44 sm:text-sm"
        >
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" className="min-h-11 sm:min-h-9" disabled={pending || !email.trim()}>
        Aggiungi a tutti i casi
      </Button>
    </form>
  );
}

/** (8.1b) Toglie una persona dal team del cliente e dai casi aperti dove ha quel ruolo. */
export function RemoveWorkspaceTeamMember({ workspaceId, userId, name }: { workspaceId: string; userId: string; name: string }) {
  const { pending, run } = useUcAction();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="min-h-11 shrink-0 sm:min-h-8"
      disabled={pending}
      aria-label={`Togli ${name} dal team del cliente`}
      onClick={() => run(() => removeWorkspaceTeamMemberAction(workspaceId, userId))}
    >
      Togli
    </Button>
  );
}
