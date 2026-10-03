"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { AdminDetailDTO, LearningAdminRequest } from "@/lib/learning/admin-contract";
import { learningAdminRequest } from "@/lib/learning/admin-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AdminNotice, AdminSection, AdminSelect, AdminUnsavedNotice, ConfirmAdminAction, LearningLinkCopy, adminDate, sessionLabels } from "./admin-shared";
import { AdminParticipants } from "./admin-participants";
import { AdminGrants } from "./admin-grants";
import { confirmLearningNavigation, useLearningUnsavedChanges } from "./use-unsaved-changes";

type Mutation = Exclude<LearningAdminRequest, { operation: "catalog" | "detail" | "inspectPack" }>;
type WithoutActor<T> = T extends unknown ? Omit<T, "expectedUserId"> : never;
export type AdminMutate = (request: WithoutActor<Mutation>) => Promise<boolean>;
const sections = { overview: "Corso", participants: "Partecipanti", sessions: "Turni", permissions: "Permessi", history: "Registro e conservazione" };
type Section = keyof typeof sections;

const auditLabels: Record<string, string> = {
  program_imported: "Corso importato", program_enabled: "Corso reso disponibile", program_disabled: "Corso nascosto",
  program_closed: "Corso chiuso", program_reopened: "Corso riaperto", program_settings_changed: "Impostazioni aggiornate",
  session_status_changed: "Apertura del turno aggiornata", learner_enrolled: "Partecipante assegnato", enrollment_changed: "Assegnazione aggiornata",
  grant_created: "Permesso concesso", grant_revoked: "Permesso revocato", retention_purged: "Dati scaduti cancellati",
  attempt_started: "Attività avviata", draft_saved: "Bozza salvata", attempt_submitted: "Attività consegnata", decisions_submitted: "Decisioni consegnate",
};

