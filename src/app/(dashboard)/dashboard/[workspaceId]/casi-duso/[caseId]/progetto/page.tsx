import { notFound } from "next/navigation";
import { Building2, ClipboardList, FlaskConical, Gavel, ListTodo, Package, Wrench } from "lucide-react";
import { EVAL_TEXT, evalSectionDescription } from "@/components/agent-factory/eval-format";
import { readEvalOverview } from "@/components/agent-factory/eval-load";
import { EvalSection } from "@/components/agent-factory/eval-section";
import { UseCaseContextView } from "@/components/context/use-case-context";
import { packageDeltaLine, packageFilesShown } from "@/components/context/view-model";
import { PAGE_TITLE_CLASS, PageContainer } from "@/components/dashboard/page-container";
import { SettingsSection } from "@/components/dashboard/settings-section";
import { canWrite, openShellPage } from "@/components/uc/shell/case-data";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { contextActorFor, type ContextActor } from "@/lib/context/server/actor";
import { CONTEXT_TEXT } from "@/lib/context/text";
import { loadAgentContext, loadUseCaseContext, type UseCaseContext } from "@/lib/db/queries/context-work";
import { factoryStoreReady, readFactory, topicLabel, findUseCaseOfCase, namesToHide, type DecisionView, type FactoryTarget, type FactoryView, type ProjectView } from "@/lib/db/queries/use-case-factory";
import { FACTORY_LIMITS, SETUP_TOPICS } from "@/lib/db/use-case-hub-factory-ddl";
import { listTasks, tasksStoreReady, type TaskView } from "@/lib/db/queries/use-case-tasks";
import { listOpenProposals, proposalsStoreReady, type ProposalView } from "@/lib/db/queries/use-case-task-proposals";
import type { UcExecutor } from "@/lib/db/uc-executor";
import { loadFactoryAccess } from "@/lib/use-cases/factory/access";
import { packageContextDelta } from "@/lib/use-cases/factory/package";
import { aiBoardOkRule, AI_BOARD_NOTE_MIN, canApproveProject, canRequestProjectChange, canWriteFactory } from "@/lib/use-cases/factory/permissions";
import { romeToday } from "@/lib/use-cases/quarter";
import { AiBoardOk, DecisionForm, DetailsEditor, PackageButton, ProjectPrimaryAction, ProposalButtons, ReopenProject, TopicEditor } from "./project-forms";

