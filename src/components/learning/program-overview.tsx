import type { ReactNode } from "react";
import Link from "next/link";
import { ChartColumn, Download, Play, RotateCcw, Settings2 } from "lucide-react";
import { LearningError, getLearningProgram } from "@/lib/learning/server";
import { participantNotice } from "@/lib/learning/register-legal";
import { LEARNING_ROWS_SHOWN, LEARNING_TEXT } from "@/lib/learning/text";
import {
  agendaBlocks,
  exerciseRow,
  lessonPhase,
  lessonWhen,
  liveRefreshFrom,
  nowCard,
  outcomeWord,
  sizeLabel,
  type CourseActivity,
  type NowAction,
} from "@/lib/learning/course-view";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/uc/ui/status-dot";
import { Fold } from "@/components/ui-10/fold";
import { NextStep, type NextStepItem } from "@/components/ui-10/next-step";
import { Row, RowList, TextAction } from "@/components/ui-10/row";
import { cn } from "@/lib/utils";
import { LearningShell, ProgramUnavailable } from "./learning-shell";
import { LiveRefresh } from "./live-refresh";

/**
 * Il corso visto da chi lo segue (rilascio 10, ondata 7a, docs/ui-10/PROPOSTA-10.md §3.9), dall'alto in basso:
 * - il titolo e la riga «La tua lezione: lunedì 24 novembre, 14:30–16:30»;
 * - la card «Adesso», con il solo pulsante pieno della pagina: prima della lezione «Scarica i materiali», durante
 *   «Inizia: {esercizio aperto}», dopo «2 di 3 esercizi fatti» con «Rifai…» quando c'è da ripassare;
 * - «Scaletta», aperta in lezione, con gli orari veri e «Siamo qui»;
 * - «Esercizi», l'unico posto con gli esiti, con «Tutte le prove» (prima la pagina «Il mio risultato»);
 * - «Materiali», «Da portare a casa» (dopo la lezione), «Prossimi moduli (N)» e «Chi vede le tue risposte», chiusi.
 * In lezione la pagina si aggiorna da sola ogni 15 secondi (`LiveRefresh`), al posto di «Aggiorna».
 *
 * Chi tiene il corso e non lo segue vede le stesse sezioni senza la card «Adesso», con «Risultati» e «Gestisci» in
 * testata. Le regole stanno in `@/lib/learning/course-view` (pure, con i test); tutto viene dal corso, niente è scritto
 * qui per un corso solo.
 */

type Program = Awaited<ReturnType<typeof getLearningProgram>>;
type ModuleView = Program["modules"][number];
type Material = Program["materials"][number];

const T = LEARNING_TEXT.course;

/** Le prime tre righe di una lista, le altre dietro «Vedi tutti (N)» (§1, regola 4). Senza JavaScript. */
function ShowAllRows<Item>({ items, render, label }: { items: readonly Item[]; render: (item: Item) => ReactNode; label: string }) {
  const shown = items.slice(0, LEARNING_ROWS_SHOWN);
  const rest = items.slice(LEARNING_ROWS_SHOWN);
  return <>
    <RowList label={label}>{shown.map(render)}</RowList>
    {rest.length ? (
      <details data-slot="show-all" className="group">
        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center rounded-md text-sm font-medium underline decoration-foreground/40 underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-8 [&::-webkit-details-marker]:hidden">
          {T.showAll(items.length)}
        </summary>
        <RowList className="mt-3" label={label}>{rest.map(render)}</RowList>
      </details>
    ) : null}
  </>;
}

/**
 * Un materiale: tutta la riga scarica il file. Un link nativo e non `<Link>`: un prefetch del router non deve scaricare
 * né contare nulla.
 */