export function LearningAdminProgram({ workspaceId, initial }: { workspaceId: string; initial: AdminDetailDTO }) {
  const [data, setData] = useState(initial);
  const [section, setSection] = useState<Section>("overview");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [accessLost, setAccessLost] = useState(false);
  const [formVersion, setFormVersion] = useState(0);
  const inFlight = useRef(false);
  useLearningUnsavedChanges({ dirty: false, pending: busy });
  const base = `/dashboard/${workspaceId}/learning`;
  const scope = { workspaceId, programId: data.program.id };

  const mutate: AdminMutate = async request => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true); setError(false); setMessage("");
    try {
      const result = await learningAdminRequest({ ...request, expectedUserId: data.userId });
      if (!result.ok) { setError(true); setMessage(result.message); return false; }
      setMessage(result.data.message);
      try {
        const updated = await learningAdminRequest({ expectedUserId: data.userId, operation: "detail", input: scope });
        if (updated.ok) setData(updated.data);
        else if (updated.code === "forbidden") { setAccessLost(true); setMessage("Modifica confermata. Il tuo permesso di gestione per questo corso non è più attivo."); }
        else setMessage(`${result.data.message} Ricarica la pagina per aggiornare il riepilogo.`);
      } catch { setMessage(`${result.data.message} Ricarica la pagina per aggiornare il riepilogo.`); }
      return true;
    } catch { setError(true); setMessage("Modifica non confermata. Verifica la connessione e ricarica il riepilogo prima di riprovare."); return false; }
    finally { inFlight.current = false; setBusy(false); }
  };

  async function refresh() {
    if (inFlight.current || !confirmLearningNavigation()) return;
    inFlight.current = true;
    setBusy(true); setError(false); setMessage("");
    try {
      const result = await learningAdminRequest({ expectedUserId: data.userId, operation: "detail", input: scope });
      if (!result.ok) { setError(true); setMessage(result.message); if (result.code === "forbidden") setAccessLost(true); }
      else { setData(result.data); setFormVersion(version => version + 1); setMessage("Riepilogo aggiornato."); }
    } catch { setError(true); setMessage("Aggiornamento non riuscito. Riprova quando la connessione è disponibile."); }
    finally { inFlight.current = false; setBusy(false); }
  }

  return <div className="space-y-6" aria-busy={busy}>
    <div className="flex flex-wrap items-center justify-between gap-3"><Link className="text-sm underline" href={`${base}/admin`}>Tutti i corsi da gestire</Link><Button type="button" variant="outline" disabled={busy} onClick={refresh}>Aggiorna riepilogo</Button></div>
    <AdminNotice message={message} error={error} />
    {busy && <p role="status" className="text-sm text-muted-foreground">Operazione in corso. Attendi la conferma prima di lasciare la pagina.</p>}
    {!accessLost && <>
      <div className="rounded-lg border p-4"><p className="font-medium">{data.program.title}</p><p className="mt-1 text-sm">Versione {data.program.version} · {data.program.featureEnabled ? "Visibile ai partecipanti assegnati" : "Nascosto ai partecipanti"} · {data.program.status === "published" ? "In corso" : "Chiuso alle nuove risposte"}</p>{!data.program.canManageAll && <p className="mt-2 text-sm text-muted-foreground">Puoi gestire i turni: {data.program.managedCohorts.join(", ")}.</p>}</div>
      <nav aria-label="Gestione del corso" className="flex flex-wrap gap-2">{Object.entries(sections).map(([key, label]) => <Button key={key} type="button" variant={section === key ? "default" : "outline"} aria-pressed={section === key} disabled={busy} onClick={() => { if (key !== section && confirmLearningNavigation()) { setSection(key as Section); setMessage(""); } }}>{label}</Button>)}</nav>
      <div key={formVersion}>
      {section === "overview" && <div className="space-y-6">
        <AdminSection title="Preparazione del percorso">
          <ol className="list-decimal space-y-2 pl-5 text-sm"><li>Controlla nome, informativa e conservazione.</li><li>Assegna i partecipanti a uno dei turni M1 e autorizza i formatori.</li><li>Rendi disponibile il corso e verifica l’accesso con un account partecipante.</li></ol>
          <p className="text-sm">Nel tuo perimetro: {data.enrollments.filter(enrollment => enrollment.status === "active").length} assegnazioni attive · {data.grants.filter(grant => grant.capability === "review" && !grant.revokedAt).length} permessi per leggere le consegne individuali.</p>
          <p className="text-sm">Il partecipante entra in Unbundle con Google oppure email e password, apre il workspace e sceglie <strong>Formazione</strong>. Le risposte salvate sono legate al suo account.</p>
          <p className="text-sm"><Link className="underline" href={`${base}/${data.program.id}`}>Apri la pagina del percorso</Link>. Per verificare la vista partecipante usa un account di prova assegnato; questa pagina non cambia il tuo ruolo.</p>
          <LearningLinkCopy path={`${base}/${data.program.id}`} label="Link del percorso da condividere con i partecipanti" />
          {data.program.canManageAll && <div className="flex flex-wrap items-start gap-3 border-t pt-4">
            <ConfirmAdminAction busy={busy} label={data.program.featureEnabled ? "Nascondi corso" : "Rendi disponibile il corso"} description={data.program.featureEnabled ? "Nascondere il percorso a tutti i partecipanti? I dati salvati restano conservati, ma non saranno consultabili finché il corso è nascosto." : "Rendere il percorso visibile alle persone assegnate? Le attività seguiranno il programma dei turni. Nessuna email sarà inviata."} onConfirm={() => mutate({ operation: "lifecycle", input: { ...scope, action: data.program.featureEnabled ? "disable" : "enable" } })} />
            <ConfirmAdminAction busy={busy} label={data.program.status === "published" ? "Chiudi corso" : "Riapri corso"} description={data.program.status === "published" ? "Chiudere il percorso alle nuove risposte? I partecipanti potranno ancora consultare le consegne se il corso è visibile. Il periodo di conservazione partirà dalla chiusura." : "Riaprire il percorso alle nuove risposte? La scadenza di conservazione sarà ricalcolata alla prossima chiusura. Controlla anche lo stato dei turni."} onConfirm={() => mutate({ operation: "lifecycle", input: { ...scope, action: data.program.status === "published" ? "close" : "reopen" } })} />
          </div>}
        </AdminSection>
        {data.program.canManageAll && <AdminSettings data={data} workspaceId={workspaceId} busy={busy} mutate={mutate} />}

      </div>}
      {section === "participants" && <AdminParticipants workspaceId={workspaceId} data={data} busy={busy} mutate={mutate} />}
      {section === "sessions" && <AdminSection title="Apertura dei turni">
        <p className="text-sm">Con il programma automatico, M1 apre le attività dopo 30, 78 e 105 minuti dall’inizio del turno. La fine dell’incontro non interrompe il lavoro. “Tutte le attività aperte” permette di anticiparle; “Nuove risposte sospese” interrompe salvataggi e consegne.</p>
        <p className="text-sm text-muted-foreground">Le date sono visualizzate nell’ora italiana (Europe/Rome). M2 e M3 restano in programma: questo pannello rende operativo M1.</p>
        <ul className="space-y-4">{data.sessions.map(session => <li key={session.id} className="space-y-3 rounded-lg border p-4"><h3 className="font-medium">{session.moduleId.toUpperCase()} · {session.cohortId}</h3><p className="text-sm">{adminDate(session.startsAt)} – {adminDate(session.endsAt)}</p>{session.moduleId === "m1" ? <AdminSessionForm session={session} workspaceId={workspaceId} programId={data.program.id} busy={busy} mutate={mutate} /> : <p className="text-sm text-muted-foreground">In programma · Attività non ancora disponibili</p>}</li>)}</ul>
      </AdminSection>}
      {section === "permissions" && <AdminGrants workspaceId={workspaceId} data={data} busy={busy} mutate={mutate} />}
      {section === "history" && <div className="space-y-6">
        {data.program.canManageAll && data.retention && <AdminRetention key={`${data.program.closedAt}:${data.program.retentionDays}:${data.retention.attempts}:${data.retention.ideaDrafts}`} data={data} workspaceId={workspaceId} busy={busy} mutate={mutate} />}
        <AdminSection title="Registro delle operazioni">
          <p className="text-sm text-muted-foreground">Operazioni recenti nel tuo perimetro. Questo registro non contiene risposte o voti.</p>
          {data.audit.length === 0 ? <p>Nessuna operazione registrata.</p> : <ol className="space-y-3">{data.audit.map(event => <li key={event.id} className="rounded-lg border p-3"><p className="text-sm font-medium">{auditLabels[event.eventType] || "Operazione sul percorso"}</p><p className="text-sm text-muted-foreground">{adminDate(event.createdAt)} · {event.actorName || "Responsabile del percorso"}{event.cohortId ? ` · ${event.cohortId}` : ""}</p></li>)}</ol>}
        </AdminSection>
      </div>}
      </div>
    </>}
  </div>;
}

