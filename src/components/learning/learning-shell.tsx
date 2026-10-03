import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function LearningShell({ workspaceId, title, children }: {
  workspaceId: string; title: string; children: React.ReactNode;
}) {
  return <main className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-8">
    <Link className="text-sm underline underline-offset-4" href={`/dashboard/${workspaceId}/learning`}>Formazione del workspace</Link>
    <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
    {children}
  </main>;
}

export function LearningUnavailable({ message = "La formazione non è disponibile per questo account o workspace. Contatta il responsabile del percorso." }: { message?: string }) {
  return <Card><CardHeader><CardTitle>Percorso non disponibile</CardTitle></CardHeader><CardContent><p>{message}</p></CardContent></Card>;
}

export function outcomeLabel(status: string | null | undefined) {
  return ({ consolidated: "Consolidato", needs_practice: "Da consolidare", formative_completed: "Checkpoint completato", draft: "Da riprendere", submitted: "Consegnato", pending_review: "Revisione in corso", available: "Disponibile", locked: "In programma" } as Record<string, string>)[status ?? ""] ?? "Non iniziato";
}

export function localDate(value: string) {
  return new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", dateStyle: "long", timeStyle: "short" }).format(new Date(value));
}
