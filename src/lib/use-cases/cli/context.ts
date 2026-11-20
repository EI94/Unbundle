import "server-only";
/**
 * Il contesto di un caso per un coding agent (rilascio 8.0b, standard §7), uguale per `unbundle context` e per
 * `get_case_context` dell'MCP del caso: il brief di al massimo 300 token, o uno strato (`progetto`, `decisioni`,
 * `pacchetto`, `domande`, (9b) `contesto`). Il testo è pronto da leggere, senza nomi né e-mail; `dati` serve agli script.
 *
 * (9b, docs/contesto/RILASCIO-9b-COSTRUZIONE.md §2.5, §2.6) Lo strato `contesto` e la riga del brief vengono da
 * `loadAgentContext`: **solo i fatti «Per tutti», anche a Lateral Space** (D1), perché i coding agent scrivono in
 * repository e PR che leggono anche chi costruisce da fuori e il cliente. I nomi che Unbundle conosce diventano «una
 * persona», come nel pacchetto. Le novità della riga del brief si contano sul file: `CONTESTO.md` di adesso contro quello
 * dell'ultima versione del pacchetto (`packageContextDelta`).
 */
import type { AgentContext } from "@/lib/context/work/agent-text";
import { formatAgentContext } from "@/lib/context/work/agent-text";
import { loadAgentContext } from "@/lib/db/queries/context-work";
import { cliCaseExtras, namesToHide, readFactory } from "@/lib/db/queries/use-case-factory";
import { listTasks, tasksStoreReady } from "@/lib/db/queries/use-case-tasks";
import { tasksBriefLine } from "@/lib/use-cases/factory/tasks";
import type { UcExecutor } from "@/lib/db/uc-executor";
import { packageContextDelta, redactAgentContext } from "@/lib/use-cases/factory/package";
import { canWriteFactory } from "@/lib/use-cases/factory/permissions";
import { cliKnowsContextLayer, composeBrief, composeDecisionsLayer, composePackageLayer, composeProjectLayer, composeQuestionsLayer, nextStep, type ContextLayer } from "./brief";
import { CLI_NOT_A_BUILDER, caseOnlyContextOf, type CliCase } from "./case";
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
     * di toccare GitHub (a chi scende a Contributore: il ruolo si cambia da Impostazioni › Persone). Senza, null.
     */
    perche: string | null;
    /** (9b) Solo nello strato `contesto`: i fatti «Per tutti», con i nomi coperti (lo stesso testo di `testo`, per gli script). */
    contesto?: AgentContext;
  };
}

/**
 * Il brief o lo strato chiesto. `non_trovato`: l'Agent Factory del caso non si legge (come «caso non trovato»).
 * `non_disponibile`: lo strato `contesto` non si è letto (l'archivio di «Contesto» non risponde): da riprovare.
 */
export type CliContextResult = { ok: true; value: CliContext } | { ok: false; code: "non_trovato" | "non_disponibile" };

/**
 * `userAgent`: l'intestazione della richiesta. (9b) Solo la CLI che conosce `--contesto` (dalla 1.6.0) riceve nel brief la
 * riga del contesto e lo strato tra gli «Strati»; l'MCP del caso non la passa.
 */
export async function loadCliContext(executor: UcExecutor, c: CliCase, input: { layer: ContextLayer | null; since: Date | null; userAgent?: string | null }): Promise<CliContextResult> {
  const read = await readFactory(executor, c.target, c.actor);
  if (!read.ok) return { ok: false, code: "non_trovato" };
  const view = read.value;
  const contextLayer = input.layer === "contesto";
  // (9b) La riga del contesto nel brief, solo per la CLI che conosce `--contesto`: il contesto di adesso, da confrontare
  // con il CONTESTO.md dell'ultimo pacchetto.
  const knowsContext = cliKnowsContextLayer(input.userAgent);
  const contextLine = input.layer === null && knowsContext;
  // (8.0d, D7) I soli fatti legati al caso per «Solo questo use case», e per chiunque legga un caso che costruisce
  // qualcuno «Solo questo use case» (`caseOnlyContextOf`); per tutti gli altri la lettura resta quella di sempre.
  const caseOnlyReader = (contextLayer || contextLine) && (await caseOnlyContextOf(executor, c)) ? ({ caseOnly: true } as const) : {};
  const [extras, names, tasks, agent] = await Promise.all([
    cliCaseExtras(executor, c.target, { canSeeNeeds: c.canSeeNeeds }),
    namesToHide(executor, c.target),
    tasksStoreReady(executor).then((ready) => (ready ? listTasks(executor, c.target) : [])),
    // (9b) Lo strato `contesto` (con `since`) e la riga del brief (senza): solo «Per tutti», per chiunque chieda (D1).
    // (8.0d, D7) A «Solo questo use case» solo i fatti legati al suo caso, mai quelli dell'azienda.
    contextLayer
      ? loadAgentContext({ workspaceId: c.target.workspaceId, useCaseId: c.target.useCaseId, since: input.since, ...caseOnlyReader })
      : contextLine
        ? loadAgentContext({ workspaceId: c.target.workspaceId, useCaseId: c.target.useCaseId, ...caseOnlyReader })
        : Promise.resolve(null),
  ]);
  if (contextLayer && agent === null) return { ok: false, code: "non_disponibile" };
  // Le novità del brief: le righe di CONTESTO.md che il prossimo «Aggiorna il pacchetto» cambierebbe; senza pacchetto,
  // quanti fatti ci sono. Senza archivio (agent null) nessuna riga.
  const contextDelta = contextLine ? packageContextDelta({ context: agent, namesToHide: names, code: c.useCase.code, latest: view.latestPackage, ...caseOnlyReader }) : 0;
  const shared = contextLayer && agent ? redactAgentContext(agent, names) : null;
  const viewerId = c.actor.kind === "persona" ? c.actor.userId : "";
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
    contextDelta,
    contextLayer: knowsContext,
    namesToHide: names,
    since: input.since ? input.since.toISOString() : null,
  };
  const testo = shared
    ? formatAgentContext(shared, { code: c.useCase.code })
    : input.layer === "progetto"
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
    ok: true,
    value: {
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
        ...(shared ? { contesto: shared } : {}),
      },
    },
  };
}
