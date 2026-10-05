import Link from "next/link";
import { CircleCheck, PartyPopper, RotateCcw } from "lucide-react";
import { getLearningProgram } from "@/lib/learning/server";
import { participantNotice } from "@/lib/learning/register-legal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { LearningShell, outcomeLabel } from "./learning-shell";
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
type HistoryRow = Program["history"][number];
type ResultView = NonNullable<ActivityView["result"]>;

const ROME = "Europe/Rome";
const navLink = "inline-flex min-h-10 items-center underline underline-offset-4";

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
  if (bytes < 1024) return `${bytes} byte`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}
/** Le righe della descrizione diventano passi, se il formatore le ha scritte così. */
function steps(text: string | null) {
  return (text ?? "").split("\n").map((line) => line.replace(/^\s*(\d+[.)]|[-•])\s*/, "").trim()).filter(Boolean);
}
function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * L'ultima consegna di un'attività, anche quando dopo è iniziata una nuova
 * prova non ancora inviata: il risultato da mostrare resta quello consegnato.
 */
function latestResult(activity: ActivityView, history: HistoryRow[]): { result: ResultView; attemptId: string } | null {
  // L'ultima prova aperta può essere il recupero: valgono le consegne
  // dell'attività e del suo recupero, come nel completamento del turno.
  const linked = new Set([activity.id, ...history.filter((entry) => entry.id === activity.attemptId).map((entry) => entry.activityId)]);
  const row = history.filter((entry) => entry.status === "submitted" && entry.result && linked.has(entry.activityId)).at(-1);
  if (row?.result) return { result: row.result, attemptId: row.id };
  if (activity.status === "submitted" && activity.result && activity.attemptId) return { result: activity.result, attemptId: activity.attemptId };
  return null;
}

function OutcomePill({ status }: { status: string }) {
  const good = status === "consolidated" || status === "formative_completed";
  const practice = status === "needs_practice";
  return (
    <span className={cn("inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 text-xs font-medium",
      good ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
        : practice ? "border-amber-500/50 bg-amber-500/10 text-amber-300"
          : "text-muted-foreground")}>
      {good && <CircleCheck aria-hidden className="size-3.5" />}
      {practice && <RotateCcw aria-hidden className="size-3.5" />}
      {outcomeLabel(status)}
    </span>
  );
}

/**
 * «Il tuo risultato»: le attività del turno con le risposte giuste e, quando
 * il turno è completo, l'esito in una riga. Componente server, usato sia nel
 * percorso sia nella pagina «Il mio risultato».
 */
