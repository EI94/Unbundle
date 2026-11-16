import test from "node:test";
import assert from "node:assert/strict";
import { installAppModules } from "./claude-test-kit.ts";
import { FIXTURE_IDS, fixtureBoard } from "../mappatura/board-fixture.ts";
import { locateStep, type MappingBoard } from "../mappatura/board-model.ts";
import { applyOps, type BoardOp } from "../mappatura/board-ops.ts";
import type { CompletionOutcome } from "../mappatura/complete.ts";
import { MAPPING_LIMITS } from "../mappatura/vocab.ts";
import type { UcStatement } from "../uc/sql/statement.ts";

// (Mappatura board) I tool veri della chat dell'activity mapping (docs/mappatura/MAPPATURA-BOARD-PIANO.md §5.1, §6) su
// una board finta: che cosa scrivono, sempre con l'unità e il workspace che la rotta ha controllato, e che cosa
// rispondono al modello. Un id scritto dal modello vale solo se è un passo di questa unità; senza le tabelle della 0039
// nessun tool scrive niente. Dati inventati («Ufficio acquisti», board-fixture.ts).

await installAppModules({});
const { BOARD_NOT_READY_MESSAGE, completionMessage, getActivityMappingTools } = await import("./tools/activity-mapping-tools.ts");
const { linkDependencyStatement } = await import("../mappatura/board-sql.ts");
type Deps = Parameters<typeof getActivityMappingTools>[3] & object;

const I = FIXTURE_IDS;
const SCOPE = { workspaceId: I.workspace, departmentId: I.unit };
const ACTOR = { kind: "assistente", userId: "33333333-cccc-4ccc-8ccc-333333333333", role: "contributor" } as const;
/** Un id di un'altra unità (o di un altro workspace): sulla board di questa unità non c'è. */
const FOREIGN = "99999999-9999-4999-8999-999999999999";
const NEW_PROCESS = "aaaaaaaa-0000-4000-8000-0000000000ff";

type Call = [name: string, ...args: unknown[]];

/**
 * Una board finta: la board di «Ufficio acquisti» per lo scope giusto; i salvataggi applicano le operazioni come il
 * browser (`applyOps`) e rifiutano quelle che `refuse` nomina; le istruzioni SQL rispondono con `rows`.
 */
