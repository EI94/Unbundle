import Link from "next/link";
import { getLearningProgram } from "@/lib/learning/server";
import { participantNotice } from "@/lib/learning/register-legal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LearningShell, outcomeLabel } from "./learning-shell";
import { LearningExportButton } from "./export-button";
import { LearningRefresh } from "./learning-refresh";

/**
 * Il corso visto da chi lo segue: una scaletta, non un elenco.
 *
 * Prima della lezione la pagina dice cosa scaricare e come; durante, indica
 * il punto in cui si trova l'aula e mette ogni attività accanto al momento in
 * cui si fa; dopo, raccoglie ciò che resta: il riepilogo, il prossimo passo,
 * le slide. Tutto viene dal corso, niente è scritto qui per un corso solo.
 */

type Program = Awaited<ReturnType<typeof getLearningProgram>>;
type ModuleView = Program["modules"][number];
type ActivityView = ModuleView["activities"][number];
type Material = Program["materials"][number];

const ROME = "Europe/Rome";

function dayLabel(iso: string) {
  return new Intl.DateTimeFormat("it-IT", { timeZone: ROME, weekday: "long", day: "numeric", month: "long" }).format(new Date(iso));
}
function hourLabel(iso: string) {
  return new Intl.DateTimeFormat("it-IT", { timeZone: ROME, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}
function minuteLabel(minutes: number) {
  return String(minutes).padStart(2, "0");
}
function sizeLabel(bytes: number) {
  if (bytes < 1024) return `${bytes}\u00a0byte`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}\u00a0KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")}\u00a0MB`;
}
/** Le righe della descrizione diventano passi, se il formatore le ha scritte così. */
function steps(text: string | null) {
  return (text ?? "").split("\n").map((line) => line.replace(/^\s*(\d+[.)]|[-•])\s*/, "").trim()).filter(Boolean);
}

function activityStatus(activity: ActivityView) {
  const submitted = activity.status === "submitted";
  const draft = activity.status === "draft";
  if (submitted) return outcomeLabel(activity.result?.status ?? "submitted");
  if (draft) return activity.availability.writeAccess ? "Bozza da riprendere" : "Bozza in sola lettura";
  if (activity.availability.writeAccess) return "Disponibile";
  return activity.availability.state === "scheduled" ? "Si apre durante la lezione" : "Non ancora aperta";
}
function activityAction(activity: ActivityView) {
  const submitted = activity.status === "submitted";
  const draft = activity.status === "draft";
  if (submitted) return "Leggi il riscontro";
  if (draft) return activity.availability.writeAccess ? "Riprendi" : "Consulta la bozza";
  return activity.availability.writeAccess ? "Inizia" : "Vedi quando si apre";
}

function ActivityRow({ activity, base, canParticipate }: { activity: ActivityView; base: string; canParticipate: boolean }) {
  const href = activity.attemptId ? `${base}/attempts/${activity.attemptId}` : `${base}/activities/${activity.id}`;
  const open = activity.availability.writeAccess || activity.status === "submitted" || activity.status === "draft";
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-background p-3">
      <div className="min-w-0">
        <p className="font-medium">{activity.title}</p>
        {canParticipate && (
          <p className="text-sm text-muted-foreground">
            {activityStatus(activity)}
            {activity.result ? ` · ${activity.result.correct}/${activity.result.total}` : ""}
            {activity.estimatedMinutes ? ` · circa ${activity.estimatedMinutes} minuti` : ""}
            {!activity.required ? " · facoltativa" : ""}
          </p>
        )}
        {canParticipate && !open && activity.availability.reason && (
          <p className="mt-1 text-xs text-muted-foreground">{activity.availability.reason}</p>
        )}
      </div>
      {canParticipate && (
        <Link
          className={open
            ? "rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background"
            : "text-sm underline underline-offset-4"}
          href={href}
        >
          {activityAction(activity)}
        </Link>
      )}
    </li>
  );
}

function MaterialRow({ material }: { material: Material }) {
  const downloadable = material.access.downloadable;
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-background p-3">
      <div className="min-w-0">
        <p className="font-medium">
          {material.title}
          {material.forTrainers && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-normal">solo formatori</span>}
        </p>
        <p className="text-sm text-muted-foreground">
          {material.fileName} · {sizeLabel(material.sizeBytes)}
        </p>
        {!downloadable && <p className="mt-1 text-xs text-muted-foreground">{material.access.reason}</p>}
      </div>
      {downloadable ? (
        // Link nativo e non <Link>: un prefetch del router non deve scaricare né contare nulla.
        <a className="rounded-lg border px-4 py-2 text-sm font-medium" href={material.href} download={material.fileName}>
          Scarica
        </a>
      ) : (
        <span className="text-sm text-muted-foreground">Non ancora disponibile</span>
      )}
    </li>
  );
}

