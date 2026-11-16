import { randomUUID } from "node:crypto";
import { tool } from "ai";
import { z } from "zod";
import { skippedClassificationsText } from "@/lib/ai/classify";
import { getAppUcExecutor, type UcExecutor } from "@/lib/db/uc-executor";
import { allSteps, locateStep, type MappingBoard, type StepPlace } from "@/lib/mappatura/board-model";
import { cutLine, opsForNewStep, opsForStepPatch, type BoardOp, type StepDraft } from "@/lib/mappatura/board-ops";
import { mappingStoreReady, readBoard, resolveProcess, saveBoardOps, type BoardActor, type BoardScope, type Rejection } from "@/lib/mappatura/board-store";
import { linkDependencyStatement } from "@/lib/mappatura/board-sql";
import { appCompleteDeps, completeUnitMapping, type CompleteDeps, type CompletionOutcome } from "@/lib/mappatura/complete";
import { BOARD_TEXT } from "@/lib/mappatura/text";
import { FREQUENCIES, MAPPING_LIMITS, WORK_TYPES, type Friction } from "@/lib/mappatura/vocab";

/**
 * I tool dell'activity mapping, costruiti per ogni richiesta della chat (docs/mappatura/MAPPATURA-BOARD-PIANO.md §5.1).
 *
 * L'unità arriva già controllata dalla rotta (è di quel workspace) e l'attore è l'assistente, con chi scrive e il suo
 * ruolo: nessun tool scrive con `db`. I passi e le loro note passano da `saveBoardOps`, l'unica strada per scrivere la
 * board, dove ogni istruzione porta il workspace e l'unità; il completamento passa da `completeUnitMapping`. Un id
 * scritto dal modello vale solo se è un passo di questa unità.
 *
 * `deadline` è la scadenza dei tool della richiesta (chatToolsDeadline in src/lib/ai/models.ts): la classificazione e il
 * match O*NET del completamento si fermano lì. Senza le tabelle della 0039 ogni tool risponde la stessa frase e non
 * scrive niente. I testi troppo lunghi si tagliano, mai si rifiutano. Nei log solo id e codici.
 */

/** Quello che i tool usano per leggere e scrivere: nell'app il database; nei test una board finta. */
export interface MappingToolDeps {
  executor(): Promise<UcExecutor>;
  storeReady(executor: UcExecutor): Promise<boolean>;
  readBoard: typeof readBoard;
  resolveProcess: typeof resolveProcess;
  saveBoardOps: typeof saveBoardOps;
  completeDeps(executor: UcExecutor): CompleteDeps;
  complete: typeof completeUnitMapping;
  newId(): string;
}

export const APP_MAPPING_TOOL_DEPS: MappingToolDeps = Object.freeze({
  executor: getAppUcExecutor,
  storeReady: mappingStoreReady,
  readBoard,
  resolveProcess,
  saveBoardOps,
  completeDeps: appCompleteDeps,
  complete: completeUnitMapping,
  newId: () => randomUUID(),
});

/** Senza le tabelle della 0039: niente si scrive, e il modello lo dice con queste parole. */
export const BOARD_NOT_READY_MESSAGE = "La board non è ancora disponibile: riprova tra qualche minuto.";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOf = (value: string | undefined): string | null => {
  const id = value?.trim() ?? "";
  return UUID.test(id) ? id.toLowerCase() : null;
};

// ─── Gli schemi che il modello riempie ───────────────────────────────

