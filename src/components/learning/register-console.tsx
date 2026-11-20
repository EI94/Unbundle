"use client";

import { useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";
import type { TrainingRegister } from "@/lib/learning/register";
import { dateTime, longDate, sessionLabel, sessionStateLabel } from "@/lib/learning/register-format";
import { criteriaMap, italianAuthority, legalFramework, limits, notIncluded, presenceDefinition, privacyGuidance, REGISTER_LEGAL_VERIFIED_ON } from "@/lib/learning/register-legal";
import { missingCompanyFields, registerFacts, registerStatus } from "@/lib/learning/register-view";
import { LEARNING_TEXT } from "@/lib/learning/text";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusDot } from "@/components/uc/ui/status-dot";
import { Fold } from "@/components/ui-10/fold";
import { AdminNotice, AdminSelect } from "./admin-shared";

const G = LEARNING_TEXT.register;

/**
 * Il «Registro della formazione AI», per chi amministra il workspace o gestisce un corso (rilascio 10, ondata 7a,
 * docs/ui-10/PROPOSTA-10.md §3.9, audit Fuori §4.13). Prima la risposta alla domanda che conta in un controllo —
 * «siamo a posto?» — in una frase («In ordine», oppure che cosa manca, con il link per sistemarlo); poi la copia da
 * consegnare, «Scarica PDF» il solo pulsante pieno, con Excel come link; poi righe chiuse: Partecipanti, Registra una
 * presenza, Lezioni, Dati dell'azienda (aperta da sola se mancano dati), Contenuti, Verifica una copia (con «Mostra
 * impronta»), Cosa dice la norma. Le operazioni, il contenuto del registro, il PDF, l'Excel e la loro norma non
 * cambiano; la norma sulla pagina sta tutta nella sua piega.
 */

type ExportRow = { id: string; format: "pdf" | "xlsx"; sha256: string; sizeBytes: number; participantCount: number; companyDomain: string | null; generatedAt: string; generatedBy: string };
type Result = { ok: boolean; message?: string; match?: { id: string; format: string; generatedAt: string; generatedBy: string; participantCount: number; companyDomain: string | null } | null };

const sessionKey = (p: { programId: string; moduleId: string; cohortId: string }) => `${p.programId}|${p.moduleId}|${p.cohortId}`;
const linkAction = "inline-flex min-h-11 items-center text-sm font-medium underline decoration-foreground/40 underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 sm:min-h-9";