/**
 * Il progetto dell'agente (rilascio 8.0a, docs/rilascio-8/RILASCIO-8.0-PIANO.md §2): l'impostazione dello use case
 * nell'Agent Factory. Si apre dal menu «⋯» del dossier; la leggono il team del caso e l'AI Board, gli altri
 * ricevono 404 (`UC_SHELL_PAGE_ROLES.progetto`).
 *
 * - Un'azione principale, secondo lo stato e chi guarda: «Imposta lo use case», «Manda in approvazione», l'ok
 *   dell'AI Board (o «Chiedi una modifica»), «Approva il progetto» (solo il responsabile), «Rivedi il progetto».
 *   «Riapri per cambiarlo» la ha solo il responsabile, con la conferma: fa decadere l'ok dell'AI Board.
 * - I 10 argomenti con la scelta, il perché e l'alternativa scartata; si cambiano solo con il progetto in corso.
 *   Con una versione nuova aperta resta da leggere quella approvata.
 * - Strumenti nuovi e stima, con l'ok o la modifica chiesta dall'AI Board.
 * - Le decisioni che valgono, oltre alle scelte; lo storico completo, con quelle sostituite, su richiesta.
 * - Il pacchetto, solo per chi costruisce: la versione di oggi, i suoi file, «Aggiorna il pacchetto».
 * - (8.1a) I compiti (`#compiti`): stato e chi li ha, le aree e le prove a richiesta. Si prendono e si passano dal
 *   coding agent, con la CLI; qui si leggono.
 * - (8.1b) Le proposte di compito da GitHub (un'issue, un commento `/compito`), solo per chi costruisce: le accetta
 *   (nasce il compito) o le scarta.
 * - (8.0c) Chi scrive, il pacchetto e le proposte vengono dai ruoli della fabbrica (`loadFactoryAccess`): chi costruisce
 *   il caso da fuori Lateral Space, da osservatore nel dossier, imposta il progetto come uno sviluppatore. Chi approva,
 *   riapre e dà l'ok dell'AI Board resta quello di prima (i ruoli del caso).
 * - (8.2a) Evals e banco di prova (`#banco`), per tutti quelli che vedono la pagina: le ultime evals con l'andamento,
 *   l'ultimo banco per ruolo con il grafico qualità contro costo e la raccomandazione, o i comandi per cominciare.
 *   Si lanciano dalla CLI; qui si leggono. Una lettura che fallisce non fa cadere la pagina.
 * - (9b) «Contesto» (`#contesto`, l'ancora di «Il contesto è cambiato» in campanella), dopo «Decisioni»: quello che
 *   sappiamo del cliente e che tocca lo use case, lo stesso della piega della scheda, con i fatti per chi guarda (Lateral
 *   Space per l'e-mail verificata; chi costruisce da fuori, il responsabile del cliente e l'AI Board solo «Per tutti»).
 *   Senza niente da mostrare non c'è. In «Pacchetto», a chi lo vede, la riga «Il contesto è cambiato dopo l'ultimo
 *   pacchetto (n novità).» sotto la versione, solo quando serve: l'azione resta «Aggiorna il pacchetto». «Leggi i file»
 *   mostra anche `CONTESTO.md` quando c'è.
 *
 * Il dialogo dell'impostazione si fa anche dal coding agent (skill `/agent-factory:imposta`): qui si rilegge, si
 * corregge e si approva.
 */

const STATUS_TEXT: Record<ProjectView["status"], string> = {
  in_corso: "In corso",
  da_approvare: "Da approvare",
  approvato: "Approvato",
  superato: "Superato",
};

