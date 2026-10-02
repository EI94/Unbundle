"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { FormEvent } from "react";
import type { AdminCatalogDTO, AdminPackDTO } from "@/lib/learning/admin-contract";
import { learningAdminRequest } from "@/lib/learning/admin-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AdminNotice, AdminSection, adminDate } from "./admin-shared";

export function LearningAdminCatalog({ workspaceId, initial }: { workspaceId: string; initial: AdminCatalogDTO }) {
  const [catalog, setCatalog] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [packSummary, setPackSummary] = useState<AdminPackDTO | null>(null);
  const privatePack = useRef<unknown>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const [confirmed, setConfirmed] = useState(false);
  const base = `/dashboard/${workspaceId}/learning`;

  async function inspect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(false); setMessage(""); setPackSummary(null); setConfirmed(false); privatePack.current = null;
    try {
      const file = fileInput.current?.files?.[0];
      if (!file || file.size > 5_000_000) throw new Error("Scegli un pacchetto JSON di dimensione inferiore a 5 MB.");
      let pack: unknown;
      try { pack = JSON.parse(await file.text()); } catch { throw new Error("Il file non contiene un pacchetto JSON valido."); }
      const result = await learningAdminRequest({ expectedUserId: catalog.userId, operation: "inspectPack", input: { workspaceId, pack } });
      if (!result.ok) { setError(true); setMessage(result.message); return; }
      privatePack.current = pack;
      setPackSummary(result.data);
      setMessage("Pacchetto verificato. Controlla il riepilogo e completa i dati prima di importarlo.");
    } catch (cause) { setError(true); setMessage(cause instanceof Error ? cause.message : "Verifica non completata. Riprova."); }
    finally { setBusy(false); }
  }

  async function importPack(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !packSummary || !confirmed || !privatePack.current) return;
    const fields = new FormData(event.currentTarget);
    setBusy(true); setError(false); setMessage("");
    try {
      const result = await learningAdminRequest({ expectedUserId: catalog.userId, operation: "importPack", input: {
        workspaceId, pack: privatePack.current, title: String(fields.get("title") ?? ""),
        visibilityPolicy: String(fields.get("visibilityPolicy") ?? ""), retentionDays: Number(fields.get("retentionDays")),
      } });
      if (!result.ok) { setError(true); setMessage(result.message); return; }
      privatePack.current = null; setPackSummary(null); setConfirmed(false); form.current?.reset();
      if (fileInput.current) fileInput.current.value = "";
      setMessage(result.data.message);
      try {
        const updated = await learningAdminRequest({ expectedUserId: catalog.userId, operation: "catalog", input: { workspaceId } });
        if (updated.ok) setCatalog(updated.data);
        else setMessage("Importazione confermata. Ricarica la pagina per aggiornare l’elenco dei corsi.");
      } catch { setMessage("Importazione confermata. Ricarica la pagina per aggiornare l’elenco dei corsi."); }
    } catch { setError(true); setMessage("Importazione non confermata. Riprova con lo stesso pacchetto: un corso già importato non viene duplicato."); }
    finally { setBusy(false); }
  }

  return <div className="space-y-6" aria-busy={busy}>
    <p>Prepara il percorso, assegna i turni e autorizza i formatori. Le risposte alla survey AI Readiness restano separate.</p>
    <AdminNotice message={message} error={error} />
    {busy && <p role="status" className="text-sm text-muted-foreground">Operazione in corso. Attendi la conferma prima di lasciare la pagina.</p>}
    <AdminSection title="I corsi che gestisci">
      {catalog.programs.length === 0 ? <p>Nessun corso da gestire. {catalog.canCreate ? "Inizia importando il pacchetto didattico approvato." : "Un responsabile del corso deve assegnarti il permesso di gestione."}</p> : <ul className="grid gap-4 sm:grid-cols-2">{catalog.programs.map(program => <li key={program.id} className="space-y-3 rounded-lg border p-4">
        <h2 className="font-semibold">{program.title}</h2>
        <p className="text-sm">Versione {program.version} · {program.featureEnabled ? "Visibile agli assegnatari" : "Nascosto ai partecipanti"} · {program.status === "published" ? "In corso" : "Chiuso"}</p>
        {!program.canManageAll && <p className="text-sm text-muted-foreground">Gestione limitata ai turni assegnati.</p>}
        <Link className="inline-block underline underline-offset-4" href={`${base}/${program.id}/admin`}>Gestisci {program.title}</Link>
      </li>)}</ul>}
    </AdminSection>
    {catalog.canCreate && <AdminSection title="Prepara un nuovo corso">
      <p className="text-sm text-muted-foreground">Usa il pacchetto didattico approvato. Dopo l’importazione sceglierai partecipanti e permessi, poi renderai disponibile il corso. Una versione già importata non può essere sovrascritta.</p>
      <form onSubmit={inspect} className="space-y-3">
        <fieldset disabled={busy} className="space-y-3">
          <Label htmlFor="learning-pack">Pacchetto didattico riservato (JSON, massimo 5 MB)</Label>
          <Input ref={fileInput} id="learning-pack" type="file" accept=".json,application/json" required onChange={() => { privatePack.current = null; setPackSummary(null); setConfirmed(false); }} />
          <Button type="submit" variant="outline">Verifica pacchetto</Button>
        </fieldset>
      </form>
      {packSummary && <div className="space-y-4 border-t pt-4">
        <div className="space-y-2 rounded-lg bg-muted/40 p-4"><h3 className="font-medium">Riepilogo della versione {packSummary.version}</h3><p className="text-sm">{packSummary.modules.length} moduli · {packSummary.sessionCount} turni · {packSummary.activityCount} attività · {packSummary.itemCount} domande</p>
          <ul className="space-y-3 text-sm">{packSummary.modules.map(module => <li key={module.id}><strong>{module.title}</strong><ul>{module.sessions.map(session => <li key={session.cohortId}>{session.cohortId} · {adminDate(session.startsAt)} – {adminDate(session.endsAt)} · {session.timezone}</li>)}</ul></li>)}</ul>
        </div>
        <form ref={form} onSubmit={importPack}>
          <fieldset disabled={busy} className="space-y-4">
            <div className="space-y-2"><Label htmlFor="new-course-title">Nome del corso</Label><Input id="new-course-title" name="title" maxLength={250} required /></div>
            <div className="space-y-2"><Label htmlFor="new-course-policy">Informativa visibile ai partecipanti</Label><Textarea id="new-course-policy" name="visibilityPolicy" minLength={20} maxLength={10000} rows={4} required placeholder="Indica chi può consultare i risultati e a chi rivolgersi per il percorso." /></div>
            <div className="space-y-2"><Label htmlFor="new-course-retention">Giorni di conservazione dopo la chiusura</Label><Input id="new-course-retention" name="retentionDays" type="number" min={1} max={3650} defaultValue={90} required /><p className="text-sm text-muted-foreground">Scegli il periodo concordato per questo corso. La cancellazione richiederà una conferma separata dopo la scadenza.</p></div>
            <label className="flex items-start gap-3 text-sm"><input className="mt-1 size-4" type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} required /><span>Ho verificato versione, date e informativa. Confermo l’importazione in questo workspace.</span></label>
            <Button type="submit" disabled={!confirmed}>Importa corso</Button>
          </fieldset>
        </form>
      </div>}
    </AdminSection>}
    <p className="text-sm"><Link className="underline" href={`/dashboard/${workspaceId}/settings`}>Membri e inviti del workspace</Link> · L’assegnazione di un corso non invia email.</p>
  </div>;
}