function BeforeYouStart({ materials }: { materials: Material[] }) {
  if (!materials.length) return null;
  return (
    <section
      aria-labelledby="before-start"
      className="space-y-4 rounded-2xl border-2 border-emerald-600/40 bg-emerald-500/5 p-5"
      data-testid="learning-before-start"
    >
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">Prima di iniziare</p>
        <h2 id="before-start" className="mt-1 text-lg font-semibold">
          {materials.length === 1 ? `Scarica «${materials[0].title}»` : "Scarica i materiali della lezione"}
        </h2>
      </div>
      {materials.map((material) => (
        <div key={material.id} className="space-y-3">
          {steps(material.description).length > 0 && (
            <ol className="list-decimal space-y-1.5 pl-5 text-sm">
              {steps(material.description).map((step) => <li key={step}>{step}</li>)}
            </ol>
          )}
          {material.access.downloadable ? (
            <a
              className="inline-flex min-h-12 flex-wrap items-center gap-x-2 rounded-xl bg-emerald-700 px-6 py-3 text-base font-medium text-white hover:bg-emerald-800"
              href={material.href}
              download={material.fileName}
              data-testid="learning-download-before"
            >
              <span>Scarica {material.fileName}</span>
              <span className="whitespace-nowrap font-normal opacity-90">{sizeLabel(material.sizeBytes)}</span>
            </a>
          ) : (
            <p className="text-sm text-muted-foreground">{material.access.reason}</p>
          )}
        </div>
      ))}
    </section>
  );
}

