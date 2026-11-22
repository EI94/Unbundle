"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { Copy, DoorOpen, Link2, QrCode } from "lucide-react";
import type { AdminDetailDTO, AdminJoinLinkDTO } from "@/lib/learning/admin-contract";
import { learningAdminRequest } from "@/lib/learning/admin-client";
import { clockLabel } from "@/lib/learning/course-view";
import { activitiesState, lessonsNextStep, linkState, linkUsable } from "@/lib/learning/manage-view";
import { LEARNING_TEXT } from "@/lib/learning/text";
import type { AdminMutate } from "./admin-program";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusDot } from "@/components/uc/ui/status-dot";
import { AdminQrFullscreen } from "./admin-qr";
import { ConfirmAdminAction, adminDate, cohortLabel } from "./admin-shared";

const L = LEARNING_TEXT.manage.lessons;

/**
 * «Lezioni» (rilascio 10, ondata 7a, §3.9, audit Fuori §4.11 e FO-30): ogni lezione in una card, con tutto quello che
 * serve in aula senza cambiare scheda. Prima stavano in due sezioni, «Link di accesso» e «Turni», proprio nel momento
 * più delicato. Due interruttori distinti, con nomi diversi, perché confonderli è il modo più facile per avere venti
 * persone dentro il corso che non riescono a rispondere:
 *   «Ingresso» — ci si può iscrivere (il link, con il QR a schermo intero);
 *   «Attività» — si può rispondere (le attività della lezione: secondo la scaletta, aperte, sospese).
 * Un solo pulsante pieno: il prossimo passo della prossima lezione (`lessonsNextStep`). Le opzioni del link stanno
 * chiuse; le operazioni del server sono quelle di prima.
 */
export function AdminLessons({ workspaceId, data, busy, mutate, now }: {
  workspaceId: string; data: AdminDetailDTO; busy: boolean; mutate: AdminMutate; now: number;
}) {
  const lessons = data.sessions.filter((session) => session.moduleId === "m1");
  const others = data.sessions.filter((session) => session.moduleId !== "m1");
  const scope = { workspaceId, programId: data.program.id };
  const next = lessonsNextStep(lessons, data.joinLinks, now);
  const [created, setCreated] = useState<(AdminJoinLinkDTO & { cohortId: string }) | null>(null);
  const [projecting, setProjecting] = useState(false);

  if (!lessons.length && !others.length) return <p className="text-sm text-muted-foreground">{L.none}</p>;
  return <div className="space-y-4">
    {lessons.map((lesson) => <LessonCard
      key={lesson.id}
      lesson={lesson}
      data={data}
      busy={busy}
      mutate={mutate}
      now={now}
      scope={scope}
      primary={next?.cohortId === lesson.cohortId ? next : null}
      created={created?.cohortId === lesson.cohortId ? created : null}
      onCreated={(link) => setCreated({ ...link, cohortId: lesson.cohortId })}
      onProject={() => setProjecting(true)}
    />)}
    {others.length ? <details className="rounded-xl border px-4 py-2">
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium sm:min-h-9">{L.otherModules(new Set(others.map((session) => session.moduleId)).size)}</summary>
      <ul className="space-y-1 pb-2 text-sm">
        {others.map((session) => <li key={session.id}>{cohortLabel(data.sessions, session.cohortId)}</li>)}
      </ul>
      <p className="pb-2 text-sm text-muted-foreground">{L.planned}</p>
    </details> : null}
    {projecting && created ? <AdminQrFullscreen
      qrSvg={created.qrSvg}
      lesson={cohortLabel(lessons, created.cohortId)}
      doorOpen={data.joinLinks.find((link) => link.id === created.linkId)?.doorOpen ?? false}
      busy={busy}
      onDoor={(open) => void mutate({ operation: "joinLinkDoor", input: { ...scope, linkId: created.linkId, doorOpen: open } })}
      onClose={() => setProjecting(false)}
    /> : null}
  </div>;
}

