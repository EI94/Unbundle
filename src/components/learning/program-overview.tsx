import Link from "next/link";
import { getLearningProgram } from "@/lib/learning/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LearningShell, localDate, outcomeLabel } from "./learning-shell";
import { LearningExportButton } from "./export-button";
import { LearningRefresh } from "./learning-refresh";

export async function ProgramOverview({ workspaceId, programId, moduleId }: { workspaceId: string; programId: string; moduleId?: string }) {
  const program = await getLearningProgram(workspaceId, programId);
  const base = `/dashboard/${workspaceId}/learning/${programId}`;
  return <LearningShell workspaceId={workspaceId} title={program.title}>
    <nav aria-label="Percorso formativo" className="flex flex-wrap gap-4 text-sm underline">
      <Link href={base}>Moduli</Link>
      {program.canParticipate && <><Link href={`${base}/progress`}>I miei progressi</Link><Link href={`${base}/ideas`}>La mia idea</Link></>}
      {program.canReview && <Link href={`${base}/manage`}>Vista formatori</Link>}
      {program.canAggregate && <Link href={`${base}/live`}>Vista di gruppo</Link>}
      {program.canManage && <Link href={`${base}/admin`}>Gestisci corso</Link>}
    </nav>
    <LearningRefresh label="Aggiorna disponibilità ed esiti" />
    {program.canExport && !program.canReview && <LearningExportButton workspaceId={workspaceId} programId={programId} />}
    <Card><CardHeader><CardTitle>Come useremo le tue risposte</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
      <p>Gli esercizi sono associati al tuo account. Puoi vedere i tuoi risultati; le prove individuali sono accessibili ai formatori con autorizzazione esplicita. La leadership vede solo gli aggregati autorizzati.</p>
      <p className="whitespace-pre-wrap">{program.visibilityPolicy}</p>
      <p>Conservazione configurata: {program.retentionDays} giorni dopo la chiusura del percorso.</p>
      <p>Formatori del percorso: {program.reviewers.length ? program.reviewers.join(", ") : "rivolgiti al responsabile indicato per il corso"}.</p>
      <p>La survey AI Readiness è separata e non viene ripetuta durante la formazione.</p>
    </CardContent></Card>
    <details className="rounded-lg border p-4" open><summary className="cursor-pointer font-medium">Prova di accesso: materiale introduttivo, senza valutazione</summary><p className="mt-3">Un assistente AI usa le istruzioni e le informazioni disponibili. Il suo risultato va confrontato con le fonti. Durante il corso lavoriamo su esempi fittizi; nessuna attività invia messaggi, prenota servizi o modifica sistemi operativi.</p></details>
    <div className="grid gap-5">{program.modules.filter(module => !moduleId || module.id === moduleId).map(module => <Card key={module.id}>
      <CardHeader><CardTitle>{module.title}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p>{module.id === "m1" ? "Tre finestre in aula: minuti 30–35, 78–96 e 105–116. Nessuna chiamata AI richiesta per completare le prove." : "In programma. Le attività di questo modulo non sono ancora aperte."}</p>
        {module.id === "m1" && program.canParticipate && <p className="font-medium">{module.completionStatus === "completed" ? "Attività richieste consegnate" : module.completionStatus === "in_progress" ? "Percorso iniziato" : "Percorso non iniziato"}{module.learningOutcome ? ` · ${outcomeLabel(module.learningOutcome)}` : ""}</p>}
        {program.sessions.filter(session => session.moduleId === module.id).map(session => <p className="text-sm" key={session.id}>
          {session.assigned ? "Il tuo turno: " : "Replica: "}{localDate(session.startsAt)} – {localDate(session.endsAt)} · Europe/Rome
          {session.assigned && ` · ${session.status === "open" ? "Aperto dal formatore" : session.status === "closed" ? "Chiuso" : "Apertura secondo calendario"}`}
        </p>)}
        {module.id === "m1" && !program.canParticipate && <p>Per compilare le attività occorre un’iscrizione come partecipante. Le viste autorizzate sono disponibili nella navigazione del corso.</p>}
        {module.id === "m1" && <ul className="space-y-3">{module.activities.map(activity => {
          const submitted = activity.status === "submitted";
          const draft = activity.status === "draft";
          const status = submitted ? outcomeLabel(activity.result?.status ?? "submitted") : draft ? activity.availability.writeAccess ? "Bozza da riprendere" : "Bozza in sola lettura" : activity.availability.writeAccess ? "Disponibile" : activity.availability.state === "scheduled" ? "In programma" : "Non aperta";
          const href = activity.attemptId ? `${base}/attempts/${activity.attemptId}` : `${base}/activities/${activity.id}`;
          return <li key={activity.id} className="space-y-3 rounded-lg border p-4">
            <div><p className="font-medium">{activity.title}</p>{program.canParticipate && <>
              <p className="text-sm">{status}{activity.result ? ` · ${activity.result.correct}/${activity.result.total}` : ""}{submitted ? " · Consegna ricevuta" : ""}</p>
              {activity.attemptNumber && <p className="text-sm text-muted-foreground">{activity.attemptTitle} · Tentativo {activity.attemptNumber}</p>}
              {activity.availability.reason && <p className="mt-2 text-sm text-muted-foreground">{activity.availability.reason}</p>}
            </>}</div>
            {program.canParticipate && <Link className="inline-block underline underline-offset-4" href={href}>{submitted ? "Leggi feedback" : draft ? activity.availability.writeAccess ? "Riprendi attività" : "Consulta la bozza" : activity.availability.writeAccess ? "Apri attività" : "Vedi disponibilità"}</Link>}
          </li>;
        })}</ul>}
      </CardContent>
    </Card>)}</div>
    <p className="text-sm text-muted-foreground">Versione {program.version}. Una replica per modulo; nessun doppio requisito. Il completamento registra le consegne; l’esito indica ciò che è consolidato e ciò che va ripreso.</p>
  </LearningShell>;
}
