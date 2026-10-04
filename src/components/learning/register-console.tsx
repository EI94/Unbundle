"use client";

import { useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { TrainingRegister } from "@/lib/learning/register";
import { dateTime, longDate, sessionLabel, sessionStateLabel } from "@/lib/learning/register-format";
import { criteriaMap, italianAuthority, legalFramework, limits, notIncluded, presenceDefinition, privacyGuidance, REGISTER_LEGAL_VERIFIED_ON } from "@/lib/learning/register-legal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AdminNotice, AdminSection, AdminSelect } from "./admin-shared";

/**
 * Il registro della formazione IA, per l'amministratore. Prima la risposta
 * alla domanda che conta in un controllo — «siamo a posto?» — poi la copia da
 * consegnare, poi i dettagli.
 */

type ExportRow = { id: string; format: "pdf" | "xlsx"; sha256: string; sizeBytes: number; participantCount: number; companyDomain: string | null; generatedAt: string; generatedBy: string };
type Result = { ok: boolean; message?: string; match?: { id: string; format: string; generatedAt: string; generatedBy: string; participantCount: number; companyDomain: string | null } | null };

const sessionKey = (p: { programId: string; moduleId: string; cohortId: string }) => `${p.programId}|${p.moduleId}|${p.cohortId}`;

function Table({ head, children, label }: { head: string[]; children: ReactNode; label: string }) {
  return <div className="overflow-x-auto rounded-lg border">
    <table className="w-full min-w-[640px] text-left text-sm" aria-label={label}>
      <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground"><tr>{head.map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
      <tbody className="divide-y">{children}</tbody>
    </table>
  </div>;
}

function Check({ ok, title, children }: { ok: boolean | "info"; title: string; children?: ReactNode }) {
  const tone = ok === true ? "bg-emerald-600" : ok === "info" ? "bg-sky-600" : "bg-amber-500";
  return <li className="flex gap-3">
    <span aria-hidden className={`mt-1.5 size-2.5 shrink-0 rounded-full ${tone}`} />
    <div className="space-y-1"><p className="font-medium">{ok === true ? "✓ " : ""}{title}</p>{children && <div className="text-sm text-muted-foreground">{children}</div>}</div>
  </li>;
}

export function RegisterConsole({ workspaceId, userId, canEditSettings, register, exports }: {
  workspaceId: string; userId: string; canEditSettings: boolean; register: TrainingRegister; exports: ExportRow[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState({ message: "", error: false });
  const [lastExport, setLastExport] = useState<{ format: string; id: string; sha: string } | null>(null);
  const [company, setCompany] = useState("");
  const inFlight = useRef(false);
  const org = register.organization;
  const t = register.totals;
  const sessionByKey = useMemo(() => new Map(register.sessions.map((s) => [sessionKey(s), s])), [register.sessions]);

  async function call(body: Record<string, unknown>): Promise<Result> {
    const response = await fetch("/api/learning/register", {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, workspaceId, expectedUserId: userId }),
    });
    const result = (await response.json().catch(() => null)) as Result | null;
    return result ?? { ok: false, message: "Risposta non leggibile. Ricarica la pagina e controlla prima di riprovare." };
  }

  async function run(body: Record<string, unknown>, after?: () => void) {
    if (inFlight.current) return false;
    inFlight.current = true; setBusy(true); setNotice({ message: "", error: false });
    try {
      const result = await call(body);
      setNotice({ message: result.message ?? (result.ok ? "Fatto." : "Operazione non riuscita."), error: !result.ok });
      if (result.ok) { after?.(); router.refresh(); }
      return result.ok;
    } catch {
      setNotice({ message: "Connessione interrotta: l'operazione non è confermata. Ricarica la pagina e controlla prima di riprovare.", error: true });
      return false;
    } finally { inFlight.current = false; setBusy(false); }
  }

  async function download(format: "pdf" | "xlsx") {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setNotice({ message: "", error: false });
    try {
      const response = await fetch("/api/learning/register", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "export", format, domain: company || null, workspaceId, expectedUserId: userId }),
      });
      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as Result | null;
        setNotice({ message: result?.message ?? "Esportazione non riuscita. Riprova.", error: true });
        return;
      }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const encoded = /filename\*=UTF-8''([^;]+)/.exec(disposition)?.[1];
      const name = encoded ? decodeURIComponent(encoded) : `registro-formazione-ia.${format}`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setLastExport({ format, id: response.headers.get("x-register-export-id") ?? "", sha: response.headers.get("x-register-sha256") ?? "" });
      setNotice({ message: `${format === "pdf" ? "PDF" : "Excel"} scaricato. La piattaforma ne ha registrato codice e impronta.`, error: false });
      router.refresh();
    } catch {
      setNotice({ message: "Connessione interrotta durante l'esportazione. Riprova.", error: true });
    } finally { inFlight.current = false; setBusy(false); }
  }

  // ─── Stato del registro ───
  const multiCompany = register.companies.length > 1;
  const missingFields = [
    !multiCompany && !org.legalName && "ragione sociale",
    ...(multiCompany ? register.companies.filter((c) => !c.legalName).map((c) => `ragione sociale per @${c.domain}`) : []),
    !org.registerOwner && "referente del registro",
    !org.aiActRole && "ruolo ai sensi dell'AI Act",
    !org.aiSystems.length && "sistemi di IA in uso",
    !org.useContext && "contesto d'uso",
    !org.trainers && "docenti",
  ].filter(Boolean) as string[];
  const emptySessions = register.sessions.filter((s) => s.state === "senza_partecipanti");
  const lastHeldEnd = register.sessions.filter((s) => s.state === "svolta").map((s) => s.endsAt).sort().at(-1) ?? null;
  const lastCopy = exports[0] ?? null;
  const copyIsCurrent = Boolean(lastCopy && (!lastHeldEnd || lastCopy.generatedAt >= lastHeldEnd));

  return <div className="space-y-6" aria-busy={busy}>
    <p className="max-w-3xl">
      Il registro raccoglie da solo le prove della formazione sull&apos;IA svolta con {register.provider.name}: chi ha partecipato, quando, a quale
      contenuto, con quali materiali. Serve a mostrare, in caso di controllo, le misure adottate ai sensi dell&apos;art. 4 dell&apos;AI Act.
      Non contiene risposte né punteggi.
    </p>
    <AdminNotice message={notice.message} error={notice.error} />

    <AdminSection title="Stato del registro">
      <ul className="space-y-4">
        <Check ok={missingFields.length === 0} title={missingFields.length === 0 ? "Dati dell'azienda completi" : "Dati dell'azienda da completare"}>
          {missingFields.length > 0 && <p>Mancano: {missingFields.join(", ")}. <a className="underline underline-offset-4" href="#dati-azienda">Completa i dati</a> — servono due minuti e compaiono in ogni copia.</p>}
        </Check>
        <Check ok={t.sessionsHeld > 0 ? true : "info"} title={t.sessionsHeld > 0
          ? `${t.sessionsHeld} ${t.sessionsHeld === 1 ? "sessione svolta" : "sessioni svolte"}, ${t.peopleAttended} ${t.peopleAttended === 1 ? "persona ha partecipato" : "persone hanno partecipato"}`
          : "Nessuna sessione ancora svolta"}>
          {t.sessionsScheduled > 0 && <p>{t.sessionsScheduled} {t.sessionsScheduled === 1 ? "sessione in programma" : "sessioni in programma"}: entrano nel registro da sole, man mano che si svolgono.</p>}
        </Check>
        {t.undocumented > 0 && <Check ok={false} title={`${t.undocumented} ${t.undocumented === 1 ? "iscrizione" : "iscrizioni"} senza partecipazione documentata`}>
          <p>Persone iscritte a un turno concluso che non sono entrate dal link durante la lezione e non hanno consegnato esercitazioni: non sono contate fra chi ha partecipato. Se erano in aula, <a className="underline underline-offset-4" href="#presenze">registra la presenza</a>.</p>
        </Check>}
        {emptySessions.length > 0 && <Check ok={false} title={`${emptySessions.length === 1 ? "Un turno concluso" : `${emptySessions.length} turni conclusi`} senza partecipanti registrati`}>
          <p>{emptySessions.map((s) => `${s.moduleTitle}, ${sessionLabel(s)}`).join("; ")}. Se la lezione si è tenuta, <a className="underline underline-offset-4" href="#presenze">registra le presenze</a>.</p>
        </Check>}
        <Check ok={copyIsCurrent ? true : t.sessionsHeld > 0 ? false : "info"} title={lastCopy ? `Ultima copia esportata il ${dateTime(lastCopy.generatedAt)}` : "Nessuna copia esportata"}>
          {!copyIsCurrent && t.sessionsHeld > 0 && <p>Scarica una copia dopo ogni sessione e conservala con i documenti dell&apos;azienda: così la prova esiste anche fuori dalla piattaforma.</p>}
          {copyIsCurrent && <p>La copia è aggiornata all&apos;ultima sessione svolta.</p>}
        </Check>
      </ul>
    </AdminSection>

    <AdminSection title="Scarica il registro">
      <p className="text-sm">Il PDF è la copia da mostrare o stampare; l&apos;Excel la stessa cosa, da filtrare. Ogni copia riceve un codice e la piattaforma ne conserva l&apos;impronta: chiunque può verificare che non sia stata modificata.</p>
      {register.companies.length > 1 && <div className="max-w-md space-y-1">
        <Label htmlFor="register-company">Registro di</Label>
        <AdminSelect id="register-company" value={company} disabled={busy} onChange={(e) => setCompany(e.target.value)}>
          <option value="">Tutto il corso · {t.people} {t.people === 1 ? "persona" : "persone"}</option>
          {register.companies.map((c) => <option key={c.domain} value={c.domain}>{c.legalName ?? `@${c.domain}`} · {c.people} {c.people === 1 ? "persona" : "persone"}</option>)}
        </AdminSelect>
        <p className="text-xs text-muted-foreground">Il corso riunisce persone di più società: ognuna può avere il proprio registro, con la propria ragione sociale. La società si riconosce dal dominio dell&apos;email.</p>
      </div>}
      <div className="flex flex-wrap gap-3">
        <Button type="button" disabled={busy} onClick={() => download("pdf")}>{busy ? "Preparazione…" : "Scarica PDF"}</Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => download("xlsx")}>Scarica Excel</Button>
      </div>
      {lastExport && <dl className="grid gap-1 rounded-lg bg-muted/40 p-3 text-sm sm:grid-cols-[10rem_1fr]" data-testid="last-export">
        <dt className="text-muted-foreground">Codice</dt><dd className="break-all font-mono text-xs">{lastExport.id}</dd>
        <dt className="text-muted-foreground">Impronta SHA-256</dt><dd className="break-all font-mono text-xs">{lastExport.sha}</dd>
      </dl>}
    </AdminSection>

    <Participants register={register} sessionByKey={sessionByKey} busy={busy} run={run} />
    <ManualEntry register={register} busy={busy} run={run} />

    <AdminSection title={`Sessioni (${register.sessions.length})`}>
      {register.sessions.length === 0 ? <p className="text-sm text-muted-foreground">Nessuna sessione.</p> : <Table label="Sessioni" head={["Sessione", "Modulo", "Durata", "Stato", "Partecipanti", "Art. 4 in vigore"]}>
        {register.sessions.map((s) => <tr key={sessionKey(s)}>
          <td className="px-3 py-2">{sessionLabel(s)}</td>
          <td className="px-3 py-2">{s.moduleTitle}<span className="block text-xs text-muted-foreground">{s.programTitle}</span></td>
          <td className="px-3 py-2">{s.durationMinutes} min</td>
          <td className="px-3 py-2">{sessionStateLabel[s.state]}</td>
          <td className="px-3 py-2">{s.state === "in_programma" ? `${s.enrolled} iscritti` : s.participants + s.manualParticipants}
            {s.manualParticipants > 0 && <span className="block text-xs text-muted-foreground">di cui {s.manualParticipants} registrati dal formatore</span>}
            {s.undocumented > 0 && <span className="block text-xs text-amber-700 dark:text-amber-400">+ {s.undocumented} senza partecipazione documentata</span>}</td>
          <td className="px-3 py-2 text-xs">{s.article4 === "modificato" ? "Testo modificato (Reg. UE 2026/1744)" : "Testo originario"}</td>
        </tr>)}
      </Table>}
    </AdminSection>

    <CompanySettings register={register} canEdit={canEditSettings} busy={busy} run={run} />
    <Contents register={register} />
    <Copies exports={exports} busy={busy} call={call} />
    <LegalNotes />
  </div>;
}

