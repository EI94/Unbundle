"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode, SelectHTMLAttributes } from "react";
import { Button } from "@/components/ui/button";

export const capabilityLabels: Record<string, string> = {
  manage: "Gestire il corso", review: "Leggere consegne e risultati individuali",
  aggregate: "Vedere i risultati di gruppo", export: "Scaricare i risultati individuali",
};
export function adminDate(value: string | null) {
  return value ? new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Rome" }).format(new Date(value)) : "—";
}
/**
 * (Rilascio 10, §7.4) Una lezione si dice con la sua data e ora, mai con il codice del turno (`cohortId`): «Lezione
 * del 5 ott 2026, 14:30». Senza la lezione tra quelle note, solo «Lezione».
 */
export function cohortLabel(sessions: ReadonlyArray<{ cohortId: string; startsAt: string }>, cohortId: string | null | undefined): string {
  const session = cohortId ? sessions.find(entry => entry.cohortId === cohortId) : undefined;
  return session ? `Lezione del ${adminDate(session.startsAt)}` : "Lezione";
}
/** (Rilascio 10, ondata 7a, FO-12) Una sezione della console con un vero titolo H2, non un `div`. */
export function AdminSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="space-y-4 rounded-xl border bg-card p-4 sm:p-5"><h2 className="text-base font-semibold">{title}</h2>{children}</section>;
}
export function AdminSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`min-h-11 w-full rounded-lg border border-input bg-background px-3 py-2 text-base focus-visible:outline-ring disabled:opacity-50 sm:min-h-9 sm:text-sm ${props.className ?? ""}`} />;
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
