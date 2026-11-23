import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { QUALITY_ANCHORS, QUALITY_TEXT, hasMeasures, qualitySummary } from "@/components/agent-factory/eval-format";
import { readEvalOrigins, readEvalOverview } from "@/components/agent-factory/eval-load";
import { EvalSection } from "@/components/agent-factory/eval-section";
import { EvalSummary } from "@/components/agent-factory/eval-summary";
import { UseCaseContextView } from "@/components/context/use-case-context";
import { contextFoldSummary, packageDeltaLine, packageFilesShown } from "@/components/context/view-model";
import { PageContainer } from "@/components/dashboard/page-container";
import { Fold } from "@/components/ui-10/fold";
import { casePath } from "@/components/uc/catalog/paths";
import { ClaudeDevPanel } from "@/components/uc/mcp/claude-dev-panel";
import { canWrite, headerStepShownOn, loadCaseHead } from "@/components/uc/shell/case-data";
import { StatusDot } from "@/components/uc/ui/status-dot";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { contextActorFor, type ContextActor } from "@/lib/context/server/actor";
import { CONTEXT_TEXT } from "@/lib/context/text";
import { loadAgentContext, loadUseCaseContext, type UseCaseContext } from "@/lib/db/queries/context-work";
import { listCaseReadTokens } from "@/lib/db/queries/uc-mcp";
import { factoryStoreReady, readFactory, findUseCaseOfCase, namesToHide, type DecisionView, type FactoryTarget, type FactoryView, type ProjectView } from "@/lib/db/queries/use-case-factory";
import { hasCaseOnlyBuilder } from "@/lib/db/queries/use-case-builders";
import { FACTORY_LIMITS, SETUP_TOPICS } from "@/lib/db/use-case-hub-factory-ddl";
import { listTasks, tasksStoreReady, type TaskView } from "@/lib/db/queries/use-case-tasks";
import { listOpenProposals, proposalsStoreReady, type ProposalView } from "@/lib/db/queries/use-case-task-proposals";
import type { UcExecutor } from "@/lib/db/uc-executor";
import { canOpenShellPage, pastViaPhase } from "@/lib/uc/views/case-shell";
import {
  CONSTRUCTION_TEXT as T,
  TASKS_ALL_PARAM,
  TASKS_ALL_VALUE,
  TASKS_SHOWN,
  agentFoldSummary,
  choicesMade,
  constructionTopicLabel,
  missingChoices,
  projectAction,
  projectStateLine,
  projectTone,
  seesBuildDetails,
  tasksInOrder,
  tasksTally,
  type TaskStatusKey,
} from "@/lib/uc/views/construction";
import { canOpenPage } from "@/lib/uc/views/page-access";
import { isLsViewer } from "@/lib/uc/views/status-groups";
import type { SemaforoColor } from "@/lib/uc/vocab";
import { loadFactoryAccess } from "@/lib/use-cases/factory/access";
import { caseOnlyPackageFiles, packageContextDelta } from "@/lib/use-cases/factory/package";
import { isCaseOnly } from "@/lib/auth/case-only";
import { aiBoardOkRule, AI_BOARD_NOTE_MIN, canApproveProject, canRequestProjectChange, canWriteFactory } from "@/lib/use-cases/factory/permissions";
import { romeToday } from "@/lib/use-cases/quarter";
import { cn } from "@/lib/utils";
import { AiBoardOk, DecisionForm, DetailsEditor, PackageButton, ProjectPrimaryAction, ProposalButtons, ReopenProject, TopicEditor } from "./project-forms";