function Agenda({ module, sessionStart, now, base, canParticipate }: {
  module: ModuleView; sessionStart: string | null; now: number; base: string; canParticipate: boolean;
}) {
  const elapsed = sessionStart ? Math.floor((now - new Date(sessionStart).getTime()) / 60_000) : null;
  const live = elapsed !== null && elapsed >= 0 && elapsed < module.durationMinutes;
  const placed = new Set<string>();
  const blocks = module.agenda.map((block) => {
    const activities = module.activities.filter((activity) =>
      typeof activity.opensAfterMinutes === "number" &&
      activity.opensAfterMinutes >= block.from_minute && activity.opensAfterMinutes < block.to_minute);
    activities.forEach((activity) => placed.add(activity.id));
    const current = live && elapsed! >= block.from_minute && elapsed! < block.to_minute;
    const past = live ? elapsed! >= block.to_minute : elapsed !== null && elapsed >= module.durationMinutes;
    return { block, activities, current, past };
  });
  const loose = module.activities.filter((activity) => !placed.has(activity.id));

  return (
    <div className="space-y-4">
      {blocks.length > 0 && (
        <ol className="space-y-2" aria-label="Scaletta della lezione">
          {blocks.map(({ block, activities, current, past }) => (
            <li
              key={`${block.from_minute}-${block.title}`}
              aria-current={current ? "step" : undefined}
              className={current
                ? "rounded-2xl border-2 border-foreground bg-muted/40 p-4"
                : `rounded-2xl border p-4 ${past ? "opacity-70" : ""}`}
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {minuteLabel(block.from_minute)}–{minuteLabel(block.to_minute)}
                </span>
                <span className="font-medium">{block.title}</span>
                {current && <span className="rounded-full bg-foreground px-2 py-0.5 text-xs font-medium text-background">Siamo qui</span>}
              </div>
              {block.detail && <p className="mt-1 text-sm text-muted-foreground">{block.detail}</p>}
              {activities.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {activities.map((activity) => <ActivityRow key={activity.id} activity={activity} base={base} canParticipate={canParticipate} />)}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
      {loose.length > 0 && (
        <ul className="space-y-2">
          {loose.map((activity) => <ActivityRow key={activity.id} activity={activity} base={base} canParticipate={canParticipate} />)}
        </ul>
      )}
    </div>
  );
}

export async function ProgramOverview({ workspaceId, programId, moduleId }: { workspaceId: string; programId: string; moduleId?: string }) {
  const program = await getLearningProgram(workspaceId, programId);
  const base = `/dashboard/${workspaceId}/learning/${programId}`;
  const own = program.ownSession;
  const isTrainerView = !program.canParticipate;
  const modules = program.modules.filter((module) => !moduleId || module.id === moduleId);
  const before = program.materials.filter((material) => material.downloadBefore && (!moduleId || !material.moduleId || material.moduleId === moduleId));

  return (
    <LearningShell workspaceId={workspaceId} title={program.title}>
      <nav aria-label="Percorso formativo" className="flex flex-wrap gap-4 text-sm underline">
        <Link href={base}>Il percorso</Link>
        {program.canParticipate && <><Link href={`${base}/progress`}>I miei progressi</Link><Link href={`${base}/ideas`}>La mia idea</Link></>}
        {program.canReview && <Link href={`${base}/manage`}>Vista formatori</Link>}
        {program.canAggregate && <Link href={`${base}/live`}>Vista di gruppo</Link>}
        {program.canManage && <Link href={`${base}/admin`}>Gestisci corso</Link>}
      </nav>
      <LearningRefresh label="Aggiorna" />
      {program.canExport && !program.canReview && <LearningExportButton workspaceId={workspaceId} programId={programId} />}

      <BeforeYouStart materials={before} />

      <div className="grid gap-5">
        {modules.map((module) => {
          const isOwn = own?.moduleId === module.id;
          const moduleSessions = program.sessions.filter((session) => session.moduleId === module.id);
          const ended = isOwn && own && (own.status === "closed" || program.now >= new Date(own.endsAt).getTime());
          const moduleMaterials = program.materials.filter((material) => material.moduleId === module.id && !material.downloadBefore);
          const operational = module.activities.length > 0 || module.agenda.length > 0;
          return (
            <Card key={module.id} className={isOwn ? "border-foreground/30" : undefined}>
              <CardHeader className="space-y-2">
                <CardTitle className="text-xl">{module.title}</CardTitle>
                <p className="text-sm text-muted-foreground">{module.subtitle}</p>
                {isOwn && own ? (
                  <p className="text-sm font-medium">
                    Il tuo turno: {dayLabel(own.startsAt)}, {hourLabel(own.startsAt)}–{hourLabel(own.endsAt)}
                    {own.status === "open" ? " · aperto dal formatore" : own.status === "closed" ? " · concluso" : ""}
                  </p>
                ) : (
                  moduleSessions.length > 0 && (
                    <p className="text-sm">
                      {moduleSessions.map((session, index) => (
                        <span key={session.id}>
                          {index > 0 ? " · oppure " : ""}
                          {dayLabel(session.startsAt)}, {hourLabel(session.startsAt)}–{hourLabel(session.endsAt)}
                        </span>
                      ))}
                    </p>
                  )
                )}
              </CardHeader>
              <CardContent className="space-y-5">
                <p className="text-sm">{module.objective}</p>

                {isOwn && program.canParticipate && module.completion.required > 0 && (
                  <p className="text-sm font-medium" data-testid="learning-module-progress">
                    Attività richieste: {module.completion.submitted} di {module.completion.required} consegnate
                    {module.completion.outcome ? ` · ${outcomeLabel(module.completion.outcome)}` : ""}
                  </p>
                )}

                {operational && (isOwn || isTrainerView) ? (
                  <Agenda module={module} sessionStart={isOwn && own ? own.startsAt : null} now={program.now} base={base} canParticipate={program.canParticipate} />
                ) : (
                  <p className="text-sm text-muted-foreground">In programma. Le attività si apriranno nel turno di questo modulo.</p>
                )}

                {module.takeaways.length > 0 && (isTrainerView || ended) && (
                  <section aria-label="Da portare a casa" className="space-y-2">
                    <h3 className="font-medium">Da portare a casa</h3>
                    <ol className="list-decimal space-y-1 pl-5 text-sm">
                      {module.takeaways.map((item) => <li key={item}>{item}</li>)}
                    </ol>
                  </section>
                )}

                {module.nextSteps.length > 0 && (isTrainerView || ended) && (
                  <section aria-label="Prima del prossimo modulo" className="space-y-2 rounded-xl bg-muted/40 p-4">
                    <h3 className="font-medium">Prima del prossimo modulo</h3>
                    <ol className="list-decimal space-y-1 pl-5 text-sm">
                      {module.nextSteps.map((item) => <li key={item}>{item}</li>)}
                    </ol>
                  </section>
                )}

                {moduleMaterials.length > 0 && (
                  <section aria-label="Materiali del modulo" className="space-y-2">
                    <h3 className="font-medium">Materiali</h3>
                    <ul className="space-y-2">{moduleMaterials.map((material) => <MaterialRow key={material.id} material={material} />)}</ul>
                  </section>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {isTrainerView && (
        <p className="text-sm text-muted-foreground">
          Stai guardando il corso come formatore: vedi tutte le scalette e tutti i materiali. Per compilare le attività serve un&apos;iscrizione da partecipante.
        </p>
      )}

      <details className="rounded-xl border p-4">
        <summary className="cursor-pointer font-medium">Come useremo le tue risposte</summary>
        <div className="mt-3 space-y-3 text-sm">
          <p>Le attività sono associate al tuo account. Vedi i tuoi risultati; le prove individuali sono accessibili ai formatori con autorizzazione esplicita. La direzione vede solo dati aggregati.</p>
          <p className="whitespace-pre-wrap">{program.visibilityPolicy}</p>
          <p>Le risposte restano conservate {program.retentionDays} giorni dopo la chiusura del corso.</p>
          <p>{participantNotice}</p>
          {program.reviewers.length > 0 && <p>Formatori del tuo turno: {program.reviewers.join(", ")}.</p>}
        </div>
      </details>
    </LearningShell>
  );
}
