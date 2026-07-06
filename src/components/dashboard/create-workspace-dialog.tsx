"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createWorkspaceWithTeamAction,
  type CreateWorkspaceWithTeamData,
  type WorkspaceActionState,
} from "@/lib/actions/workspace";
import type { Organization } from "@/lib/db/schema";
import { Copy, Plus, Trash2, Users } from "lucide-react";

type TeamRow = {
  id: number;
  email: string;
  role: string;
};

const ROLE_OPTIONS = [
  { value: "analyst", label: "Analyst — segnala e rankizza" },
  { value: "contributor", label: "Contributor — solo raccolta" },
  { value: "function_lead", label: "Function Lead — ranking e wave" },
  {
    value: "transformation_lead",
    label: "Transformation Lead — gestione completa",
  },
] as const;

const roleLabels: Record<string, string> = {
  transformation_lead: "Transformation Lead",
  function_lead: "Function Lead",
  contributor: "Contributor",
  analyst: "Analyst",
};

const INITIAL: WorkspaceActionState & { data?: CreateWorkspaceWithTeamData } = {
  ok: true,
};

let rowIdCounter = 1;

export function CreateWorkspaceDialog({
  organizations,
  children,
}: {
  organizations: Organization[];
  children: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isNewOrg, setIsNewOrg] = useState(organizations.length === 0);
  const [teamRows, setTeamRows] = useState<TeamRow[]>([]);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [state, formAction, pending] = useActionState(
    createWorkspaceWithTeamAction,
    INITIAL
  );
  const created = state.ok ? state.data : undefined;

  useEffect(() => {
    // Workspace creato senza inviti: vai direttamente al workspace.
    if (created && created.invites.length === 0 && !created.inviteWarning) {
      router.push(`/dashboard/${created.workspaceId}`);
    }
  }, [created, router]);

  const addTeamRow = () =>
    setTeamRows((rows) => [
      ...rows,
      { id: rowIdCounter++, email: "", role: "analyst" },
    ]);
  const updateTeamRow = (id: number, patch: Partial<TeamRow>) =>
    setTeamRows((rows) =>
      rows.map((row) => (row.id === id ? { ...row, ...patch } : row))
    );
  const removeTeamRow = (id: number) =>
    setTeamRows((rows) => rows.filter((row) => row.id !== id));

  const teamInvitesJson = JSON.stringify(
    teamRows
      .filter((row) => row.email.trim().length > 0)
      .map((row) => ({ email: row.email.trim(), role: row.role }))
  );

  async function copyLink(url: string, index: number) {
    await navigator.clipboard.writeText(url);
    setCopiedIndex(index);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setCopiedIndex(null);
      // Se un workspace è stato creato, aggiorna la lista alla chiusura.
      if (created) {
        router.refresh();
      }
    }
  }

  const showInviteRecap =
    created && (created.invites.length > 0 || created.inviteWarning);

  return (
    <>
      <span onClick={() => setOpen(true)} className="cursor-pointer">
        {children}
      </span>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          {showInviteRecap ? (
            <div data-testid="workspace-created-recap">
              <DialogHeader>
                <DialogTitle>Workspace «{created.workspaceName}» creato</DialogTitle>
                <DialogDescription>
                  {created.invites.length > 0
                    ? "Copia i link e invia a ciascun collega: entreranno nel workspace con il ruolo indicato. Unbundle non invia email automaticamente."
                    : null}
                </DialogDescription>
              </DialogHeader>
              {created.inviteWarning ? (
                <p className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
                  {created.inviteWarning}
                </p>
              ) : null}
              <div className="mt-4 space-y-3">
                {created.invites.map((invite, index) => (
                  <div
                    key={invite.inviteUrl}
                    className="rounded-xl border p-3"
                    data-testid="workspace-created-invite"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium">{invite.email}</span>
                      <Badge variant="outline">
                        {roleLabels[invite.role] ?? invite.role}
                      </Badge>
                    </div>
                    <div className="mt-2 flex gap-2">
                      <Input readOnly value={invite.inviteUrl} className="text-xs" />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => copyLink(invite.inviteUrl, index)}
                      >
                        <Copy className="mr-1 h-3.5 w-3.5" />
                        {copiedIndex === index ? "Copiato" : "Copia"}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              <DialogFooter className="mt-6">
                <Button
                  type="button"
                  onClick={() => router.push(`/dashboard/${created.workspaceId}`)}
                >
                  Vai al workspace
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <form action={formAction}>
              <DialogHeader>
                <DialogTitle>Nuovo Workspace</DialogTitle>
                <DialogDescription>
                  Crea un nuovo spazio di lavoro per analizzare e trasformare
                  un&apos;area della tua organizzazione.
                </DialogDescription>
              </DialogHeader>

              <div className="mt-4 space-y-4">
                {organizations.length > 0 && !isNewOrg ? (
                  <div className="space-y-2">
                    <Label htmlFor="organizationId">Organizzazione</Label>
                    <Select name="organizationId" defaultValue={organizations[0]?.id}>
                      <SelectTrigger>
                        <SelectValue placeholder="Seleziona organizzazione" />
                      </SelectTrigger>
                      <SelectContent>
                        {organizations.map((org) => (
                          <SelectItem key={org.id} value={org.id}>
                            {org.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <button
                      type="button"
                      onClick={() => setIsNewOrg(true)}
                      className="text-xs text-primary hover:underline"
                    >
                      + Crea nuova organizzazione
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor="orgName">Nome organizzazione</Label>
                    <Input
                      id="orgName"
                      name="orgName"
                      placeholder="Es. Acme Corp"
                      required
                    />
                    {organizations.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setIsNewOrg(false)}
                        className="text-xs text-primary hover:underline"
                      >
                        Usa organizzazione esistente
                      </button>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="name">Nome workspace</Label>
                  <Input
                    id="name"
                    name="name"
                    placeholder="Es. Trasformazione Q3 2026"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Descrizione (opzionale)</Label>
                  <Textarea
                    id="description"
                    name="description"
                    placeholder="Descrivi brevemente l'obiettivo di questo workspace..."
                    rows={3}
                  />
                </div>

                <div className="space-y-2 rounded-xl border bg-muted/20 p-3">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-1.5">
                      <Users className="h-4 w-4" />
                      Invita il team (opzionale)
                    </Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={addTeamRow}
                      disabled={teamRows.length >= 10}
                      data-testid="workspace-add-team-row"
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      Aggiungi email
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Aggiungi le email dei colleghi con il loro ruolo: per ognuno
                    verrà creato un link di invito personale per accedere al
                    workspace.
                  </p>
                  {teamRows.map((row) => (
                    <div key={row.id} className="flex items-center gap-2">
                      <Input
                        type="email"
                        placeholder="collega@azienda.com"
                        value={row.email}
                        onChange={(event) =>
                          updateTeamRow(row.id, { email: event.target.value })
                        }
                        className="flex-1"
                      />
                      <select
                        value={row.role}
                        onChange={(event) =>
                          updateTeamRow(row.id, { role: event.target.value })
                        }
                        className="h-8 w-40 rounded-lg border border-input bg-background px-2 text-xs"
                        aria-label="Ruolo"
                      >
                        {ROLE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeTeamRow(row.id)}
                        aria-label="Rimuovi"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  <input type="hidden" name="teamInvites" value={teamInvitesJson} />
                </div>
              </div>

              {!state.ok && state.message ? (
                <p className="mt-3 text-sm text-destructive">{state.message}</p>
              ) : null}

              <DialogFooter className="mt-6">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                >
                  Annulla
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending ? "Creo..." : "Crea workspace"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