function AdminRetention({ data, workspaceId, busy, mutate }: { data: AdminDetailDTO; workspaceId: string; busy: boolean; mutate: AdminMutate }) {
  const [title, setTitle] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const { confirmDiscard } = useLearningUnsavedChanges({ dirty: !!title || confirmed, onDiscard: () => { setTitle(""); setConfirmed(false); } });
  const retention = data.retention!;
  return <AdminSection title="Conservazione delle risposte">
    <p className="text-sm">Periodo configurato: {data.program.retentionDays} giorni dalla chiusura. Chiusura: {adminDate(data.program.closedAt)}. {retention.purgeAfter ? `Cancellazione consentita dal ${adminDate(retention.purgeAfter)}.` : "La data sarà calcolata alla chiusura del percorso."}</p>
    <p className="text-sm">Dati formativi conservati: {retention.attempts} tentativi e {retention.ideaDrafts} schede idea.</p>
    {!retention.eligible ? <p className="text-sm text-muted-foreground">La cancellazione non è ancora disponibile.</p> : <form onSubmit={async event => {
      event.preventDefault(); if (!confirmed || title !== data.program.title) return;
      if (await mutate({ operation: "purge", input: { workspaceId, programId: data.program.id, confirmProgramId: data.program.id, confirmTitle: title } })) { setTitle(""); setConfirmed(false); }
    }}><fieldset disabled={busy} className="space-y-4 rounded-lg border border-destructive/40 p-4">
      <p className="text-sm">La cancellazione è definitiva: elimina risposte, feedback e schede idea di questo corso. Le proposte già inviate al portfolio restano nel portfolio. Iscrizioni, permessi e registro restano conservati.</p>
      <div className="space-y-2"><Label htmlFor="purge-title">Per confermare, riscrivi il nome del corso: {data.program.title}</Label><Input id="purge-title" value={title} onChange={event => setTitle(event.target.value)} autoComplete="off" required /></div>
      <label className="flex items-start gap-3 text-sm"><input className="mt-1 size-4" type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} required /><span>Confermo la cancellazione definitiva dei dati formativi scaduti di questo corso.</span></label>
      <AdminUnsavedNotice dirty={!!title || confirmed} onDiscard={confirmDiscard} />
      <Button type="submit" variant="destructive" disabled={!confirmed || title !== data.program.title || (retention.attempts === 0 && retention.ideaDrafts === 0)}>Cancella dati formativi scaduti</Button>
    </fieldset></form>}
  </AdminSection>;
}