function MaterialRow({ material }: { material: Material }) {
  const facts = [material.fileName, sizeLabel(material.sizeBytes), material.forTrainers ? T.materials.forTrainers : null].filter(Boolean).join(" · ");
  const body = <>
    <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
      <span className="min-w-0 font-medium break-words">{material.title}</span>
      <span className="min-w-0 break-words text-muted-foreground sm:text-right">{material.access.downloadable ? facts : material.access.reason ?? T.materials.notYet}</span>
    </span>
  </>;
  const row = "group flex min-h-11 w-full min-w-0 items-center gap-3 px-4 py-3 text-left text-sm outline-none transition-colors focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50 sm:min-h-12";
  return <li>
    {material.access.downloadable ? (
      <a data-slot="row" className={cn(row, "hover:bg-muted/40")} href={material.href} download={material.fileName}>
        {body}
        <Download aria-hidden className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
        <span className="sr-only">{T.materials.download}</span>
      </a>
    ) : (
      <div data-slot="row" className={row}>{body}</div>
    )}
  </li>;
}

function nowStep(action: NowAction): NextStepItem {
  const icon = action.kind === "redo" ? RotateCcw : action.kind === "download" || action.kind === "materials" ? Download : Play;
  if (action.kind === "download") return { label: action.label, icon, why: T.now.why, mine: true, link: <a href={action.href} download={action.fileName} /> };
  // Un link nativo verso la piega: il cambio d'ancora la apre (`Fold` ascolta «hashchange»).
  if (action.kind === "materials") return { label: action.label, icon, why: T.now.why, mine: true, link: <a href={action.href} /> };
  return { label: action.label, icon, why: T.now.why, mine: true, href: action.href };
}

function NowCardView({ card }: { card: ReturnType<typeof nowCard> }) {
  const counted = card.phase === "after";
  return <section aria-labelledby="adesso-titolo" data-testid="learning-now" className="space-y-3 rounded-xl border bg-card p-4 sm:p-5">
    <h2 id="adesso-titolo" className="text-base font-semibold">{T.now.title}</h2>
    <p data-testid="learning-now-line" className={counted ? "text-lg font-semibold tabular-nums" : "text-sm"}>{card.line}</p>
    {card.note ? <p className="text-sm text-muted-foreground">{card.note}</p> : null}
    {card.action ? <NextStep id="adesso" step={nowStep(card.action)} /> : null}
    {card.steps.length ? (
      <ol className="list-decimal space-y-1 pl-5 text-sm">{card.steps.map((step) => <li key={step}>{step}</li>)}</ol>
    ) : null}
  </section>;
}

function Agenda({ module, session, now, open }: { module: ModuleView; session: Program["ownSession"]; now: number; open: boolean }) {
  const blocks = agendaBlocks(module.agenda, session, now);
  if (!blocks.length) return null;
  return <Fold id="scaletta" title={T.agenda.title} defaultOpen={open}>
    <ol className="space-y-2" aria-label={T.agenda.label}>
      {blocks.map((block) => <li
        key={block.key}
        aria-current={block.current ? "step" : undefined}
        className={cn("rounded-xl border p-3", block.current && "border-foreground bg-muted/40", block.past && "text-muted-foreground")}
      >
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-sm tabular-nums text-muted-foreground">{block.time}</span>
          <span className="font-medium">{block.title}</span>
          {block.current ? <span className="rounded-full bg-foreground px-2 py-0.5 text-xs font-medium text-background">{T.agenda.here}</span> : null}
        </div>
        {block.detail ? <p className="mt-1 text-sm text-muted-foreground">{block.detail}</p> : null}
      </li>)}
    </ol>
  </Fold>;
}

