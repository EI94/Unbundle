"use client";

import { useMemo, useState } from "react";
import { UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useUcAction } from "@/components/uc/catalog/use-uc-action";
import { addMemberAction, removeMemberAction } from "@/lib/actions/uc-cases";
import { CASE_ROLE_HINT, CASE_ROLE_LABEL, PERSONAL_ZONE_MEMBER_LABEL, rolesAssignableTo, sideLabel, type MemberView } from "@/lib/uc/views/people";
import type { CaseRole } from "@/lib/uc/vocab";
import { ChoiceSelect } from "./choice-select";

export interface MemberCandidateOption {
  userId: string;
  name: string;
  isLateralSpace: boolean;
}

/**
 * «Accesso al caso» (DESIGN §3.13.3, prima in Persone): le persone con un
 * account, i loro ruoli nel dossier e il lato (Lateral Space o cliente, dal
 * dominio dell'email verificata). Il responsabile Lateral Space aggiunge e
 * toglie ruoli; i ruoli di Lateral Space vanno solo a Lateral Space, quelli del
 * cliente solo al cliente.
 */
export function MembersPanel({
  workspaceId,
  caseId,
  members,
  candidates,
  canManage,
}: {
  workspaceId: string;
  caseId: string;
  members: readonly MemberView[];
  candidates: readonly MemberCandidateOption[];
  canManage: boolean;
}) {
  const { pending, run } = useUcAction();
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<CaseRole | "">("");
  const [removing, setRemoving] = useState<{ member: MemberView; role: CaseRole } | null>(null);
  const candidate = candidates.find((c) => c.userId === userId) ?? null;
  const held = useMemo(() => new Set(members.find((m) => m.userId === userId)?.roles ?? []), [members, userId]);
  const roleOptions = candidate ? rolesAssignableTo(candidate.isLateralSpace).filter((r) => !held.has(r)) : [];
  const sorted = [...candidates].sort((a, b) => a.name.localeCompare(b.name, "it"));

  return (
    <div className="space-y-4">
      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground">Ancora nessuno.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg ring-1 ring-foreground/10">
          {members.map((m) => (
            <li key={m.userId} className="min-w-0 px-3 py-3">
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="min-w-0 text-sm font-medium break-words">{m.name}</span>
                <span className="text-xs text-muted-foreground">{sideLabel(m.isLateralSpace)}</span>
              </div>
              {m.email && <p className="text-xs break-all text-muted-foreground">{m.email}</p>}
              <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={`Ruoli di ${m.name}`}>
                {m.roles.map((r) => (
                  <li key={r} title={CASE_ROLE_HINT[r]} className="inline-flex min-h-7 items-center gap-1 rounded-full pr-1 pl-2.5 text-xs ring-1 ring-foreground/15">
                    {CASE_ROLE_LABEL[r]}
                    {canManage ? (
                      <button
                        type="button"
                        disabled={pending}
                        className="inline-flex size-6 items-center justify-center rounded-full hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                        aria-label={`Togli il ruolo ${CASE_ROLE_LABEL[r]} a ${m.name}`}
                        onClick={() => setRemoving({ member: m, role: r })}
                      >
                        <X className="size-3" aria-hidden />
                      </button>
                    ) : (
                      <span className="w-1.5" aria-hidden />
                    )}
                  </li>
                ))}
              </ul>
              {m.personalZone !== "no" && <p className="mt-1 text-xs text-muted-foreground">{PERSONAL_ZONE_MEMBER_LABEL[m.personalZone]}</p>}
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <form
          className="grid min-w-0 gap-3 @lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] @lg:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (!userId || !role) return;
            run(() => addMemberAction(workspaceId, caseId, { userId, role }), {
              success: "Ruolo aggiunto.",
              onSuccess: () => {
                setUserId("");
                setRole("");
              },
            });
          }}
        >
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="uc-member-user">Persona del workspace</Label>
            <ChoiceSelect
              id="uc-member-user"
              value={userId}
              placeholder="Scegli"
              onChange={(v) => {
                setUserId(v);
                setRole("");
              }}
              groups={[
                { label: "Lateral Space", options: sorted.filter((c) => c.isLateralSpace).map((c) => ({ value: c.userId, label: c.name })) },
                { label: "Cliente", options: sorted.filter((c) => !c.isLateralSpace).map((c) => ({ value: c.userId, label: c.name })) },
              ].filter((g) => g.options.length > 0)}
            />
          </div>
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="uc-member-role">Ruolo nel dossier</Label>
            <ChoiceSelect
              id="uc-member-role"
              value={role}
              placeholder="Scegli"
              disabled={!candidate}
              onChange={(v) => setRole((roleOptions as string[]).includes(v) ? (v as CaseRole) : "")}
              groups={[{ options: roleOptions.map((r) => ({ value: r, label: CASE_ROLE_LABEL[r] })) }]}
            />
          </div>
          <Button type="submit" className="min-h-11 sm:min-h-8" disabled={!userId || !role || pending}>
            <UserPlus aria-hidden />
            Aggiungi
          </Button>
          {role && <p className="text-xs text-muted-foreground @lg:col-span-3">{CASE_ROLE_HINT[role]}</p>}
        </form>
      )}

      <Dialog open={removing !== null} onOpenChange={(o) => !o && setRemoving(null)}>
        {removing && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Togliere il ruolo «{CASE_ROLE_LABEL[removing.role]}» a {removing.member.name}?</DialogTitle>
              <DialogDescription>Smette subito di vedere ciò che quel ruolo gli permetteva. Gli altri ruoli restano.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" className="h-11 sm:h-8" onClick={() => setRemoving(null)}>
                Annulla
              </Button>
              <Button
                variant="destructive"
                className="h-11 sm:h-8"
                disabled={pending}
                onClick={() =>
                  run(() => removeMemberAction(workspaceId, caseId, { userId: removing.member.userId, role: removing.role }), {
                    success: "Ruolo tolto.",
                    onSuccess: () => setRemoving(null),
                  })
                }
              >
                Togli il ruolo
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
