"use client";

import { useMemo, useState } from "react";
import { ChevronRight, MoreHorizontal, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { useUcAction } from "@/components/uc/catalog/use-uc-action";
import { addMemberAction, removeMemberAction } from "@/lib/actions/uc-cases";
import {
  CASE_ROLE_HINT,
  CASE_ROLE_LABEL,
  MEMBER_BUILDS_CLIENT_ROLE_TEXT,
  MEMBER_BUILDS_LABEL,
  PEOPLE_ROWS_SHOWN,
  PEOPLE_TEXT,
  PERSONAL_ZONE_MEMBER_LABEL,
  removeRoleConfirmText,
  roleChoicesFor,
  shownRows,
  sideLabel,
  type MemberView,
} from "@/lib/uc/views/people";
import type { CaseRole } from "@/lib/uc/vocab";
import { cn } from "@/lib/utils";
import { ChoiceSelect } from "./choice-select";

export interface MemberCandidateOption {
  userId: string;
  name: string;
  isLateralSpace: boolean;
}

/**
 * «Nella realizzazione» (rilascio 10, §3.5; prima «Accesso al caso» in Impostazioni del caso, DESIGN §3.13.3): le
 * persone con un account, i loro ruoli nella realizzazione e il lato (Lateral Space o cliente, dal dominio dell'email
 * verificata); al massimo tre righe, poi «Vedi tutti (N)». Il responsabile Lateral Space aggiunge una persona con un
 * ruolo («Aggiungi una persona», in un dialogo) e toglie un ruolo dal «⋯» della riga, con conferma. I ruoli di Lateral
 * Space vanno solo a Lateral Space, quelli del cliente solo al cliente. (8.0c) Chi costruisce il caso da fuori Lateral
 * Space (una concessione di «Chi costruisce» che lo copre) è «Osservatore · costruisce»: la riga serve, ma da sola non
 * dà poteri; toglierla lo ferma in questo caso. Chi perde il ruolo con cui costruiva il caso lascia i suoi compiti lì:
 * la conferma lo dice (`removeRoleConfirmText`). La gestione di chi costruisce resta nell'Agent Factory.
 */
export function MembersPanel({
  workspaceId,
  caseId,
  members,
  candidates,
  canManage,
  builderIds = [],
}: {
  workspaceId: string;
  caseId: string;
  members: readonly MemberView[];
  candidates: readonly MemberCandidateOption[];
  canManage: boolean;
  /** (8.0c) Chi ha una concessione di «Chi costruisce» che copre il caso. */
  builderIds?: readonly string[];
}) {
  const { pending, run } = useUcAction();
  const [adding, setAdding] = useState(false);
  const [all, setAll] = useState(false);
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<CaseRole | "">("");
  const [removing, setRemoving] = useState<{ member: MemberView; role: CaseRole } | null>(null);
  const candidate = candidates.find((c) => c.userId === userId) ?? null;
  const held = useMemo(() => new Set(members.find((m) => m.userId === userId)?.roles ?? []), [members, userId]);
  // (8.0c) Chi costruisce il caso da fuori: i ruoli del cliente si vedono spenti, con il perché sotto.
  const buildsHere = candidate !== null && builderIds.includes(candidate.userId.toLowerCase());
  const roleChoices = candidate ? roleChoicesFor(candidate.isLateralSpace, held, buildsHere) : [];
  const roleOptions = roleChoices.filter((c) => !c.disabled).map((c) => c.role);
  const sorted = [...candidates].sort((a, b) => a.name.localeCompare(b.name, "it"));
  const builds = (member: MemberView, role: CaseRole) => role === "osservatore" && builderIds.includes(member.userId.toLowerCase());
  const roleText = (member: MemberView, role: CaseRole) => (builds(member, role) ? MEMBER_BUILDS_LABEL : CASE_ROLE_LABEL[role]);

  function closeAdd() {
    setAdding(false);
    setUserId("");
    setRole("");
  }

  return (
    <div className="space-y-3">
      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground">{PEOPLE_TEXT.noMembers}</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl bg-card ring-1 ring-foreground/10" aria-label={PEOPLE_TEXT.caseGroup}>
          {shownRows(members, all).map((m) => (
            <li key={m.userId} className="flex min-w-0 items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="min-w-0 text-sm font-medium break-words">{m.name}</span>
                  <span className="text-xs text-muted-foreground">{sideLabel(m.isLateralSpace)}</span>
                </div>
                {m.email && <p className="text-xs break-all text-muted-foreground">{m.email}</p>}
                <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label={`Ruoli di ${m.name}`}>
                  {m.roles.map((r) => (
                    <li key={r} className="inline-flex h-6 items-center rounded-full px-2 text-xs ring-1 ring-foreground/15">
                      {roleText(m, r)}
                    </li>
                  ))}
                </ul>
                {m.personalZone !== "no" && <p className="mt-1 text-xs text-muted-foreground">{PERSONAL_ZONE_MEMBER_LABEL[m.personalZone]}</p>}
              </div>
              {canManage && (
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={PEOPLE_TEXT.memberMenu(m.name)} className="size-11 shrink-0 sm:size-7" />}>
                    <MoreHorizontal aria-hidden />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-auto min-w-52 max-w-[min(20rem,calc(100vw-2rem))]">
                    {m.roles.map((r) => (
                      <DropdownMenuItem key={r} variant="destructive" className="min-h-11 sm:min-h-8" disabled={pending} onClick={() => setRemoving({ member: m, role: r })}>
                        {PEOPLE_TEXT.removeRole(roleText(m, r))}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </li>
          ))}
        </ul>
      )}
      {members.length > PEOPLE_ROWS_SHOWN && (
        <button
          type="button"
          aria-expanded={all}
          onClick={() => setAll(!all)}
          className="inline-flex min-h-11 items-center gap-0.5 rounded-md text-sm text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:min-h-8"
        >
          {all ? PEOPLE_TEXT.showFewer : PEOPLE_TEXT.showAll(members.length)}
          <ChevronRight className={cn("size-3.5 transition-transform", all && "-rotate-90")} aria-hidden />
        </button>
      )}

      {canManage && (
        <Button type="button" variant="outline" className="min-h-11 sm:min-h-8" onClick={() => setAdding(true)}>
          <UserPlus aria-hidden />
          {PEOPLE_TEXT.addMember}
        </Button>
      )}

      <Dialog open={adding} onOpenChange={(o) => !o && closeAdd()}>
        {adding && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{PEOPLE_TEXT.addMemberTitle}</DialogTitle>
              <DialogDescription>{PEOPLE_TEXT.addMemberBody}</DialogDescription>
            </DialogHeader>
            <form
              id="uc-member-form"
              className="grid min-w-0 gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (!userId || !role) return;
                run(() => addMemberAction(workspaceId, caseId, { userId, role }), { success: "Ruolo aggiunto.", onSuccess: closeAdd });
              }}
            >
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="uc-member-user">{PEOPLE_TEXT.memberWho}</Label>
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
                <Label htmlFor="uc-member-role">{PEOPLE_TEXT.memberRole}</Label>
                <ChoiceSelect
                  id="uc-member-role"
                  value={role}
                  placeholder="Scegli"
                  disabled={!candidate}
                  onChange={(v) => setRole((roleOptions as string[]).includes(v) ? (v as CaseRole) : "")}
                  groups={[{ options: roleChoices.map((c) => ({ value: c.role, label: CASE_ROLE_LABEL[c.role], disabled: c.disabled })) }]}
                />
              </div>
              {role && <p className="text-xs text-muted-foreground">{CASE_ROLE_HINT[role]}</p>}
              {roleChoices.some((c) => c.disabled) && <p className="text-xs text-muted-foreground">{MEMBER_BUILDS_CLIENT_ROLE_TEXT}</p>}
            </form>
            <DialogFooter>
              <Button type="button" variant="outline" className="h-11 sm:h-8" onClick={closeAdd}>
                Annulla
              </Button>
              <Button type="submit" form="uc-member-form" className="h-11 sm:h-8" disabled={!userId || !role || pending}>
                Aggiungi
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={removing !== null} onOpenChange={(o) => !o && setRemoving(null)}>
        {removing && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Togliere il ruolo «{CASE_ROLE_LABEL[removing.role]}» a {removing.member.name}?</DialogTitle>
              <DialogDescription>
                {removeRoleConfirmText(removing.member.roles, removing.role, builds(removing.member, removing.role))}
              </DialogDescription>
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