function LessonCard({ lesson, data, busy, mutate, now, scope, primary, created, onCreated, onProject }: {
  lesson: AdminDetailDTO["sessions"][number];
  data: AdminDetailDTO;
  busy: boolean;
  mutate: AdminMutate;
  now: number;
  scope: { workspaceId: string; programId: string };
  primary: { step: "create" | "openDoor"; linkId: string | null } | null;
  created: AdminJoinLinkDTO | null;
  onCreated: (link: AdminJoinLinkDTO) => void;
  onProject: () => void;
}) {
  const title = cohortLabel(data.sessions, lesson.cohortId);
  const enrolled = data.enrollments.filter((enrollment) => enrollment.cohortId === lesson.cohortId && enrollment.status === "active").length;
  const links = data.joinLinks.filter((link) => link.cohortId === lesson.cohortId);
  const usable = links.filter((link) => linkUsable(link, now));
  const closed = links.filter((link) => !linkUsable(link, now));
  const activities = activitiesState(lesson.status);
  const reopen = usable.flatMap((link) => link.reopenRequests);
  const reopenCount = reopen.reduce((sum, request) => sum + request.count, 0);
  const sessionInput = { ...scope, sessionId: lesson.id };

  return <section aria-labelledby={`lezione-${lesson.id}`} data-testid="admin-lesson" className="space-y-4 rounded-xl border bg-card p-4 sm:p-5">
    <header className="space-y-1">
      <h2 id={`lezione-${lesson.id}`} className="text-base font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">{clockLabel(lesson.startsAt)}–{clockLabel(lesson.endsAt)}{enrolled ? ` · ${L.enrolled(enrolled)}` : ""}</p>
    </header>

    {/* «Ingresso»: i link della lezione, il QR, i posti. */}
    <div className="space-y-3">
      {usable.map((link) => {
        const state = linkState(link, now);
        const filled = primary?.step === "openDoor" && primary.linkId === link.id;
        const left = Math.max(link.maxUses - link.usedCount, 0);
        return <div key={link.id} data-testid="admin-join-link" className="space-y-2 rounded-lg border p-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <StatusDot tone={state.tone} label={state.label} size="md" />
            {link.label ? <span className="text-sm font-medium">{link.label}</span> : null}
          </div>
          <p className="text-sm text-muted-foreground">{L.seatsLine(link.joined, left, link.maxUses)} · {L.validUntil(adminDate(link.expiresAt))}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={busy} variant={filled ? "default" : "outline"} className="min-h-11 sm:min-h-9"
              onClick={() => mutate({ operation: "joinLinkDoor", input: { ...scope, linkId: link.id, doorOpen: !link.doorOpen } })}>
              <DoorOpen aria-hidden data-icon="inline-start" />{link.doorOpen ? L.closeDoor : L.openDoor}
            </Button>
            <Button type="button" variant="outline" disabled={busy} className="min-h-11 sm:min-h-9"
              onClick={() => mutate({ operation: "joinLinkSeats", input: { ...scope, linkId: link.id, maxUses: link.maxUses + 20 } })}>
              {L.addSeats}
            </Button>
            <ConfirmAdminAction busy={busy} label={L.revoke} description={L.revokeAsk(title.toLowerCase())}
              onConfirm={() => mutate({ operation: "revokeJoinLink", input: { ...scope, linkId: link.id } })} />
          </div>
        </div>;
      })}
      {created ? <CreatedLink created={created} onProject={onProject} /> : null}
      <CreateLink scope={scope} cohortId={lesson.cohortId} userId={data.userId} busy={busy} filled={primary?.step === "create"} mutate={mutate} onCreated={onCreated} />
      {reopenCount > 0 ? <p className="rounded-lg border border-uc-giallo/40 bg-uc-giallo-bg p-3 text-sm">
        {L.reopen(reopenCount, [...new Set(reopen.map((request) => cohortLabel(data.sessions, request.cohortId).replace(/^Lezione del /, "")))].join(", "))}
      </p> : null}
      {closed.length ? <details className="text-sm">
        <summary className="min-h-11 cursor-pointer py-2 text-muted-foreground sm:min-h-9">{L.closedLinks(closed.length)}</summary>
        <ul className="space-y-1">{closed.map((link) => {
          const state = linkState(link, now);
          return <li key={link.id} className="flex flex-wrap items-center gap-x-3"><StatusDot tone={state.tone} label={state.label} />{link.label ? <span>{link.label}</span> : null}<span className="text-muted-foreground">{L.seatsLine(link.joined, Math.max(link.maxUses - link.usedCount, 0), link.maxUses)}</span></li>;
        })}</ul>
      </details> : null}
    </div>

    {/* «Attività»: si può rispondere. */}
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3">
      <StatusDot tone={activities.tone} label={activities.label} size="md" />
      <div className="flex flex-wrap gap-2">
        {lesson.status !== "open" ? <ConfirmAdminAction busy={busy} label={L.openNow} description={L.openNowAsk}
          onConfirm={() => mutate({ operation: "session", input: { ...sessionInput, status: "open" } })} /> : null}
        {lesson.status !== "scheduled" ? <ConfirmAdminAction busy={busy} label={L.backToPlan} description={L.backToPlanAsk}
          onConfirm={() => mutate({ operation: "session", input: { ...sessionInput, status: "scheduled" } })} /> : null}
        {lesson.status !== "closed" ? <ConfirmAdminAction busy={busy} label={L.suspend} description={L.suspendAsk}
          onConfirm={() => mutate({ operation: "session", input: { ...sessionInput, status: "closed" } })} /> : null}
      </div>
    </div>
  </section>;
}

