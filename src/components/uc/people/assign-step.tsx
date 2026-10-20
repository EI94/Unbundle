"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useUcAction } from "@/components/uc/catalog/use-uc-action";
import { assignRoleQuestionsAction } from "@/lib/actions/uc-people";
import type { ContactOption, RoleGroup } from "@/lib/uc/views/rows";
import { ChoiceSelect, type ChoiceGroup } from "./choice-select";
import { formatCountIt } from "@/lib/uc/views/format";


/** Un referente che si può scegliere per un ruolo. */
export interface AssignContactOption {
  id: string;
  name: string;
  roleLabel: string | null;
}

/** Il ruolo dello schema con le domande senza referente (righe «Senza referente»). */
export interface AssignRole {
  roleKey: string;
  roleLabel: string;
  questions: number;
  suggestedContactIds: readonly string[];
}

/** Prima i referenti con lo stesso ruolo, poi gli altri. */
export function contactGroupsFor(suggestedIds: readonly string[], contacts: readonly AssignContactOption[]): ChoiceGroup[] {
  const label = (c: AssignContactOption) => (c.roleLabel ? `${c.name} · ${c.roleLabel}` : c.name);
  const suggested = contacts.filter((c) => suggestedIds.includes(c.id));
  const others = contacts.filter((c) => !suggestedIds.includes(c.id));
  if (suggested.length === 0) return [{ options: others.map((c) => ({ value: c.id, label: label(c) })) }];
  return [
    { label: "Con questo ruolo", options: suggested.map((c) => ({ value: c.id, label: label(c) })) },
    ...(others.length > 0 ? [{ label: "Altri referenti", options: others.map((c) => ({ value: c.id, label: label(c) })) }] : []),
  ];
}

/** La scelta proposta: l'unico referente con lo stesso ruolo, se ce n'è uno solo. */
export function suggestedChoice(role: Pick<AssignRole, "suggestedContactIds">, contacts: readonly AssignContactOption[]): string {
  const usable = role.suggestedContactIds.filter((id) => contacts.some((c) => c.id === id));
  return usable.length === 1 ? usable[0] : "";
}

/**
 * Passo 1 di «Invia le domande» (DESIGN §3.9.2): per ogni ruolo con domande
 * senza referente, chi risponde. La scelta resta al pannello, che assegna con
 * «Avanti». Sostituisce «Assegna per ruolo» del catalogo.
 */
export function AssignStep({
  roles,
  contacts,
  choices,
  onChoose,
  includeAssigned,
  onIncludeAssigned,
  addHref,
}: {
  roles: readonly AssignRole[];
  contacts: readonly AssignContactOption[];
  choices: Readonly<Record<string, string>>;
  onChoose: (roleKey: string, contactId: string) => void;
  includeAssigned: boolean;
  onIncludeAssigned: (value: boolean) => void;
  /** «+ Aggiungi un referente»: il pannello di aggiunta, poi di nuovo qui. */
  addHref: string | null;
}) {
  return (
    <div className="space-y-4">
      <ul className="divide-y divide-border rounded-xl ring-1 ring-foreground/10">
        {roles.map((r) => (
          <li key={r.roleKey} className="flex min-w-0 flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium break-words">{r.roleLabel}</p>
              <p className="text-xs text-muted-foreground tabular-nums">
                {formatCountIt(r.questions)} {r.questions === 1 ? "domanda senza referente" : "domande senza referente"}
              </p>
            </div>
            <ChoiceSelect
              className="sm:w-64"
              ariaLabel={`Chi risponde per ${r.roleLabel}`}
              value={choices[r.roleKey] ?? ""}
              onChange={(v) => onChoose(r.roleKey, v)}
              placeholder="Scegli"
              groups={contactGroupsFor(r.suggestedContactIds, contacts)}
            />
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label htmlFor="uc-assign-overwrite" className="flex min-h-11 items-center gap-2 text-sm sm:min-h-8">
          <Switch id="uc-assign-overwrite" checked={includeAssigned} onCheckedChange={(v) => onIncludeAssigned(v)} />
          Riassegna anche quelle già assegnate
        </label>
        {addHref && (
          <Button variant="ghost" className="min-h-11 sm:min-h-8" render={<Link href={addHref} scroll={false} />} nativeButton={false}>
            <Plus aria-hidden />
            Aggiungi un referente
          </Button>
        )}
      </div>
    </div>
  );
}

function RoleRow({ workspaceId, caseId, group, contacts }: { workspaceId: string; caseId: string; group: RoleGroup; contacts: ContactOption[] }) {
  const options = contacts.filter((c) => c.assignable).map((c) => ({ id: c.id, name: c.name, roleLabel: c.roleLabel }));
  const [contactId, setContactId] = useState(suggestedChoice({ suggestedContactIds: group.suggestedContactIds }, options));
  const [includeAssigned, setIncludeAssigned] = useState(false);
  const { pending, run } = useUcAction();
  const target = includeAssigned ? group.itemCount : group.unassignedCount;
  return (
    <li className="flex min-w-0 flex-col gap-2 py-3 lg:flex-row lg:items-center">
      <div className="min-w-0 flex-1">
        <p className="font-medium break-words">{group.roleLabel}</p>
        <p className="text-xs text-muted-foreground">
          {formatCountIt(group.itemCount)} domande aperte · {formatCountIt(group.unassignedCount)} senza referente
        </p>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <ChoiceSelect
          className="sm:w-60"
          ariaLabel={`Referente per ${group.roleLabel}`}
          value={contactId}
          onChange={setContactId}
          placeholder="Scegli il referente"
          groups={contactGroupsFor(group.suggestedContactIds, options)}
        />
        <label className="flex min-h-11 items-center gap-2 text-xs text-muted-foreground md:min-h-0">
          <Switch size="sm" checked={includeAssigned} onCheckedChange={(v) => setIncludeAssigned(v)} />
          Anche quelle già assegnate
        </label>
        <Button
          size="sm"
          variant="outline"
          disabled={!contactId || target === 0 || pending}
          onClick={() => run(() => assignRoleQuestionsAction(workspaceId, caseId, { roleKey: group.roleKey, contactId, includeAssigned }))}
        >
          Assegna {formatCountIt(target)}
        </Button>
      </div>
    </li>
  );
}

/**
 * «Assegna per ruolo» com'era nel catalogo: resta per chi lo monta ancora
 * (Domande), finché il pannello «Invia le domande» di Persone non lo
 * sostituisce del tutto. Le domande di un ruolo si scelgono sul server.
 */
export function RoleAssign({ workspaceId, caseId, groups, contacts }: { workspaceId: string; caseId: string; groups: RoleGroup[]; contacts: ContactOption[] }) {
  if (groups.length === 0) return null;
  return (
    <Card size="sm" className="mb-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="size-4" aria-hidden />
          Assegna per ruolo
        </CardTitle>
        <CardDescription>Le domande aperte di ogni ruolo vanno al referente che scegli. Poi le invii da Persone.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {groups.map((g) => (
            <RoleRow key={g.roleKey} workspaceId={workspaceId} caseId={caseId} group={g} contacts={contacts} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