type Run = (body: Record<string, unknown>, after?: () => void) => Promise<boolean>;

function Participants({ register, sessionByKey, busy, run }: {
  register: TrainingRegister; sessionByKey: Map<string, TrainingRegister["sessions"][number]>; busy: boolean; run: Run;
}) {
  const [filter, setFilter] = useState("");
  const [query, setQuery] = useState("");
  const [voiding, setVoiding] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const needle = query.trim().toLowerCase();
  const shown = register.participants.filter((p) => (!filter || sessionKey(p) === filter)
    && (!needle || p.name.toLowerCase().includes(needle) || (p.email ?? "").toLowerCase().includes(needle)));
  return <AdminSection title={`Partecipanti (${register.participants.length})`}>
    {register.participants.length === 0 ? <p className="text-sm text-muted-foreground">Ancora nessun partecipante. Chi entra dal link del turno compare qui da solo.</p> : <>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1"><Label htmlFor="register-search">Cerca</Label><Input id="register-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nome o email" /></div>
        <div className="space-y-1"><Label htmlFor="register-session">Sessione</Label>
          <AdminSelect id="register-session" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">Tutte le sessioni</option>
            {register.sessions.map((s) => <option key={sessionKey(s)} value={sessionKey(s)}>{s.moduleTitle} · {sessionLabel(s)}</option>)}
          </AdminSelect>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">«Esercitazioni» conta le esercitazioni consegnate sul totale richiesto dal modulo, non il loro esito. {presenceDefinition}</p>
      <Table label="Partecipanti" head={["Partecipante", "Sessione", "Accesso", "Esercitazioni", "Stato"]}>
        {shown.map((p) => {
          const s = sessionByKey.get(sessionKey(p));
          return <tr key={p.key} className="align-top">
            <td className="px-3 py-2"><span className="font-medium">{p.name}</span>{p.email && <span className="block break-all text-xs text-muted-foreground">{p.email}</span>}</td>
            <td className="px-3 py-2">{p.moduleTitle}{s && <span className="block text-xs text-muted-foreground">{sessionLabel(s)}</span>}</td>
            <td className="px-3 py-2">{p.joinedAt ? <>{dateTime(p.joinedAt)}<span className="block text-xs text-muted-foreground">{p.joinLabel}</span></> : p.source === "registrazione_manuale"
              ? <>Registrata il {dateTime(p.recordedAt)}<span className="block text-xs text-muted-foreground">da {p.recordedBy}</span></> : <span className="text-muted-foreground">{p.joinLabel}</span>}</td>
            <td className="px-3 py-2">{p.source === "registrazione_manuale" ? "—" : `${p.submitted} di ${p.required}`}</td>
            <td className="px-3 py-2">
              {p.statusLabel}{p.manualNote && <span className="block text-xs text-muted-foreground">Nota: {p.manualNote}</span>}
              {p.manualEntryId && (voiding === p.manualEntryId ? <form className="mt-2 space-y-2" onSubmit={async (e: FormEvent) => {
                e.preventDefault();
                await run({ operation: "voidManualEntry", entryId: p.manualEntryId, reason }, () => { setVoiding(null); setReason(""); });
              }}>
                <Label htmlFor={`void-${p.manualEntryId}`} className="text-xs">Motivo dell&apos;annullamento</Label>
                <Input id={`void-${p.manualEntryId}`} value={reason} maxLength={500} required minLength={3} onChange={(e) => setReason(e.target.value)} placeholder="Es. nome scritto male" autoFocus />
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" size="sm" variant="destructive" disabled={busy || reason.trim().length < 3}>Annulla presenza</Button>
                  <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { setVoiding(null); setReason(""); }}>Indietro</Button>
                </div>
                <p className="text-xs text-muted-foreground">L&apos;annullamento non si può revocare e resta visibile fra le correzioni.</p>
              </form> : <Button type="button" size="sm" variant="ghost" className="mt-1 h-auto px-0 text-xs underline" disabled={busy} onClick={() => { setVoiding(p.manualEntryId); setReason(""); }}>Annulla questa presenza</Button>)}
            </td>
          </tr>;
        })}
        {shown.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-center text-muted-foreground">Nessun partecipante corrisponde ai filtri.</td></tr>}
      </Table>
      {register.corrections.length > 0 && <details className="text-sm">
        <summary className="cursor-pointer">Correzioni ({register.corrections.length})</summary>
        <ul className="mt-2 space-y-2">{register.corrections.map((c) => <li key={c.id} className="rounded-lg border p-3">
          <span className="font-medium">{c.personName}</span> · {c.moduleTitle} — registrata il {dateTime(c.recordedAt)} da {c.recordedBy}, annullata il {dateTime(c.voidedAt)} da {c.voidedBy}. Motivo: {c.voidReason}
        </li>)}</ul>
      </details>}
    </>}
  </AdminSection>;
}