export function RegisterConsole({ workspaceId, userId, canEditSettings, register, exports }: {
  workspaceId: string; userId: string; canEditSettings: boolean; register: TrainingRegister; exports: ExportRow[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState({ message: "", error: false });
  const [lastExport, setLastExport] = useState<{ format: string; id: string; sha: string } | null>(null);
  const [company, setCompany] = useState("");
  const inFlight = useRef(false);
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
      setNotice({ message: G.downloaded(format), error: false });
      router.refresh();
    } catch {
      setNotice({ message: "Connessione interrotta durante l'esportazione. Riprova.", error: true });
    } finally { inFlight.current = false; setBusy(false); }
  }

  const lastCopy = exports[0] ?? null;
  const status = registerStatus(register, lastCopy?.generatedAt ?? null);
  const facts = registerFacts(register, lastCopy ? dateTime(lastCopy.generatedAt) : null);
  const missing = missingCompanyFields(register).length > 0;

  return <div className="space-y-6" aria-busy={busy}>
    <section aria-label={G.title} data-testid="register-status" className="space-y-1">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-base">
        <StatusDot tone={status.tone} label={status.sentence} size="md" />
        {status.fix ? <a className={linkAction} href={`#${status.fix}`}>{G.fix}</a> : null}
      </p>
      {facts ? <p className="text-sm text-muted-foreground">{facts}</p> : null}
    </section>
    <AdminNotice message={notice.message} error={notice.error} />

    <section aria-label={G.pdf} className="space-y-3">
      {register.companies.length > 1 && <div className="max-w-md space-y-1">
        <Label htmlFor="register-company">{G.company}</Label>
        <AdminSelect id="register-company" value={company} disabled={busy} onChange={(e) => setCompany(e.target.value)}>
          <option value="">{G.allCourse(t.people)}</option>
          {register.companies.map((c) => <option key={c.domain} value={c.domain}>{c.legalName ?? `@${c.domain}`} · {c.people} {c.people === 1 ? "persona" : "persone"}</option>)}
        </AdminSelect>
        <p className="text-sm text-muted-foreground">{G.companyHint}</p>
      </div>}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button type="button" className="min-h-11 w-full sm:min-h-9 sm:w-auto" disabled={busy} onClick={() => download("pdf")} data-testid="register-pdf">
          <Download aria-hidden data-icon="inline-start" />{busy ? G.preparing : G.pdf}
        </Button>
        <button type="button" className={linkAction} disabled={busy} onClick={() => download("xlsx")} data-testid="register-excel">{G.excel}</button>
      </div>
      {lastExport && <details className="text-sm" data-testid="last-export">
        <summary className="min-h-11 cursor-pointer py-2 sm:min-h-9">{G.fingerprint}</summary>
        <dl className="grid gap-1 rounded-lg bg-muted/40 p-3 sm:grid-cols-[8rem_1fr]">
          <dt className="text-muted-foreground">{G.code}</dt><dd className="break-all font-mono text-xs">{lastExport.id}</dd>
          <dt className="text-muted-foreground">{G.fingerprintLabel}</dt><dd className="break-all font-mono text-xs">{lastExport.sha}</dd>
        </dl>
      </details>}
    </section>

    <div>
      <Participants register={register} sessionByKey={sessionByKey} busy={busy} run={run} />
      <ManualEntry register={register} busy={busy} run={run} />
      <Lessons register={register} />
      <CompanySettings register={register} canEdit={canEditSettings} busy={busy} run={run} open={missing} />
      <Contents register={register} />
      <Copies exports={exports} busy={busy} call={call} />
      <LegalNotes />
    </div>
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
  return <Fold id="partecipanti" title={G.participants(register.participants.length)}>
    {register.participants.length === 0 ? <p className="text-sm text-muted-foreground">{G.noParticipants}</p> : <>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1"><Label htmlFor="register-search">{G.search}</Label><Input id="register-search" className="text-base sm:text-sm" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={G.searchHint} /></div>
        <div className="space-y-1"><Label htmlFor="register-session">{G.lessonFilter}</Label>
          <AdminSelect id="register-session" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">{G.allLessons}</option>
            {register.sessions.map((s) => <option key={sessionKey(s)} value={sessionKey(s)}>{s.moduleTitle} · {sessionLabel(s)}</option>)}
          </AdminSelect>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">«Esercitazioni» conta le esercitazioni consegnate sul totale richiesto dal modulo, non il loro esito. {presenceDefinition}</p>
      <ul aria-label={G.participants(register.participants.length)} className="divide-y rounded-xl border">
        {shown.map((p) => {
          const s = sessionByKey.get(sessionKey(p));
          return <li key={p.key} className="grid gap-1 p-3 text-sm sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)] sm:gap-4">
            <div className="min-w-0"><p className="font-medium break-words">{p.name}</p>{p.email && <p className="break-all text-muted-foreground">{p.email}</p>}</div>
            <div className="min-w-0 text-muted-foreground">
              <p>{p.moduleTitle}{s ? ` · ${sessionLabel(s)}` : ""}</p>
              <p>{p.joinedAt ? `${dateTime(p.joinedAt)} · ${p.joinLabel}` : p.source === "registrazione_manuale" ? `Registrata il ${dateTime(p.recordedAt)} da ${p.recordedBy}` : p.joinLabel}</p>
            </div>
            <div className="min-w-0 space-y-1">
              <p className="font-medium">{p.statusLabel}</p>
              {p.source !== "registrazione_manuale" && <p className="text-muted-foreground">{G.exercises(p.submitted, p.required)}</p>}
              {p.manualNote && <p className="text-muted-foreground">Nota: {p.manualNote}</p>}
              {p.manualEntryId && (voiding === p.manualEntryId ? <form className="space-y-2 pt-1" onSubmit={async (e: FormEvent) => {
                e.preventDefault();
                await run({ operation: "voidManualEntry", entryId: p.manualEntryId, reason }, () => { setVoiding(null); setReason(""); });
              }}>
                <Label htmlFor={`void-${p.manualEntryId}`}>{G.voidReason}</Label>
                <Input id={`void-${p.manualEntryId}`} className="text-base sm:text-sm" value={reason} maxLength={500} required minLength={3} onChange={(e) => setReason(e.target.value)} placeholder={G.voidReasonHint} autoFocus />
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" variant="destructive" className="min-h-11 sm:min-h-9" disabled={busy || reason.trim().length < 3}>{G.voidConfirm}</Button>
                  <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" disabled={busy} onClick={() => { setVoiding(null); setReason(""); }}>{G.voidBack}</Button>
                </div>
                <p className="text-muted-foreground">{G.voidNote}</p>
              </form> : <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" disabled={busy} onClick={() => { setVoiding(p.manualEntryId); setReason(""); }}>{G.voidEntry}</Button>)}
            </div>
          </li>;
        })}
        {shown.length === 0 && <li className="p-3 text-center text-sm text-muted-foreground">{G.noMatch}</li>}
      </ul>
      {register.corrections.length > 0 && <details className="text-sm">
        <summary className="min-h-11 cursor-pointer py-2 sm:min-h-9">{G.corrections(register.corrections.length)}</summary>
        <ul className="mt-2 space-y-2">{register.corrections.map((c) => <li key={c.id} className="rounded-lg border p-3">
          <span className="font-medium">{c.personName}</span> · {c.moduleTitle} — registrata il {dateTime(c.recordedAt)} da {c.recordedBy}, annullata il {dateTime(c.voidedAt)} da {c.voidedBy}. Motivo: {c.voidReason}
        </li>)}</ul>
      </details>}
    </>}
  </Fold>;
}

function ManualEntry({ register, busy, run }: { register: TrainingRegister; busy: boolean; run: Run }) {
  const sessions = register.sessions;
  const [session, setSession] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const target = sessions.find((s) => sessionKey(s) === session);
  if (!sessions.length) return null;
  return <Fold id="presenze" title={G.record}>
    <p className="text-sm">{G.recordIntro}</p>
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      if (!target) return;
      await run({ operation: "addManualEntry", entry: { programId: target.programId, moduleId: target.moduleId, cohortId: target.cohortId, personName: name, personEmail: email.trim(), note } },
        () => { setName(""); setEmail(""); setNote(""); });
    }}>
      <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1 sm:col-span-2"><Label htmlFor="manual-session">{G.recordLesson}</Label>
          <AdminSelect id="manual-session" value={session} required onChange={(e) => setSession(e.target.value)}>
            <option value="">{G.recordChoose}</option>
            {sessions.map((s) => <option key={sessionKey(s)} value={sessionKey(s)}>{s.moduleTitle} · {sessionLabel(s)}</option>)}
          </AdminSelect>
        </div>
        <div className="space-y-1"><Label htmlFor="manual-name">{G.recordName}</Label><Input id="manual-name" className="text-base sm:text-sm" value={name} required minLength={2} maxLength={200} onChange={(e) => setName(e.target.value)} autoComplete="off" /></div>
        <div className="space-y-1"><Label htmlFor="manual-email">{G.recordEmail}</Label><Input id="manual-email" className="text-base sm:text-sm" type="email" value={email} maxLength={254} onChange={(e) => setEmail(e.target.value)} autoComplete="off" /></div>
        <div className="space-y-1 sm:col-span-2"><Label htmlFor="manual-note">{G.recordNote}</Label><Input id="manual-note" className="text-base sm:text-sm" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder={G.recordNoteHint} /></div>
        <div className="sm:col-span-2"><Button type="submit" variant="outline" className="min-h-11 sm:min-h-9" disabled={!target || name.trim().length < 2}>{G.recordSubmit}</Button></div>
      </fieldset>
    </form>
  </Fold>;
}