function fakeStore(options: { ready?: boolean; board?: MappingBoard; refuse?: (op: BoardOp) => "conflict" | "gone" | "limit" | null; saveCode?: "non_disponibile" | "non_trovata"; rows?: Array<Record<string, unknown>>; outcome?: CompletionOutcome | null } = {}) {
  const calls: Call[] = [];
  let board = options.board ?? fixtureBoard();
  let seq = 0;
  const executor = {
    async batch(statements: readonly UcStatement[]) {
      calls.push(["batch", statements]);
      return [options.rows ?? []];
    },
  };
  const deps: Deps = {
    executor: async () => executor,
    storeReady: async () => {
      calls.push(["storeReady"]);
      return options.ready !== false;
    },
    readBoard: async (_executor, scope, viewer) => {
      calls.push(["readBoard", scope, viewer]);
      return scope.workspaceId === SCOPE.workspaceId && scope.departmentId === SCOPE.departmentId ? board : null;
    },
    resolveProcess: async (_executor, scope, name) => {
      calls.push(["resolveProcess", scope, name]);
      if (name === null) return board.processes[0]?.id ?? null;
      return board.processes.find((process) => process.name.toLowerCase() === name.toLowerCase())?.id ?? NEW_PROCESS;
    },
    saveBoardOps: async (_executor, scope, actor, input) => {
      calls.push(["saveBoardOps", scope, actor, input]);
      if (options.saveCode) return { ok: false, code: options.saveCode };
      const rejected = input.ops.flatMap((op) => {
        const reason = options.refuse?.(op) ?? null;
        return reason ? [{ id: op.id, reason }] : [];
      });
      const applied = input.ops.filter((op) => !rejected.some((item) => item.id === op.id));
      const withProcess = applied.some((op) => op.t === "step.add" && op.processId === NEW_PROCESS)
        ? { ...board, processes: [...board.processes, { id: NEW_PROCESS, name: "Dai fornitori al magazzino", owner: null, votes: 0, myVotes: 0, steps: [] }] }
        : board;
      board = applyOps(withProcess, applied, { kind: actor.kind });
      return { ok: true, revision: board.revision + 1, savedAt: "2026-11-16T10:00:00.000Z", rejected, board };
    },
    completeDeps: () => {
      calls.push(["completeDeps"]);
      return {} as never;
    },
    complete: async (_deps, input) => {
      calls.push(["complete", input]);
      return options.outcome === undefined ? OUTCOME : options.outcome;
    },
    newId: () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`,
  };
  const tools = getActivityMappingTools(SCOPE.workspaceId, SCOPE.departmentId, { deadline: Date.now() + 60_000, actor: ACTOR }, deps);
  const run = async (name: keyof typeof tools, input: Record<string, unknown>) =>
    (await (tools[name].execute as (input: unknown, options: unknown) => Promise<unknown>)(input, { toolCallId: "toolu_prova", messages: [] })) as { success: boolean; message: string; activityId?: string };
  return { calls, run, called: (name: string) => calls.filter((call) => call[0] === name), board: () => board };
}

const OUTCOME: CompletionOutcome = {
  firstCompletion: true,
  total: 6,
  classified: 5,
  remaining: 1,
  counts: { automate: 3, differentiate: 1, innovate: 1 },
  classification: "parziale",
  matched: 4,
  avgExposurePct: 34,
  onet: "fatto",
};

const opsOf = (store: ReturnType<typeof fakeStore>) => (store.called("saveBoardOps")[0]?.[3] as { ops: BoardOp[] } | undefined)?.ops ?? [];

test("saveActivity: il passo nel processo che il modello nomina, con i suoi campi e le sue note; nasce «da validare», dalla chat", async () => {
  const store = fakeStore();
  const answer = await store.run("saveActivity", {
    title: "Verifica della fattura",
    description: "Si confronta la fattura con l'ordine e con la merce ricevuta.",
    processName: "dall'ordine alla consegna",
    who: ["Contabilità", "Buyer"],
    toolsUsed: ["Gestionale"],
    inputDescription: "La fattura del fornitore.",
    outputDescription: "La fattura approvata.",
    steps: ["Si apre la fattura", "Si cerca l'ordine"],
    decisionPoints: "La contabilità decide se pagare.",
    decisionLabel: "Approvazione della fattura",
    exception: "Se l'importo non torna, si scrive al fornitore.",
    frictions: ["Ordini senza numero"],
    frictionLevel: 2,
    data: ["Ordine", "Bolla di consegna"],
    times: ["Venti fatture a settimana"],
    frequency: "settimanale",
    timeSpentHoursWeek: 3.5,
    qualityPerceived: "Bassa",
    workType: "detection",
  });
  // Il processo per nome (con le maiuscole e gli spazi che vuole il modello), nell'unità della rotta.
  assert.deepEqual(store.called("resolveProcess"), [["resolveProcess", SCOPE, "dall'ordine alla consegna"]]);
  const [[, scope, actor]] = store.called("saveBoardOps");
  assert.deepEqual([scope, actor], [SCOPE, ACTOR], "lo scope della rotta e l'attore assistente, mai un id del modello");
  const ops = opsOf(store);
  assert.deepEqual(ops[0], { id: ops[0].id, t: "step.add", stepId: answer.activityId, processId: I.processB, title: "Verifica della fattura" });
  const sets = Object.fromEntries(ops.flatMap((op) => (op.t === "step.set" ? [[op.field, op.next]] : [])));
  assert.deepEqual(sets, {
    description: "Si confronta la fattura con l'ordine e con la merce ricevuta.",
    who: ["Contabilità", "Buyer"],
    tools: ["Gestionale"],
    input: "La fattura del fornitore.",
    output: "La fattura approvata.",
    decision: "La contabilità decide se pagare.",
    decisionLabel: "Approvazione della fattura",
    exception: "Se l'importo non torna, si scrive al fornitore.",
    friction: 2,
    frequency: "settimanale",
    hoursWeek: 3.5,
    quality: "Bassa",
    workType: "detection",
  });
  // Le liste diventano note delle loro corsie: il server le ricopia nelle colonne di sempre (attriti, dati).
  assert.deepEqual(
    ops.flatMap((op) => (op.t === "note.add" ? [[op.lane, op.text]] : [])),
    [
      ["attivita", "Si apre la fattura"],
      ["attivita", "Si cerca l'ordine"],
      ["attriti", "Ordini senza numero"],
      ["dati", "Ordine"],
      ["dati", "Bolla di consegna"],
      ["tempi", "Venti fatture a settimana"],
    ],
  );
  assert.deepEqual(answer, { success: true, activityId: answer.activityId, message: 'Passo "Verifica della fattura" salvato nel processo "Dall\'ordine alla consegna".' });
  const saved = locateStep(store.board(), answer.activityId!);
  assert.deepEqual([saved?.process.id, saved?.step.status, saved?.step.origin, saved?.step.notes.attriti[0]?.status], [I.processB, "da_validare", "chat", "fonte"]);
});

test("saveActivity: i testi troppo lunghi si tagliano ai limiti della board, mai si rifiutano; un processo nuovo per un nome nuovo", async () => {
  const store = fakeStore();
  const answer = await store.run("saveActivity", {
    title: `Controllo ${"molto ".repeat(40)}lungo`,
    description: "Una frase. ".repeat(400),
    processName: "Dai fornitori al magazzino",
    who: Array.from({ length: 20 }, (_, index) => `Ruolo ${index + 1}`),
    toolsUsed: ["x".repeat(200)],
  });
  assert.equal(answer.success, true);
  const ops = opsOf(store);
  const add = ops[0] as Extract<BoardOp, { t: "step.add" }>;
  assert.equal(add.processId, NEW_PROCESS);
  assert.ok(add.title.length <= MAPPING_LIMITS.title && add.title.startsWith("Controllo molto"));
  const set = (field: string) => ops.find((op) => op.t === "step.set" && op.field === field) as Extract<BoardOp, { t: "step.set" }>;
  assert.ok((set("description").next as string).length <= MAPPING_LIMITS.description);
  assert.equal((set("who").next as string[]).length, MAPPING_LIMITS.who);
  assert.equal((set("tools").next as string[])[0].length, MAPPING_LIMITS.toolItem);
  assert.match(answer.message, /nel processo "Dai fornitori al magazzino"\.$/);
});

test("saveActivity dopo un altro passo: solo un passo di questa unità vale; senza processo nominato va nel processo di quel passo", async () => {
  const store = fakeStore();
  await store.run("saveActivity", { title: "Richiesta di chiarimenti", description: "Si chiede al fornitore.", afterActivityId: I.confronto.toUpperCase() });
  assert.deepEqual(store.called("resolveProcess"), [], "il processo è quello del passo di prima");
  assert.deepEqual(opsOf(store)[0], { id: opsOf(store)[0].id, t: "step.add", stepId: (opsOf(store)[0] as { stepId: string }).stepId, processId: I.processA, afterId: I.confronto, title: "Richiesta di chiarimenti" });
  const place = locateStep(store.board(), (opsOf(store)[0] as { stepId: string }).stepId);
  assert.equal(place?.code, "A3", "subito dopo «Confronto delle offerte» (A2)");

  // Un id di un'altra unità, o che non è un id: il passo si salva lo stesso, in fondo al primo processo.
  for (const afterActivityId of [FOREIGN, "il passo di prima"]) {
    const other = fakeStore();
    const answer = await other.run("saveActivity", { title: "Archiviazione", description: "Si archivia.", afterActivityId });
    assert.equal(answer.success, true, afterActivityId);
    assert.equal("afterId" in opsOf(other)[0], false, afterActivityId);
    assert.equal(locateStep(other.board(), answer.activityId!)?.code, "A5");
  }
});

test("saveActivity rifiutato: il limite dei passi, il processo sparito, la board che non c'è; il modello lo sa, niente risulta salvato", async () => {
  const limit = fakeStore({ refuse: (op) => (op.t === "step.add" ? "limit" : null) });
  assert.deepEqual(await limit.run("saveActivity", { title: "Altro passo", description: "x" }), { success: false, message: "Passo non salvato. Un processo tiene al massimo 40 passi." });
  const gone = fakeStore({ refuse: (op) => (op.t === "step.add" ? "gone" : null) });
  assert.equal((await gone.run("saveActivity", { title: "Altro passo", description: "x" })).success, false);
  const missing = fakeStore({ saveCode: "non_disponibile" });
  assert.deepEqual(await missing.run("saveActivity", { title: "Altro passo", description: "x" }), { success: false, message: BOARD_NOT_READY_MESSAGE });
  const empty = fakeStore();
  assert.deepEqual(await empty.run("saveActivity", { title: "   ", description: "x" }), { success: false, message: "Passo non salvato: serve un titolo." });
  assert.deepEqual(empty.called("saveBoardOps"), []);
});

test("updateActivity su un passo di un'altra unità (o un id inventato): success false, niente scritto", async () => {
  for (const activityId of [FOREIGN, "a-1", ""]) {
    const store = fakeStore();
    const answer = await store.run("updateActivity", { activityId, description: "Un'altra descrizione." });
    assert.deepEqual(answer, { success: false, message: "Passo non trovato su questa board: usa un id dall'elenco dei passi." }, activityId);
    assert.deepEqual(store.called("saveBoardOps"), [], activityId);
    assert.deepEqual(store.called("readBoard"), [["readBoard", SCOPE, { userId: ACTOR.userId, role: ACTOR.role }]], "la board di questa unità, per chi scrive");
  }
});

test("updateActivity: corregge i campi che cambiano; le liste aggiungono note, ruoli e strumenti, mai tolgono; afterActivityId sposta il passo", async () => {
  const store = fakeStore();
  const answer = await store.run("updateActivity", {
    activityId: I.richieste,
    description: "Le richieste arrivano da un modulo.",
    who: ["Buyer", "Ufficio tecnico"],
    frictions: ["Richieste incomplete", "Allegati mancanti"],
    afterActivityId: I.confronto,
  });
  assert.deepEqual(answer, { success: true, message: 'Passo "Raccolta delle richieste" aggiornato.' });
  const [[, , , input]] = store.called("saveBoardOps") as Array<[string, unknown, unknown, { baseRevision: number; ops: BoardOp[] }]>;
  assert.equal(input.baseRevision, 7, "la revisione della board letta");
  const ops = input.ops.map((op) => Object.fromEntries(Object.entries(op).filter(([key]) => key !== "id")));
  assert.deepEqual(ops, [
    { t: "step.set", stepId: I.richieste, field: "description", prev: "Le richieste degli uffici arrivano per e-mail e si copiano in un foglio.", next: "Le richieste arrivano da un modulo." },
    { t: "step.set", stepId: I.richieste, field: "who", prev: ["Buyer"], next: ["Buyer", "Ufficio tecnico"] },
    // «Richieste incomplete» c'è già: si aggiunge solo l'altra.
    { t: "note.add", noteId: (input.ops[2] as { noteId: string }).noteId, stepId: I.richieste, lane: "attriti", text: "Allegati mancanti" },
    { t: "step.move", stepId: I.richieste, processId: I.processA, beforeId: I.scelta },
  ]);
  const step = locateStep(store.board(), I.richieste)!;
  assert.equal(step.code, "A2", "dopo «Confronto delle offerte»");
  assert.equal(step.step.notes.attriti.length, 3, "le note di prima restano");

  // Niente da cambiare: niente si scrive.
  const same = fakeStore();
  assert.deepEqual(await same.run("updateActivity", { activityId: I.ordine, who: ["buyer"] }), { success: true, message: 'Passo "Invio dell\'ordine": niente da cambiare.' });
  assert.deepEqual(same.called("saveBoardOps"), []);
});

test("updateActivity su un campo appena cambiato sulla board: il modello lo sa, e il valore della persona resta", async () => {
  const store = fakeStore({ refuse: (op) => (op.t === "step.set" ? "conflict" : null) });
  const answer = await store.run("updateActivity", { activityId: I.ordine, description: "Si manda l'ordine dal gestionale." });
  assert.deepEqual(answer, { success: false, message: 'Passo "Invio dell\'ordine" non aggiornato: è appena stato cambiato sulla board. Rileggi l\'elenco dei passi.' });
});

test("linkActivityDependency: un'istruzione con il workspace e l'unità; un id di un'altra unità non collega niente, una coppia ripetuta riesce", async () => {
  // Il database risponde che le due attività ci sono (anche se la coppia c'era già): riuscito.
  const repeated = fakeStore({ rows: [{ linked: true }] });
  assert.deepEqual(await repeated.run("linkActivityDependency", { sourceActivityId: I.scelta, targetActivityId: I.confronto, dependencyType: "input" }), { success: true, message: "Passi collegati." });
  const [[, statements]] = repeated.called("batch") as Array<[string, UcStatement[]]>;
  assert.equal(statements.length, 1);
  assert.deepEqual(statements[0], linkDependencyStatement(SCOPE, I.scelta, I.confronto, "input"));
  // Una delle due non è un'attività di questo workspace (o la prima non è di questa unità): niente collegato.
  const foreign = fakeStore({ rows: [{ linked: false }] });
  assert.deepEqual(await foreign.run("linkActivityDependency", { sourceActivityId: I.scelta, targetActivityId: FOREIGN }), {
    success: false,
    message: "Dipendenza non collegata: uno dei due passi non è su questa board.",
  });
  // Un passo che dipende da sé stesso, o un id che non è un id: nessuna istruzione.
  for (const [source, target] of [[I.scelta, I.scelta.toUpperCase()], ["a-1", I.scelta]]) {
    const store = fakeStore({ rows: [{ linked: true }] });
    assert.equal((await store.run("linkActivityDependency", { sourceActivityId: source, targetActivityId: target })).success, false);
    assert.deepEqual(store.called("batch"), []);
  }
});

test("l'istruzione della dipendenza: la prima attività di questa unità, la seconda di questo workspace, mai sé stessa; una coppia ripetuta non cambia niente; la board sale di revisione", () => {
  const { text, params } = linkDependencyStatement(SCOPE, I.scelta, I.confronto, null);
  assert.deepEqual(params, [I.scelta, I.unit, I.workspace, I.confronto, I.workspace, null, I.unit, I.workspace]);
  assert.match(text, /src AS \(SELECT a\.id FROM activities a WHERE a\.id = \$1::uuid AND a\.department_id = \$2::uuid AND a\.workspace_id = \$3::uuid\)/);
  assert.match(text, /tgt AS \(SELECT a\.id FROM activities a WHERE a\.id = \$4::uuid AND a\.workspace_id = \$5::uuid\)/);
  assert.match(text, /FROM src, tgt WHERE src\.id <> tgt\.id\s+ON CONFLICT \(source_activity_id, target_activity_id\) DO NOTHING/);
  assert.match(text, /UPDATE mapping_boards b SET revision = b\.revision \+ 1, updated_at = now\(\)\s+WHERE b\.department_id = \$7::uuid AND b\.workspace_id = \$8::uuid AND EXISTS \(SELECT 1 FROM done\)/);
  assert.match(text, /SELECT EXISTS \(SELECT 1 FROM src, tgt WHERE src\.id <> tgt\.id\) AS linked$/);
  assert.doesNotMatch(text, /VALUES/, "nessun inserimento senza i genitori");
});

test("markDepartmentMapped: completeUnitMapping con l'unità, la scadenza della richiesta, la frase e al più sei punti; il messaggio di sempre", async () => {
  const store = fakeStore();
  const points = Array.from({ length: 8 }, (_, index) => ({ title: `Punto ${index + 1}`, text: "Il tempo va nei solleciti." }));
  const answer = await store.run("markDepartmentMapped", { summary: "Mappati sei passi.", headline: "Un terzo del tempo va nei solleciti.", analysisPoints: points });
  const [[, input]] = store.called("complete") as Array<[string, { scope: unknown; deadline: number; headline: unknown; analysis: unknown[] }]>;
  assert.deepEqual(input.scope, SCOPE);
  assert.ok(input.deadline > Date.now());
  assert.equal(input.headline, "Un terzo del tempo va nei solleciti.");
  assert.equal(input.analysis.length, MAPPING_LIMITS.analysisPoints);
  assert.deepEqual(answer, {
    success: true,
    message:
      "Dipartimento segnato come mappato. Mappati sei passi. Classificazione completata: 3 Automate, 1 Differentiate, 1 Innovate. 1 attività è rimasta da classificare. " +
      "Match O*NET completato su 4 attività. AI Exposure media: 34%.",
  });
  // Senza frase: niente frase; l'unità che non si completa (la 0039 mancante a metà): il modello lo sa.
  const blank = fakeStore({ outcome: null });
  assert.deepEqual(await blank.run("markDepartmentMapped", { summary: "x", headline: "  " }), { success: false, message: BOARD_NOT_READY_MESSAGE });
  assert.equal((blank.called("complete")[0][1] as { headline: unknown }).headline, null);
});

test("il messaggio del completamento: le frasi di sempre, esito per esito", () => {
  const base = { ...OUTCOME, matched: 0, avgExposurePct: null };
  assert.equal(completionMessage("Fatto.", { ...base, classification: "niente_da_fare", onet: "niente_da_fare" }), "Dipartimento segnato come mappato. Fatto.");
  assert.equal(
    completionMessage("", { ...base, classification: "non_riuscita", onet: "non_riuscito" }),
    "Dipartimento segnato come mappato. Classificazione non riuscita — verrà riprovata manualmente. Match O*NET non riuscito — verrà riprovato manualmente.",
  );
  assert.equal(
    completionMessage("", { ...base, classification: "fatta", remaining: 0, onet: "fatto" }),
    "Dipartimento segnato come mappato. Classificazione completata: 3 Automate, 1 Differentiate, 1 Innovate. Match O*NET completato su 0 attività. AI Exposure media: 0%.",
  );
});

test("senza le tabelle della 0039 ogni tool risponde la stessa frase e non scrive niente", async () => {
  const inputs: Record<string, Record<string, unknown>> = {
    saveActivity: { title: "Passo", description: "x", afterActivityId: I.confronto },
    updateActivity: { activityId: I.richieste, description: "y" },
    linkActivityDependency: { sourceActivityId: I.scelta, targetActivityId: I.confronto },
    markDepartmentMapped: { summary: "z" },
  };
  for (const [name, input] of Object.entries(inputs)) {
    const store = fakeStore({ ready: false });
    assert.deepEqual(await store.run(name as never, input), { success: false, message: BOARD_NOT_READY_MESSAGE }, name);
    assert.deepEqual(store.calls.map(([call]) => call), ["storeReady"], `${name}: niente letto, niente scritto`);
  }
  assert.equal(BOARD_NOT_READY_MESSAGE, "La board non è ancora disponibile: riprova tra qualche minuto.");
});

test("i tool della board sono quattro, e il modello non sceglie mai l'unità o il workspace", () => {
  const tools = getActivityMappingTools(SCOPE.workspaceId, SCOPE.departmentId, { deadline: 0, actor: ACTOR });
  assert.deepEqual(Object.keys(tools).sort(), ["linkActivityDependency", "markDepartmentMapped", "saveActivity", "updateActivity"]);
  for (const [name, definition] of Object.entries(tools)) {
    const shape = Object.keys((definition.inputSchema as unknown as { shape: Record<string, unknown> }).shape);
    for (const field of ["workspaceId", "departmentId", "unitId", "reasoning"]) assert.equal(shape.includes(field), false, `${name}: ${field}`);
  }
});