export function LearnerResultSummary({ module, history, base, emptyText }: {
  module: ModuleView; history: HistoryRow[]; base: string; emptyText?: string;
}) {
  const rows = module.activities.map((activity) => ({ activity, latest: latestResult(activity, history) }));
  const anySubmitted = rows.some((row) => row.latest);
  if (!anySubmitted && !emptyText) return null;
  const required = rows.filter((row) => row.activity.required);
  const counted = required.length > 0 ? required : rows;
  const correct = counted.reduce((sum, row) => sum + (row.latest?.result.correct ?? 0), 0);
  const total = counted.reduce((sum, row) => sum + (row.latest?.result.total ?? 0), 0);
  const { completion } = module;
  const completed = completion.status === "completed";
  const missing = Math.max(completion.required - completion.submitted, 0);
  const headingId = `learning-result-${module.id}`;

  return (
    <section
      aria-labelledby={headingId}
      data-testid="learning-result-summary"
      className="space-y-4 rounded-2xl border-2 border-foreground/20 bg-muted/30 p-4 sm:p-5"
    >
      <h2 id={headingId} className="text-lg font-semibold">Il tuo risultato</h2>

      {completed && (
        completion.outcome === "consolidated" ? (
          <div className="flex items-start gap-3 rounded-xl border border-emerald-500/50 bg-emerald-500/10 p-4">
            <PartyPopper aria-hidden className="mt-0.5 size-6 shrink-0 text-emerald-300" />
            <p className="text-base font-semibold sm:text-lg">Turno completato: obiettivo raggiunto</p>
          </div>
        ) : (
          <div className="flex items-start gap-3 rounded-xl border border-amber-500/50 bg-amber-500/10 p-4">
            <RotateCcw aria-hidden className="mt-0.5 size-6 shrink-0 text-amber-300" />
            <div className="space-y-1">
              <p className="text-base font-semibold sm:text-lg">Turno completato: alcuni punti da ripassare</p>
              <p className="text-sm">Rifai quando vuoi gli esercizi segnati «Da ripassare».</p>
            </div>
          </div>
        )
      )}

      {anySubmitted ? (
        <>
          <p className="text-base font-medium" data-testid="learning-result-total">
            {[
              completion.required > 0 ? `Esercizi: ${completion.submitted} di ${completion.required} fatti` : null,
              total > 0 ? `${correct} ${correct === 1 ? "risposta giusta" : "risposte giuste"} su ${total}` : null,
            ].filter(Boolean).join(" · ")}
          </p>
          {!completed && missing > 0 && (
            <p className="text-sm text-muted-foreground">{missing === 1 ? "Ancora 1 esercizio da fare." : `Ancora ${missing} esercizi da fare.`}</p>
          )}
          <ul className="divide-y rounded-xl border bg-background">
            {rows.map(({ activity, latest }) => (
              <li key={activity.id} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <div className="min-w-0 sm:flex-1">
                  <p className="font-medium">{activity.title}</p>
                  {!activity.required && <p className="text-xs text-muted-foreground">Non conta per il risultato</p>}
                </div>
                {latest ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-sm tabular-nums">{latest.result.correct}/{latest.result.total} giuste</span>
                    <OutcomePill status={latest.result.status} />
                    <Link className={cn(navLink, "text-sm")} href={`${base}/attempts/${latest.attemptId}`}>
                      Rivedi<span className="sr-only"> {activity.title}</span>
                    </Link>
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground">{activity.status === "draft" ? outcomeLabel("draft") : "Da fare"}</span>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      )}
    </section>
  );
}

function activityStatus(activity: ActivityView) {
  if (activity.status === "submitted") {
    const label = outcomeLabel(activity.result?.status ?? "submitted");
    return activity.result ? `${label} · ${activity.result.correct}/${activity.result.total} giuste` : label;
  }
  if (activity.status === "draft") return outcomeLabel("draft");
  if (activity.availability.writeAccess) return "Da fare";
  return activity.availability.state === "scheduled" ? "Si apre durante la lezione" : "Non ancora aperta";
}
function activityAction(activity: ActivityView) {
  if (activity.status === "submitted") return "Vedi il risultato";
  if (activity.status === "draft") return activity.availability.writeAccess ? "Continua" : "Vedi le risposte";
  return activity.availability.writeAccess ? "Inizia" : null;
}

function ActivityRow({ activity, base, canParticipate }: { activity: ActivityView; base: string; canParticipate: boolean }) {
  const href = activity.attemptId ? `${base}/attempts/${activity.attemptId}` : `${base}/activities/${activity.id}`;
  const open = activity.availability.writeAccess || activity.status === "submitted" || activity.status === "draft";
  const action = activityAction(activity);
  const tone = activity.status === "submitted"
    ? activity.result?.status === "needs_practice" ? "text-amber-300" : "text-emerald-300"
    : "text-muted-foreground";
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-background p-3">
      <div className="min-w-0 flex-1">
        <p className="font-medium">{activity.title}</p>
        {canParticipate && (
          <p className="text-sm text-muted-foreground">
            <span className={tone}>{activityStatus(activity)}</span>
            {activity.status !== "submitted" && activity.estimatedMinutes ? ` · circa ${plural(activity.estimatedMinutes, "minuto", "minuti")}` : ""}
            {!activity.required ? " · non conta per il risultato" : ""}
          </p>
        )}
        {canParticipate && !open && activity.availability.reason && (
          <p className="mt-1 text-xs text-muted-foreground">{activity.availability.reason}</p>
        )}
      </div>
      {canParticipate && open && action && (
        <Link
          className={activity.status === "submitted"
            ? "inline-flex min-h-10 items-center rounded-lg border px-4 text-sm font-medium hover:bg-muted"
            : "inline-flex min-h-10 items-center rounded-lg bg-foreground px-5 text-sm font-semibold text-background hover:bg-foreground/90"}
          href={href}
        >
          {action}<span className="sr-only">: {activity.title}</span>
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
        <a className="inline-flex min-h-10 items-center rounded-lg border px-4 text-sm font-medium" href={material.href} download={material.fileName}>
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
        <p className="text-xs font-semibold uppercase tracking-wider text-emerald-300">Prima di iniziare</p>
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
    // Un blocco con attività ancora da fare non è «passato»: gli esercizi
    // possono essere compiti da fare dopo la lezione, e non devono sembrare chiusi.
    const pending = activities.some((activity) => activity.availability.writeAccess && activity.status !== "submitted");
    const past = !pending && (live ? elapsed! >= block.to_minute : elapsed !== null && elapsed >= module.durationMinutes);
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
  const showResults = program.canReview || program.canAggregate || program.canExport || program.canManage;
  const modules = program.modules.filter((module) => !moduleId || module.id === moduleId);
  const before = program.materials.filter((material) => material.downloadBefore && (!moduleId || !material.moduleId || material.moduleId === moduleId));

  return (
    <LearningShell workspaceId={workspaceId} title={program.title}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Pagine del corso" className="flex flex-wrap gap-x-5 text-sm">
          <Link className={navLink} href={base}>Il percorso</Link>
          {program.canParticipate && <>
            <Link className={navLink} href={`${base}/progress`}>Il mio risultato</Link>
            <Link className={navLink} href={`${base}/ideas`}>La mia idea</Link>
          </>}
          {showResults && <Link className={cn(navLink, "font-medium")} href={`${base}/results`}>Risultati</Link>}
          {program.canManage && <Link className={navLink} href={`${base}/admin`}>Gestisci corso</Link>}
        </nav>
        <LearningRefresh label="Aggiorna" />
      </div>

      <BeforeYouStart materials={before} />

      <div className="grid gap-5">
        {modules.map((module) => {
          const isOwn = own?.moduleId === module.id;
          const moduleSessions = program.sessions.filter((session) => session.moduleId === module.id);
          const ended = isOwn && own && (own.status === "closed" || program.now >= new Date(own.endsAt).getTime());
          const moduleMaterials = program.materials.filter((material) => material.moduleId === module.id && !material.downloadBefore);
          const operational = module.activities.length > 0 || module.agenda.length > 0;
          const learner = isOwn && program.canParticipate;
          const hasResults = learner && module.activities.some((activity) => latestResult(activity, program.history));
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

                {hasResults && <LearnerResultSummary module={module} history={program.history} base={base} />}

                {learner && !hasResults && module.completion.required > 0 && (
                  <p className="text-sm font-medium" data-testid="learning-module-progress">
                    Esercizi fatti: {module.completion.submitted} di {module.completion.required}
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
          Stai guardando il corso come formatore: vedi tutte le scalette e tutti i materiali. I risultati dei partecipanti sono nella pagina Risultati.
        </p>
      )}

      <details className="rounded-xl border px-4 py-3">
        <summary className="cursor-pointer py-1 font-medium">Chi vede le tue risposte</summary>
        <div className="mt-3 space-y-3 text-sm">
          <p>Le risposte sono legate al tuo account. Le vedi tu e i formatori del corso. La direzione vede solo i risultati di gruppo.</p>
          <p className="whitespace-pre-wrap">{program.visibilityPolicy}</p>
          <p>Le risposte restano conservate {program.retentionDays} giorni dopo la chiusura del corso.</p>
          <p>{participantNotice}</p>
          {program.reviewers.length > 0 && <p>Formatori del tuo turno: {program.reviewers.join(", ")}.</p>}
        </div>
      </details>
    </LearningShell>
  );
}