/** I campi di un passo, tutti facoltativi: `saveActivity` vuole in più titolo e descrizione, `updateActivity` l'id. */
const stepFields = {
  afterActivityId: z.string().optional().describe("L'id del passo dopo il quale va questo passo, quando va in mezzo ad altri. Senza, va in fondo al processo"),
  who: z.array(z.string()).optional().describe("Chi fa il passo: ruoli o nomi, come li dice l'utente"),
  toolsUsed: z.array(z.string()).optional().describe("Strumenti e sistemi usati"),
  inputDescription: z.string().optional().describe("Che cosa entra: che cosa arriva, da chi, in che forma"),
  outputDescription: z.string().optional().describe("Che cosa esce: che cosa si produce, per chi"),
  steps: z.array(z.string()).optional().describe("I passaggi operativi, uno per voce"),
  decisionPoints: z.string().optional().describe("Dove decide una persona: chi decide, e che cosa"),
  decisionLabel: z.string().optional().describe("Il nome della decisione in poche parole, per esempio «Conferma dell'ordine»"),
  exception: z.string().optional().describe("Che cosa succede quando qualcosa va storto"),
  frictions: z.array(z.string()).optional().describe("Gli attriti: dove il lavoro si inceppa, uno per voce"),
  frictionLevel: z.number().int().min(0).max(3).optional().describe("Quanto pesano gli attriti: 0 nessuno, 1 lieve, 2 medio, 3 forte"),
  data: z.array(z.string()).optional().describe("Dati e documenti che servono, uno per voce"),
  times: z.array(z.string()).optional().describe("Tempi e volumi, uno per voce: «Quaranta richieste a settimana»"),
  frequency: z.enum(FREQUENCIES).optional().describe("Frequenza: giornaliera, settimanale, mensile, ad_hoc"),
  timeSpentHoursWeek: z.number().optional().describe("Ore a settimana stimate"),
  qualityPerceived: z.string().optional().describe("Qualità percepita del passo"),
  workType: z.enum(WORK_TYPES).optional().describe("Tipo di lavoro"),
};

const saveActivitySchema = z.object({
  title: z.string().describe("Il nome del passo, breve"),
  description: z.string().describe("Che cosa succede in questo passo, in una frase"),
  processName: z
    .string()
    .optional()
    .describe("Il nome del processo (il flusso) di cui il passo fa parte, con le parole dell'utente: lo stesso per tutti i passi dello stesso processo"),
  ...stepFields,
});

const updateActivitySchema = z.object({
  activityId: z.string().describe("L'id del passo, dall'elenco dei passi della board nel contesto"),
  title: z.string().optional().describe("Il nome del passo, breve"),
  description: z.string().optional().describe("Che cosa succede in questo passo, in una frase"),
  ...stepFields,
});

type StepInput = Partial<z.infer<typeof saveActivitySchema>>;

/** Dal modulo del modello al modulo di un passo della board (§5.1): solo i campi che il modello ha scritto. */
export function draftOf(input: StepInput): Partial<StepDraft> {
  const draft: Partial<StepDraft> = {};
  const put = <K extends keyof StepDraft>(key: K, value: StepDraft[K] | undefined) => {
    if (value !== undefined) draft[key] = value;
  };
  put("title", input.title);
  put("description", input.description);
  put("who", input.who);
  put("tools", input.toolsUsed);
  put("input", input.inputDescription);
  put("output", input.outputDescription);
  put("decision", input.decisionPoints);
  put("decisionLabel", input.decisionLabel);
  put("exception", input.exception);
  put("friction", input.frictionLevel as Friction | undefined);
  put("frequency", input.frequency);
  put("hoursWeek", input.timeSpentHoursWeek);
  put("quality", input.qualityPerceived);
  put("workType", input.workType);
  put("steps", input.steps);
  put("frictions", input.frictions);
  put("data", input.data);
  put("times", input.times);
  return draft;
}

// ─── Le risposte al modello ──────────────────────────────────────────

type ToolAnswer = { success: boolean; message: string; activityId?: string };

const notReady = (): ToolAnswer => ({ success: false, message: BOARD_NOT_READY_MESSAGE });

/** Perché un passo non si è salvato, in parole per il modello. */
function stepRefusal(reason: Rejection["reason"], board: MappingBoard): string {
  if (reason === "limit") {
    return `Passo non salvato. ${allSteps(board).length >= MAPPING_LIMITS.stepsPerUnit ? BOARD_TEXT.toast.limitStepsInBoard : BOARD_TEXT.toast.limitStepsInProcess}`;
  }
  return "Passo non salvato: il processo non c'è più sulla board. Riprova.";
}

/** Un salvataggio che non è partito: senza la 0039 la frase di sempre, altrimenti un nuovo tentativo. */
const saveFailure = (code: string): ToolAnswer => (code === "non_disponibile" ? notReady() : { success: false, message: "Passo non salvato. Riprova." });

/**
 * Il messaggio di «Completa la mappatura» per il modello, con le frasi di sempre: ora sono vere, perché la board ha il
 * bottone «Classifica N passi» per quello che resta.
 */
