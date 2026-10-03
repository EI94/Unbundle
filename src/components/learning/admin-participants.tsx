"use client";

import Link from "next/link";
import { useState } from "react";
import type { FormEvent } from "react";
import type { AdminDetailDTO } from "@/lib/learning/admin-contract";
import type { AdminMutate } from "./admin-program";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AdminSection, AdminSelect, AdminUnsavedNotice, ConfirmAdminAction, LearningLinkCopy, adminDate } from "./admin-shared";

import { useLearningUnsavedChanges } from "./use-unsaved-changes";

export function AdminParticipants({ workspaceId, data, busy, mutate }: {
  workspaceId: string; data: AdminDetailDTO; busy: boolean; mutate: AdminMutate;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [cohortId, setCohortId] = useState("");
  const sessions = data.sessions.filter(session => session.moduleId === "m1");
  const scope = { workspaceId, programId: data.program.id };
  const assigned = new Set(data.enrollments.map(enrollment => enrollment.userId));
  const candidates = data.members.filter(member => !assigned.has(member.id));
  const matching = candidates.filter(member => `${member.name ?? ""} ${member.email}`.toLocaleLowerCase("it").includes(query.toLocaleLowerCase("it")));
  const selectedAvailable = selected.filter(id => candidates.some(member => member.id === id));

  const dirty = selectedAvailable.length > 0 || !!cohortId;
  const { confirmDiscard } = useLearningUnsavedChanges({ dirty, onDiscard: () => { setSelected([]); setCohortId(""); } });

  async function assign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await mutate({ operation: "enroll", input: { ...scope, userIds: selectedAvailable, cohortId } })) { setSelected([]); setCohortId(""); }
  }

  return <div className="space-y-6">
    <AdminSection title="Assegna il percorso M1">
      <p className="text-sm">Scegli i membri e una delle repliche. Ogni persona segue un solo turno M1. Dopo l’assegnazione, quando il corso sarà reso disponibile, lo troverà entrando nel proprio workspace.</p>
      <p className="text-sm"><Link className="underline" href={`/dashboard/${workspaceId}/settings`}>Gestisci membri e inviti del workspace</Link>. Per assegnare il corso a una persona nuova, attendi che abbia accettato l’invito. Questa assegnazione non invia email.</p>
      <form onSubmit={assign}><fieldset disabled={busy} className="space-y-4">
        <div className="space-y-2"><Label htmlFor="member-search">Cerca tra i membri disponibili</Label><Input id="member-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Nome o email" /></div>
        <div className="max-h-80 space-y-1 overflow-y-auto rounded-lg border p-2">
          {matching.length === 0 && <p className="p-2 text-sm">Nessun membro da aggiungere con questa ricerca.</p>}
          {matching.map(member => <label key={member.id} className="flex cursor-pointer items-start gap-3 rounded p-3 hover:bg-muted/40">
            <input className="mt-1 size-4 shrink-0" type="checkbox" checked={selectedAvailable.includes(member.id)} disabled={!selectedAvailable.includes(member.id) && selectedAvailable.length >= 100} onChange={event => setSelected(event.target.checked ? [...selectedAvailable, member.id] : selectedAvailable.filter(id => id !== member.id))} />
            <span className="min-w-0 break-words text-sm"><span className="font-medium">{member.name || member.email}</span><span className="block text-muted-foreground">{member.email}</span></span>
          </label>)}
        </div>
        <p className="text-sm">{selectedAvailable.length} persone selezionate, anche fuori dalla ricerca corrente. Massimo 100 per assegnazione.</p>
        <div className="space-y-2"><Label htmlFor="assign-cohort">Turno M1</Label><AdminSelect id="assign-cohort" name="cohortId" value={cohortId} onChange={event => setCohortId(event.target.value)} required><option value="" disabled>Scegli la replica</option>{sessions.map(session => <option key={session.id} value={session.cohortId}>{session.cohortId} · {adminDate(session.startsAt)}</option>)}</AdminSelect></div>
        <AdminUnsavedNotice dirty={dirty} onDiscard={confirmDiscard} />
        <Button type="submit" disabled={selectedAvailable.length === 0 || sessions.length === 0}>Assegna alle persone selezionate</Button>
      </fieldset></form>
      <LearningLinkCopy path={`/dashboard/${workspaceId}/learning/${data.program.id}`} label="Link del percorso per le persone assegnate" />
    </AdminSection>
    <AdminSection title={`Partecipanti assegnati (${data.enrollments.length})`}>
      <p className="text-sm text-muted-foreground">Il turno può essere cambiato soltanto prima che la persona inizi a lavorare. Sospendere l’assegnazione conserva quanto già salvato; riattivandola la persona lo ritrova.</p>
      {data.enrollments.length === 0 && <p>Nessun partecipante assegnato.</p>}
      <ul className="space-y-3">{data.enrollments.map(enrollment => <li key={enrollment.id} className="space-y-3 rounded-lg border p-4">
        <div><h3 className="font-medium">{enrollment.name || enrollment.email}</h3><p className="break-words text-sm text-muted-foreground">{enrollment.email}</p><p className="mt-1 text-sm">{enrollment.cohortId} · {enrollment.status === "active" ? "Assegnazione attiva" : "Assegnazione sospesa"}{enrollment.hasWork ? " · Attività già iniziata" : " · Non ancora iniziato"}</p></div>
        {!enrollment.hasWork && <AdminMoveParticipant enrollment={enrollment} sessions={sessions} workspaceId={workspaceId} programId={data.program.id} busy={busy} mutate={mutate} />}
        <ConfirmAdminAction busy={busy} label={enrollment.status === "active" ? "Sospendi assegnazione" : "Riattiva assegnazione"} description={enrollment.status === "active" ? `Sospendere l’accesso di ${enrollment.name || enrollment.email} al percorso? Le risposte salvate saranno conservate.` : `Restituire a ${enrollment.name || enrollment.email} l’accesso al percorso e ai progressi salvati?`} onConfirm={() => mutate({ operation: "enrollment", input: { ...scope, enrollmentId: enrollment.id, cohortId: enrollment.cohortId, status: enrollment.status === "active" ? "revoked" : "active" } })} />
      </li>)}</ul>
    </AdminSection>
  </div>;
}