function Lessons({ register }: { register: TrainingRegister }) {
  if (!register.sessions.length) return null;
  return <Fold id="lezioni" title={G.lessons(register.sessions.length)}>
    <ul aria-label={G.lessons(register.sessions.length)} className="divide-y rounded-xl border">
      {register.sessions.map((s) => <li key={sessionKey(s)} className="grid gap-1 p-3 text-sm sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)] sm:gap-4">
        <div className="min-w-0"><p className="font-medium">{sessionLabel(s)}</p><p className="text-muted-foreground">{s.moduleTitle} · {s.programTitle} · {s.durationMinutes} min</p></div>
        <div className="min-w-0">
          <p>{sessionStateLabel[s.state]}</p>
          <p className="text-muted-foreground">{s.state === "in_programma" ? `${s.enrolled} iscritti` : `${s.participants + s.manualParticipants} partecipanti`}</p>
          {s.manualParticipants > 0 && <span className="block text-xs text-muted-foreground">di cui {s.manualParticipants} registrati dal formatore</span>}
          {s.undocumented > 0 && <span className="block text-xs text-uc-giallo">+ {s.undocumented} senza partecipazione documentata</span>}
        </div>
        <p className="min-w-0 text-xs text-muted-foreground">Art. 4 in vigore: {s.article4 === "modificato" ? "Testo modificato (Reg. UE 2026/1744)" : "Testo originario"}</p>
      </li>)}
    </ul>
  </Fold>;
}

