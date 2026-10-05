import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Cornice comune delle pagine della formazione. `back` sostituisce il link
 * generico alla formazione del workspace con un ritorno più vicino (per
 * esempio «Torna al percorso» dalle pagine di un esercizio).
 */
export function LearningShell({ workspaceId, title, back, children }: {
  workspaceId: string; title: string; back?: { href: string; label: string }; children: React.ReactNode;
}) {
  return <main className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-8">
    {back ? (
      <Link className="inline-flex min-h-10 items-center gap-1.5 text-sm underline underline-offset-4" href={back.href}>
        <ArrowLeft aria-hidden className="size-4" />{back.label}
      </Link>
    ) : (
      <Link className="inline-flex min-h-10 items-center text-sm underline underline-offset-4" href={`/dashboard/${workspaceId}/learning`}>Formazione del workspace</Link>
    )}
    <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
    {children}
  </main>;
}

export function LearningUnavailable({ message = "La formazione non è disponibile per questo account o workspace. Contatta il responsabile del percorso." }: { message?: string }) {
  return <Card><CardHeader><CardTitle>Percorso non disponibile</CardTitle></CardHeader><CardContent><p>{message}</p></CardContent></Card>;
}

export function outcomeLabel(status: string | null | undefined) {
  return ({ consolidated: "Obiettivo raggiunto", needs_practice: "Da ripassare", formative_completed: "Fatto", draft: "In corso", submitted: "Consegnato", pending_review: "Revisione in corso", available: "Disponibile", locked: "In programma" } as Record<string, string>)[status ?? ""] ?? "Non iniziato";
}

export function localDate(value: string) {
  return new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", dateStyle: "long", timeStyle: "short" }).format(new Date(value));
}
