"use client";

import { useActionState, useState } from "react";
import {
  createAiReadinessRespondentInviteAction,
  type AiReadinessActionState,
  type CreateRespondentInviteData,
} from "@/lib/actions/ai-readiness";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const INITIAL: AiReadinessActionState<CreateRespondentInviteData> = {
  ok: true,
};

export function RespondentInviteForm({
  workspaceId,
  assessmentId,
}: {
  workspaceId: string;
  assessmentId: string;
}) {
  const action = createAiReadinessRespondentInviteAction.bind(
    null,
    workspaceId,
    assessmentId
  );
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  return (
    <form action={formAction} className="space-y-4 rounded-3xl border p-4">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email respondent</Label>
          <Input id="email" name="email" type="email" placeholder="persona@azienda.com" />
          {state.fieldErrors?.email && (
            <p className="text-xs text-destructive">{state.fieldErrors.email}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label>Chi e questa persona?</Label>
          <div className="grid gap-2">
            <label className="flex cursor-pointer items-start gap-2 rounded-2xl border p-3 text-sm has-checked:border-emerald-500 has-checked:bg-emerald-500/5">
              <input type="radio" name="surveyTrack" value="everyone" defaultChecked className="mt-0.5" />
              <span>
                <span className="font-medium">Survey organizzazione</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  La survey condivisa con tutti: strumenti, adoption, idee.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 rounded-2xl border p-3 text-sm has-checked:border-emerald-500 has-checked:bg-emerald-500/5">
              <input type="radio" name="surveyTrack" value="internal" className="mt-0.5" />
              <span>
                <span className="font-medium">Scheda referenti (IT / HR / business)</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Infrastruttura, dati e conoscenza, persone e processi: per chi conosce i sistemi.
                </span>
              </span>
            </label>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="organizationUnit">Area / team</Label>
          <Input id="organizationUnit" name="organizationUnit" placeholder="Marketing, Operations..." />
          {state.fieldErrors?.organizationUnit && (
            <p className="text-xs text-destructive">{state.fieldErrors.organizationUnit}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="name">Nome</Label>
          <Input id="name" name="name" placeholder="Nome" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="surname">Cognome</Label>
          <Input id="surname" name="surname" placeholder="Cognome" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="role">Ruolo</Label>
          <Input id="role" name="role" placeholder="Es. Project Manager" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="seniority">Seniority</Label>
          <Input id="seniority" name="seniority" placeholder="Es. Senior, Manager, Director" />
        </div>
      </div>
      {state.message && (
        <p className={`text-sm ${state.ok ? "text-emerald-600" : "text-destructive"}`}>
          {state.message}
        </p>
      )}
      {state.data?.inviteUrl && (
        <div className="rounded-2xl border bg-muted/30 p-3">
          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Link survey
          </div>
          <div className="mt-2 flex flex-col gap-2 md:flex-row md:items-center">
            <code className="flex-1 overflow-hidden text-ellipsis rounded-lg bg-background px-3 py-2 text-xs">
              {state.data.inviteUrl}
            </code>
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText(state.data?.inviteUrl ?? "");
                setCopiedUrl(state.data?.inviteUrl ?? null);
              }}
            >
              {copiedUrl === state.data.inviteUrl ? "Copiato" : "Copia"}
            </Button>
          </div>
        </div>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Creo invito..." : "Crea link respondent"}
      </Button>
    </form>
  );
}