function ManualEntry({ register, busy, run }: { register: TrainingRegister; busy: boolean; run: Run }) {
  const sessions = register.sessions;
  const [session, setSession] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const target = sessions.find((s) => sessionKey(s) === session);
  if (!sessions.length) return null;
  return <section id="presenze" className="scroll-mt-6"><AdminSection title="Registra una presenza">
    <p className="text-sm">Per chi era in aula ma non è entrato dal link: telefono scarico, nessun account, un collaboratore esterno. Chi è entrato dal link compare da solo. Una presenza registrata non si modifica: si annulla, con il motivo.</p>
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      if (!target) return;
      await run({ operation: "addManualEntry", entry: { programId: target.programId, moduleId: target.moduleId, cohortId: target.cohortId, personName: name, personEmail: email.trim(), note } },
        () => { setName(""); setEmail(""); setNote(""); });
    }}>
      <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1 sm:col-span-2"><Label htmlFor="manual-session">Sessione</Label>
          <AdminSelect id="manual-session" value={session} required onChange={(e) => setSession(e.target.value)}>
            <option value="">Scegli la sessione</option>
            {sessions.map((s) => <option key={sessionKey(s)} value={sessionKey(s)}>{s.moduleTitle} · {sessionLabel(s)}</option>)}
          </AdminSelect>
        </div>
        <div className="space-y-1"><Label htmlFor="manual-name">Nome e cognome</Label><Input id="manual-name" value={name} required minLength={2} maxLength={200} onChange={(e) => setName(e.target.value)} autoComplete="off" /></div>
        <div className="space-y-1"><Label htmlFor="manual-email">Email (facoltativa)</Label><Input id="manual-email" type="email" value={email} maxLength={254} onChange={(e) => setEmail(e.target.value)} autoComplete="off" /></div>
        <div className="space-y-1 sm:col-span-2"><Label htmlFor="manual-note">Nota (facoltativa)</Label><Input id="manual-note" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder="Es. presente in aula, foglio firme del 5 ottobre" /></div>
        <div className="sm:col-span-2"><Button type="submit" disabled={!target || name.trim().length < 2}>Registra presenza</Button></div>
      </fieldset>
    </form>
  </AdminSection></section>;
}

