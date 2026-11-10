import { notFound } from "next/navigation";
import { ClipboardList, Gavel, Package, Wrench } from "lucide-react";
import { PageContainer } from "@/components/dashboard/page-container";
import { SettingsSection } from "@/components/dashboard/settings-section";
import { canWrite, openShellPage } from "@/components/uc/shell/case-data";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { factoryStoreReady, readFactory, topicLabel, findUseCaseOfCase, type DecisionView, type ProjectView } from "@/lib/db/queries/use-case-factory";
import { FACTORY_LIMITS, SETUP_TOPICS } from "@/lib/db/use-case-hub-factory-ddl";
import { aiBoardOkRule, AI_BOARD_NOTE_MIN, canApproveProject, canRequestProjectChange, canWriteFactory } from "@/lib/use-cases/factory/permissions";
import { AiBoardOk, DecisionForm, DetailsEditor, PackageButton, ProjectPrimaryAction, ReopenProject, TopicEditor } from "./project-forms";

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
 * - Il pacchetto, solo per il team di Lateral Space: la versione di oggi, i suoi tre file, «Aggiorna il pacchetto».
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

export default async function AgentProjectPage({ params }: { params: Promise<{ workspaceId: string; caseId: string }> }) {
  const { workspaceId, caseId } = await params;
  const { session, access } = await requireWorkspacePage(workspaceId);
  const { caseAccess, executor } = await openShellPage({ workspaceId, caseId, session, access, page: "progetto" });
  const roles = caseAccess.roles;

  if (!(await factoryStoreReady(executor))) {
    return (
      <PageContainer>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Progetto dell&apos;agente</h1>
        <p className="mt-4 text-sm text-muted-foreground">Non ancora disponibile: riprova tra qualche minuto.</p>
      </PageContainer>
    );
  }
  const useCase = await findUseCaseOfCase(executor, workspaceId, caseId);
  if (!useCase) notFound();
  const target = { workspaceId, useCaseId: useCase.useCaseId };
  const read = await readFactory(executor, target, { kind: "persona", userId: session.user.id, roles });
  if (!read.ok) notFound();
  const view = read.value;

  const writable = canWrite(caseAccess);
  // Il team di Lateral Space: scrive il progetto e legge il pacchetto (che è per i coding agent, non per il cliente).
  const lsTeam = canWriteFactory(roles);
  const writer = writable && lsTeam;
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
  const replaced = view.decisions.filter((d) => d.supersededOn !== null).length;

  return (
    <PageContainer>
      <header className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 id="progetto-titolo" tabIndex={-1} className="text-2xl font-semibold tracking-tight outline-none sm:text-3xl">
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
              : lsTeam
                ? "Si fanno qui o dal coding agent, con la skill /agent-factory:imposta."
                : "Le prepara il team di Lateral Space; qui le leggi e, se serve, le approvi."
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
                {project.monthlyCostEur !== null ? `Esercizio: circa ${amount(project.monthlyCostEur, 0)} € al mese.` : "Esercizio: non stimato."}
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

        {lsTeam ? (
          <SettingsSection id="pacchetto" icon={Package} title="Pacchetto" description="I tre file che il repository del caso legge e non cambia: senza nomi di persona.">
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
                  <details className="rounded-md border px-3">
                    <summary className="flex min-h-11 cursor-pointer items-center text-sm">Leggi i file</summary>
                    {(["BRIEF.md", "PACCHETTO.md", "VERSIONE"] as const).map((name) => (
                      <div key={name} className="mb-3">
                        <p className="text-xs font-medium text-muted-foreground">{name}</p>
                        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words rounded bg-muted p-2 text-xs">{view.latestPackage!.files[name]}</pre>
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
