import "server-only";
/**
 * Il contesto di un caso per un coding agent (rilascio 8.0b, standard §7), uguale per `unbundle context` e per
 * `get_case_context` dell'MCP del caso: il brief di al massimo 300 token, o uno strato (`progetto`, `decisioni`,
 * `pacchetto`, `domande`). Il testo è pronto da leggere, senza nomi né e-mail; `dati` serve agli script.
 */
import { cliCaseExtras, namesToHide, readFactory } from "@/lib/db/queries/use-case-factory";
import { listTasks, tasksStoreReady } from "@/lib/db/queries/use-case-tasks";
import { tasksBriefLine } from "@/lib/use-cases/factory/tasks";
import type { UcExecutor } from "@/lib/db/uc-executor";
import { canWriteFactory } from "@/lib/use-cases/factory/permissions";
import { composeBrief, composeDecisionsLayer, composePackageLayer, composeProjectLayer, composeQuestionsLayer, nextStep, type ContextLayer } from "./brief";
import { CLI_NOT_A_BUILDER, type CliCase } from "./case";
import { notBuilderMessage } from "./case-errors";

export { CONTEXT_LAYERS, type ContextLayer } from "./brief";

export interface CliContext {
  testo: string;
  dati: {
    caso: string;
    dossier: string;
    progetto: { versione: number; stato: string; revisione: number } | null;
    pacchetto: { versione: number } | null;
    prossimoPasso: string;
    repository: unknown;
    /** (8.1a) I compiti, senza nomi: solo se è tuo. */
    compiti: { ref: string; stato: string; tuo: boolean }[];
    /** (8.0c) I ruoli della fabbrica: quelli del caso, più `builder_esterno` per chi costruisce da fuori. */
    ruoli: readonly string[];
    /**
     * (8.0c) La persona costruisce il caso (un ruolo che costruisce, fuori dalla sola lettura): la CLI del modello 1.5.0
     * decide da qui, non dall'elenco dei ruoli. Lo stato del caso (chiuso, in pausa) resta a parte, in `dossier`.
     */
    scrive: boolean;
    /**
     * (8.0c) Con `scrive` falso, il perché, lo stesso testo del 403 di una scrittura: la CLI del modello 1.5.0 lo dice prima
     * di toccare GitHub (per chi è scesa a Contributore: il ruolo si cambia da Impostazioni › Persone). Senza, null.
     */
    perche: string | null;
  };
}

/** Il brief o lo strato chiesto; null se l'Agent Factory del caso non si legge (come «caso non trovato»). */
export async function loadCliContext(executor: UcExecutor, c: CliCase, input: { layer: ContextLayer | null; since: Date | null }): Promise<CliContext | null> {
  const read = await readFactory(executor, c.target, c.actor);
  if (!read.ok) return null;
  const [extras, names, tasks] = await Promise.all([
    cliCaseExtras(executor, c.target, { canSeeNeeds: c.canSeeNeeds }),
    namesToHide(executor, c.target),
    tasksStoreReady(executor).then((ready) => (ready ? listTasks(executor, c.target) : [])),
  ]);
  const viewerId = c.actor.kind === "persona" ? c.actor.userId : "";
  const view = read.value;
  const base = {
    code: c.useCase.code,
    title: c.useCase.title,
    dossierStatus: c.access.status,
    open: view.open,
    approved: view.approved,
    latestPackage: view.latestPackage ? { version: view.latestPackage.version, createdAt: view.latestPackage.createdAt, source: view.latestPackage.source } : null,
    decisions: view.decisions,
    openNeeds: extras.openNeeds === null ? null : extras.openNeeds.length,
    proposedQuestions: extras.proposals?.length ?? 0,
    repos: extras.repos,
    tasksLine: tasksBriefLine(tasks, viewerId),
    namesToHide: names,
    since: input.since ? input.since.toISOString() : null,
  };
  const testo =
    input.layer === "progetto"
      ? composeProjectLayer(base)
      : input.layer === "decisioni"
        ? composeDecisionsLayer(base)
        : input.layer === "pacchetto"
          ? composePackageLayer({ code: c.useCase.code, packages: view.packages })
          : input.layer === "domande"
            ? composeQuestionsLayer({ code: c.useCase.code, openNeeds: extras.openNeeds, proposals: extras.proposals, namesToHide: names })
            : composeBrief(base);
  const project = view.open ?? view.approved;
  const scrive = !c.factory.readOnly && canWriteFactory(c.factory.roles);
  return {
    testo,
    dati: {
      caso: c.useCase.code,
      dossier: c.access.status,
      progetto: project ? { versione: project.version, stato: project.status, revisione: project.revision } : null,
      pacchetto: view.latestPackage ? { versione: view.latestPackage.version } : null,
      prossimoPasso: nextStep(base),
      repository: extras.repos,
      compiti: tasks.map((t) => ({ ref: t.ref, stato: t.status, tuo: t.holderUserId !== null && t.holderUserId === viewerId })),
      ruoli: c.factory.roles,
      scrive,
      perche: scrive ? null : notBuilderMessage(c.factory.blocked, CLI_NOT_A_BUILDER),
    },
  };
}