/** Il link appena creato: l'indirizzo compare una volta sola, con «Copia il link» e il QR a schermo intero. */
function CreatedLink({ created, onProject }: { created: AdminJoinLinkDTO; onProject: () => void }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(created.url);
      setCopied(true); setError("");
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setError(L.copyError);
    }
  }
  return <div className="space-y-3 rounded-lg border border-uc-verde/40 bg-uc-verde-bg p-3" data-testid="join-link-created">
    <p className="text-sm font-medium">{L.ready}</p>
    <p className="text-sm text-muted-foreground">{L.readyHelp}</p>
    <code className="block overflow-x-auto rounded-lg border bg-background p-3 text-xs">{created.url}</code>
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" onClick={copy}><Copy aria-hidden data-icon="inline-start" />{copied ? L.copiedShort : L.copy}</Button>
      <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" onClick={onProject} aria-haspopup="dialog"><QrCode aria-hidden data-icon="inline-start" />{L.showQr}</Button>
    </div>
    {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
  </div>;
}

/** «Crea il link» della lezione, con le opzioni chiuse (nome, posti, ore di validità). */
function CreateLink({ scope, cohortId, userId, busy, filled, mutate, onCreated }: {
  scope: { workspaceId: string; programId: string }; cohortId: string; userId: string; busy: boolean; filled: boolean;
  mutate: AdminMutate; onCreated: (link: AdminJoinLinkDTO) => void;
}) {
  const [label, setLabel] = useState("");
  const [maxUses, setMaxUses] = useState(30);
  const [hours, setHours] = useState(24);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating) return;
    setError(""); setCreating(true);
    try {
      // L'idempotency key nasce con il submit: un doppio tocco non crea due link.
      const result = await learningAdminRequest({
        expectedUserId: userId,
        operation: "joinLink",
        input: { ...scope, cohortId, label: label.trim() || undefined, maxUses, expiresInHours: hours, idempotencyKey: crypto.randomUUID() },
      });
      if (!result.ok) { setError(result.message); return; }
      onCreated(result.data);
      setLabel("");
      // Il riepilogo si aggiorna senza toccare il token appena mostrato.
      await mutate({ operation: "joinLinkDoor", input: { ...scope, linkId: result.data.linkId, doorOpen: false } });
    } catch {
      setError(L.createFailed);
    } finally {
      setCreating(false);
    }
  }

  const id = `link-${cohortId}`.replace(/[^a-zA-Z0-9_-]/g, "-");
  return <form onSubmit={create} className="space-y-2">
    <fieldset disabled={busy || creating} className="space-y-2">
      <Button type="submit" variant={filled ? "default" : "outline"} className="min-h-11 sm:min-h-9" data-testid="join-link-create">
        <Link2 aria-hidden data-icon="inline-start" />{creating ? L.creating : L.createLink}
      </Button>
      <details className="text-sm">
        <summary className="min-h-11 cursor-pointer py-2 text-muted-foreground sm:min-h-9">{L.options}</summary>
        <div className="grid gap-3 pt-1 sm:grid-cols-3">
          <div className="space-y-1"><Label htmlFor={`${id}-label`}>{L.linkName}</Label><Input id={`${id}-label`} className="text-base sm:text-sm" value={label} onChange={(event) => setLabel(event.target.value)} placeholder={L.linkNameHint} maxLength={120} /></div>
          <div className="space-y-1"><Label htmlFor={`${id}-seats`}>{L.seats}</Label><Input id={`${id}-seats`} className="text-base sm:text-sm" type="number" min={1} max={500} value={maxUses} onChange={(event) => setMaxUses(Number(event.target.value))} /></div>
          <div className="space-y-1"><Label htmlFor={`${id}-hours`}>{L.hours}</Label><Input id={`${id}-hours`} className="text-base sm:text-sm" type="number" min={1} max={720} value={hours} onChange={(event) => setHours(Number(event.target.value))} /></div>
        </div>
      </details>
    </fieldset>
    {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
  </form>;
}