export function completionMessage(summary: string, outcome: CompletionOutcome): string {
  const { counts } = outcome;
  const classification =
    outcome.classification === "niente_da_fare"
      ? ""
      : outcome.classification === "non_riuscita"
        ? "Classificazione non riuscita — verrà riprovata manualmente."
        : [`Classificazione completata: ${counts.automate} Automate, ${counts.differentiate} Differentiate, ${counts.innovate} Innovate.`, skippedClassificationsText(outcome.remaining)]
            .filter(Boolean)
            .join(" ");
  const onet =
    outcome.onet === "niente_da_fare"
      ? ""
      : outcome.onet === "non_riuscito"
        ? "Match O*NET non riuscito — verrà riprovato manualmente."
        : `Match O*NET completato su ${outcome.matched} attività. AI Exposure media: ${outcome.avgExposurePct ?? 0}%.`;
  return ["Dipartimento segnato come mappato.", summary.trim(), classification, onet].filter(Boolean).join(" ");
}

// ─── Spostare un passo dopo un altro ─────────────────────────────────

/** Lo spostamento che mette il passo subito dopo `afterId` (anche in un altro processo); null se è già lì o se `afterId` non è un passo. */
function moveAfter(board: MappingBoard, place: StepPlace, afterId: string | null, newId: () => string): BoardOp | null {
  const after = afterId ? locateStep(board, afterId) : null;
  if (!after || after.step.id === place.step.id) return null;
  if (after.process.id === place.process.id && after.process.steps[after.stepIndex + 1]?.id === place.step.id) return null;
  const siblings = after.process.steps.filter((step) => step.id !== place.step.id);
  const beforeId = siblings[siblings.findIndex((step) => step.id === after.step.id) + 1]?.id ?? null;
  return { id: newId(), t: "step.move", stepId: place.step.id, processId: after.process.id, beforeId };
}

// ─── I tool ──────────────────────────────────────────────────────────

