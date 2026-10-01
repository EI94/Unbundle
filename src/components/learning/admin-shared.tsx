"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode, SelectHTMLAttributes } from "react";
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
  const [confirming, setConfirming] = useState(false);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const originalButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (confirming) confirmButton.current?.focus(); }, [confirming]);
  return confirming ? <div className="space-y-3 rounded-lg border p-3">
    <p className="text-sm">{description}</p><div className="flex flex-wrap gap-2">
      <Button ref={confirmButton} type="button" disabled={busy} variant={destructive ? "destructive" : "default"} onClick={async () => { if (await onConfirm()) setConfirming(false); }}>Conferma: {label.toLowerCase()}</Button>
      <Button type="button" disabled={busy} variant="outline" onClick={() => { setConfirming(false); requestAnimationFrame(() => originalButton.current?.focus()); }}>Annulla</Button>
    </div>
  </div> : <Button ref={originalButton} type="button" disabled={busy} variant={destructive ? "destructive" : "outline"} onClick={() => setConfirming(true)}>{label}</Button>;
}
