"use client";

import { useState } from "react";
import type { AdminCapability, AdminDetailDTO } from "@/lib/learning/admin-contract";
import type { AdminMutate } from "./admin-program";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { AdminSection, AdminSelect, AdminUnsavedNotice, ConfirmAdminAction, capabilityLabels, adminDate, cohortLabel } from "./admin-shared";

import { useLearningUnsavedChanges } from "./use-unsaved-changes";

export function AdminGrants({ workspaceId, data, busy, mutate }: {
  workspaceId: string; data: AdminDetailDTO; busy: boolean; mutate: AdminMutate;
}) {
  const [capability, setCapability] = useState<AdminCapability>("aggregate");
  const [confirmed, setConfirmed] = useState(false);
  const defaultCohort = data.program.canManageAll ? "" : data.sessions.find(session => session.moduleId === "m1")?.cohortId ?? "";
  const [userId, setUserId] = useState("");
  const [cohortId, setCohortId] = useState(defaultCohort);
  const dirty = !!userId || capability !== "aggregate" || cohortId !== defaultCohort || confirmed;
  function reset() { setUserId(""); setCapability("aggregate"); setCohortId(defaultCohort); setConfirmed(false); }
  const { confirmDiscard } = useLearningUnsavedChanges({ dirty, onDiscard: reset });
  const scope = { workspaceId, programId: data.program.id };
  // (Rilascio 10, ondata 7a) Le lezioni con la loro data, mai con il codice del turno.
  const lessonOf = (cohortId: string | null) => cohortId ? cohortLabel(data.sessions, cohortId) : "Tutte le lezioni";
  return <div className="space-y-6">
    <AdminSection title="Autorizza una persona">
      <p className="text-sm">I permessi sono separati: gestire il corso non fa leggere né scaricare i risultati con i nomi. Dai ogni accesso alla persona e alle lezioni concordate.</p>
      <form onSubmit={async event => {
        event.preventDefault(); if (!confirmed) return;
        if (await mutate({ operation: "grant", input: { ...scope, userId, capability, cohortId: cohortId || null } })) reset();
      }}><fieldset disabled={busy} className="space-y-4">
        <div className="space-y-2"><Label htmlFor="grant-user">Persona da autorizzare</Label><AdminSelect id="grant-user" name="userId" value={userId} required onChange={event => { setUserId(event.target.value); setConfirmed(false); }}><option value="" disabled>Scegli un membro del workspace</option>{data.members.map(member => <option value={member.id} key={member.id}>{member.name || member.email} · {member.email}</option>)}</AdminSelect></div>
        <div className="space-y-2"><Label htmlFor="grant-capability">Permesso</Label><AdminSelect id="grant-capability" value={capability} onChange={event => { setCapability(event.target.value as AdminCapability); setConfirmed(false); }}>{Object.entries(capabilityLabels).filter(([key]) => data.program.canManageAll || key !== "manage").map(([key, label]) => <option value={key} key={key}>{label}</option>)}</AdminSelect></div>
        <div className="space-y-2"><Label htmlFor="grant-cohort">Lezioni</Label><AdminSelect id="grant-cohort" name="cohortId" value={cohortId} onChange={event => { setCohortId(event.target.value); setConfirmed(false); }}>{data.program.canManageAll && <option value="">Tutte le lezioni del corso</option>}{data.sessions.filter(session => session.moduleId === "m1").map(session => <option key={session.id} value={session.cohortId}>{adminDate(session.startsAt)}</option>)}</AdminSelect></div>
        <label className="flex items-start gap-3 text-sm"><input className="mt-1 size-4" type="checkbox" required checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>Confermo che questa persona è autorizzata a {capabilityLabels[capability].toLowerCase()} per le lezioni scelte.</span></label>
        <AdminUnsavedNotice dirty={dirty} onDiscard={confirmDiscard} />
        <Button type="submit" variant="outline" className="min-h-11 sm:min-h-9" disabled={!confirmed}>Concedi permesso</Button>
      </fieldset></form>
    </AdminSection>
    <AdminSection title="Permessi del corso">
      <p className="text-sm text-muted-foreground">La revoca interrompe l’accesso per quel permesso. Deve restare almeno una persona che gestisce tutto il corso.</p>
      {data.grants.length === 0 && <p>Nessun permesso.</p>}
      <ul className="space-y-3">{data.grants.map(grant => <li key={grant.id} className="space-y-3 rounded-lg border p-4">
        <div><h3 className="font-medium">{grant.name || grant.email}</h3><p className="break-words text-sm text-muted-foreground">{grant.email}</p><p className="mt-2 text-sm">{capabilityLabels[grant.capability]} · {lessonOf(grant.cohortId)}</p><p className="text-sm text-muted-foreground">{grant.revokedAt ? `Revocato il ${adminDate(grant.revokedAt)}` : `Attivo dal ${adminDate(grant.grantedAt)}`}</p></div>
        {!grant.revokedAt && (data.program.canManageAll || (grant.capability !== "manage" && grant.cohortId !== null)) && <ConfirmAdminAction busy={busy} label="Revoca permesso" description={`Revocare a ${grant.name || grant.email} il permesso “${capabilityLabels[grant.capability]}” per ${lessonOf(grant.cohortId).toLowerCase()}?`} onConfirm={() => mutate({ operation: "revokeGrant", input: { ...scope, grantId: grant.id } })} />}
      </li>)}</ul>
    </AdminSection>
  </div>;
}