export function getActivityMappingTools(
  workspaceId: string,
  departmentId: string,
  { deadline, actor }: { deadline: number; actor: BoardActor },
  deps: MappingToolDeps = APP_MAPPING_TOOL_DEPS,
) {
  const scope: BoardScope = { workspaceId, departmentId };
  const viewer = { userId: actor.userId, role: actor.role };

  return {
    saveActivity: tool({
      description:
        "Salva sulla board un passo emerso dall'intervista, nel suo processo. Usalo quando hai raccolto abbastanza dettagli su un passo (almeno titolo, descrizione e qualche dettaglio). Il passo compare subito sulla board come «da validare».",
      inputSchema: saveActivitySchema,
      execute: async (input): Promise<ToolAnswer> => {
        const executor = await deps.executor();
        if (!(await deps.storeReady(executor))) return notReady();
        const processName = input.processName?.trim() || null;
        // «Dopo quel passo»: vale solo un passo di questa unità; senza un processo nominato, il passo va nel suo.
        let after: StepPlace | null = null;
        let baseRevision = 0;
        const afterId = uuidOf(input.afterActivityId);
        if (afterId) {
          const board = await deps.readBoard(executor, scope, viewer);
          after = board ? locateStep(board, afterId) : null;
          baseRevision = board?.revision ?? 0;
        }
        const processId = processName === null && after ? after.process.id : await deps.resolveProcess(executor, scope, processName);
        if (!processId) return { success: false, message: "Passo non salvato: la board non accetta altri processi." };
        const { stepId, ops } = opsForNewStep({ ...draftOf(input), title: input.title }, { processId, afterStepId: after && after.process.id === processId ? after.step.id : null }, deps.newId);
        const add = ops[0];
        if (!add || add.t !== "step.add") return { success: false, message: "Passo non salvato: serve un titolo." };
        const result = await deps.saveBoardOps(executor, scope, actor, { baseRevision, ops });
        if (!result.ok) return saveFailure(result.code);
        const refused = result.rejected.find((rejection) => rejection.id === add.id);
        if (refused) return { success: false, message: stepRefusal(refused.reason, result.board) };
        const name = result.board.processes.find((process) => process.id === processId)?.name ?? processName ?? BOARD_TEXT.defaultProcessName;
        return { success: true, activityId: stepId, message: `Passo "${add.title}" salvato nel processo "${name}".` };
      },
    }),

    updateActivity: tool({
      description:
        "Corregge o completa un passo già sulla board, con il suo id: scrivi solo i campi che cambiano. Le liste (passaggi, attriti, dati, tempi, ruoli, strumenti) aggiungono voci e non ne tolgono. Con afterActivityId sposta il passo subito dopo quell'altro.",
      inputSchema: updateActivitySchema,
      execute: async (input): Promise<ToolAnswer> => {
        const executor = await deps.executor();
        if (!(await deps.storeReady(executor))) return notReady();
        const board = await deps.readBoard(executor, scope, viewer);
        const id = uuidOf(input.activityId);
        const place = board && id ? locateStep(board, id) : null;
        if (!board || !place) return { success: false, message: "Passo non trovato su questa board: usa un id dall'elenco dei passi." };
        const ops = opsForStepPatch(place.step, draftOf(input), deps.newId);
        const move = moveAfter(board, place, uuidOf(input.afterActivityId), deps.newId);
        if (move) ops.push(move);
        if (ops.length === 0) return { success: true, message: `Passo "${place.step.title}": niente da cambiare.` };
        const result = await deps.saveBoardOps(executor, scope, actor, { baseRevision: board.revision, ops });
        if (!result.ok) return saveFailure(result.code);
        const title = locateStep(result.board, place.step.id)?.step.title ?? place.step.title;
        if (result.rejected.length === 0) return { success: true, message: `Passo "${title}" aggiornato.` };
        if (result.rejected.length === ops.length) {
          return { success: false, message: `Passo "${title}" non aggiornato: è appena stato cambiato sulla board. Rileggi l'elenco dei passi.` };
        }
        return { success: true, message: `Passo "${title}" aggiornato. Alcuni campi erano appena stati cambiati sulla board e restano come sono.` };
      },
    }),

    linkActivityDependency: tool({
      description: "Collega una dipendenza tra due passi: quando emerge che un passo dipende da un altro. Gli id vengono dall'elenco dei passi della board.",
      inputSchema: z.object({
        sourceActivityId: z.string().describe("L'id del passo che dipende"),
        targetActivityId: z.string().describe("L'id del passo da cui dipende"),
        dependencyType: z.string().optional().describe("Tipo di dipendenza (input, approval, data, handoff)"),
      }),
      execute: async ({ sourceActivityId, targetActivityId, dependencyType }): Promise<ToolAnswer> => {
        const executor = await deps.executor();
        if (!(await deps.storeReady(executor))) return notReady();
        const source = uuidOf(sourceActivityId);
        const target = uuidOf(targetActivityId);
        if (!source || !target || source === target) return { success: false, message: "Dipendenza non collegata: servono gli id di due passi diversi dall'elenco della board." };
        const [rows] = await executor.batch([linkDependencyStatement(scope, source, target, cutLine(dependencyType, 100))]);
        return rows?.[0]?.linked === true
          ? { success: true, message: "Passi collegati." }
          : { success: false, message: "Dipendenza non collegata: uno dei due passi non è su questa board." };
      },
    }),

    markDepartmentMapped: tool({
      description:
        "Segna la mappatura dell'unità come completa, quando hai raccolto tutti i passi principali. Classifica da sola i passi nei 3 stream e cerca il match O*NET. Porta la scoperta in una frase e i punti di analisi.",
      inputSchema: z.object({
        summary: z.string().describe("Breve riepilogo della mappatura"),
        headline: z.string().optional().describe("La scoperta in una frase: dove va il tempo, che cosa blocca (al più 300 caratteri)"),
        analysisPoints: z
          .array(z.object({ title: z.string().describe("Il titolo del punto, breve"), text: z.string().describe("Il punto: la prima frase dice il punto, poi i dettagli") }))
          .optional()
          .describe("Fino a sei punti di analisi"),
      }),
      execute: async ({ summary, headline, analysisPoints }): Promise<ToolAnswer> => {
        const executor = await deps.executor();
        if (!(await deps.storeReady(executor))) return notReady();
        const outcome = await deps.complete(deps.completeDeps(executor), {
          scope,
          deadline,
          headline: headline?.trim() ? headline : null,
          analysis: analysisPoints?.slice(0, MAPPING_LIMITS.analysisPoints),
        });
        if (!outcome) return notReady();
        return { success: true, message: completionMessage(summary, outcome) };
      },
    }),
  };
}
