import { notFound } from "next/navigation";
import { ClipboardList, Gavel, Package, Wrench } from "lucide-react";
import { PageContainer } from "@/components/dashboard/page-container";
import { SettingsSection } from "@/components/dashboard/settings-section";
import { canWrite, openShellPage } from "@/components/uc/shell/case-data";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { factoryStoreReady, readFactory, topicLabel, findUseCaseOfCase, type ProjectView } from "@/lib/db/queries/use-case-factory";
import { SETUP_TOPICS } from "@/lib/db/use-case-hub-factory-ddl";
import { aiBoardOkRule, canApproveProject, canWriteFactory } from "@/lib/use-cases/factory/permissions";
import { AiBoardOk, DecisionForm, DetailsEditor, PackageButton, ProjectPrimaryAction, ReopenProject, TopicEditor } from "./project-forms";

/**
 * Il progetto dell'agente (rilascio 8.0a, docs/rilascio-8/RILASCIO-8.0-PIANO.md §2): l'impostazione del caso
 * nell'Agent Factory. Si apre dal menu «⋯» del dossier; la leggono il team del caso e l'AI Board, gli altri
 * ricevono 404 (`UC_SHELL_PAGE_ROLES.progetto`).
 *
 * - Una sola azione principale, secondo lo stato: «Imposta il caso», «Manda in approvazione», «Approva il
 *   progetto» (solo il responsabile), «Rivedi il progetto».
 * - I 10 argomenti con la scelta, il perché e l'alternativa scartata; si cambiano solo con il progetto in corso.
 * - Strumenti nuovi e stima, con l'ok dell'AI Board quando serve.
 * - Le decisioni del caso, dalla più recente.
 * - Il pacchetto: la versione di oggi, i suoi tre file, «Aggiorna il pacchetto».
 *
 * Il dialogo dell'impostazione si fa anche dal coding agent, con la skill `/agent-factory:imposta`: qui si
 * rilegge, si corregge e si approva.
 */

const STATUS_TEXT: Record<ProjectView["status"], string> = {
  in_corso: "In corso",
  da_approvare: "Da approvare",
  approvato: "Approvato",
  superato: "Superato",
};