function CompanySettings({ register, canEdit, busy, run }: { register: TrainingRegister; canEdit: boolean; busy: boolean; run: Run }) {
  const org = register.organization;
  const [legalName, setLegalName] = useState(org.legalName ?? "");
  const [owner, setOwner] = useState(org.registerOwner ?? "");
  const [role, setRole] = useState<string>(org.aiActRole ?? "");
  const [systems, setSystems] = useState(org.aiSystems.join("\n"));
  const [context, setContext] = useState(org.useContext ?? "");
  const [trainers, setTrainers] = useState(org.trainers ?? "");
  const [other, setOther] = useState(org.otherInitiatives ?? "");
  const domains = [...new Set([...register.companies.map((c) => c.domain), ...Object.keys(org.companyNames)])];
  const [companyNames, setCompanyNames] = useState<Record<string, string>>(org.companyNames);
  const list = systems.split("\n").map((s) => s.trim()).filter(Boolean);
  return <section id="dati-azienda" className="scroll-mt-6"><AdminSection title="Dati dell'azienda">
    <p className="text-sm">Quello che la piattaforma non può sapere da sola. L&apos;art. 4 chiede misure che tengano conto del contesto in cui l&apos;IA è usata e delle persone su cui incide: scriverlo qui lo rende visibile in ogni copia, marcato come dichiarato dall&apos;azienda.</p>
    {!canEdit && <p className="text-sm text-muted-foreground">Solo chi amministra il workspace modifica questi dati.</p>}
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      await run({ operation: "saveSettings", settings: { organizationLegalName: legalName, registerOwner: owner, aiActRole: role || null, aiSystems: list, useContext: context, trainers, companyNames, otherInitiatives: other } });
    }}>
      <fieldset disabled={busy || !canEdit} className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1"><Label htmlFor="reg-legal">{domains.length > 1 ? "Ragione sociale (registro completo)" : "Ragione sociale"}</Label><Input id="reg-legal" value={legalName} maxLength={300} onChange={(e) => setLegalName(e.target.value)} placeholder={domains.length > 1 ? "Es. Gruppo Esempio" : org.workspaceName} /></div>
        <div className="space-y-1"><Label htmlFor="reg-owner">Referente del registro</Label><Input id="reg-owner" value={owner} maxLength={300} onChange={(e) => setOwner(e.target.value)} placeholder="Nome, ruolo" /></div>
        <div className="space-y-1"><Label htmlFor="reg-role">Ruolo ai sensi dell&apos;AI Act</Label>
          <AdminSelect id="reg-role" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">Da indicare</option>
            <option value="deployer">Deployer: utilizza sistemi di IA</option>
            <option value="provider">Fornitore: sviluppa o immette sistemi di IA</option>
            <option value="both">Deployer e fornitore</option>
          </AdminSelect>
          <p className="text-xs text-muted-foreground">Lo dichiara l&apos;azienda. Chi usa strumenti come Copilot o ChatGPT nel lavoro è di norma deployer.</p>
        </div>
        {domains.length > 1 && <div className="space-y-2 rounded-lg border p-3 sm:col-span-2">
          <p className="text-sm font-medium">Ragione sociale di ogni società</p>
          <p className="text-xs text-muted-foreground">Compare in testa al registro di quella società.</p>
          <div className="grid gap-3 sm:grid-cols-2">{domains.map((d) => <div key={d} className="space-y-1">
            <Label htmlFor={`reg-company-${d}`}>Email @{d}</Label>
            <Input id={`reg-company-${d}`} value={companyNames[d] ?? ""} maxLength={300} placeholder="Ragione sociale"
              onChange={(e) => setCompanyNames((names) => ({ ...names, [d]: e.target.value }))} />
          </div>)}</div>
        </div>}
        <div className="space-y-1"><Label htmlFor="reg-systems">Sistemi di IA in uso</Label>
          <Textarea id="reg-systems" rows={4} value={systems} onChange={(e) => setSystems(e.target.value)} placeholder={"Uno per riga, es.\nClaude (Anthropic) — bozze e analisi di documenti — rischio limitato\nMicrosoft 365 Copilot — email e riunioni — rischio limitato"} />
          <p className="text-xs text-muted-foreground">Uno per riga, fino a 30: nome, fornitore, a cosa serve, livello di rischio secondo l&apos;azienda.</p>
        </div>
        <div className="space-y-1"><Label htmlFor="reg-context">Contesto d&apos;uso e persone interessate</Label>
          <Textarea id="reg-context" rows={4} value={context} maxLength={4000} onChange={(e) => setContext(e.target.value)} placeholder="Es. uffici commerciali e operativi, per bozze di email e analisi di documenti interni; nessuna decisione automatizzata su clienti o dipendenti." />
        </div>
        <div className="space-y-1"><Label htmlFor="reg-trainers">Docenti e qualifica</Label>
          <Textarea id="reg-trainers" rows={3} value={trainers} maxLength={2000} onChange={(e) => setTrainers(e.target.value)} placeholder={`Es. Nome Cognome, ${register.provider.name} — consulente AI`} />
        </div>
        <div className="space-y-1"><Label htmlFor="reg-other">Altre iniziative di alfabetizzazione (facoltativo)</Label>
          <Textarea id="reg-other" rows={3} value={other} maxLength={4000} onChange={(e) => setOther(e.target.value)} placeholder="Es. policy interna sull'uso dell'IA del 1° settembre 2026, comunicata a tutto il personale." />
        </div>
        {canEdit && <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={list.length > 30}>Salva dati dell&apos;azienda</Button>
          {org.settingsUpdatedAt && <span className="text-xs text-muted-foreground">Ultima modifica {dateTime(org.settingsUpdatedAt)} · {org.settingsUpdatedBy}</span>}
        </div>}
      </fieldset>
    </form>
  </AdminSection></section>;
}

