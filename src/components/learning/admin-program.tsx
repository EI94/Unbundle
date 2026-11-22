"use client";

import Link from "next/link";
import { useRef, useState, type KeyboardEvent } from "react";
import { ChartColumn } from "lucide-react";
import type { AdminDetailDTO, LearningAdminRequest } from "@/lib/learning/admin-contract";
import { learningAdminRequest } from "@/lib/learning/admin-client";
import { ADMIN_TABS, adminTabHref, type AdminTab } from "@/lib/learning/manage-view";
import { LEARNING_TEXT } from "@/lib/learning/text";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusDot } from "@/components/uc/ui/status-dot";
import { ActionMenu } from "@/components/uc/ui/action-menu";
import { Fold } from "@/components/ui-10/fold";
import { notifyDone } from "@/components/ui-10/toast";
import { cn } from "@/lib/utils";
import { AdminNotice, AdminSection, AdminUnsavedNotice, ConfirmAdminAction, adminDate, cohortLabel } from "./admin-shared";
import { AdminParticipants } from "./admin-participants";
import { AdminLessons } from "./admin-join-links";
import { AdminMaterials } from "./admin-materials";
import { AdminGrants } from "./admin-grants";
import { confirmLearningNavigation, useLearningUnsavedChanges } from "./use-unsaved-changes";

type Mutation = Exclude<LearningAdminRequest, { operation: "catalog" | "detail" | "inspectPack" }>;
type WithoutActor<T> = T extends unknown ? Omit<T, "expectedUserId"> : never;
export type AdminMutate = (request: WithoutActor<Mutation>) => Promise<boolean>;

const M = LEARNING_TEXT.manage;

const auditLabels: Record<string, string> = {
  program_imported: "Corso importato", program_enabled: "Corso reso disponibile", program_disabled: "Corso nascosto",
  program_closed: "Corso chiuso", program_reopened: "Corso riaperto", program_settings_changed: "Impostazioni aggiornate",
  session_status_changed: "Attività della lezione aggiornate", learner_enrolled: "Partecipante assegnato", enrollment_changed: "Assegnazione aggiornata",
  grant_created: "Permesso concesso", grant_revoked: "Permesso revocato", retention_purged: "Dati scaduti cancellati",
  join_link_created: "Link di accesso creato", join_link_opened: "Ingresso aperto", join_link_closed: "Ingresso chiuso",
  join_link_seats_changed: "Posti del link aggiornati", join_link_revoked: "Link di accesso disattivato",
  learner_joined_by_link: "Partecipante entrato dal link", learner_cohort_moved: "Partecipante spostato di lezione",
  material_uploaded: "Materiale caricato", material_deleted: "Materiale eliminato",
  attempt_started: "Attività avviata", draft_saved: "Bozza salvata", attempt_submitted: "Attività consegnata", decisions_submitted: "Decisioni consegnate",
};

/**
 * «Gestisci» un corso (rilascio 10, ondata 7a, docs/ui-10/PROPOSTA-10.md §3.9, audit Fuori §4.11): sotto l'H1 (il titolo
 * del corso) lo stato in una riga, «Risultati» bordato e il «⋯» (Copia link del corso · Vedi come partecipante ·
 * Aggiorna); poi quattro schede, con il loro indirizzo (`?scheda=`) e un solo pulsante pieno ciascuna:
 * - **Lezioni** — per ogni lezione l'ingresso (i link, il QR a schermo intero) e le attività (aperte, sospese, secondo
 *   la scaletta), prima in due sezioni diverse;
 * - **Materiali**;
 * - **Persone** — chi segue il corso e i permessi;
 * - **Impostazioni** — nome, informativa e conservazione; visibilità e chiusura; lo storico delle operazioni e la
 *   cancellazione dei dati scaduti, chiusi.
 * Le operazioni, i controlli del server e la protezione delle modifiche non salvate sono quelli di prima.
 */
