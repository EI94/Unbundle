"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode, SelectHTMLAttributes } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const capabilityLabels: Record<string, string> = {
  manage: "Gestire il corso", review: "Leggere consegne e risultati individuali",
  aggregate: "Vedere i risultati di gruppo", export: "Scaricare i risultati individuali",
};
export const sessionLabels: Record<string, string> = {
  scheduled: "Apertura secondo il programma", open: "Tutte le attività aperte", closed: "Nuove risposte sospese",
};
export function adminDate(value: string | null) {
  return value ? new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Rome" }).format(new Date(value)) : "—";
}
export function AdminSection({ title, children }: { title: string; children: ReactNode }) {
  return <Card><CardHeader><CardTitle>{title}</CardTitle></CardHeader><CardContent className="space-y-4">{children}</CardContent></Card>;
}
export function AdminSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`min-h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-ring disabled:opacity-50 ${props.className ?? ""}`} />;
}
export function AdminNotice({ message, error }: { message: string; error: boolean }) {
  const notice = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (message) notice.current?.focus(); }, [message]);
  return <div aria-live="polite" aria-atomic="true">{message && <p ref={notice} tabIndex={-1} role={error ? "alert" : "status"} className={`rounded-lg border p-4 text-sm ${error ? "border-destructive text-destructive" : "border-primary/40"}`}>{message}</p>}</div>;
}
export function ConfirmAdminAction({ label, description, busy, onConfirm, destructive = false }: {
  label: string; description: string; busy: boolean; onConfirm: () => Promise<boolean>; destructive?: boolean;
}) {
  const identity = `${label}:${description}`;
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);
  const confirming = confirmation === identity;
  const confirmButton = useRef<HTMLButtonElement>(null);
  const originalButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (confirming) confirmButton.current?.focus(); }, [confirming]);
  function close() { setConfirmation(null); setFailed(false); requestAnimationFrame(() => originalButton.current?.focus()); }
  return confirming ? <div className="space-y-3 rounded-lg border p-3">
    <p className="text-sm">{description}</p>
    {failed && <p role="alert" className="text-sm text-destructive">Operazione non confermata. Controlla il riepilogo prima di riprovare.</p>}
    <div className="flex flex-wrap gap-2">
      <Button ref={confirmButton} type="button" disabled={busy || submitting} variant={destructive ? "destructive" : "default"} onClick={async () => {
        if (busy || inFlight.current) return;
        inFlight.current = true; setSubmitting(true); setFailed(false);
        try { if (await onConfirm()) close(); } catch { setFailed(true); }
        finally { inFlight.current = false; setSubmitting(false); }
      }}>Conferma: {label.toLowerCase()}</Button>
      <Button type="button" disabled={busy || submitting} variant="outline" onClick={close}>Annulla</Button>
    </div>
  </div> : <Button ref={originalButton} type="button" disabled={busy || submitting} variant={destructive ? "destructive" : "outline"} onClick={() => { setFailed(false); setConfirmation(identity); }}>{label}</Button>;
}

export function AdminUnsavedNotice({ dirty, onDiscard }: { dirty: boolean; onDiscard: () => boolean }) {
  return dirty ? <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/40 p-3 text-sm" role="status">
    <p>Modifiche non salvate. Salva il modulo prima di cambiare sezione o uscire.</p>
    <Button type="button" variant="outline" onClick={onDiscard}>Scarta modifiche</Button>
  </div> : null;
}

export function LearningLinkCopy({ path, label }: { path: string; label: string }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(path);
  const [notice, setNotice] = useState("");
  async function copy() {
    const url = new URL(path, window.location.origin).href;
    setValue(url);
    if (input.current) input.current.value = url;
    try { await navigator.clipboard.writeText(url); setNotice("Link copiato. Condividilo con le persone assegnate: non concede nuovi permessi e non invia email."); }
    catch { setNotice("Copia automatica non disponibile. Il link è selezionato: copialo manualmente."); input.current?.focus(); input.current?.select(); }
  }
  return <div className="space-y-2">
    <label className="text-sm font-medium" htmlFor={id}>{label}</label>
    <div className="flex flex-wrap gap-2"><Input ref={input} id={id} value={value} readOnly className="min-w-0 flex-1 text-sm" onFocus={() => { if (value === path) setValue(new URL(path, window.location.origin).href); }} /><Button type="button" variant="outline" onClick={copy}>Copia link</Button></div>
    <p className="text-sm text-muted-foreground" role="status" aria-live="polite">{notice || "Apre il corso a chi è già iscritto. Per far entrare qualcuno di nuovo usa un link di accesso."}</p>
  </div>;
}