function Exercises({ program, module, base, participant }: { program: Program; module: ModuleView; base: string; participant: boolean }) {
  const activities: readonly CourseActivity[] = module.activities;
  if (!activities.length) return null;
  const E = T.exercises;
  const history = participant ? [...program.history].reverse() : [];
  return <section aria-labelledby="esercizi-titolo" id="esercizi" className="scroll-mt-20 space-y-3">
    <h2 id="esercizi-titolo" className="text-base font-semibold">{E.title}</h2>
    <ShowAllRows label={E.label} items={activities} render={(activity) => {
      if (!participant) {
        const facts = [activity.estimatedMinutes ? E.minutes(activity.estimatedMinutes) : null, activity.required ? null : E.notCounted].filter(Boolean).join(" · ");
        return <li key={activity.id}><Row title={activity.title} fact={facts || null} /></li>;
      }
      const row = exerciseRow(activity, base, program.now);
      const fact = <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 sm:justify-end">
        <StatusDot tone={row.tone} label={row.state} size="md" />
        {row.fact ? <span>{row.fact}</span> : null}
      </span>;
      return <li key={activity.id} data-testid="learning-exercise"><Row title={row.title} fact={fact} href={row.href ?? undefined} /></li>;
    }} />
    {history.length ? (
      <Fold id="prove" title={E.attempts(history.length)}>
        <RowList label={E.attempts(history.length)}>
          {history.map((attempt) => {
            const fact = attempt.result ? `${E.score(attempt.result.correct, attempt.result.total)} · ${outcomeWord(attempt.result.status)}` : attempt.status === "submitted" ? outcomeWord("submitted") : E.inProgress;
            return <li key={attempt.id}>
              <Row title={E.attempt(attempt.activityTitle, attempt.attemptNumber)} fact={fact} href={`${base}/attempts/${attempt.id}`} />
            </li>;
          })}
        </RowList>
      </Fold>
    ) : null}
    {participant ? <TextAction href={`${base}/ideas`}>{E.idea}</TextAction> : null}
  </section>;
}

function Takeaways({ module }: { module: ModuleView }) {
  if (!module.takeaways.length && !module.nextSteps.length) return null;
  return <Fold id="da-portare-a-casa" title={T.takeaways.title}>
    {module.takeaways.length ? <ol className="list-decimal space-y-1 pl-5 text-sm">{module.takeaways.map((item) => <li key={item}>{item}</li>)}</ol> : null}
    {module.nextSteps.length ? <div className="space-y-2">
      <h3 className="text-sm font-medium">{T.takeaways.nextSteps}</h3>
      <ol className="list-decimal space-y-1 pl-5 text-sm">{module.nextSteps.map((item) => <li key={item}>{item}</li>)}</ol>
    </div> : null}
  </Fold>;
}

function NextModules({ program, modules, open }: { program: Program; modules: ModuleView[]; open: boolean }) {
  if (!modules.length) return null;
  return <Fold id="prossimi-moduli" title={T.nextModules.title(modules.length)} defaultOpen={open}>
    {modules.map((module) => {
      const sessions = program.sessions.filter((session) => session.moduleId === module.id);
      const materials = program.materials.filter((material) => material.moduleId === module.id);
      return <div key={module.id} className="space-y-2">
        <h3 className="font-medium">{module.title}</h3>
        {module.subtitle ? <p className="text-sm text-muted-foreground">{module.subtitle}</p> : null}
        {module.objective ? <p className="text-sm">{module.objective}</p> : null}
        {sessions.length ? <div className="text-sm">
          <p className="text-muted-foreground">{T.nextModules.dates}</p>
          <ul className="list-disc pl-5">{sessions.map((session) => <li key={session.id}>{lessonWhen(session)}</li>)}</ul>
        </div> : <p className="text-sm text-muted-foreground">{T.nextModules.planned}</p>}
        {materials.length ? <RowList label={`${T.materials.title}: ${module.title}`}>{materials.map((material) => <MaterialRow key={material.id} material={material} />)}</RowList> : null}
      </div>;
    })}
  </Fold>;
}

