import Link from "next/link";
import { getLearningProgram } from "@/lib/learning/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LearningShell, localDate, outcomeLabel } from "./learning-shell";
export async function ProgramOverview({ workspaceId, programId, moduleId }: { workspaceId: string; programId: string; moduleId?: string }) {
  const program = await getLearningProgram(workspaceId, programId);
  const base = `/dashboard/${workspaceId}/learning/${programId}`;
  return <LearningShell workspaceId={workspaceId} title={program.title}>
    <nav aria-label="Percorso formativo" className="flex flex-wrap gap-4 text-sm underline">
      <Link href={base}>Moduli</Link><Link href={`${base}/progress`}>I miei progressi</Link><Link href={`${base}/ideas`}>La mia idea</Link>
      {program.canReview && <Link href={`${base}/manage`}>Vista formatori</Link>}{program.canAggregate && <Link href={`${base}/live`}>Vista di gruppo</Link>}
    </nav>
    <Card><CardHeader><CardTitle>Come useremo le tue risposte</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
      <p>Gli esercizi sono associati al tuo account. Puoi vedere i tuoi risultati; le prove individuali sono accessibili ai formatori con autorizzazione esplicita. La leadership vede solo gli aggregati autorizzati.</p>
      <p className="whitespace-pre-wrap">{program.visibilityPolicy}</p>
      <p>Conservazione configurata: {program.retentionDays} giorni dopo la chiusura del percorso.</p>
      <p>Formatori del percorso: {program.reviewers.length ? program.reviewers.join(", ") : "rivolgiti al responsabile indicato per il corso"}.</p>
      <p>La survey AI Readiness è separata e non viene ripetuta durante la formazione.</p>
    </CardContent></Card>
    <details className="rounded-lg border p-4" open><summary className="cursor-pointer font-medium">Prova di accesso: materiale introduttivo, senza valutazione</summary><p className="mt-3">Un assistente AI usa le istruzioni e le informazioni disponibili. Il suo risultato va confrontato con le fonti. Durante il corso lavoriamo su esempi fittizi; nessuna attività invia messaggi, prenota servizi o modifica sistemi operativi.</p></details>
    <div className="grid gap-5">{program.modules.filter((module) => !moduleId || module.id === moduleId).map((module) => <Card key={module.id}><CardHeader><CardTitle>{module.title}</CardTitle></CardHeader><CardContent className="space-y-4">
      <p>{module.id === "m1" ? "Tre finestre in aula: minuti 30–35, 78–96 e 105–116. Nessuna chiamata AI richiesta per completare le prove." : "In programma. Le attività di questo modulo non sono ancora aperte."}</p>
      {program.sessions.filter((session) => session.moduleId === module.id).map((session) => <p className="text-sm" key={session.id}>{session.cohortId === program.cohortId ? "Il tuo turno: " : "Replica: "}{localDate(session.startsAt)} · Europe/Rome</p>)}
      {module.id === "m1" && <ul className="space-y-3">{module.activities.filter((activity) => activity.id !== "m1-exit-b").map((activity) => <li key={activity.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"><div><p className="font-medium">{activity.title}</p><p className="text-sm text-muted-foreground">{outcomeLabel(activity.status)}</p></div><Link className="underline underline-offset-4" href={`${base}/activities/${activity.id}`}>{activity.attemptId ? "Riprendi / leggi feedback" : "Apri attività"}</Link></li>)}</ul>}
    </CardContent></Card>)}</div>
    <p className="text-sm text-muted-foreground">Versione {program.version}. Una replica per modulo; nessun doppio requisito.</p>
  </LearningShell>;
}
