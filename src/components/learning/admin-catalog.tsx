"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { BookOpenCheck, Plus } from "lucide-react";
import type { FormEvent } from "react";
import type { AdminCatalogDTO, AdminPackDTO } from "@/lib/learning/admin-contract";
import { learningAdminRequest } from "@/lib/learning/admin-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LEARNING_TEXT } from "@/lib/learning/text";
import { Row, RowList } from "@/components/ui-10/row";
import { notifyDone } from "@/components/ui-10/toast";
import { ActionMenu } from "@/components/uc/ui/action-menu";
import { AdminNotice, AdminSection, AdminUnsavedNotice, adminDate } from "./admin-shared";

import { useLearningUnsavedChanges } from "./use-unsaved-changes";

const C = LEARNING_TEXT.catalog;

/**
 * «Gestisci formazione» (rilascio 10, ondata 7a, audit Fuori §4.10): i corsi in righe, che aprono «Gestisci» del corso;
 * il registro della formazione AI in una riga; un solo pulsante pieno, «Nuovo corso», che apre l'importazione in tre
 * passi (il file, il riepilogo con nome, informativa e conservazione, la conferma). L'importazione è quella di prima.
 */
export function LearningAdminCatalog({ workspaceId, initial }: { workspaceId: string; initial: AdminCatalogDTO }) {
  const [catalog, setCatalog] = useState(initial);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [packSummary, setPackSummary] = useState<AdminPackDTO | null>(null);
  const privatePack = useRef<unknown>(null);
  const inFlight = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [dirty, setDirty] = useState(false);
  function discardImport() {
    privatePack.current = null; setPackSummary(null); setConfirmed(false); setDirty(false);
    form.current?.reset(); if (fileInput.current) fileInput.current.value = "";
  }
  const { confirmDiscard } = useLearningUnsavedChanges({ dirty, pending: busy, onDiscard: discardImport });
  const base = `/dashboard/${workspaceId}/learning`;

  async function inspect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError(false); setMessage(""); setPackSummary(null); setConfirmed(false); privatePack.current = null;
    try {
      const file = fileInput.current?.files?.[0];
      if (!file || file.size > 5_000_000) throw new Error("Scegli il file del corso, fino a 5 MB.");
      let pack: unknown;
      try { pack = JSON.parse(await file.text()); } catch { throw new Error("Questo file non è il file di un corso."); }
      const result = await learningAdminRequest({ expectedUserId: catalog.userId, operation: "inspectPack", input: { workspaceId, pack } });
      if (!result.ok) { setError(true); setMessage(result.message); return; }
      privatePack.current = pack;
      setPackSummary(result.data);
      setMessage("File controllato. Leggi il riepilogo e completa i dati prima di importarlo.");
    } catch (cause) { setError(true); setMessage(cause instanceof Error ? cause.message : "Verifica non completata. Riprova."); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function importPack(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || !packSummary || !confirmed || !privatePack.current) return;
    inFlight.current = true;
    const fields = new FormData(event.currentTarget);
    setBusy(true); setError(false); setMessage("");
    try {
      const result = await learningAdminRequest({ expectedUserId: catalog.userId, operation: "importPack", input: {
        workspaceId, pack: privatePack.current, title: String(fields.get("title") ?? ""),
        visibilityPolicy: String(fields.get("visibilityPolicy") ?? ""), retentionDays: Number(fields.get("retentionDays")),
      } });
      if (!result.ok) { setError(true); setMessage(result.message); return; }
      privatePack.current = null; setPackSummary(null); setConfirmed(false); setDirty(false); form.current?.reset();
      if (fileInput.current) fileInput.current.value = "";
      setMessage(result.data.message);
      try {
        const updated = await learningAdminRequest({ expectedUserId: catalog.userId, operation: "catalog", input: { workspaceId } });
        if (updated.ok) setCatalog(updated.data);
        else setMessage("Importazione confermata. Ricarica la pagina per aggiornare l’elenco dei corsi.");
      } catch { setMessage("Importazione confermata. Ricarica la pagina per aggiornare l’elenco dei corsi."); }
    } catch { setError(true); setMessage("Importazione non confermata. Riprova con lo stesso pacchetto: un corso già importato non viene duplicato."); }
    finally { inFlight.current = false; setBusy(false); }
  }

  /** Il link della Formazione del workspace (prima un riquadro da copiare): negli appunti, o scritto qui se non si può. */
  async function copyLearningLink() {
    const url = new URL(base, window.location.origin).href;
    try { await navigator.clipboard.writeText(url); notifyDone(C.copied); }
    catch { setError(false); setMessage(C.copyFailed(url)); }
  }

  return <div className="space-y-6" aria-busy={busy}>
    <div className="flex items-start gap-2">
      {catalog.canCreate && !creating ? <Button type="button" className="min-h-11 min-w-0 flex-1 sm:min-h-9 sm:flex-none" onClick={() => setCreating(true)} data-testid="catalog-new-course">
        <Plus aria-hidden data-icon="inline-start" />{C.newCourse}
      </Button> : null}
      <ActionMenu label={C.more} className="ml-auto" items={[{ label: C.copyLink, onSelect: () => void copyLearningLink() }]} />
    </div>
    <AdminNotice message={message} error={error} />
    <AdminUnsavedNotice dirty={dirty} onDiscard={confirmDiscard} />
    {busy && <p role="status" className="text-sm text-muted-foreground">Operazione in corso. Attendi la conferma prima di lasciare la pagina.</p>}
    {catalog.programs.length ? <section aria-labelledby="corsi-titolo" className="space-y-3">
      <h2 id="corsi-titolo" className="text-base font-semibold">{C.courses(catalog.programs.length)}</h2>
      <RowList label={C.courses(catalog.programs.length)}>
        {catalog.programs.map(program => <li key={program.id}>
          <Row
            title={program.title}
            fact={[program.status === "published" ? C.open : C.closed, program.featureEnabled ? C.visible : C.hidden, program.canManageAll ? null : C.someLessons].filter(Boolean).join(" · ")}
            href={`${base}/${program.id}/admin`}
            data-row="catalog-course"
          />
        </li>)}
      </RowList>
    </section> : <p className="text-sm text-muted-foreground">{catalog.canCreate ? C.emptyCreate : C.emptyAsk}</p>}
    <RowList label={C.register}>
      <li><Row leading={<BookOpenCheck aria-hidden className="size-4 text-muted-foreground" />} title={C.register} fact={C.registerFact} href={`${base}/register`} data-row="catalog-register" /></li>
    </RowList>
    {catalog.canCreate && creating && <AdminSection title={C.newCourse}>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground"><li>{C.step1}</li><li>{C.step2}</li><li>{C.step3}</li></ol>
      <form onSubmit={inspect} className="space-y-3">
        <fieldset disabled={busy} className="space-y-3">
          <Label htmlFor="learning-pack">{C.packLabel}</Label>
          <Input ref={fileInput} id="learning-pack" type="file" className="text-base sm:text-sm" disabled={!!packSummary} accept=".json,application/json" required onChange={event => { privatePack.current = null; setPackSummary(null); setConfirmed(false); setDirty(!!event.target.files?.length); }} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="outline" className="min-h-11 sm:min-h-9" disabled={!!packSummary}>{C.check}</Button>
            {!packSummary && !dirty && <Button type="button" variant="ghost" className="min-h-11 sm:min-h-9" onClick={() => setCreating(false)}>{C.cancel}</Button>}
          </div>
          {packSummary && <p className="text-sm text-muted-foreground">Per scegliere un altro file, scarta prima le modifiche non salvate.</p>}
        </fieldset>
      </form>
      {packSummary && <div className="space-y-4 border-t pt-4">
        <div className="space-y-2 rounded-lg bg-muted/40 p-4"><h3 className="font-medium">{C.summary}</h3><p className="text-sm">{packSummary.modules.length} moduli · {packSummary.sessionCount} lezioni · {packSummary.activityCount} esercizi · {packSummary.itemCount} domande</p>
          <ul className="space-y-3 text-sm">{packSummary.modules.map(module => <li key={module.id}><strong>{module.title}</strong><ul>{module.sessions.map(session => <li key={session.cohortId}>{adminDate(session.startsAt)} – {adminDate(session.endsAt)}</li>)}</ul></li>)}</ul>
        </div>
        <form ref={form} onSubmit={importPack} onChange={() => setDirty(true)}>
          <fieldset disabled={busy} className="space-y-4">
            <div className="space-y-2"><Label htmlFor="new-course-title">Nome del corso</Label><Input id="new-course-title" name="title" className="text-base sm:text-sm" maxLength={250} required /></div>
            <div className="space-y-2"><Label htmlFor="new-course-policy">Informativa visibile ai partecipanti</Label><Textarea id="new-course-policy" name="visibilityPolicy" className="text-base sm:text-sm" minLength={20} maxLength={10000} rows={4} required placeholder="Indica chi può consultare i risultati e a chi rivolgersi per il corso." /></div>
            <div className="space-y-2"><Label htmlFor="new-course-retention">Giorni di conservazione dopo la chiusura</Label><Input id="new-course-retention" name="retentionDays" className="text-base sm:text-sm" type="number" min={1} max={3650} defaultValue={90} required /><p className="text-sm text-muted-foreground">Scegli il periodo concordato per questo corso. La cancellazione richiederà una conferma separata dopo la scadenza.</p></div>
            <label className="flex items-start gap-3 text-sm"><input className="mt-1 size-4" type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} required /><span>Ho verificato versione, date e informativa. Confermo l’importazione in questo workspace.</span></label>
            <Button type="submit" className="min-h-11 sm:min-h-9" disabled={!confirmed}>{C.import}</Button>
          </fieldset>
        </form>
      </div>}
    </AdminSection>}
    <p className="text-sm"><Link className="underline underline-offset-4" href={`/dashboard/${workspaceId}/settings`}>Membri e inviti del workspace</Link> · {LEARNING_TEXT.manage.noEmail}</p>
  </div>;
}