function AdminSettings({ data, workspaceId, busy, mutate }: { data: AdminDetailDTO; workspaceId: string; busy: boolean; mutate: AdminMutate }) {
  const current = { title: data.program.title, visibilityPolicy: data.program.visibilityPolicy, retentionDays: data.program.retentionDays };
  const [form, setForm] = useState({ baseline: current, title: current.title, policy: current.visibilityPolicy, retention: String(current.retentionDays) });
  const dirty = form.title !== form.baseline.title || form.policy !== form.baseline.visibilityPolicy || form.retention !== String(form.baseline.retentionDays);
  const changedElsewhere = JSON.stringify(current) !== JSON.stringify(form.baseline);
  const { confirmDiscard } = useLearningUnsavedChanges({ dirty, onDiscard: () => setForm({ baseline: current, title: current.title, policy: current.visibilityPolicy, retention: String(current.retentionDays) }) });
  return <AdminSection title="Impostazioni del corso">
    {changedElsewhere && <p role="status" className="text-sm text-amber-700 dark:text-amber-300">Il riepilogo contiene impostazioni più recenti. Le tue modifiche sono conservate: aggiorna il riepilogo per caricare la versione salvata prima di riprovare.</p>}
    <form onSubmit={async event => {
      event.preventDefault();
      const submitted = { title: form.title.trim(), visibilityPolicy: form.policy.trim(), retentionDays: Number(form.retention) };
      if (await mutate({ operation: "settings", input: { workspaceId, programId: data.program.id, ...submitted, expectedSettings: form.baseline } })) {
        setForm({ baseline: submitted, title: submitted.title, policy: submitted.visibilityPolicy, retention: String(submitted.retentionDays) });
      }
    }}><fieldset disabled={busy} className="space-y-4">
      <div className="space-y-2"><Label htmlFor="course-title">Nome del corso</Label><Input id="course-title" name="title" value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} required maxLength={250} /></div>
      <div className="space-y-2"><Label htmlFor="course-policy">Informativa visibile ai partecipanti</Label><Textarea id="course-policy" name="visibilityPolicy" value={form.policy} onChange={event => setForm({ ...form, policy: event.target.value })} required minLength={20} maxLength={10000} rows={4} /></div>
      <div className="space-y-2"><Label htmlFor="course-retention">Giorni di conservazione dopo la chiusura</Label><Input id="course-retention" name="retentionDays" type="number" min={1} max={3650} value={form.retention} onChange={event => setForm({ ...form, retention: event.target.value })} required /><p className="text-sm text-muted-foreground">Accorciare il periodo anticipa la data dalla quale sarà possibile cancellare le risposte. La cancellazione richiede una conferma separata.</p></div>
      <AdminUnsavedNotice dirty={dirty} onDiscard={confirmDiscard} />
      <Button type="submit" disabled={!dirty}>Salva impostazioni</Button>
    </fieldset></form>
    <p className="text-sm text-muted-foreground">Le domande e le date appartengono alla versione importata. Per sostituire i contenuti crea un nuovo corso con una nuova versione; i progressi esistenti restano nel corso originale.</p>
  </AdminSection>;
}

function AdminSessionForm({ session, workspaceId, programId, busy, mutate }: { session: AdminDetailDTO["sessions"][number]; workspaceId: string; programId: string; busy: boolean; mutate: AdminMutate }) {
  const [form, setForm] = useState({ saved: session.status, selected: session.status });
  const dirty = form.saved !== form.selected;
  const { confirmDiscard } = useLearningUnsavedChanges({ dirty, onDiscard: () => setForm({ saved: session.status, selected: session.status }) });
  return <form className="space-y-3" onSubmit={async event => {
    event.preventDefault(); const status = form.selected as "scheduled" | "open" | "closed";
    if (await mutate({ operation: "session", input: { workspaceId, programId, sessionId: session.id, status } })) setForm({ saved: status, selected: status });
  }}><fieldset disabled={busy} className="flex flex-wrap items-end gap-3"><div className="min-w-0 flex-1 space-y-2"><Label htmlFor={`session-${session.id}`}>Stato del turno {session.cohortId}</Label><AdminSelect id={`session-${session.id}`} name="status" value={form.selected} onChange={event => setForm({ ...form, selected: event.target.value })}>{Object.entries(sessionLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</AdminSelect></div><Button type="submit" variant="outline" disabled={!dirty}>Salva apertura</Button></fieldset><AdminUnsavedNotice dirty={dirty} onDiscard={confirmDiscard} /></form>;
}