/**
 * La Costruzione (rilascio 10, docs/ui-10/PROPOSTA-10.md §3.5, D9 (a)): il progetto dell'agente della realizzazione
 * (rilascio 8.0a) con i compiti (8.1a, 8.1b), la qualità (8.2a, 8.2b) e, per chi costruisce, «Per il coding agent».
 * Dopo il via allo sviluppo è la seconda scheda, al posto di Domande (che resta a un tocco, «Catalogo ›»); prima del
 * via si apre dal «⋯». La leggono il team della realizzazione e l'AI Board; gli altri ricevono 404
 * (`UC_SHELL_PAGE_ROLES.costruzione`). `/progetto` porta qui con un 308 (le sue ancore restano: `#banco`, `#compiti`,
 * `#contesto`).
 *
 * - In vista: lo stato del progetto («Approvato · versione 2 · 10 di 10 scelte»), la sua sola azione (il pulsante pieno
 *   della pagina; bordata quando la testata mostra qui il suo passo: riconfermare il via, firmare, riprendere), i
 *   Compiti (al massimo 3 righe, poi «Vedi tutti (N)»; le proposte con «Accetta» bordato) e «Qualità» in una riga,
 *   con per ogni ruolo la sola raccomandazione del banco.
 * - In piega, chiuse finché un link non le apre: Scelte (i 10 argomenti, gli strumenti nuovi e la stima, la versione
 *   approvata di prima) · Decisioni · Contesto (9b, l'ancora di «Il contesto è cambiato») · «Per il coding agent»
 *   (pacchetto, comandi e gli accessi di Claude, che prima stavano nel via).
 * - Ai ruoli del cliente la qualità è una frase sola: niente comandi, rami, commit o p95 (`seesBuildDetails`). Chi
 *   scrive, approva e dà l'ok dell'AI Board è quello di prima (`loadFactoryAccess`, i permessi della fabbrica).
 *
 * Una lettura che non riesce (evals, contesto, novità del pacchetto) non fa cadere la pagina.
 *
 * (8.0d) È anche la pagina di «Solo questo use case» (`esterno_caso`), una porta di `CASE_ONLY_SURFACES`: «Progetto
 * dell'agente» della specifica, con la sua «Qualità» (evals e banco). Il caso poi vuole il predicato (`loadCaseHead` →
 * `caseAccessPrecheck`: un caso fuori risponde 404); il pacchetto ha `CONTESTO.md` con i soli fatti del caso (D7), e il
 * contesto dell'azienda non si legge (`contextAbilities` non apre a chi non è collaboratore).
 */