function CompanySettings({ register, canEdit, busy, run, open }: { register: TrainingRegister; canEdit: boolean; busy: boolean; run: Run; open: boolean }) {
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
  return <Fold id="dati-azienda" title={G.company2} defaultOpen={open}>
    <p className="text-sm">{G.companyIntro}</p>
    {!canEdit && <p className="text-sm text-muted-foreground">{G.companyReadOnly}</p>}
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      await run({ operation: "saveSettings", settings: { organizationLegalName: legalName, registerOwner: owner, aiActRole: role || null, aiSystems: list, useContext: context, trainers, companyNames, otherInitiatives: other } });
    }}>
      <fieldset disabled={busy || !canEdit} className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1"><Label htmlFor="reg-legal">{domains.length > 1 ? "Ragione sociale (registro completo)" : "Ragione sociale"}</Label><Input id="reg-legal" className="text-base sm:text-sm" value={legalName} maxLength={300} onChange={(e) => setLegalName(e.target.value)} placeholder={domains.length > 1 ? "Es. Gruppo Esempio" : org.workspaceName} /></div>
        <div className="space-y-1"><Label htmlFor="reg-owner">Referente del registro</Label><Input id="reg-owner" className="text-base sm:text-sm" value={owner} maxLength={300} onChange={(e) => setOwner(e.target.value)} placeholder="Nome, ruolo" /></div>
        <div className="space-y-1"><Label htmlFor="reg-role">{G.role}</Label>
          <AdminSelect id="reg-role" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">{G.roleChoose}</option>
            <option value="deployer">{G.roleDeployer}</option>
            <option value="provider">{G.roleProvider}</option>
            <option value="both">{G.roleBoth}</option>
          </AdminSelect>
          <p className="text-sm text-muted-foreground">{G.roleHint}</p>
        </div>
        {domains.length > 1 && <div className="space-y-2 rounded-lg border p-3 sm:col-span-2">
          <p className="text-sm font-medium">Ragione sociale di ogni società</p>
          <p className="text-sm text-muted-foreground">Compare in testa al registro di quella società.</p>
          <div className="grid gap-3 sm:grid-cols-2">{domains.map((d) => <div key={d} className="space-y-1">
            <Label htmlFor={`reg-company-${d}`}>Email @{d}</Label>
            <Input id={`reg-company-${d}`} className="text-base sm:text-sm" value={companyNames[d] ?? ""} maxLength={300} placeholder="Ragione sociale"
              onChange={(e) => setCompanyNames((names) => ({ ...names, [d]: e.target.value }))} />
          </div>)}</div>
        </div>}
        <div className="space-y-1"><Label htmlFor="reg-systems">{G.systems}</Label>
          <Textarea id="reg-systems" className="text-base sm:text-sm" rows={4} value={systems} onChange={(e) => setSystems(e.target.value)} placeholder={"Uno per riga, es.\nClaude (Anthropic) — bozze e analisi di documenti — rischio limitato\nMicrosoft 365 Copilot — email e riunioni — rischio limitato"} />
          <p className="text-sm text-muted-foreground">{G.systemsHint}</p>
        </div>
        <div className="space-y-1"><Label htmlFor="reg-context">Contesto d&apos;uso e persone interessate</Label>
          <Textarea id="reg-context" className="text-base sm:text-sm" rows={4} value={context} maxLength={4000} onChange={(e) => setContext(e.target.value)} placeholder="Es. uffici commerciali e operativi, per bozze di email e analisi di documenti interni; nessuna decisione automatizzata su clienti o dipendenti." />
        </div>
        <div className="space-y-1"><Label htmlFor="reg-trainers">Docenti e qualifica</Label>
          <Textarea id="reg-trainers" className="text-base sm:text-sm" rows={3} value={trainers} maxLength={2000} onChange={(e) => setTrainers(e.target.value)} placeholder={`Es. Nome Cognome, ${register.provider.name} — consulente AI`} />
        </div>
        <div className="space-y-1"><Label htmlFor="reg-other">Altre iniziative di alfabetizzazione (facoltativo)</Label>
          <Textarea id="reg-other" className="text-base sm:text-sm" rows={3} value={other} maxLength={4000} onChange={(e) => setOther(e.target.value)} placeholder={G.otherHint} />
        </div>
        {canEdit && <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <Button type="submit" variant="outline" className="min-h-11 sm:min-h-9" disabled={list.length > 30}>{G.save}</Button>
          {org.settingsUpdatedAt && <span className="text-sm text-muted-foreground">Ultima modifica {dateTime(org.settingsUpdatedAt)} · {org.settingsUpdatedBy}</span>}
        </div>}
      </fieldset>
    </form>
  </Fold>;
}