function Contents({ register }: { register: TrainingRegister }) {
  return <AdminSection title="Contenuti e materiali">
    {register.programs.length === 0 && <p className="text-sm text-muted-foreground">Nessun percorso pubblicato.</p>}
    {register.programs.map((program) => <div key={program.id} className="space-y-3">
      <div><h3 className="font-semibold">{program.title}</h3>
        <p className="text-sm text-muted-foreground">Versione {program.contentVersion} · pubblicato il {longDate(program.publishedAt)}</p>
        <p className="break-all font-mono text-xs text-muted-foreground">Impronta del contenuto: {program.packHash}</p></div>
      <ul className="space-y-2">{program.modules.map((m) => <li key={m.id} className="rounded-lg border p-3 text-sm">
        <p className="font-medium">{m.title}{m.subtitle ? ` — ${m.subtitle}` : ""}</p>
        {m.objective && <p>{m.objective}</p>}
        <p className="text-muted-foreground">{[m.durationMinutes ? `${m.durationMinutes} minuti` : null, m.competencies.length ? `Competenze: ${m.competencies.join(", ")}` : null, m.exercises.length ? `${m.exercises.length} esercitazioni` : null].filter(Boolean).join(" · ")}</p>
      </li>)}</ul>
      {program.materials.length > 0 && <Table label={`Materiali di ${program.title}`} head={["Materiale", "File", "Per", "Impronta SHA-256"]}>
        {program.materials.map((mat) => <tr key={mat.sha256 + mat.fileName}>
          <td className="px-3 py-2">{mat.title}</td><td className="px-3 py-2">{mat.fileName}</td>
          <td className="px-3 py-2">{mat.audience === "trainers" ? "Solo formatori" : "Partecipanti"}</td>
          <td className="break-all px-3 py-2 font-mono text-xs">{mat.sha256}</td>
        </tr>)}
      </Table>}
    </div>)}
    {register.needsAssessments.length > 0 && <div className="space-y-1 text-sm">
      <h3 className="font-semibold">Rilevazione dei bisogni</h3>
      {register.needsAssessments.map((a) => <p key={a.name + a.createdAt}>{a.name} — avviata il {longDate(a.createdAt)}, {a.completed} {a.completed === 1 ? "risposta completa" : "risposte complete"}. Nel registro compare solo il numero.</p>)}
    </div>}
  </AdminSection>;
}