const day = (iso: string | null) => (iso ? new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Rome" }).format(new Date(iso)) : "");
const amount = (n: number, digits: number) => new Intl.NumberFormat("it-IT", { maximumFractionDigits: digits, useGrouping: "always" }).format(n);

/** Le scelte di una versione, in sola lettura (anche per la versione approvata mentre se ne prepara un'altra). */
function ChoiceText({ choice }: { choice: ProjectView["topics"][keyof ProjectView["topics"]] | null }) {
  if (!choice) return <p className="mt-0.5 text-sm text-muted-foreground">Da scegliere</p>;
  return (
    <>
      <p className="mt-0.5 text-sm">{choice.scelta}</p>
      {choice.perche ? <p className="mt-0.5 text-xs text-muted-foreground">Perché: {choice.perche}</p> : null}
      {choice.alternativa ? <p className="mt-0.5 text-xs text-muted-foreground">Scartata: {choice.alternativa}</p> : null}
    </>
  );
}

const TASK_STATUS: Record<TaskView["status"], string> = {
  da_fare: "Da fare",
  in_corso: "In corso",
  in_revisione: "In revisione",
  fatto: "Fatto",
  annullato: "Annullato",
};

function TaskLine({ t }: { t: TaskView }) {
  const who = (t.status === "in_corso" || t.status === "in_revisione") && t.holderName ? ` · ${t.holderName}` : "";
  return (
    <li>
      <details className="group py-2.5">
        <summary className="flex min-h-11 cursor-pointer items-start justify-between gap-3 sm:min-h-0">
          <span className={`min-w-0 text-sm ${t.status === "annullato" ? "text-muted-foreground line-through" : ""}`}>
            <span className="font-medium tabular-nums">{t.ref}</span> · {t.title}
          </span>
          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${t.status === "fatto" ? "border-uc-verde bg-uc-verde-bg" : t.status === "da_fare" ? "text-muted-foreground" : ""}`}>
            {TASK_STATUS[t.status]}
            {who}
          </span>
        </summary>
        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
          {t.areas.length ? <p className="break-words">Aree: {t.areas.join(", ")}</p> : null}
          {t.estimateHours !== null ? <p>Stima: {String(t.estimateHours).replace(".", ",")} ore</p> : null}
          {t.evidence ? <p>Prove: {t.evidence}</p> : null}
          {t.branch ? <p className="break-words">Ramo: {t.branch}</p> : null}
          {t.prUrl ? (
            <p>
              <a href={t.prUrl} className="underline" target="_blank" rel="noreferrer">
                La pull request
              </a>
            </p>
          ) : null}
        </div>
      </details>
    </li>
  );
}

function ProposalLine({ p, ids }: { p: ProposalView; ids: { workspaceId: string; caseId: string } | null }) {
  return (
    <li className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 text-sm">
        <p className="break-words">{p.title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {p.link ? (
            <a href={p.link} className="underline" target="_blank" rel="noreferrer">
              Da {p.source === "github" ? "GitHub" : "Slack"}
            </a>
          ) : (
            `Da ${p.source === "github" ? "GitHub" : "Slack"}`
          )}{" "}
          · il {day(p.createdAt)}
          {p.existingRef ? ` · forse c'è già: ${p.existingRef}` : ""}
        </p>
      </div>
      {ids ? <ProposalButtons workspaceId={ids.workspaceId} caseId={ids.caseId} proposalId={p.id} /> : null}
    </li>
  );
}

function DecisionLine({ d }: { d: DecisionView }) {
  return (
    <li className="py-2.5 text-sm">
      <p className={d.supersededOn ? "text-muted-foreground" : undefined}>
        <span className="tabular-nums text-muted-foreground">{day(d.decidedOn)}</span> · <span className="font-medium">{d.topic}</span> ·{" "}
        <span className={d.supersededOn ? "line-through" : undefined}>{d.choice}</span>
      </p>
      {d.supersededOn ? <p className="mt-0.5 text-xs text-muted-foreground">Sostituita il {day(d.supersededOn)}</p> : d.reason ? <p className="mt-0.5 text-xs text-muted-foreground">{d.reason}</p> : null}
    </li>
  );
}

/**
 * (9b) La sezione «Contesto»: i fatti, gli impegni e le domande del cliente che toccano lo use case, per chi guarda (anche
 * nessuno: la sezione resta, con una riga che lo dice, ed è l'ancora della campanella). null senza l'archivio di
 * «Contesto», per chi non apre «Contesto» o se la lettura non riesce: la pagina resta, senza sezione.
 */
async function readContextSection(actor: ContextActor, useCaseId: string): Promise<UseCaseContext | null> {
  try {
    return await loadUseCaseContext(actor, useCaseId);
  } catch (error) {
    console.error("[agent-project] context_failed", { error: { name: error instanceof Error ? error.name : "Error" } });
    return null;
  }
}

/**
 * (9b) Le novità del contesto dopo l'ultimo pacchetto: le righe di `CONTESTO.md` che il prossimo «Aggiorna il pacchetto»
 * cambierebbe, dal file salvato nella versione a quello di adesso (con gli stessi nomi coperti); se la versione non ha
 * `CONTESTO.md`, tutte le righe di adesso. Zero se la lettura non riesce.
 */
async function readContextDelta(executor: UcExecutor, target: FactoryTarget, code: string, latest: NonNullable<FactoryView["latestPackage"]>): Promise<number> {
  try {
    const [context, names] = await Promise.all([loadAgentContext(target), namesToHide(executor, target)]);
    return packageContextDelta({ context, namesToHide: names, code, latest });
  } catch (error) {
    console.error("[agent-project] context_delta_failed", { error: { name: error instanceof Error ? error.name : "Error" } });
    return 0;
  }
}

export default async function AgentProjectPage({ params }: { params: Promise<{ workspaceId: string; caseId: string }> }) {
  const { workspaceId, caseId } = await params;
  const { session, access } = await requireWorkspacePage(workspaceId);
  const { caseAccess, executor } = await openShellPage({ workspaceId, caseId, session, access, page: "progetto" });
  const roles = caseAccess.roles;

  if (!(await factoryStoreReady(executor))) {
    return (
      <PageContainer>
        <h1 className={PAGE_TITLE_CLASS}>Progetto dell&apos;agente</h1>
        <p className="mt-4 text-sm text-muted-foreground">Non ancora disponibile: riprova tra qualche minuto.</p>
      </PageContainer>
    );
  }
  const useCase = await findUseCaseOfCase(executor, workspaceId, caseId);
  if (!useCase) notFound();
  const target = { workspaceId, useCaseId: useCase.useCaseId };
  // (8.0c) I ruoli della fabbrica: quelli del caso, più `builder_esterno` per chi costruisce da fuori.
  const factory = await loadFactoryAccess(executor, caseAccess);
  // La 0037 non è pronta e la persona costruisce il caso da fuori (o non si sa): come la fabbrica non ancora pronta.
  if (factory.blocked === "non_disponibile") {
    return (
      <PageContainer>
        <h1 className={PAGE_TITLE_CLASS}>Progetto dell&apos;agente</h1>
        <p className="mt-4 text-sm text-muted-foreground">Non ancora disponibile: riprova tra qualche minuto.</p>
      </PageContainer>
    );
  }
  const read = await readFactory(executor, target, { kind: "persona", userId: session.user.id, roles: factory.roles });
  if (!read.ok) notFound();
  const view = read.value;

  const writable = canWrite(caseAccess);
  // Chi costruisce: scrive il progetto e legge il pacchetto (che è per i coding agent, non per il cliente).
  const builder = canWriteFactory(factory.roles);
  const writer = builder && !factory.readOnly && caseAccess.status !== "chiuso";
  const approver = writable && canApproveProject(roles);
  const board = writable ? aiBoardOkRule(roles) : { allowed: false, noteRequired: false };
  const boardMember = writable && canRequestProjectChange(roles);
  const project = view.open ?? view.approved;
  const open = view.open;
  const editable = writer && open?.status === "in_corso";
  const pending = open?.status === "da_approvare" ? open : null;
  const needsBoard = pending !== null && pending.newTools.length > 0 && !pending.aiBoardOkAt;
  const missing = open?.status === "in_corso" ? SETUP_TOPICS.filter((t) => !open.topics[t]?.scelta) : [];
  const chosen = project ? SETUP_TOPICS.length - SETUP_TOPICS.filter((t) => !project.topics[t]?.scelta).length : 0;
  const changeRequest = open?.changeRequest ? { text: open.changeRequest, on: open.changeRequestedAt } : null;

  // L'azione principale e, per il responsabile, «Riapri per cambiarlo» accanto (o al suo posto, se l'AI Board ha
  // chiesto una modifica: è il passo che sblocca).
  let primary: "imposta" | "manda" | "approva" | "rivedi" | "ok_board" | "riapri" | null = null;
  let reopenAside = false;
  if (!project) primary = writer ? "imposta" : null;
  else if (open?.status === "in_corso") primary = writer ? "manda" : null;
  else if (pending) {
    if (approver) {
      if (needsBoard && changeRequest) primary = "riapri";
      else {
        primary = needsBoard ? "ok_board" : "approva";
        reopenAside = true;
      }
    } else if (needsBoard && board.allowed) primary = "ok_board";
  } else primary = writer ? "rivedi" : null;

  const statusLine = project
    ? `${STATUS_TEXT[project.status]} · versione ${project.version}${project.status === "approvato" && project.approvedAt ? ` · il ${day(project.approvedAt)}` : ""}`
    : "Lo use case non è ancora impostato.";
  const hint =
    missing.length > 0 && writer
      ? `Prima dell'invio ${missing.length === 1 ? `manca ${topicLabel(missing[0])}` : `mancano ${missing.length} scelte: ${missing.map(topicLabel).join(", ")}`}.`
      : needsBoard && !changeRequest
        ? "Prima dell'approvazione serve l'ok dell'AI Board agli strumenti nuovi."
        : null;
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
    />
  ) : null;
  const reopen = pending ? <ReopenProject workspaceId={workspaceId} caseId={caseId} revision={pending.revision} boardOkOn={pending.aiBoardOkAt ? day(pending.aiBoardOkAt) : null} primary={primary === "riapri"} /> : null;

  const teamDecisions = view.decisions.filter((d) => d.source !== "impostazione" && d.supersededOn === null);
  const tasksReady = await tasksStoreReady(executor);
  // Le evals e i banchi insieme ai compiti; `readEvalOverview` non rifiuta mai (un errore va nel log e nella sezione).
  // (9b) Insieme anche il contesto per chi guarda e, per chi vede il pacchetto, le novità dopo l'ultimo: nessuna delle
  // due letture fa cadere la pagina.
  const [tasks, evals, context, contextDelta] = await Promise.all([
    tasksReady ? listTasks(executor, target) : Promise.resolve<TaskView[]>([]),
    readEvalOverview(executor, target),
    readContextSection(contextActorFor(session.user, access, workspaceId), useCase.useCaseId),
    builder && view.latestPackage ? readContextDelta(executor, target, useCase.code ?? "", view.latestPackage) : Promise.resolve(0),
  ]);
  const deltaLine = packageDeltaLine(contextDelta);
  // Le proposte sono testi del team: le vede solo chi costruisce il caso (anche da fuori Lateral Space), e le decide chi
  // tra loro può scrivere nel caso.
  const proposals = tasksReady && builder && (await proposalsStoreReady(executor)) ? await listOpenProposals(executor, target) : [];
  const caseCode = useCase.code ?? "<ID>";
  const tally = {
    open: tasks.filter((t) => t.status === "da_fare").length,
    busy: tasks.filter((t) => t.status === "in_corso" || t.status === "in_revisione").length,
    done: tasks.filter((t) => t.status === "fatto").length,
  };
  const replaced = view.decisions.filter((d) => d.supersededOn !== null).length;

  return (
    <PageContainer>
      <header className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 id="progetto-titolo" tabIndex={-1} className={`${PAGE_TITLE_CLASS} outline-none`}>
            Progetto dell&apos;agente
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{statusLine}</p>
          {hint ? <p className="mt-1 text-sm">{hint}</p> : null}
          {previous ? (
            <details className="mt-1 text-sm">
              <summary className="flex min-h-11 cursor-pointer items-center text-muted-foreground sm:min-h-0">
                Versione {previous.version} approvata il {day(previous.approvedAt)} · Vedi
              </summary>
              <ul className="mt-2 divide-y rounded-md border px-3">
                {SETUP_TOPICS.map((topic) => (
                  <li key={topic} className="py-2.5">
                    <p className="text-sm font-medium">{topicLabel(topic)}</p>
                    <ChoiceText choice={previous.topics[topic] ?? null} />
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {reopenAside ? reopen : null}
          {primary === "ok_board" ? okBoard : primary === "riapri" ? reopen : <ProjectPrimaryAction workspaceId={workspaceId} caseId={caseId} action={primary} revision={open?.revision ?? null} blocked={missing.length > 0} />}
        </div>
      </header>

      {changeRequest ? (
        <div role="status" className="mt-4 rounded-md border border-uc-giallo bg-uc-giallo-bg p-3 text-sm">
          <p className="font-medium">L&apos;AI Board chiede una modifica{changeRequest.on ? ` (${day(changeRequest.on)})` : ""}</p>
          <p className="mt-1 whitespace-pre-wrap break-words">{changeRequest.text}</p>
          {open?.status === "da_approvare" ? (
            <p className="mt-1 text-muted-foreground">{approver ? "Riapri il progetto per cambiarlo con il team." : "Il responsabile del caso riapre il progetto per cambiarlo."}</p>
          ) : (
            <p className="mt-1 text-muted-foreground">Resta qui finché il progetto non torna da approvare.</p>
          )}
        </div>
      ) : null}

      <div className="mt-6 space-y-6">
        <SettingsSection
          id="scelte"
          icon={ClipboardList}
          title="Le scelte"
          description={
            project
              ? `${chosen} di ${SETUP_TOPICS.length} argomenti scelti. Ogni scelta è anche una decisione del caso.`
              : builder
                ? "Si fanno qui o dal coding agent, con la skill /agent-factory:imposta."
                : "Le prepara chi costruisce il caso; qui le leggi e, se serve, le approvi."
          }
        >
          {project ? (
            <ul className="divide-y">
              {SETUP_TOPICS.map((topic) => {
                const choice = project.topics[topic] ?? null;
                return (
                  <li key={topic} className="flex items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{topicLabel(topic)}</p>
                      <ChoiceText choice={choice} />
                    </div>
                    {editable ? <TopicEditor workspaceId={workspaceId} caseId={caseId} topic={topic} label={topicLabel(topic)} current={choice} /> : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Nessuna scelta ancora.</p>
          )}
        </SettingsSection>

        {project ? (
          <SettingsSection id="strumenti" icon={Wrench} title="Strumenti nuovi e stima" description="Quello che il cliente approva oltre alle scelte.">
            <div className="space-y-3 text-sm">
              {project.newTools.length ? (
                <ul className="space-y-1">
                  {project.newTools.map((tool) => (
                    <li key={tool.nome}>
                      <span className="font-medium">{tool.nome}</span>
                      {tool.perche ? <span className="text-muted-foreground"> · {tool.perche}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">Nessuno strumento nuovo per il cliente.</p>
              )}
              {project.newTools.length ? (
                <p className={project.aiBoardOkAt ? "" : "text-muted-foreground"}>
                  {project.aiBoardOkAt
                    ? `Ok dell'AI Board il ${day(project.aiBoardOkAt)}${project.aiBoardNote ? `: ${project.aiBoardNote}` : "."}`
                    : project.status === "in_corso"
                      ? "Dopo l'invio in approvazione serve l'ok dell'AI Board."
                      : changeRequest
                        ? "L'AI Board ha chiesto una modifica: niente ok per ora."
                        : "Manca l'ok dell'AI Board."}
                </p>
              ) : null}
              <p>
                {project.estimateHours !== null ? `Costruzione: circa ${amount(project.estimateHours, 1)} ore.` : "Costruzione: non stimata."}{" "}
                {project.monthlyCostEur !== null ? `Costo al mese: circa ${amount(project.monthlyCostEur, 0)} €.` : "Costo al mese: non stimato."}
              </p>
              {editable ? (
                <div className="flex flex-wrap gap-2">
                  <DetailsEditor
                    workspaceId={workspaceId}
                    caseId={caseId}
                    tools={project.newTools}
                    hours={project.estimateHours}
                    cost={project.monthlyCostEur}
                    limits={{ hours: FACTORY_LIMITS.hoursMax, cost: FACTORY_LIMITS.monthlyCostEurMax, tools: FACTORY_LIMITS.newToolsMax }}
                  />
                </div>
              ) : null}
            </div>
          </SettingsSection>
        ) : null}

        {tasksReady && (tasks.length > 0 || view.approved || proposals.length > 0) ? (
          <SettingsSection
            id="compiti"
            icon={ListTodo}
            title="Compiti"
            description={
              tasks.length
                ? `${tally.open} da prendere · ${tally.busy} in corso · ${tally.done} ${tally.done === 1 ? "fatto" : "fatti"}. Si prendono dal coding agent: «unbundle take ${caseCode} T-n».`
                : `Nessun compito ancora: nascono dal progetto, con «unbundle compiti importa ${caseCode}».`
            }
          >
            {proposals.length ? (
              <div className="mb-3 rounded-md border px-3">
                <p className="pt-2.5 text-sm font-medium">
                  {proposals.length === 1 ? "Una proposta da decidere" : `${proposals.length} proposte da decidere`}
                </p>
                <ul className="divide-y">
                  {proposals.map((p) => (
                    <ProposalLine key={p.id} p={p} ids={writer ? { workspaceId, caseId } : null} />
                  ))}
                </ul>
              </div>
            ) : null}
            {tasks.length ? (
              <ul className="divide-y">
                {tasks.map((t) => (
                  <TaskLine key={t.id} t={t} />
                ))}
              </ul>
            ) : null}
          </SettingsSection>
        ) : null}

        <SettingsSection id="banco" icon={FlaskConical} title={EVAL_TEXT.title} description={evalSectionDescription(evals.overview, evals.unavailable)}>
          <EvalSection overview={evals.overview} caseCode={caseCode} unavailable={evals.unavailable} />
        </SettingsSection>

        <SettingsSection id="decisioni" icon={Gavel} title="Decisioni" description="Valgono per ogni coding agent del caso. Quelle delle scelte sono qui sopra, in «Le scelte».">
          <div className="space-y-3">
            {teamDecisions.length ? (
              <ul className="divide-y">
                {teamDecisions.map((d) => (
                  <DecisionLine key={d.id} d={d} />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nessuna decisione oltre alle scelte.</p>
            )}
            {view.decisions.length ? (
              <details className="rounded-md border px-3">
                <summary className="flex min-h-11 cursor-pointer items-center text-sm">
                  Tutte le decisioni ({view.decisions.length}
                  {replaced ? `, di cui ${replaced} ${replaced === 1 ? "sostituita" : "sostituite"}` : ""})
                </summary>
                <ul className="divide-y pb-1">
                  {view.decisions.map((d) => (
                    <DecisionLine key={d.id} d={d} />
                  ))}
                </ul>
              </details>
            ) : null}
            {writer ? <DecisionForm workspaceId={workspaceId} caseId={caseId} /> : null}
          </div>
        </SettingsSection>

        {/* (9b) Con la lettura riuscita la sezione c'è sempre, anche vuota: la campanella «Il contesto è cambiato» porta qui. */}
        {context ? (
          <SettingsSection id="contesto" icon={Building2} title={CONTEXT_TEXT.useCase.title} description={CONTEXT_TEXT.useCase.dossierDescription}>
            <UseCaseContextView workspaceId={workspaceId} today={romeToday()} context={context} />
          </SettingsSection>
        ) : null}

        {builder ? (
          <SettingsSection id="pacchetto" icon={Package} title="Pacchetto" description="I file che il repository del caso legge e non cambia: senza nomi di persona.">
            <div className="space-y-3 text-sm">
              {view.latestPackage ? (
                <>
                  <p>
                    <span className="font-medium">Versione {view.latestPackage.version}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      · {view.latestPackage.source === "importato" ? "preparata a mano" : "generata dalla scheda dello use case"} il {day(view.latestPackage.createdAt)}
                    </span>
                  </p>
                  {deltaLine ? <p data-slot="package-context-delta">{deltaLine}</p> : null}
                  <details className="rounded-md border px-3">
                    <summary className="flex min-h-11 cursor-pointer items-center text-sm">Leggi i file</summary>
                    {packageFilesShown(view.latestPackage.files).map(({ name, text }) => (
                      <div key={name} className="mb-3">
                        <p className="text-xs font-medium text-muted-foreground">{name}</p>
                        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words rounded bg-muted p-2 text-xs">{text}</pre>
                      </div>
                    ))}
                  </details>
                </>
              ) : (
                <p className="text-muted-foreground">Nessun pacchetto ancora.</p>
              )}
              {writer ? <PackageButton workspaceId={workspaceId} caseId={caseId} first={!view.latestPackage} /> : null}
            </div>
          </SettingsSection>
        ) : null}
      </div>
    </PageContainer>
  );
}