function Contents({ register }: { register: TrainingRegister }) {
  if (!register.programs.length && !register.needsAssessments.length) return null;
  return <Fold id="contenuti" title={G.contents}>
    {register.programs.map((program) => <div key={program.id} className="space-y-3">
      <div><h3 className="font-semibold">{program.title}</h3>
        <p className="text-sm text-muted-foreground">Pubblicato il {longDate(program.publishedAt)}</p></div>
      <ul className="space-y-2">{program.modules.map((m) => <li key={m.id} className="rounded-lg border p-3 text-sm">
        <p className="font-medium">{m.title}{m.subtitle ? ` — ${m.subtitle}` : ""}</p>
        {m.objective && <p>{m.objective}</p>}
        <p className="text-muted-foreground">{[m.durationMinutes ? `${m.durationMinutes} minuti` : null, m.competencies.length ? `Competenze: ${m.competencies.join(", ")}` : null, m.exercises.length ? `${m.exercises.length} esercitazioni` : null].filter(Boolean).join(" · ")}</p>
      </li>)}</ul>
      {program.materials.length > 0 && <ul aria-label={`Materiali di ${program.title}`} className="divide-y rounded-xl border text-sm">
        {program.materials.map((mat) => <li key={mat.sha256 + mat.fileName} className="space-y-1 p-3">
          <p><span className="font-medium">{mat.title}</span> · {mat.fileName} · {mat.audience === "trainers" ? "Solo formatori" : "Partecipanti"}</p>
          <details><summary className="min-h-11 cursor-pointer py-2 text-muted-foreground sm:min-h-9">{G.fingerprint}</summary><p className="break-all font-mono text-xs">{mat.sha256}</p></details>
        </li>)}
      </ul>}
      <details className="text-sm"><summary className="min-h-11 cursor-pointer py-2 text-muted-foreground sm:min-h-9">{G.fingerprint}: {program.title}</summary><p className="break-all font-mono text-xs">{program.packHash}</p></details>
    </div>)}
    {register.needsAssessments.length > 0 && <div className="space-y-1 text-sm">
      <h3 className="font-semibold">Rilevazione dei bisogni</h3>
      {register.needsAssessments.map((a) => <p key={a.name + a.createdAt}>{a.name} — avviata il {longDate(a.createdAt)}, {a.completed} {a.completed === 1 ? "risposta completa" : "risposte complete"}. Nel registro compare solo il numero.</p>)}
    </div>}
  </Fold>;
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
  return <Fold id="verifica" title={G.verify}>
    <div className="space-y-2">
      <Label htmlFor="register-verify">{G.verifyLabel}</Label>
      <Input id="register-verify" ref={input} type="file" className="text-base sm:text-sm" accept=".pdf,.xlsx" disabled={busy || checking} onChange={(e) => verify(e.target.files?.[0] ?? null)} />
      <p className="text-sm text-muted-foreground">{G.verifyHint}</p>
      <div aria-live="polite">{checking ? <p className="text-sm" role="status">{G.verifying}</p> : verdict && <p role="status" className={`rounded-lg border p-3 text-sm ${verdict.ok ? "border-uc-verde/40" : "border-uc-giallo/60"}`}>{verdict.text}</p>}</div>
    </div>
    {exports.length > 0 && <div className="space-y-2">
      <h3 className="text-sm font-medium">{G.copies(exports.length)}</h3>
      <ul className="divide-y rounded-xl border text-sm">
        {exports.map((e) => <li key={e.id} className="space-y-1 p-3">
          <p><span className="font-medium">{e.format === "pdf" ? "PDF" : "Excel"}</span> · {dateTime(e.generatedAt)} · {e.generatedBy} · {e.participantCount} partecipanti · {e.companyDomain ? `@${e.companyDomain}` : "Tutto il corso"}</p>
          <details><summary className="min-h-11 cursor-pointer py-2 text-muted-foreground sm:min-h-9">{G.fingerprint}</summary><p className="break-all font-mono text-xs">{G.code} {e.id} · {e.sha256}</p></details>
        </li>)}
      </ul>
    </div>}
  </Fold>;
}

function LegalNotes() {
  return <Fold id="norma" title={G.law}>
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
  </Fold>;
}