function AdminMoveParticipant({ enrollment, sessions, workspaceId, programId, busy, mutate }: {
  enrollment: AdminDetailDTO["enrollments"][number]; sessions: AdminDetailDTO["sessions"]; workspaceId: string; programId: string; busy: boolean; mutate: AdminMutate;
}) {
  const [form, setForm] = useState({ saved: enrollment.cohortId, selected: enrollment.cohortId });
  const dirty = form.saved !== form.selected;
  const { confirmDiscard } = useLearningUnsavedChanges({ dirty, onDiscard: () => setForm({ saved: enrollment.cohortId, selected: enrollment.cohortId }) });
  return <form className="space-y-3" onSubmit={async event => {
    event.preventDefault(); const cohortId = form.selected;
    if (await mutate({ operation: "enrollment", input: { workspaceId, programId, enrollmentId: enrollment.id, status: enrollment.status as "active" | "revoked", cohortId } })) setForm({ saved: cohortId, selected: cohortId });
  }}><fieldset disabled={busy} className="flex flex-wrap items-end gap-3"><div className="min-w-0 flex-1 space-y-2"><Label htmlFor={`turn-${enrollment.id}`}>Modifica turno di {enrollment.name || enrollment.email}</Label><AdminSelect id={`turn-${enrollment.id}`} name="cohortId" value={form.selected} onChange={event => setForm({ ...form, selected: event.target.value })}>{sessions.map(session => <option key={session.id} value={session.cohortId}>{session.cohortId} · {adminDate(session.startsAt)}</option>)}</AdminSelect></div><Button disabled={!dirty} type="submit" variant="outline">Salva turno</Button></fieldset><AdminUnsavedNotice dirty={dirty} onDiscard={confirmDiscard} /></form>;
}