async function sha256Hex(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function Copies({ exports, busy, call }: { exports: ExportRow[]; busy: boolean; call: (body: Record<string, unknown>) => Promise<Result> }) {
  const [verdict, setVerdict] = useState<{ ok: boolean; text: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  async function verify(file: File | null) {
    setVerdict(null);
    if (!file) return;
    setChecking(true);
    try {
      const sha = await sha256Hex(file);
      const result = await call({ operation: "verify", sha256: sha });
      if (!result.ok) setVerdict({ ok: false, text: result.message ?? "Verifica non riuscita. Riprova." });
      else if (result.match) setVerdict({ ok: true, text: `Copia autentica: è il ${result.match.format === "pdf" ? "PDF" : "file Excel"}${result.match.companyDomain ? ` della società @${result.match.companyDomain}` : ""} esportato il ${dateTime(result.match.generatedAt)} da ${result.match.generatedBy} (codice ${result.match.id}). Non è stato modificato.` });
      else setVerdict({ ok: false, text: `Nessuna copia esportata da questo workspace ha questa impronta (${sha.slice(0, 16)}…). Il file è stato modificato dopo l'esportazione, oppure non viene da qui.` });
    } catch {
      setVerdict({ ok: false, text: "Non è stato possibile leggere il file. Riprova." });
    } finally {
      setChecking(false);
      if (input.current) input.current.value = "";
    }
  }
  return <AdminSection title="Copie esportate e verifica">
    <div className="space-y-2">
      <Label htmlFor="register-verify">Verifica un file</Label>
      <Input id="register-verify" ref={input} type="file" accept=".pdf,.xlsx" disabled={busy || checking} onChange={(e) => verify(e.target.files?.[0] ?? null)} />
      <p className="text-xs text-muted-foreground">Il file non viene caricato: il browser ne calcola l&apos;impronta e la confronta con le copie esportate.</p>
      <div aria-live="polite">{checking ? <p className="text-sm" role="status">Verifica in corso…</p> : verdict && <p role="status" className={`rounded-lg border p-3 text-sm ${verdict.ok ? "border-emerald-600/40" : "border-amber-500/60"}`}>{verdict.text}</p>}</div>
    </div>
    {exports.length === 0 ? <p className="text-sm text-muted-foreground">Nessuna copia esportata finora.</p> : <Table label="Copie esportate" head={["Data", "Copia", "Da", "Partecipanti", "Impronta SHA-256"]}>
      {exports.map((e) => <tr key={e.id}>
        <td className="px-3 py-2">{dateTime(e.generatedAt)}</td><td className="px-3 py-2">{e.format === "pdf" ? "PDF" : "Excel"}<span className="block text-xs text-muted-foreground">{e.companyDomain ? `@${e.companyDomain}` : "Tutto il corso"}</span></td>
        <td className="px-3 py-2">{e.generatedBy}</td><td className="px-3 py-2">{e.participantCount}</td>
        <td className="break-all px-3 py-2 font-mono text-xs" title={`Codice ${e.id}`}>{e.sha256}</td>
      </tr>)}
    </Table>}
  </AdminSection>;
}

function LegalNotes() {
  return <AdminSection title="Riferimenti normativi">
    <div className="space-y-3 text-sm">
      {legalFramework.map((p) => <p key={p}>{p}</p>)}
      <dl className="grid gap-2 sm:grid-cols-[14rem_1fr]">{criteriaMap.map(([k, v]) => <div key={k} className="contents"><dt className="font-medium">{k}</dt><dd className="text-muted-foreground">{v}</dd></div>)}</dl>
      {notIncluded.map((p) => <p key={p} className="text-muted-foreground">{p}</p>)}
      {limits.map((p) => <p key={p} className="text-muted-foreground">{p}</p>)}
      <p className="text-muted-foreground">{italianAuthority}</p>
      <h3 className="pt-2 font-semibold">Privacy: cosa spetta all&apos;azienda</h3>
      <dl className="grid gap-2 sm:grid-cols-[14rem_1fr]">{privacyGuidance.map(([k, v]) => <div key={k} className="contents"><dt className="font-medium">{k}</dt><dd className="text-muted-foreground">{v}</dd></div>)}</dl>
      <p className="text-xs text-muted-foreground">Indicazioni di buona pratica, non parere legale. Quadro normativo verificato su fonti ufficiali UE e italiane il {longDate(`${REGISTER_LEGAL_VERIFIED_ON}T12:00:00Z`)}.</p>
    </div>
  </AdminSection>;
}