const day = (iso: string | null) => (iso ? new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Rome" }).format(new Date(iso)) : "");
const amount = (n: number, digits: number) => new Intl.NumberFormat("it-IT", { maximumFractionDigits: digits, useGrouping: "always" }).format(n);
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const TASK_TONE: Readonly<Record<TaskStatusKey, SemaforoColor>> = { da_fare: "grigio", in_corso: "blu", in_revisione: "giallo", fatto: "verde", annullato: "grigio" };

/** Le scelte di una versione, in sola lettura (anche per la versione approvata mentre se ne prepara un'altra). */
function ChoiceText({ choice }: { choice: ProjectView["topics"][keyof ProjectView["topics"]] | null }) {
  if (!choice) return <p className="mt-0.5 text-sm text-muted-foreground">{T.choiceTodo}</p>;
  return (
    <>
      <p className="mt-0.5 text-sm break-words">{choice.scelta}</p>
      {choice.perche ? <p className="mt-0.5 text-xs break-words text-muted-foreground">{T.choiceWhy(choice.perche)}</p> : null}
      {choice.alternativa ? <p className="mt-0.5 text-xs break-words text-muted-foreground">{T.choiceDropped(choice.alternativa)}</p> : null}
    </>
  );
}

/** Un compito: riferimento, titolo e lo stato a puntino; i dettagli a richiesta. Ramo e modifica solo a chi costruisce. */
function TaskLine({ t, details }: { t: TaskView; details: boolean }) {
  const holder = (t.status === "in_corso" || t.status === "in_revisione") && t.holderName ? t.holderName : undefined;
  const lines = [
    t.areas.length ? T.taskAreas(t.areas) : null,
    t.estimateHours !== null ? T.taskEstimate(String(t.estimateHours).replace(".", ",")) : null,
    t.evidence ? T.taskEvidence(t.evidence) : null,
    details && t.branch ? T.taskBranch(t.branch) : null,
  ].filter((l): l is string => l !== null);
  const pr = details && t.prUrl ? t.prUrl : null;
  const head = (
    <>
      <span className={cn("min-w-0 text-sm break-words", t.status === "annullato" && "text-muted-foreground line-through")}>
        <span className="font-medium tabular-nums">{t.ref}</span> · {t.title}
      </span>
      <StatusDot tone={TASK_TONE[t.status]} label={T.taskStatus[t.status]} sublabel={holder} className="shrink-0" />
    </>
  );
  if (lines.length === 0 && !pr) {
    return <li className="flex min-h-11 items-center justify-between gap-3 py-2.5 sm:min-h-0">{head}</li>;
  }
  return (
    <li>
      <details className="py-2.5">
        <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 sm:min-h-0">{head}</summary>
        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
          {lines.map((l) => (
            <p key={l} className="break-words">
              {l}
            </p>
          ))}
          {pr ? (
            <p>
              <a href={pr} className="underline" target="_blank" rel="noreferrer">
                {T.taskChange}
              </a>
            </p>
          ) : null}
        </div>
      </details>
    </li>
  );
}

function ProposalLine({ p, ids }: { p: ProposalView; ids: { workspaceId: string; caseId: string } | null }) {
  const from = T.proposalFrom(p.source === "github" ? "github" : "slack");
  return (
    <li className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 text-sm">
        <p className="break-words">{p.title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {p.link ? (
            <a href={p.link} className="underline" target="_blank" rel="noreferrer">
              {from}
            </a>
          ) : (
            from
          )}{" "}
          · {T.proposalOn(day(p.createdAt))}
          {p.existingRef ? ` · ${T.proposalExisting(p.existingRef)}` : ""}
        </p>
      </div>
      {ids ? <ProposalButtons workspaceId={ids.workspaceId} caseId={ids.caseId} proposalId={p.id} title={p.title} /> : null}
    </li>
  );
}

function DecisionLine({ d }: { d: DecisionView }) {
  return (
    <li className="py-2.5 text-sm">
      <p className={d.supersededOn ? "text-muted-foreground" : undefined}>
        <span className="tabular-nums text-muted-foreground">{day(d.decidedOn)}</span> · <span className="font-medium">{constructionTopicLabel(d.topicKey, d.topic)}</span> ·{" "}
        <span className={d.supersededOn ? "line-through" : undefined}>{d.choice}</span>
      </p>
      {d.supersededOn ? <p className="mt-0.5 text-xs text-muted-foreground">{T.decisionReplaced(day(d.supersededOn))}</p> : d.reason ? <p className="mt-0.5 text-xs break-words text-muted-foreground">{d.reason}</p> : null}
    </li>
  );
}

/** Un comando da lanciare: il testo e il comando, tutto selezionato con un clic. */
function CommandLine({ label, command }: { label: string; command: string }) {
  return (
    <p className="text-xs text-muted-foreground">
      {label}{" "}
      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] break-words text-foreground select-all box-decoration-clone">{command}</code>
    </p>
  );
}

/**
 * (9b) Il contesto dello use case per chi guarda (anche vuoto: la piega c'è, ed è l'ancora della campanella). null
 * senza l'archivio di «Contesto», per chi non apre «Contesto» o se la lettura non riesce.
 */
async function readContextSection(actor: ContextActor, useCaseId: string): Promise<UseCaseContext | null> {
  try {
    return await loadUseCaseContext(actor, useCaseId);
  } catch (error) {
    console.error("[costruzione] context_failed", { error: { name: error instanceof Error ? error.name : "Error" } });
    return null;
  }
}

/**
 * (8.0d, D7) Il progetto come lo legge «Solo questo use case», e chiunque legga un caso che costruisce qualcuno «Solo
 * questo use case»: `CONTESTO.md` del pacchetto con i soli fatti del caso (quello che si copia finisce nel repository).
 */
function caseOnlyView(view: FactoryView): FactoryView {
  return view.latestPackage ? { ...view, latestPackage: { ...view.latestPackage, files: caseOnlyPackageFiles(view.latestPackage.files) } } : view;
}

/**
 * (9b) Le novità del contesto dopo l'ultimo pacchetto (`packageContextDelta`); zero se la lettura non riesce. (8.0d, D7)
 * Con `caseOnlyContext`, sui soli fatti del caso.
 */
async function readContextDelta(executor: UcExecutor, target: FactoryTarget, code: string, latest: NonNullable<FactoryView["latestPackage"]>, caseOnlyContext: boolean): Promise<number> {
  try {
    const [context, names] = await Promise.all([loadAgentContext({ ...target, caseOnly: caseOnlyContext }), namesToHide(executor, target)]);
    return packageContextDelta({ context, namesToHide: names, code, latest, caseOnly: caseOnlyContext });
  } catch (error) {
    console.error("[costruzione] context_delta_failed", { error: { name: error instanceof Error ? error.name : "Error" } });
    return 0;
  }
}

function NotYet() {
  return (
    <PageContainer>
      <p className="text-sm text-muted-foreground">{T.unavailable}</p>
    </PageContainer>
  );
}

export default async function ConstructionPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string; caseId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceId, caseId } = await params;
  // (8.0d) Una porta di «Solo questo use case» (`CASE_ONLY_SURFACES`): il dossier poi vuole il predicato per questo caso
  // (`caseAccessPrecheck`), e un caso fuori risponde 404. Della memoria del cliente legge solo i fatti del suo caso (D7).
  const { session, access } = await requireWorkspacePage(workspaceId, { allowCaseOnly: true });
  const caseOnly = isCaseOnly(access.role);
  const { caseAccess, executor, header } = await loadCaseHead(workspaceId, caseId, session.user.id, access.role);
  const roles = caseAccess.roles;
  if (!canOpenShellPage("costruzione", roles)) notFound();

  if (!(await factoryStoreReady(executor))) return <NotYet />;
  const useCase = await findUseCaseOfCase(executor, workspaceId, caseId);
  if (!useCase) notFound();
  const target = { workspaceId, useCaseId: useCase.useCaseId };
  // (8.0c) I ruoli della fabbrica: quelli del caso, più `builder_esterno` per chi costruisce da fuori.
  const factory = await loadFactoryAccess(executor, caseAccess);
  if (factory.blocked === "non_disponibile") return <NotYet />;
  const read = await readFactory(executor, target, { kind: "persona", userId: session.user.id, roles: factory.roles });
  if (!read.ok) notFound();
  // (8.0d, D7) «Solo questo use case», e chiunque legga un caso che costruisce qualcuno «Solo questo use case», legge il
  // pacchetto con `CONTESTO.md` ridotto ai fatti del caso.
  const caseOnlyContext = caseOnly || (await hasCaseOnlyBuilder(executor, target));
  const view = caseOnlyContext ? caseOnlyView(read.value) : read.value;

  const c = header.case;
  const base = casePath(workspaceId, caseId, "costruzione");
  const writable = canWrite(caseAccess);
  // Chi costruisce: scrive il progetto e legge il pacchetto (che è per i coding agent, non per il cliente).
  const builder = canWriteFactory(factory.roles);
  const writer = builder && !factory.readOnly && caseAccess.status !== "chiuso";
  const approver = writable && canApproveProject(roles);
  const board = writable ? aiBoardOkRule(roles) : { allowed: false, noteRequired: false };
  const boardMember = writable && canRequestProjectChange(roles);
  const ls = isLsViewer(roles);
  // I dettagli di chi costruisce (comandi, rami, banco intero, pacchetto): chi costruisce e Lateral Space.
  const details = seesBuildDetails({ builder, lateralSpace: ls || caseAccess.user.isLateralSpace });
  const pastVia = pastViaPhase(c);

  const project = view.open ?? view.approved;
  const open = view.open;
  const editable = writer && open?.status === "in_corso";
  const pending = open?.status === "da_approvare" ? open : null;
  const needsBoard = pending !== null && pending.newTools.length > 0 && !pending.aiBoardOkAt;
  const changeRequest = open?.changeRequest ? { text: open.changeRequest, on: open.changeRequestedAt } : null;
  // (Rilascio 10, §3.5) La Costruzione è una scheda: il passo della testata resta (riconfermare il via, firmare,
  // riprendere), e allora l'azione del progetto è bordata. Un solo pulsante pieno per schermata. (8.0d) A «Solo questo
  // use case» la testata non mostra passi: il pulsante pieno è quello del progetto.
  const headerStep = !caseOnly && headerStepShownOn(caseAccess, header, { caseBase: casePath(workspaceId, caseId), pagePath: base });
  const { action, reopenAside, filled } = projectAction({
    hasProject: project !== null,
    openStatus: open?.status === "in_corso" || open?.status === "da_approvare" ? open.status : null,
    writer,
    approver,
    needsBoard,
    boardAllowed: board.allowed,
    changeRequested: changeRequest !== null,
    headerStep,
  });
  const missing = open?.status === "in_corso" ? missingChoices(open.topics) : [];
  const hint = missing.length > 0 && writer ? T.missing(missing) : needsBoard && !changeRequest ? T.boardOkNeeded : null;
  const previous = open && view.approved ? view.approved : null;

  const okBoard = pending ? (
    <AiBoardOk
      workspaceId={workspaceId}
      caseId={caseId}
      noteRequired={board.noteRequired}
      canAskChange={boardMember}
      revision={pending.revision}
      tools={pending.newTools}
      noteMin={AI_BOARD_NOTE_MIN}
      noteMax={FACTORY_LIMITS.aiBoardNote}
      filled={filled}
    />
  ) : null;
  const reopen = pending ? <ReopenProject workspaceId={workspaceId} caseId={caseId} revision={pending.revision} boardOkOn={pending.aiBoardOkAt ? day(pending.aiBoardOkAt) : null} primary={action === "riapri" && filled} /> : null;
  const primaryAction =
    action === "ok_board" ? okBoard : action === "riapri" ? reopen : action ? <ProjectPrimaryAction workspaceId={workspaceId} caseId={caseId} action={action} revision={open?.revision ?? null} blocked={missing.length > 0} filled={filled} /> : null;

  const teamDecisions = view.decisions.filter((d) => d.source !== "impostazione" && d.supersededOn === null);
  const replaced = view.decisions.filter((d) => d.supersededOn !== null).length;
  const tasksReady = await tasksStoreReady(executor);
  // Compiti, evals con la loro fonte (8.2b), contesto, novità del pacchetto e accessi di Claude: insieme, e nessuna lettura
  // fa cadere la pagina. Gli accessi di Claude solo a Lateral Space dopo il via, come nel via di prima.
  const claudeShown = ls && pastVia;
  const [tasks, evals, context, contextDelta, tokens] = await Promise.all([
    tasksReady ? listTasks(executor, target) : Promise.resolve<TaskView[]>([]),
    readEvalOverview(executor, target).then(async (r) => ({ ...r, origins: await readEvalOrigins(executor, target, r.overview) })),
    readContextSection(contextActorFor(session.user, access, workspaceId), useCase.useCaseId),
    builder && view.latestPackage ? readContextDelta(executor, target, useCase.code ?? "", view.latestPackage, caseOnlyContext) : Promise.resolve(0),
    claudeShown ? listCaseReadTokens(executor, workspaceId, caseId) : Promise.resolve([]),
  ]);
  const deltaLine = packageDeltaLine(contextDelta);
  // Le proposte sono testi del team: le vede solo chi costruisce (anche da fuori), le decide chi tra loro può scrivere.
  const proposals = tasksReady && builder && (await proposalsStoreReady(executor)) ? await listOpenProposals(executor, target) : [];
  const caseCode = useCase.code ?? "<ID>";

  const sp = await searchParams;
  const allTasks = first(sp[TASKS_ALL_PARAM]) === TASKS_ALL_VALUE;
  const ordered = tasksInOrder(tasks);
  const shownTasks = allTasks ? ordered : ordered.slice(0, TASKS_SHOWN);
  const tally = tasksTally(tasks);
  const tasksShown = tasksReady && (tasks.length > 0 || proposals.length > 0 || (view.approved !== null && details));

  const summary = qualitySummary(evals.overview, { builder: details });
  const qualityShown = details || summary !== null;
  const ciLinks = builder || caseAccess.user.isLateralSpace;

  const catalogHref = pastVia && canOpenPage("voci", roles) ? casePath(workspaceId, caseId, "domande") : null;
  const backtestHref = details && canOpenPage("modello_dati", roles) ? `${casePath(workspaceId, caseId, "soluzione/dati")}?vista=prova` : null;
  const decisionsShown = view.decisions.length > 0 || writer;
  const agentShown = builder || claudeShown;

  return (
    <PageContainer>
      <div className="max-w-3xl min-w-0 space-y-8">
        <section aria-labelledby={T.projectHeadingId} className="min-w-0 space-y-3">
          <h2 id={T.projectHeadingId} tabIndex={-1} className="text-base font-semibold outline-none">
            {T.project}
          </h2>
          <p className="text-sm">
            {project ? <StatusDot tone={projectTone(project.status)} label={projectStateLine(project, day)} size="md" /> : <span className="text-muted-foreground">{T.notSet}</span>}
          </p>
          {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
          {changeRequest ? (
            <div role="status" className="rounded-md border border-uc-giallo bg-uc-giallo-bg p-3 text-sm">
              <p className="font-medium">{T.changeRequest(changeRequest.on ? day(changeRequest.on) : null)}</p>
              <p className="mt-1 break-words whitespace-pre-wrap">{changeRequest.text}</p>
              <p className="mt-1 text-muted-foreground">{open?.status === "da_approvare" ? (approver ? T.changeRequestLead : T.changeRequestOthers) : T.changeRequestStays}</p>
            </div>
          ) : null}
          {primaryAction || reopenAside ? (
            <div className="flex flex-wrap gap-2">
              {primaryAction}
              {reopenAside ? reopen : null}
            </div>
          ) : null}
        </section>

        {tasksShown ? (
          <section id={T.tasksHeadingId} aria-labelledby="compiti-titolo" className="min-w-0 scroll-mt-40 space-y-2">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 id="compiti-titolo" className="text-base font-semibold">
                {T.tasks}
              </h2>
              {tally ? <p className="text-sm text-muted-foreground">{tally}</p> : null}
            </div>
            {proposals.length ? (
              <div className="rounded-md border px-3">
                <p className="pt-2.5 text-sm font-medium">{T.proposals(proposals.length)}</p>
                <ul className="divide-y">
                  {proposals.map((p) => (
                    <ProposalLine key={p.id} p={p} ids={writer ? { workspaceId, caseId } : null} />
                  ))}
                </ul>
              </div>
            ) : null}
            {tasks.length ? (
              <ul className="divide-y">
                {shownTasks.map((t) => (
                  <TaskLine key={t.id} t={t} details={details} />
                ))}
              </ul>
            ) : proposals.length === 0 ? (
              <p className="text-sm text-muted-foreground">{T.noTasks}</p>
            ) : null}
            {tasks.length > TASKS_SHOWN ? (
              <Link href={allTasks ? `${base}#${T.tasksHeadingId}` : `${base}?${TASKS_ALL_PARAM}=${TASKS_ALL_VALUE}#${T.tasksHeadingId}`} className="inline-flex min-h-11 items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground sm:min-h-0">
                {allTasks ? T.seeFewer : T.seeAll(tasks.length)}
                {allTasks ? null : <ChevronRight className="size-3.5" aria-hidden />}
              </Link>
            ) : null}
          </section>
        ) : null}

        {qualityShown ? (
          <section id={QUALITY_ANCHORS.section} aria-labelledby="qualita-titolo" className="min-w-0 scroll-mt-40 space-y-3">
            {/* L'ancora di ieri (`progetto#banco`) per chi non ha la piega dei dettagli: porta alla sezione. */}
            {details ? null : <span id={QUALITY_ANCHORS.details} className="block scroll-mt-40" />}
            <h2 id="qualita-titolo" className="text-base font-semibold">
              {QUALITY_TEXT.heading}
            </h2>
            <EvalSummary summary={summary} origins={evals.origins} ciLinks={ciLinks} unavailable={evals.unavailable && details} />
            {details && !summary && !evals.unavailable ? <p className="text-sm text-muted-foreground">{QUALITY_TEXT.none}</p> : null}
            {details ? (
              <Fold id={QUALITY_ANCHORS.details} title={QUALITY_TEXT.details} summary={hasMeasures(evals.overview) ? null : QUALITY_TEXT.start} level={3} className="last:border-b-0">
                <EvalSection overview={evals.overview} caseCode={caseCode} unavailable={evals.unavailable} origins={evals.origins} ciLinks={ciLinks} />
                {backtestHref ? (
                  <Link href={backtestHref} className="inline-flex min-h-11 items-center gap-0.5 text-sm font-medium hover:underline sm:min-h-0">
                    {QUALITY_TEXT.backtest}
                    <ChevronRight className="size-3.5" aria-hidden />
                  </Link>
                ) : null}
              </Fold>
            ) : null}
          </section>
        ) : null}

        <div className="min-w-0">
          {/* Senza progetto non ci sono scelte da leggere: la riga del progetto lo dice già (lo zero non si vede). */}
          {project ? (
            <Fold id={T.choicesId} title={T.choicesTitle} summary={T.choices(choicesMade(project.topics), SETUP_TOPICS.length)}>
              <ul className="divide-y">
                {SETUP_TOPICS.map((topic) => {
                  const choice = project.topics[topic] ?? null;
                  const label = constructionTopicLabel(topic);
                  return (
                    <li key={topic} className="flex items-start justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{label}</p>
                        <ChoiceText choice={choice} />
                      </div>
                      {editable ? <TopicEditor workspaceId={workspaceId} caseId={caseId} topic={topic} label={label} current={choice} /> : null}
                    </li>
                  );
                })}
              </ul>
              <div className="space-y-2 text-sm">
                <h3 className="font-medium">{T.toolsTitle}</h3>
                {project.newTools.length ? (
                  <ul className="space-y-1">
                    {project.newTools.map((tool) => (
                      <li key={tool.nome} className="break-words">
                        <span className="font-medium">{tool.nome}</span>
                        {tool.perche ? <span className="text-muted-foreground"> · {tool.perche}</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground">{T.noTools}</p>
                )}
                {project.newTools.length ? (
                  <p className={project.aiBoardOkAt ? undefined : "text-muted-foreground"}>
                    {project.aiBoardOkAt
                      ? T.boardOk(day(project.aiBoardOkAt), project.aiBoardNote)
                      : project.status === "in_corso"
                        ? T.boardOkAfterSubmit
                        : changeRequest
                          ? T.boardChangeAsked
                          : T.boardOkMissing}
                  </p>
                ) : null}
                <p>
                  {project.estimateHours !== null ? T.estimateHours(amount(project.estimateHours, 1)) : T.estimateHoursNone}{" "}
                  {project.monthlyCostEur !== null ? T.estimateCost(amount(project.monthlyCostEur, 0)) : T.estimateCostNone}
                </p>
                {editable ? (
                  <DetailsEditor
                    workspaceId={workspaceId}
                    caseId={caseId}
                    tools={project.newTools}
                    hours={project.estimateHours}
                    cost={project.monthlyCostEur}
                    limits={{ hours: FACTORY_LIMITS.hoursMax, cost: FACTORY_LIMITS.monthlyCostEurMax, tools: FACTORY_LIMITS.newToolsMax }}
                  />
                ) : null}
              </div>
              {previous ? (
                <details className="text-sm">
                  <summary className="flex min-h-11 cursor-pointer items-center text-muted-foreground sm:min-h-0">{T.previous(previous.version, day(previous.approvedAt))}</summary>
                  <ul className="mt-2 divide-y rounded-md border px-3">
                    {SETUP_TOPICS.map((topic) => (
                      <li key={topic} className="py-2.5">
                        <p className="text-sm font-medium">{constructionTopicLabel(topic)}</p>
                        <ChoiceText choice={previous.topics[topic] ?? null} />
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </Fold>
          ) : null}

          {decisionsShown ? (
            <Fold id={T.decisionsId} title={T.decisionsTitle} summary={teamDecisions.length ? String(teamDecisions.length) : null}>
              <p className="text-sm text-muted-foreground">{T.decisionsHint}</p>
              {teamDecisions.length ? (
                <ul className="divide-y">
                  {teamDecisions.map((d) => (
                    <DecisionLine key={d.id} d={d} />
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{T.decisionsNone}</p>
              )}
              {view.decisions.length ? (
                <details className="rounded-md border px-3">
                  <summary className="flex min-h-11 cursor-pointer items-center text-sm">{T.decisionsAll(view.decisions.length, replaced)}</summary>
                  <ul className="divide-y pb-1">
                    {view.decisions.map((d) => (
                      <DecisionLine key={d.id} d={d} />
                    ))}
                  </ul>
                </details>
              ) : null}
              {writer ? <DecisionForm workspaceId={workspaceId} caseId={caseId} /> : null}
            </Fold>
          ) : null}

          {/* (9b) Con la lettura riuscita la piega c'è sempre, anche vuota: la campanella «Il contesto è cambiato» porta qui. */}
          {context ? (
            <Fold id={T.contextId} title={CONTEXT_TEXT.useCase.title} summary={contextFoldSummary(context) || null}>
              <p className="text-sm text-muted-foreground">{CONTEXT_TEXT.useCase.dossierDescription}</p>
              <UseCaseContextView workspaceId={workspaceId} today={romeToday()} context={context} />
            </Fold>
          ) : null}

          {agentShown ? (
            <Fold id={T.agentId} title={T.agentTitle} summary={agentFoldSummary({ packageShown: builder, commandsShown: builder, claudeShown })}>
              {builder ? (
                <section aria-labelledby="pacchetto-titolo" className="space-y-2 text-sm">
                  <h3 id="pacchetto-titolo" className="font-medium">
                    {T.packageTitle}
                  </h3>
                  <p className="text-muted-foreground">{T.packageHint}</p>
                  {view.latestPackage ? (
                    <>
                      <p>
                        <span className="font-medium">{T.packageVersion(view.latestPackage.version)}</span>
                        <span className="text-muted-foreground">{T.packageMade(view.latestPackage.source === "importato", day(view.latestPackage.createdAt))}</span>
                      </p>
                      {deltaLine ? <p data-slot="package-context-delta">{deltaLine}</p> : null}
                      <details className="rounded-md border px-3">
                        <summary className="flex min-h-11 cursor-pointer items-center text-sm">{T.packageRead}</summary>
                        {packageFilesShown(view.latestPackage.files).map(({ name, text }) => (
                          <div key={name} className="mb-3">
                            <p className="text-xs font-medium text-muted-foreground">{name}</p>
                            <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-xs break-words whitespace-pre-wrap">{text}</pre>
                          </div>
                        ))}
                      </details>
                    </>
                  ) : (
                    <p className="text-muted-foreground">{T.packageNone}</p>
                  )}
                  {writer ? <PackageButton workspaceId={workspaceId} caseId={caseId} first={!view.latestPackage} /> : null}
                </section>
              ) : null}
              {builder ? (
                <section aria-labelledby="comandi-titolo" className="space-y-2">
                  <h3 id="comandi-titolo" className="text-sm font-medium">
                    {T.commandsTitle}
                  </h3>
                  <CommandLine label={T.commandTake} command={`unbundle take ${caseCode} T-n`} />
                  <CommandLine label={T.commandImport} command={`unbundle compiti importa ${caseCode}`} />
                  <CommandLine label={T.commandSetup} command="/agent-factory:imposta" />
                </section>
              ) : null}
              {claudeShown ? (
                // L'ancora è `CLAUDE_PANEL_ANCHOR`, scritta qui: un valore di un modulo client, letto dal server, non è una stringa.
                <div id="sviluppo-con-claude" className="min-w-0 scroll-mt-40">
                  <ClaudeDevPanel
                    workspaceId={workspaceId}
                    caseId={caseId}
                    caseCode={c.code}
                    canManage={roles.includes("ls_lead") && !caseAccess.readOnly}
                    catalogVersion={c.catalogVersion}
                    caseClosed={c.status === "chiuso"}
                    tokens={tokens}
                  />
                </div>
              ) : null}
            </Fold>
          ) : null}
        </div>

        {catalogHref ? (
          <Link href={catalogHref} className="inline-flex min-h-11 items-center gap-0.5 text-sm font-medium hover:underline sm:min-h-0">
            {T.catalog}
            <ChevronRight className="size-3.5" aria-hidden />
          </Link>
        ) : null}
      </div>
    </PageContainer>
  );
}