export async function ProgramOverview({ workspaceId, programId, moduleId, arrival = null }: { workspaceId: string; programId: string; moduleId?: string; arrival?: string | null }) {
  let program: Program;
  try {
    program = await getLearningProgram(workspaceId, programId);
  } catch (error) {
    // Un altro account, nessuna iscrizione, un corso sospeso o nascosto: la spiegazione, non «Riprova». Gli errori veri
    // restano a `learning/error.tsx`.
    if (error instanceof LearningError && error.code === "forbidden") return <ProgramUnavailable workspaceId={workspaceId} />;
    throw error;
  }
  const base = `/dashboard/${workspaceId}/learning/${programId}`;
  const participant = program.canParticipate;
  const own = participant ? program.ownSession : null;
  const showResults = program.canReview || program.canAggregate || program.canExport || program.canManage;

  // Il modulo in primo piano: quello della propria lezione; per chi tiene il corso quello dell'indirizzo (`/m2`), o il
  // primo. Gli altri vanno in «Prossimi moduli», che si apre da sé quando l'indirizzo chiede uno di loro.
  const ownModule = own ? program.modules.find((module) => module.id === own.moduleId) : undefined;
  const focus = ownModule ?? program.modules.find((module) => module.id === moduleId) ?? program.modules.find((module) => module.id === "m1") ?? program.modules[0];
  const others = program.modules.filter((module) => module.id !== focus?.id);
  const askedOther = !!moduleId && moduleId !== focus?.id && others.some((module) => module.id === moduleId);

  const phase = lessonPhase(own, program.now);
  const ownMaterials = program.materials.filter((material) => !material.moduleId || material.moduleId === focus?.id);
  const card = participant && focus
    ? nowCard({
      session: own,
      now: program.now,
      activities: focus.activities,
      beforeMaterials: ownMaterials.filter((material) => material.downloadBefore),
      base,
      courseOpen: program.status === "published",
    })
    : null;
  const refreshFrom = participant ? liveRefreshFrom(own, program.now) : null;
  const ended = phase === "after";

  // «Risultati» e «Gestisci» restano a un tocco per chi ha i permessi, anche se segue il corso: per chi lo tiene soltanto
  // «Risultati» è il pulsante pieno; per chi lo segue il pieno è quello della card «Adesso», e qui restano bordati.
  const actions = showResults ? <>
    <Button render={<Link href={`${base}/results`} />} nativeButton={false} variant={participant ? "outline" : "default"} className="min-h-11 flex-1 sm:min-h-9 sm:flex-none" data-action={participant ? undefined : "next-step"}>
      <ChartColumn aria-hidden data-icon="inline-start" />{T.results}
    </Button>
    {program.canManage ? <Button render={<Link href={`${base}/admin`} />} nativeButton={false} variant="outline" className="min-h-11 flex-1 sm:min-h-9 sm:flex-none">
      <Settings2 aria-hidden data-icon="inline-start" />{T.manage}
    </Button> : null}
  </> : null;
  const subtitle = participant ? (own ? T.lesson(lessonWhen(own)) : null) : T.trainerLine;

  return (
    <LearningShell workspaceId={workspaceId} title={program.title} subtitle={subtitle} actions={actions} size="narrow">
      {refreshFrom !== null ? <LiveRefresh from={refreshFrom} /> : null}
      {arrival ? (
        <p role="status" className="rounded-xl border bg-muted/40 px-4 py-3 text-sm" data-testid="join-arrival">
          {arrival}
        </p>
      ) : null}

      {card ? <NowCardView card={card} /> : null}

      {focus ? <>
        {focus.agenda.length ? <div><Agenda module={focus} session={own} now={program.now} open={phase === "live"} /></div> : null}
        <Exercises program={program} module={focus} base={base} participant={participant} />
        <div>
          {ownMaterials.length ? <Fold id="materiali" title={T.materials.title}>
            <RowList label={T.materials.title}>{ownMaterials.map((material) => <MaterialRow key={material.id} material={material} />)}</RowList>
          </Fold> : null}
          {!participant || ended ? <Takeaways module={focus} /> : null}
          <NextModules program={program} modules={others} open={askedOther} />
          {participant ? <Fold id="chi-vede" title={T.privacy.title}>
            <div className="space-y-3 text-sm">
              {program.visibilityPolicy ? <p className="whitespace-pre-wrap">{program.visibilityPolicy}</p> : null}
              <p>{participantNotice}</p>
              <p className="text-muted-foreground">
                {T.privacy.retention(program.retentionDays)}
                {program.reviewers.length ? ` ${T.privacy.trainers(program.reviewers.join(", "))}` : ""}
              </p>
            </div>
          </Fold> : null}
        </div>
      </> : null}
    </LearningShell>
  );
}