export function LearningAdminProgram({ workspaceId, initial, initialTab, initialNow }: { workspaceId: string; initial: AdminDetailDTO; initialTab: AdminTab; initialNow: number }) {
  const [data, setData] = useState(initial);
  const [section, setSection] = useState<AdminTab>(initialTab);
  const [now, setNow] = useState(initialNow);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [accessLost, setAccessLost] = useState(false);
  const [formVersion, setFormVersion] = useState(0);
  const inFlight = useRef(false);
  useLearningUnsavedChanges({ dirty: false, pending: busy });
  const base = `/dashboard/${workspaceId}/learning`;
  const coursePath = `${base}/${data.program.id}`;
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
        if (updated.ok) { setData(updated.data); setNow(Date.now()); }
        else if (updated.code === "forbidden") { setAccessLost(true); setMessage("Modifica confermata. Il tuo permesso di gestione per questo corso non è più attivo."); }
        else setMessage(`${result.data.message} Ricarica la pagina per aggiornare il riepilogo.`);
      } catch { setMessage(`${result.data.message} Ricarica la pagina per aggiornare il riepilogo.`); }
      return true;
    } catch { setError(true); setMessage("Modifica non confermata. Verifica la connessione e ricarica il riepilogo prima di riprovare."); return false; }
    finally { inFlight.current = false; setBusy(false); }
  };

  async function reloadDetail() {
    const result = await learningAdminRequest({ expectedUserId: data.userId, operation: "detail", input: scope });
    if (result.ok) { setData(result.data); setNow(Date.now()); }
  }

  async function refresh() {
    // With unsaved edits the dialog asks first; after the confirmation the edits are discarded and the refresh runs.
    if (inFlight.current || !confirmLearningNavigation(() => void refresh())) return;
    inFlight.current = true;
    setBusy(true); setError(false); setMessage("");
    try {
      const result = await learningAdminRequest({ expectedUserId: data.userId, operation: "detail", input: scope });
      if (!result.ok) { setError(true); setMessage(result.message); if (result.code === "forbidden") setAccessLost(true); }
      else { setData(result.data); setNow(Date.now()); setFormVersion(version => version + 1); setMessage("Riepilogo aggiornato."); }
    } catch { setError(true); setMessage("Aggiornamento non riuscito. Riprova quando la connessione è disponibile."); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function copyCourseLink() {
    const url = new URL(coursePath, window.location.origin).href;
    try { await navigator.clipboard.writeText(url); notifyDone(M.copied); }
    catch { setError(false); setMessage(M.copyFailed(url)); }
  }

  /** Le frecce, Inizio e Fine spostano il fuoco fra le schede; Invio o Spazio le aprono (attivazione manuale). */
  function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = ADMIN_TABS.length - 1;
    const next = event.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
        : event.key === "Home" ? 0 : event.key === "End" ? last : null;
    if (next === null) return;
    event.preventDefault();
    document.getElementById(`gestisci-scheda-${ADMIN_TABS[next]}`)?.focus();
  }

  function openTab(key: AdminTab) {
    const open = () => {
      setSection(key); setMessage("");
      window.history.replaceState(window.history.state, "", adminTabHref(window.location.pathname, window.location.search, key));
    };
    if (key !== section && confirmLearningNavigation(open)) open();
  }

  const program = data.program;
  const status = program.status === "published" ? M.statusOpen : M.statusClosed;
  const scoped = !program.canManageAll && program.managedCohorts.length
    ? M.scoped(program.managedCohorts.map(cohort => cohortLabel(data.sessions, cohort).replace(/^Lezione del /, "")).join(", "))
    : null;

  return <div className="space-y-5" aria-busy={busy}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <StatusDot tone={program.status === "published" ? (program.featureEnabled ? "verde" : "grigio") : "grigio"} label={status} sublabel={program.featureEnabled ? M.visible : M.hidden} size="md" />
        {scoped ? <p className="text-sm text-muted-foreground">{scoped}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button render={<Link href={`${coursePath}/results`} />} nativeButton={false} variant="outline" className="min-h-11 sm:min-h-9" data-testid="admin-results-link">
          <ChartColumn aria-hidden data-icon="inline-start" />{M.results}
        </Button>
        <ActionMenu label={M.more} items={[
          { label: M.copyLink, onSelect: () => void copyCourseLink() },
          { label: M.asParticipant, href: coursePath },
          { label: M.refresh, onSelect: () => void refresh(), disabled: busy },
        ]} />
      </div>
    </div>
    <AdminNotice message={message} error={error} />
    {busy && <p role="status" className="text-sm text-muted-foreground">Operazione in corso. Attendi la conferma prima di lasciare la pagina.</p>}
    {!accessLost && <>
      {/* Le schede: un tablist vero (le frecce spostano il fuoco, Invio apre), la scheda aperta nell'indirizzo. */}
      <div role="tablist" aria-label={M.tabs.label} className="grid max-w-full min-w-0 grid-cols-2 gap-1 rounded-2xl border bg-muted/60 p-1 sm:inline-grid sm:grid-flow-col sm:grid-cols-none">
        {ADMIN_TABS.map((key, index) => <button key={key} type="button" role="tab" id={`gestisci-scheda-${key}`} aria-selected={section === key} aria-controls="gestisci-pannello"
          tabIndex={section === key ? 0 : -1} disabled={busy} data-testid={`admin-tab-${key}`}
          onClick={() => openTab(key)} onKeyDown={(event) => moveTab(event, index)}
          className={cn("flex min-h-11 w-full min-w-0 items-center justify-center rounded-xl px-3 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60 sm:min-h-9",
            section === key ? "bg-background text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:bg-background/50 hover:text-foreground")}>
          {M.tabs[key]}
        </button>)}
      </div>
      <div key={formVersion} role="tabpanel" id="gestisci-pannello" aria-labelledby={`gestisci-scheda-${section}`} tabIndex={0} className="outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        {section === "lezioni" && <AdminLessons workspaceId={workspaceId} data={data} busy={busy} mutate={mutate} now={now} />}
        {section === "materiali" && <AdminMaterials workspaceId={workspaceId} data={data} busy={busy} mutate={mutate} onUploaded={reloadDetail} />}
        {section === "persone" && <div className="space-y-6">
          <AdminParticipants workspaceId={workspaceId} data={data} busy={busy} mutate={mutate} />
          <AdminGrants workspaceId={workspaceId} data={data} busy={busy} mutate={mutate} />
        </div>}
        {section === "impostazioni" && <div className="space-y-6">
          {program.canManageAll && <AdminSettings data={data} workspaceId={workspaceId} busy={busy} mutate={mutate} />}
          {program.canManageAll && <AdminSection title={M.lifecycle}>
            <div className="flex flex-wrap items-start gap-3">
              <ConfirmAdminAction busy={busy} label={program.featureEnabled ? "Nascondi corso" : "Rendi disponibile il corso"} description={program.featureEnabled ? "Nascondere il corso a tutti i partecipanti? I dati salvati restano conservati, ma non saranno consultabili finché il corso è nascosto." : "Rendere il corso visibile alle persone assegnate? Le attività seguiranno la scaletta delle lezioni. Nessuna email sarà inviata."} onConfirm={() => mutate({ operation: "lifecycle", input: { ...scope, action: program.featureEnabled ? "disable" : "enable" } })} />
              <ConfirmAdminAction busy={busy} label={program.status === "published" ? "Chiudi corso" : "Riapri corso"} description={program.status === "published" ? "Chiudere il corso alle nuove risposte? I partecipanti potranno ancora consultare le consegne se il corso è visibile. Il periodo di conservazione partirà dalla chiusura." : "Riaprire il corso alle nuove risposte? La scadenza di conservazione sarà ricalcolata alla prossima chiusura. Controlla anche le attività delle lezioni."} onConfirm={() => mutate({ operation: "lifecycle", input: { ...scope, action: program.status === "published" ? "close" : "reopen" } })} />
            </div>
          </AdminSection>}
          <div>
            <Fold id="storico" title={M.history}>
              <p className="text-sm text-muted-foreground">{M.historyNote}</p>
              {data.audit.length === 0 ? <p className="text-sm">{M.historyEmpty}</p> : <ol className="space-y-2">{data.audit.map(event => <li key={event.id} className="rounded-lg border p-3"><p className="text-sm font-medium">{auditLabels[event.eventType] || "Operazione sul corso"}</p><p className="text-sm text-muted-foreground">{adminDate(event.createdAt)} · {event.actorName || "Chi tiene il corso"}{event.cohortId ? ` · ${cohortLabel(data.sessions, event.cohortId).toLowerCase()}` : ""}</p></li>)}</ol>}
            </Fold>
            {program.canManageAll && data.retention && <Fold id="cancellazione" title={M.purge}>
              <AdminRetention key={`${program.closedAt}:${program.retentionDays}:${data.retention.attempts}:${data.retention.ideaDrafts}`} data={data} workspaceId={workspaceId} busy={busy} mutate={mutate} />
            </Fold>}
          </div>
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
  return <div className="space-y-4">
    <p className="text-sm">Periodo configurato: {data.program.retentionDays} giorni dalla chiusura. Chiusura: {adminDate(data.program.closedAt)}. {retention.purgeAfter ? `Cancellazione consentita dal ${adminDate(retention.purgeAfter)}.` : "La data sarà calcolata alla chiusura del corso."}</p>
    <p className="text-sm">Dati conservati: {retention.attempts} prove e {retention.ideaDrafts} schede idea.</p>
    {!retention.eligible ? <p className="text-sm text-muted-foreground">La cancellazione non è ancora disponibile.</p> : <form onSubmit={async event => {
      event.preventDefault(); if (!confirmed || title !== data.program.title) return;
      if (await mutate({ operation: "purge", input: { workspaceId, programId: data.program.id, confirmProgramId: data.program.id, confirmTitle: title } })) { setTitle(""); setConfirmed(false); }
    }}><fieldset disabled={busy} className="space-y-4 rounded-lg border border-destructive/40 p-4">
      <p className="text-sm">La cancellazione è definitiva: elimina risposte, riscontri e schede idea di questo corso. Gli use case già inviati restano. Iscrizioni, permessi e registro restano conservati.</p>
      <div className="space-y-2"><Label htmlFor="purge-title">Per confermare, riscrivi il nome del corso: {data.program.title}</Label><Input id="purge-title" className="text-base sm:text-sm" value={title} onChange={event => setTitle(event.target.value)} autoComplete="off" required /></div>
      <label className="flex items-start gap-3 text-sm"><input className="mt-1 size-4" type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} required /><span>Confermo la cancellazione definitiva dei dati scaduti di questo corso.</span></label>
      <AdminUnsavedNotice dirty={!!title || confirmed} onDiscard={confirmDiscard} />
      <Button type="submit" variant="destructive" disabled={!confirmed || title !== data.program.title || (retention.attempts === 0 && retention.ideaDrafts === 0)}>Cancella i dati scaduti</Button>
    </fieldset></form>}
  </div>;
}

function AdminSettings({ data, workspaceId, busy, mutate }: { data: AdminDetailDTO; workspaceId: string; busy: boolean; mutate: AdminMutate }) {
  const current = { title: data.program.title, visibilityPolicy: data.program.visibilityPolicy, retentionDays: data.program.retentionDays };
  const [form, setForm] = useState({ baseline: current, title: current.title, policy: current.visibilityPolicy, retention: String(current.retentionDays) });
  const dirty = form.title !== form.baseline.title || form.policy !== form.baseline.visibilityPolicy || form.retention !== String(form.baseline.retentionDays);
  const changedElsewhere = JSON.stringify(current) !== JSON.stringify(form.baseline);
  const { confirmDiscard } = useLearningUnsavedChanges({ dirty, onDiscard: () => setForm({ baseline: current, title: current.title, policy: current.visibilityPolicy, retention: String(current.retentionDays) }) });
  return <AdminSection title="Impostazioni del corso">
    {changedElsewhere && <p role="status" className="text-sm text-uc-giallo">Il riepilogo contiene impostazioni più recenti. Le tue modifiche sono conservate: aggiorna il riepilogo per caricare la versione salvata prima di riprovare.</p>}
    <form onSubmit={async event => {
      event.preventDefault();
      const submitted = { title: form.title.trim(), visibilityPolicy: form.policy.trim(), retentionDays: Number(form.retention) };
      if (await mutate({ operation: "settings", input: { workspaceId, programId: data.program.id, ...submitted, expectedSettings: form.baseline } })) {
        setForm({ baseline: submitted, title: submitted.title, policy: submitted.visibilityPolicy, retention: String(submitted.retentionDays) });
      }
    }}><fieldset disabled={busy} className="space-y-4">
      <div className="space-y-2"><Label htmlFor="course-title">Nome del corso</Label><Input id="course-title" name="title" className="text-base sm:text-sm" value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} required maxLength={250} /></div>
      <div className="space-y-2"><Label htmlFor="course-policy">Informativa visibile ai partecipanti</Label><Textarea id="course-policy" name="visibilityPolicy" className="text-base sm:text-sm" value={form.policy} onChange={event => setForm({ ...form, policy: event.target.value })} required minLength={20} maxLength={10000} rows={4} /></div>
      <div className="space-y-2"><Label htmlFor="course-retention">Giorni di conservazione dopo la chiusura</Label><Input id="course-retention" name="retentionDays" className="text-base sm:text-sm" type="number" min={1} max={3650} value={form.retention} onChange={event => setForm({ ...form, retention: event.target.value })} required /><p className="text-sm text-muted-foreground">Accorciare il periodo anticipa la data dalla quale sarà possibile cancellare le risposte. La cancellazione richiede una conferma separata.</p></div>
      <AdminUnsavedNotice dirty={dirty} onDiscard={confirmDiscard} />
      <Button type="submit" className="min-h-11 sm:min-h-9" disabled={!dirty}>Salva impostazioni</Button>
    </fieldset></form>
    <p className="text-sm text-muted-foreground">Le domande e le date appartengono alla versione importata. Per sostituire i contenuti crea un nuovo corso con una nuova versione; i progressi esistenti restano nel corso originale.</p>
  </AdminSection>;
}