const day = (iso: string | null) => (iso ? new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Rome" }).format(new Date(iso)) : "");
const euro = (n: number) => new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0, useGrouping: "always" }).format(n);

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
  const writer = writable && canWriteFactory(roles);
  const approver = writable && canApproveProject(roles);
  const board = writable ? aiBoardOkRule(roles) : { allowed: false, noteRequired: false };
  const project = view.open ?? view.approved;
  const open = view.open;
  const editable = writer && open?.status === "in_corso";

  const primary: "imposta" | "manda" | "approva" | "rivedi" | null = !project
    ? writer
      ? "imposta"
      : null
    : open?.status === "in_corso"
      ? writer
        ? "manda"
        : null
      : open?.status === "da_approvare"
        ? approver && (open.newTools.length === 0 || open.aiBoardOkAt)
          ? "approva"
          : null
        : writer
          ? "rivedi"
          : null;

  const statusLine = project
    ? `${STATUS_TEXT[project.status]} · versione ${project.version}${project.status === "approvato" && project.approvedAt ? ` · il ${day(project.approvedAt)}` : ""}`
    : "Il caso non è ancora impostato.";
  const needsBoard = open?.status === "da_approvare" && open.newTools.length > 0 && !open.aiBoardOkAt;

  return (
    <PageContainer>
      <header className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Progetto dell&apos;agente</h1>
          <p className="mt-1 text-sm text-muted-foreground">{statusLine}</p>
          {needsBoard ? <p className="mt-1 text-sm">Prima dell&apos;approvazione serve l&apos;ok dell&apos;AI Board agli strumenti nuovi.</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {open?.status === "da_approvare" && writer ? <ReopenProject workspaceId={workspaceId} caseId={caseId} /> : null}
          <ProjectPrimaryAction workspaceId={workspaceId} caseId={caseId} action={primary} />
        </div>
      </header>

      <div className="mt-6 space-y-6">
        <SettingsSection
          id="scelte"
          icon={ClipboardList}
          title="Le scelte"
          description={project ? "I 10 argomenti dell'impostazione. Ogni scelta è anche una decisione del caso." : "Si fanno qui o dal coding agent, con la skill /agent-factory:imposta."}
        >
          {project ? (
            <ul className="divide-y">
              {SETUP_TOPICS.map((topic) => {
                const choice = project.topics[topic] ?? null;
                return (
                  <li key={topic} className="flex items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{topicLabel(topic)}</p>
                      {choice ? (
                        <>
                          <p className="mt-0.5 text-sm">{choice.scelta}</p>
                          {choice.perche ? <p className="mt-0.5 text-xs text-muted-foreground">Perché: {choice.perche}</p> : null}
                          {choice.alternativa ? <p className="mt-0.5 text-xs text-muted-foreground">Scartata: {choice.alternativa}</p> : null}
                        </>
                      ) : (
                        <p className="mt-0.5 text-sm text-muted-foreground">Da scegliere</p>
                      )}
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
                  {project.aiBoardOkAt ? `Ok dell'AI Board il ${day(project.aiBoardOkAt)}${project.aiBoardNote ? `: ${project.aiBoardNote}` : "."}` : "Manca l'ok dell'AI Board."}
                </p>
              ) : null}
              <p>
                {project.estimateHours !== null ? `Costruzione: circa ${euro(project.estimateHours)} ore.` : "Costruzione: non stimata."}{" "}
                {project.monthlyCostEur !== null ? `Esercizio: circa ${euro(project.monthlyCostEur)} € al mese.` : "Esercizio: non stimato."}
              </p>
              <div className="flex flex-wrap gap-2">
                {editable ? <DetailsEditor workspaceId={workspaceId} caseId={caseId} tools={project.newTools} hours={project.estimateHours} cost={project.monthlyCostEur} /> : null}
                {needsBoard && board.allowed ? <AiBoardOk workspaceId={workspaceId} caseId={caseId} noteRequired={board.noteRequired} /> : null}
              </div>
            </div>
          </SettingsSection>
        ) : null}

        <SettingsSection id="decisioni" icon={Gavel} title="Decisioni" description="Entrano nel brief di ogni coding agent del caso.">
          <div className="space-y-3">
            {view.decisions.length ? (
              <ul className="divide-y">
                {view.decisions.map((d) => (
                  <li key={d.id} className="py-2.5 text-sm">
                    <p>
                      <span className="tabular-nums text-muted-foreground">{day(d.decidedOn)}</span> · <span className="font-medium">{d.topic}</span> · {d.choice}
                    </p>
                    {d.reason ? <p className="mt-0.5 text-xs text-muted-foreground">{d.reason}</p> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nessuna decisione ancora.</p>
            )}
            {writer ? <DecisionForm workspaceId={workspaceId} caseId={caseId} /> : null}
          </div>
        </SettingsSection>

        <SettingsSection id="pacchetto" icon={Package} title="Pacchetto" description="I tre file che il repository del caso legge e non cambia: senza nomi di persona.">
          <div className="space-y-3 text-sm">
            {view.latestPackage ? (
              <>
                <p>
                  <span className="font-medium">k{view.latestPackage.version}</span>
                  <span className="text-muted-foreground"> · {view.latestPackage.source === "importato" ? "preparato a mano" : "generato"} il {day(view.latestPackage.createdAt)}</span>
                </p>
                <details className="rounded-md border p-3">
                  <summary className="cursor-pointer text-sm">Leggi i file</summary>
                  {(["BRIEF.md", "PACCHETTO.md", "VERSIONE"] as const).map((name) => (
                    <div key={name} className="mt-3">
                      <p className="text-xs font-medium text-muted-foreground">{name}</p>
                      <pre className="mt-1 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 text-xs">{view.latestPackage!.files[name]}</pre>
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
      </div>
    </PageContainer>
  );
}
