import test from "node:test";
import assert from "node:assert/strict";
import { FIXTURE_IDS, fixtureBoard } from "../../../lib/mappatura/board-fixture.ts";
import { allSteps, locateStep, withUseCaseLinks, type MappingBoard } from "../../../lib/mappatura/board-model.ts";
import { applyOps, stepFieldValue, type BoardOp } from "../../../lib/mappatura/board-ops.ts";
import { BOARD_TEXT } from "../../../lib/mappatura/text.ts";
import { AUTOSAVE, MAPPING_LIMITS } from "../../../lib/mappatura/vocab.ts";
import { KEEPALIVE_MAX_BYTES, boardUrl, createBoardClient, draftKey, fitsInBody, type BoardClientState } from "./board-client.ts";

// La board nel browser (docs/mappatura/MAPPATURA-BOARD-PIANO.md §4.7; parità P70–P77, difetto F4): quando salva, che cosa
// manda, che cosa mostra la pillola, che cosa resta sul dispositivo. Orologio, fetch e memoria sono finti; il server
// finto applica le operazioni con lo stesso riduttore che `board-store.integration.test.ts` confronta con il database.

const I = FIXTURE_IDS;
const URL_BOARD = boardUrl(I.workspace, I.unit);
const KEY = draftKey(I.user, I.unit);
const T = BOARD_TEXT.toast;
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const titleOf = (board: MappingBoard, stepId: string) => locateStep(board, stepId)?.step.title ?? null;

type Put = { baseRevision: number; ops: BoardOp[]; keepalive: boolean };
type Mode = number | "rete" | "persa";

/** L'ora del test: il harness parte da qui, e una bozza scritta adesso porta questa ora. */
const T0 = Date.UTC(2026, 10, 16, 9, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

function harness(options: { initial?: MappingBoard; server?: MappingBoard; draft?: unknown; storage?: "nessuna" | "rotta"; userId?: string; stored?: Map<string, string> } = {}) {
  let time = T0;
  let ids = 0;
  let timerSeq = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  // La memoria del dispositivo: la sua, o quella di un altro harness (lo stesso browser).
  const stored = options.stored ?? new Map<string, string>();
  if (options.draft !== undefined) stored.set(KEY, typeof options.draft === "string" ? options.draft : JSON.stringify(options.draft));

  const initial = options.initial ?? fixtureBoard();
  const server = {
    board: options.server ?? initial,
    puts: [] as Put[],
    gets: [] as string[],
    /** Che cosa succede ai prossimi PUT: uno stato HTTP, «rete» (non arriva), «persa» (salvato, ma la risposta non torna). */
    next: [] as Mode[],
    /** Rifiuti decisi dal test, per tipo di operazione. */
    reject: new Map<BoardOp["t"], string>(),
    getStatus: 200,
    gate: null as null | { wait: Promise<void>; open(): void },
    /** Trattiene la risposta dei GET: il server ha già letto la board, la risposta arriva dopo. */
    getGate: null as null | { wait: Promise<void>; open(): void },
  };

  /** Il server: una operazione alla volta, R3 sui campi dei passi, la revisione sale di uno per salvataggio. */
  function serverSave(body: { ops: BoardOp[] }) {
    const rejected: Array<{ id: string; reason: string }> = [];
    for (const op of body.ops) {
      const forced = server.reject.get(op.t);
      if (forced) {
        rejected.push({ id: op.id, reason: forced });
        continue;
      }
      if (op.t === "step.set" || op.t === "step.remove") {
        const place = locateStep(server.board, op.stepId);
        if (!place) {
          rejected.push({ id: op.id, reason: "gone" });
          continue;
        }
        if (op.t === "step.set") {
          const current = stepFieldValue(place.step, op.field);
          if (!same(current, op.prev) && !same(current, op.next)) {
            rejected.push({ id: op.id, reason: "conflict" });
            continue;
          }
        }
      }
      server.board = applyOps(server.board, [op], { kind: "persona" });
    }
    server.board = { ...server.board, revision: server.board.revision + 1, savedAt: new Date(time).toISOString() };
    return { revision: server.board.revision, savedAt: server.board.savedAt, rejected, board: server.board };
  }

  const fetchFake = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if ((init?.method ?? "GET") === "GET") {
      server.gets.push(url);
      if (server.getStatus !== 200) return json({ code: "non_trovata" }, server.getStatus);
      const since = Number(new URL(url, "http://board.test").searchParams.get("since"));
      const answer = since === server.board.revision ? json({ unchanged: true, revision: since }) : json({ board: server.board });
      if (server.getGate) await server.getGate.wait;
      return answer;
    }
    assert.equal(url, URL_BOARD);
    assert.equal(init?.method, "PUT");
    const body = JSON.parse(String(init?.body)) as { baseRevision: number; ops: BoardOp[] };
    server.puts.push({ ...body, keepalive: init?.keepalive === true });
    const mode = server.next.shift() ?? 200;
    if (server.gate) await server.gate.wait;
    if (mode === "rete") throw new TypeError("fetch failed");
    if (typeof mode === "number" && mode !== 200) return json({ code: "x" }, mode);
    const answer = serverSave(body);
    if (mode === "persa") throw new TypeError("fetch failed");
    return json(answer);
  };

  const storage =
    options.storage === "nessuna"
      ? null
      : options.storage === "rotta"
        ? {
            getItem(): string | null {
              throw new Error("memoria spenta");
            },
            setItem() {
              throw new Error("memoria piena");
            },
            removeItem() {
              throw new Error("memoria spenta");
            },
          }
        : {
            getItem: (key: string) => stored.get(key) ?? null,
            setItem: (key: string, value: string) => void stored.set(key, value),
            removeItem: (key: string) => void stored.delete(key),
          };

  const client = createBoardClient({
    workspaceId: I.workspace,
    departmentId: I.unit,
    userId: options.userId ?? I.user,
    initial,
    fetch: fetchFake as typeof fetch,
    storage,
    now: () => time,
    setTimer(run, ms) {
      const handle = ++timerSeq;
      timers.set(handle, { at: time + ms, run });
      return handle;
    },
    clearTimer(handle) {
      timers.delete(handle as number);
    },
    newId: () => `0a0a0a0a-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
  });

  /** Fa passare il tempo: i timer scattano in ordine, e dopo ognuno le promesse in corso arrivano in fondo. */
  async function advance(ms: number) {
    const end = time + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) break;
      timers.delete(due[0]);
      time = Math.max(time, due[1].at);
      due[1].run();
      await flush();
    }
    time = end;
    await flush();
  }

  return {
    client,
    server,
    stored,
    advance,
    state: (): BoardClientState => client.getState(),
    draft: (): BoardOp[] | null => (stored.has(KEY) ? (JSON.parse(stored.get(KEY)!) as { ops: BoardOp[] }).ops : null),
    /** Trattiene le risposte dei PUT finché il test non le lascia andare. */
    hold() {
      let open = () => {};
      const wait = new Promise<void>((resolve) => {
        open = resolve;
      });
      server.gate = { wait, open };
    },
    async release() {
      const gate = server.gate;
      server.gate = null;
      gate?.open();
      await flush();
    },
    /** Trattiene le risposte dei GET finché il test non le lascia andare (`releaseGets`). */
    holdGets() {
      let open = () => {};
      const wait = new Promise<void>((resolve) => {
        open = resolve;
      });
      server.getGate = { wait, open };
    },
    async releaseGets() {
      const gate = server.getGate;
      server.getGate = null;
      gate?.open();
      await flush();
    },
    /** Qualcun altro salva: la board del server cambia e la revisione sale. */
    someoneElse(ops: BoardOp[]) {
      server.board = { ...applyOps(server.board, ops, { kind: "persona" }), revision: server.board.revision + 1 };
    },
  };
}

const setTitle = (stepId: string, prev: string, next: string) => ({ t: "step.set", stepId, field: "title", prev, next }) as const;
const TITLE = "Raccolta delle richieste";

test("all'apertura la board è quella letta dal server: «saved», niente da salvare, nessuna richiesta", async () => {
  const h = harness();
  const first = h.state();
  assert.equal(first.pill, "saved");
  assert.equal(first.pending, 0);
  assert.equal(first.toast, null);
  assert.equal(first.savedAt, fixtureBoard().savedAt);
  assert.deepEqual(first.board, fixtureBoard());
  // Finché niente cambia lo stato è lo stesso oggetto: useSyncExternalStore lo confronta così.
  assert.equal(h.state(), first);
  await h.advance(60_000);
  assert.equal(h.server.puts.length, 0);
  assert.equal(h.server.gets.length, 0);
});

test("una modifica si vede subito, segna «dirty» e avvisa chi ascolta; una modifica fuori dai limiti non entra (P71)", () => {
  const h = harness();
  let calls = 0;
  const stop = h.client.subscribe(() => {
    calls += 1;
  });
  const warn = console.warn;
  const warned: unknown[][] = [];
  console.warn = (...args: unknown[]) => void warned.push(args);
  try {
    h.client.dispatch(setTitle(I.richieste, TITLE, "  Raccolta   richieste  "));
    assert.equal(calls, 1);
    assert.equal(h.state().pill, "dirty");
    assert.equal(h.state().pending, 1);
    // Il testo è già rifinito come lo salverà il server.
    assert.equal(titleOf(h.state().board, I.richieste), "Raccolta richieste");

    const before = h.state();
    h.client.dispatch(setTitle(I.richieste, "x", "y".repeat(MAPPING_LIMITS.title + 1)));
    h.client.dispatch({ t: "step.set", stepId: "non-un-id", field: "title", prev: "a", next: "b" });
    assert.equal(h.state(), before, "niente cambia");
    assert.equal(calls, 1);
    // Il log porta solo il tipo dell'operazione, mai il testo.
    assert.equal(warned.length, 2);
    assert.ok(!JSON.stringify(warned).includes("yyy"));

    stop();
    h.client.dispatch(setTitle(I.confronto, "Confronto delle offerte", "Confronto"));
    assert.equal(calls, 1, "chi ha smesso di ascoltare non viene più chiamato");
  } finally {
    console.warn = warn;
  }
});

test("il salvataggio parte 5 secondi dopo l'ultima modifica, con le modifiche dello stesso campo unite (P72)", async () => {
  const h = harness();
  h.client.dispatch(setTitle(I.richieste, TITLE, "Raccolta"));
  await h.advance(AUTOSAVE.quietMs - 100);
  assert.equal(h.server.puts.length, 0);
  // Un'altra modifica fa ripartire i 5 secondi.
  h.client.dispatch(setTitle(I.richieste, "Raccolta", "Raccolta richieste"));
  await h.advance(AUTOSAVE.quietMs - 100);
  assert.equal(h.server.puts.length, 0);
  await h.advance(100);
  assert.equal(h.server.puts.length, 1);
  const put = h.server.puts[0];
  assert.equal(put.baseRevision, fixtureBoard().revision);
  assert.equal(put.keepalive, false);
  assert.equal(put.ops.length, 1);
  assert.deepEqual({ ...put.ops[0], id: "" }, { id: "", ...setTitle(I.richieste, TITLE, "Raccolta richieste") });

  const state = h.state();
  assert.equal(state.pill, "saved");
  assert.equal(state.pending, 0);
  assert.equal(state.toast, null);
  assert.equal(state.board.revision, fixtureBoard().revision + 1);
  assert.equal(state.savedAt, h.server.board.savedAt);
  assert.equal(titleOf(state.board, I.richieste), "Raccolta richieste");
  await h.advance(60_000);
  assert.equal(h.server.puts.length, 1, "niente da salvare, niente richieste");
});

test("due salvataggi automatici non stanno mai a meno di 15 secondi (P72)", async () => {
  const h = harness();
  h.client.dispatch(setTitle(I.richieste, TITLE, "Uno"));
  await h.advance(AUTOSAVE.quietMs);
  assert.equal(h.server.puts.length, 1);
  await h.advance(1_000);
  h.client.dispatch(setTitle(I.richieste, "Uno", "Due"));
  // 5 secondi dopo la modifica ne sono passati solo 6 dall'ultimo salvataggio.
  await h.advance(AUTOSAVE.quietMs);
  assert.equal(h.server.puts.length, 1);
  await h.advance(AUTOSAVE.minGapMs - 1_000 - AUTOSAVE.quietMs - 1);
  assert.equal(h.server.puts.length, 1);
  await h.advance(1);
  assert.equal(h.server.puts.length, 2);
  assert.equal(h.state().pill, "saved");
});

test("«Salva ora» salva subito, e intanto la pillola dice «saving» (P73)", async () => {
  const h = harness();
  h.client.dispatch(setTitle(I.richieste, TITLE, "Raccolta"));
  h.hold();
  const saved = h.client.saveNow();
  await flush();
  assert.equal(h.server.puts.length, 1);
  assert.equal(h.state().pill, "saving");
  assert.equal(titleOf(h.state().board, I.richieste), "Raccolta", "la modifica in viaggio resta a schermo");
  await h.release();
  await saved;
  assert.equal(h.state().pill, "saved");
  // Senza niente da salvare «Salva ora» non manda niente.
  await h.client.saveNow();
  assert.equal(h.server.puts.length, 1);
});

test("una modifica fatta durante un salvataggio resta da salvare (F4)", async () => {
  const h = harness();
  h.client.dispatch(setTitle(I.richieste, TITLE, "Uno"));
  h.hold();
  const saved = h.client.saveNow();
  await flush();
  h.client.dispatch(setTitle(I.confronto, "Confronto delle offerte", "Due"));
  // Stesso campo di quella in viaggio: non si unisce a lei, parte dal valore che la persona vede.
  h.client.dispatch(setTitle(I.richieste, "Uno", "Tre"));
  assert.equal(h.state().pill, "saving");
  await h.release();
  await saved;

  assert.equal(h.server.puts[0].ops.length, 1, "il salvataggio manda la coda com'era quando è partito");
  const state = h.state();
  assert.equal(state.pill, "dirty");
  assert.equal(state.pending, 2);
  assert.equal(titleOf(state.board, I.richieste), "Tre");
  assert.equal(titleOf(state.board, I.confronto), "Due");
  assert.equal(h.draft()?.length, 2, "la bozza tiene solo quello che resta da salvare");

  // Il resto parte da solo, quando sono passati 15 secondi dal salvataggio di prima.
  await h.advance(AUTOSAVE.minGapMs);
  assert.equal(h.server.puts.length, 2);
  assert.deepEqual(
    h.server.puts[1].ops.map((op) => (op.t === "step.set" ? [op.stepId, op.prev, op.next] : null)),
    [
      [I.confronto, "Confronto delle offerte", "Due"],
      [I.richieste, "Uno", "Tre"],
    ],
  );
  assert.equal(h.state().pill, "saved");
  assert.equal(h.draft(), null);
  assert.equal(titleOf(h.server.board, I.richieste), "Tre");
});

test("un campo cambiato da altri: il toast del conflitto, la board prende il valore più recente, il resto è salvato (P76)", async () => {
  const h = harness();
  h.someoneElse([{ id: "0b0b0b0b-0000-4000-8000-000000000001", ...setTitle(I.richieste, TITLE, "Richieste dagli uffici") }, { id: "0b0b0b0b-0000-4000-8000-000000000002", ...setTitle(I.ordine, "Emissione dell'ordine", "Ordine") }]);
  h.client.dispatch(setTitle(I.richieste, TITLE, "Raccolta"));
  h.client.dispatch({ t: "step.set", stepId: I.richieste, field: "hoursWeek", prev: 6.5, next: 8 });
  await h.client.saveNow();

  const state = h.state();
  assert.equal(state.toast?.text, T.conflict);
  assert.equal(state.toast?.undo, undefined);
  assert.equal(state.pill, "saved");
  assert.equal(state.pending, 0);
  assert.equal(titleOf(state.board, I.richieste), "Richieste dagli uffici", "il campo conteso prende il valore del server");
  assert.equal(locateStep(state.board, I.richieste)?.step.hoursWeek, 8, "l'altro campo è salvato");
  assert.equal(titleOf(state.board, I.ordine), "Ordine", "le modifiche degli altri agli altri campi arrivano senza toast loro");
  assert.equal(h.draft(), null);
  // Il toast se ne va da solo dopo 4,2 secondi.
  await h.advance(AUTOSAVE.toastMs - 1);
  assert.ok(h.state().toast);
  await h.advance(1);
  assert.equal(h.state().toast, null);
});

test("i rifiuti hanno il loro testo: collegato, limite per tipo, e un'eliminazione che non trova più il bersaglio tace", async () => {
  const cases: Array<{ reason: string; ops: Parameters<ReturnType<typeof harness>["client"]["dispatch"]>[0]; type: BoardOp["t"]; text: string | null }> = [
    { reason: "linked", type: "step.remove", ops: { t: "step.remove", stepId: I.controllo }, text: T.linked },
    { reason: "gone", type: "step.remove", ops: { t: "step.remove", stepId: I.controllo }, text: null },
    { reason: "gone", type: "note.remove", ops: { t: "note.remove", noteId: fixtureBoard().analysis[0].id }, text: null },
    { reason: "gone", type: "step.set", ops: setTitle(I.controllo, "x", "Controllo"), text: T.conflict },
    { reason: "forbidden", type: "step.stream", ops: { t: "step.stream", stepId: I.controllo, prev: null, next: "automate" }, text: T.conflict },
    { reason: "limit", type: "step.add", ops: { t: "step.add", stepId: "0c0c0c0c-0000-4000-8000-000000000001", processId: I.processA, title: "Nuovo" }, text: T.limitStepsInProcess },
    { reason: "limit", type: "step.move", ops: { t: "step.move", stepId: I.controllo, processId: I.processA, beforeId: null }, text: T.limitStepsInProcess },
    { reason: "limit", type: "process.add", ops: { t: "process.add", processId: "0c0c0c0c-0000-4000-8000-000000000002", name: "Resi" }, text: T.limitProcesses },
    { reason: "limit", type: "note.add", ops: { t: "note.add", noteId: "0c0c0c0c-0000-4000-8000-000000000003", stepId: I.controllo, lane: "idee", text: "Idea" }, text: T.limitNotes },
    { reason: "limit", type: "note.add", ops: { t: "note.add", noteId: "0c0c0c0c-0000-4000-8000-000000000004", stepId: null, lane: "analisi", text: "Punto" }, text: T.limitAnalysis },
  ];
  for (const item of cases) {
    const h = harness();
    h.server.reject.set(item.type, item.reason);
    h.client.dispatch(item.ops);
    await h.client.saveNow();
    assert.equal(h.state().toast?.text ?? null, item.text, `${item.type} ${item.reason}`);
    assert.equal(h.state().pill, "saved");
    assert.equal(h.state().pending, 0, "un'operazione rifiutata non resta in coda");
    assert.deepEqual(h.state().board, h.server.board, "a schermo c'è quello che ha il server");
  }

  // Più rifiuti insieme: un toast solo, il più preciso.
  const h = harness();
  h.server.reject.set("step.remove", "linked");
  h.server.reject.set("step.set", "conflict");
  h.server.reject.set("process.add", "limit");
  h.client.dispatch([setTitle(I.ordine, "Emissione dell'ordine", "Ordine"), { t: "process.add", processId: "0c0c0c0c-0000-4000-8000-000000000005", name: "Resi" }, { t: "step.remove", stepId: I.controllo }]);
  await h.client.saveNow();
  assert.equal(h.state().toast?.text, T.linked);
});

test("una board con 200 passi: il limite che il toast nomina è quello della board", async () => {
  const full = fixtureBoard();
  const filler = locateStep(full, I.controllo)!.step;
  const many = Array.from({ length: MAPPING_LIMITS.stepsPerUnit - allSteps(full).length }, (_, index) => ({ ...filler, id: `0d0d0d0d-0000-4000-8000-${String(index + 1).padStart(12, "0")}` }));
  const initial: MappingBoard = { ...full, processes: full.processes.map((process, index) => (index === 1 ? { ...process, steps: [...process.steps, ...many] } : process)) };
  const h = harness({ initial });
  h.server.reject.set("step.add", "limit");
  h.client.dispatch({ t: "step.add", stepId: "0c0c0c0c-0000-4000-8000-000000000001", processId: I.processA, title: "Nuovo" });
  await h.client.saveNow();
  assert.equal(h.state().toast?.text, T.limitStepsInBoard);
});

test("senza permesso (401, 403, 404): sola lettura con il suo toast, i controlli spenti, le modifiche restano sul dispositivo (P75)", async () => {
  for (const status of [401, 403, 404]) {
    const h = harness();
    h.server.next.push(status);
    h.client.dispatch(setTitle(I.richieste, TITLE, "Raccolta"));
    await h.advance(AUTOSAVE.quietMs);
    const state = h.state();
    assert.equal(state.pill, "readonly", String(status));
    assert.equal(state.toast?.text, T.readonly);
    assert.deepEqual(state.board.can, { edit: false, setStream: false, complete: false });
    assert.equal(titleOf(state.board, I.richieste), "Raccolta", "la modifica resta a schermo");
    assert.equal(state.pending, 1);
    assert.equal(h.draft()?.length, 1, "e nella bozza");
    // Non si riprova: né da soli, né con «Salva ora».
    await h.advance(120_000);
    await h.client.saveNow();
    assert.equal(h.server.puts.length, 1);
    assert.equal(titleOf(h.server.board, I.richieste), TITLE);
  }
});

test("503 (le tabelle mancano ancora): sola lettura senza toast; quando una lettura dice che si può scrivere, le modifiche tenute si salvano", async () => {
  const h = harness();
  h.server.next.push(503);
  h.client.dispatch(setTitle(I.richieste, TITLE, "Raccolta"));
  await h.advance(AUTOSAVE.quietMs);
  assert.equal(h.state().pill, "readonly");
  assert.equal(h.state().toast, null);
  assert.equal(h.draft()?.length, 1);
  await h.advance(60_000);
  assert.equal(h.server.puts.length, 1);

  // Qualcun altro salva, poi la pagina torna visibile e rilegge.
  h.someoneElse([{ id: "0b0b0b0b-0000-4000-8000-000000000001", ...setTitle(I.ordine, "Emissione dell'ordine", "Ordine") }]);
  await h.client.pull();
  assert.equal(h.state().pill, "dirty");
  assert.equal(h.state().board.can.edit, true);
  await h.advance(AUTOSAVE.minGapMs);
  assert.equal(h.server.puts.length, 2);
  assert.equal(h.state().pill, "saved");
  assert.equal(titleOf(h.server.board, I.richieste), "Raccolta");
});

test("una board che non si può modificare apre in sola lettura, e la bozza resta dov'è", async () => {
  for (const initial of [fixtureBoard({ readOnly: true }), { ...fixtureBoard(), store: "mancante" as const }]) {
    const draft = { v: 1, at: T0, ops: [{ id: "0b0b0b0b-0000-4000-8000-000000000001", ...setTitle(I.richieste, TITLE, "Raccolta") }] };
    const h = harness({ initial, draft });
    h.client.start();
    assert.equal(h.state().pill, "readonly");
    assert.equal(h.state().pending, 0);
    assert.deepEqual(h.state().board.can, { edit: false, setStream: false, complete: false });
    assert.equal(titleOf(h.state().board, I.richieste), TITLE);
    assert.equal(h.draft()?.length, 1);
    await h.advance(60_000);
    assert.equal(h.server.puts.length, 0);
  }
});

test("un errore di rete o del server: il toast, «Salva ora» resta, nessun nuovo tentativo da soli (P77)", async () => {
  for (const mode of ["rete", 500, 502] as const) {
    const h = harness();
    h.server.next.push(mode);
    h.client.dispatch(setTitle(I.richieste, TITLE, "Raccolta"));
    await h.advance(AUTOSAVE.quietMs);
    const state = h.state();
    assert.equal(state.pill, "dirty", String(mode));
    assert.equal(state.toast?.text, T.failure);
    assert.equal(state.pending, 1);
    assert.equal(state.board.can.edit, true);
    assert.equal(h.draft()?.length, 1);
    await h.advance(120_000);
    assert.equal(h.server.puts.length, 1, "nessun tentativo da soli");
    // «Salva ora» riprova, con le stesse operazioni.
    await h.client.saveNow();
    assert.equal(h.server.puts.length, 2);
    assert.deepEqual(h.server.puts[1].ops, h.server.puts[0].ops);
    assert.equal(h.state().pill, "saved");
    assert.equal(h.draft(), null);
  }
});

test("dopo un errore, la prossima modifica fa ripartire il salvataggio automatico, in ordine", async () => {
  const h = harness();
  h.server.next.push("rete");
  h.client.dispatch(setTitle(I.richieste, TITLE, "Uno"));
  await h.advance(AUTOSAVE.quietMs);
  assert.equal(h.server.puts.length, 1);
  h.client.dispatch(setTitle(I.confronto, "Confronto delle offerte", "Due"));
  await h.advance(AUTOSAVE.minGapMs);
  assert.equal(h.server.puts.length, 2);
  assert.deepEqual(
    h.server.puts[1].ops.map((op) => (op.t === "step.set" ? op.next : null)),
    ["Uno", "Due"],
  );
  assert.equal(h.state().pill, "saved");
});

test("senza rete la pillola dice «local»; al ritorno in linea si riprova una volta (P77)", async () => {
  const h = harness();
  h.client.setOnline(false);
  assert.equal(h.state().pill, "saved", "senza modifiche non c'è niente da dire");
  h.client.dispatch(setTitle(I.richieste, TITLE, "Raccolta"));
  assert.equal(h.state().pill, "local");
  h.server.next.push("rete", "rete");
  await h.advance(AUTOSAVE.quietMs);
  assert.equal(h.server.puts.length, 1);
  assert.equal(h.state().pill, "local");
  assert.equal(h.state().toast?.text, T.failure);

  // Torna la rete: un tentativo. Se non riesce, non si insiste.
  h.client.setOnline(true);
  await flush();
  assert.equal(h.server.puts.length, 2);
  assert.equal(h.state().pill, "dirty");
  h.client.setOnline(true);
  await h.advance(120_000);
  assert.equal(h.server.puts.length, 2);

  // Di nuovo senza rete e poi in linea: un altro tentativo, che riesce.
  h.client.setOnline(false);
  h.client.setOnline(true);
  await flush();
  assert.equal(h.server.puts.length, 3);
  assert.equal(h.state().pill, "saved");
  assert.equal(titleOf(h.server.board, I.richieste), "Raccolta");

  // In linea senza errori alle spalle non parte niente.
  h.client.dispatch(setTitle(I.richieste, "Raccolta", "Richieste"));
  h.client.setOnline(false);
  h.client.setOnline(true);
  await flush();
  assert.equal(h.server.puts.length, 3);
});

test("la bozza: scritta a ogni modifica, tolta quando è salvata (P74)", async () => {
  const h = harness();
  assert.equal(h.draft(), null);
  h.client.dispatch(setTitle(I.richieste, TITLE, "Raccolta"));
  assert.deepEqual(JSON.parse(h.stored.get(KEY)!), { v: 1, at: T0, ops: [{ id: "0a0a0a0a-0000-4000-8000-000000000001", ...setTitle(I.richieste, TITLE, "Raccolta") }] });
  h.client.dispatch({ t: "process.vote", processId: I.processA, mine: 2 });
  assert.equal(h.draft()?.length, 2);
  await h.client.saveNow();
  assert.equal(h.stored.has(KEY), false);
});

test("la bozza torna sopra una board più recente: «dirty», e il salvataggio parte da solo (P74)", async () => {
  const stale = fixtureBoard();
  const draft = {
    v: 1,
    at: T0 - 6 * DAY,
    ops: [
      { id: "0b0b0b0b-0000-4000-8000-000000000001", ...setTitle(I.richieste, TITLE, "Raccolta") },
      { id: "0b0b0b0b-0000-4000-8000-000000000002", t: "step.add", stepId: "0c0c0c0c-0000-4000-8000-000000000001", processId: I.processB, title: "Archivio" },
      // Una voce che non è un'operazione si scarta, il resto torna.
      { id: "0b0b0b0b-0000-4000-8000-000000000003", t: "step.explode", stepId: I.ordine },
      "non un'operazione",
    ],
  };
  // Nel frattempo qualcuno ha salvato: la pagina apre con la sua board.
  const newer: MappingBoard = { ...applyOps(stale, [{ id: "0b0b0b0b-0000-4000-8000-000000000009", ...setTitle(I.ordine, "Emissione dell'ordine", "Ordine") }], { kind: "persona" }), revision: stale.revision + 3 };
  const h = harness({ initial: newer, draft });

  // Prima di `start` la board è quella del server: il primo disegno nel browser è uguale a quello del server.
  assert.equal(h.state().pill, "saved");
  assert.equal(titleOf(h.state().board, I.richieste), TITLE);
  h.client.start();
  const state = h.state();
  assert.equal(state.pill, "dirty");
  assert.equal(state.pending, 2);
  assert.equal(titleOf(state.board, I.richieste), "Raccolta");
  assert.equal(titleOf(state.board, I.ordine), "Ordine");
  assert.ok(locateStep(state.board, "0c0c0c0c-0000-4000-8000-000000000001"));
  // `start` due volte non raddoppia.
  h.client.start();
  assert.equal(h.state().pending, 2);

  await h.advance(AUTOSAVE.quietMs);
  assert.equal(h.server.puts.length, 1);
  assert.equal(h.server.puts[0].baseRevision, stale.revision + 3);
  assert.deepEqual(
    h.server.puts[0].ops.map((op) => op.id),
    ["0b0b0b0b-0000-4000-8000-000000000001", "0b0b0b0b-0000-4000-8000-000000000002"],
  );
  assert.equal(h.state().pill, "saved");
  assert.equal(h.draft(), null);
});

test("una bozza già salvata (la pagina si è chiusa prima della risposta) non riapre «dirty»: si toglie e basta", async () => {
  const op = { id: "0b0b0b0b-0000-4000-8000-000000000001", ...setTitle(I.richieste, TITLE, "Raccolta") };
  const saved: MappingBoard = { ...applyOps(fixtureBoard(), [op], { kind: "persona" }), revision: fixtureBoard().revision + 1 };
  const h = harness({ initial: saved, draft: { v: 1, at: T0, ops: [op, { id: "0b0b0b0b-0000-4000-8000-000000000002", t: "step.remove", stepId: "0c0c0c0c-0000-4000-8000-000000000077" }] } });
  h.client.start();
  assert.equal(h.state().pill, "saved");
  assert.equal(h.state().pending, 0);
  assert.equal(h.stored.has(KEY), false);
  await h.advance(60_000);
  assert.equal(h.server.puts.length, 0);
});

test("la bozza è di chi l'ha scritta: su un browser condiviso chi apre la board dopo non salva a suo nome le modifiche (né i voti) di un altro", async () => {
  const OTHER = "f1f1f1f1-0000-4000-8000-000000000002";
  const stored = new Map<string, string>();
  // A vota senza rete: il voto resta nella sua bozza.
  const a = harness({ stored });
  a.client.setOnline(false);
  a.client.dispatch({ t: "process.vote", processId: I.processA, mine: 3 });
  a.server.next.push("rete");
  await a.client.saveNow();
  assert.ok(stored.has(draftKey(I.user, I.unit)));
  assert.equal(draftKey(I.user, I.unit), `unbundle-mapping-draft:${I.user}:${I.unit}`);
  // B entra nello stesso browser e apre la stessa board: la bozza di A non è sua, non torna e non parte.
  const b = harness({ stored, userId: OTHER });
  b.client.start();
  assert.equal(b.state().pill, "saved");
  assert.equal(b.state().pending, 0);
  await b.advance(60_000);
  assert.equal(b.server.puts.length, 0);
  assert.ok(stored.has(draftKey(I.user, I.unit)), "la bozza di A resta ad A");
  assert.equal(stored.has(draftKey(OTHER, I.unit)), false);
});

test("uscire dall'app: quello che resta in coda parte subito, poi la board smette e la sua bozza si toglie", async () => {
  const h = harness();
  h.client.dispatch(setTitle(I.richieste, TITLE, "Raccolta"));
  assert.ok(h.stored.has(KEY));
  h.hold();
  const leaving = h.client.signOut();
  await flush();
  assert.equal(h.server.puts.length, 1, "la richiesta è partita prima dell'uscita");
  assert.equal(h.server.puts[0].keepalive, true);
  assert.equal(h.stored.has(KEY), false, "la bozza non resta sul dispositivo");
  // La risposta arriva, o no: la board non scrive più la bozza e non salva più.
  h.server.next.push(500);
  await h.release();
  await leaving;
  assert.equal(h.stored.has(KEY), false);
  h.client.dispatch(setTitle(I.richieste, "Raccolta", "Raccolta delle richieste d'acquisto"));
  await h.advance(60_000);
  assert.equal(h.server.puts.length, 1);
  assert.equal(h.stored.has(KEY), false);
  // Senza niente in coda non parte niente.
  const idle = harness();
  await idle.client.signOut();
  assert.equal(idle.server.puts.length, 0);
});

test("una bozza di più di 7 giorni, o senza ora, non torna: si toglie, e la board apre com'è sul server", async () => {
  const ops = [{ id: "0b0b0b0b-0000-4000-8000-000000000001", ...setTitle(I.richieste, TITLE, "Raccolta") }];
  for (const draft of [{ v: 1, at: T0 - 7 * DAY - 1, ops }, { v: 1, ops }, { v: 1, at: "ieri", ops }]) {
    const h = harness({ draft });
    h.client.start();
    assert.equal(h.state().pill, "saved");
    assert.equal(h.state().pending, 0);
    assert.equal(titleOf(h.state().board, I.richieste), TITLE);
    assert.equal(h.stored.has(KEY), false, "la bozza vecchia si toglie");
    await h.advance(60_000);
    assert.equal(h.server.puts.length, 0);
  }
  // Una di 7 giorni esatti torna ancora.
  const recent = harness({ draft: { v: 1, at: T0 - 7 * DAY, ops } });
  recent.client.start();
  assert.equal(recent.state().pill, "dirty");
  assert.equal(titleOf(recent.state().board, I.richieste), "Raccolta");
});

test("una bozza illeggibile, di un'altra versione o senza memoria: la board apre lo stesso", async () => {
  for (const draft of ["{non json", { v: 2, at: T0, ops: [{ id: "0b0b0b0b-0000-4000-8000-000000000001", ...setTitle(I.richieste, TITLE, "Raccolta") }] }, { v: 1, at: T0, ops: "no" }, "null"]) {
    const h = harness({ draft });
    h.client.start();
    assert.equal(h.state().pill, "saved");
    assert.equal(h.state().pending, 0);
  }
  for (const storage of ["nessuna", "rotta"] as const) {
    const h = harness({ storage });
    h.client.start();
    h.client.dispatch(setTitle(I.richieste, TITLE, "Raccolta"));
    assert.equal(h.state().pill, "dirty");
    await h.client.saveNow();
    assert.equal(h.state().pill, "saved");
    assert.equal(titleOf(h.server.board, I.richieste), "Raccolta");
  }
});

test("un'eliminazione si vede subito e aspetta 6 secondi il suo toast; intanto il resto si salva", async () => {
  const h = harness();
  h.client.dispatch({ t: "step.remove", stepId: I.controllo }, { undo: T.stepRemoved });
  h.client.dispatch(setTitle(I.richieste, TITLE, "Raccolta"));
  let state = h.state();
  assert.equal(locateStep(state.board, I.controllo), null, "il passo sparisce subito");
  assert.equal(state.pill, "dirty");
  assert.equal(state.toast?.text, T.stepRemoved);
  assert.equal(state.toast?.undo, true);
  assert.equal(state.toast?.action?.label, BOARD_TEXT.buttons.undo);
  assert.equal(h.draft()?.length, 2, "anche l'eliminazione è nella bozza");

  await h.advance(AUTOSAVE.quietMs);
  assert.equal(h.server.puts.length, 1);
  assert.deepEqual(
    h.server.puts[0].ops.map((op) => op.t),
    ["step.set"],
  );
  state = h.state();
  assert.equal(state.pill, "dirty", "l'eliminazione resta da salvare");
  assert.equal(locateStep(state.board, I.controllo), null);
  assert.ok(locateStep(h.server.board, I.controllo));
  assert.ok(state.toast, "il toast resta i suoi 6 secondi");

  await h.advance(AUTOSAVE.undoMs - AUTOSAVE.quietMs);
  assert.equal(h.state().toast, null);
  // Parte quando sono passati 15 secondi dal salvataggio di prima.
  await h.advance(AUTOSAVE.minGapMs - AUTOSAVE.undoMs + AUTOSAVE.quietMs);
  assert.equal(h.server.puts.length, 2);
  assert.deepEqual(
    h.server.puts[1].ops.map((op) => op.t),
    ["step.remove"],
  );
  assert.equal(locateStep(h.server.board, I.controllo), null);
  assert.equal(h.state().pill, "saved");
});

test("da sola, un'eliminazione parte allo scadere dei 6 secondi, non prima", async () => {
  const h = harness();
  const noteId = fixtureBoard().analysis[0].id;
  h.client.dispatch({ t: "note.remove", noteId }, { undo: T.noteRemoved });
  await h.advance(AUTOSAVE.undoMs - 1);
  assert.equal(h.server.puts.length, 0);
  await h.advance(1);
  assert.equal(h.server.puts.length, 1);
  assert.equal(h.state().pill, "saved");
  assert.equal(h.state().toast, null);
  assert.ok(!h.server.board.analysis.some((note) => note.id === noteId));
});

test("«Annulla» toglie l'eliminazione dalla coda: il passo torna e niente parte", async () => {
  const h = harness();
  h.client.dispatch({ t: "step.remove", stepId: I.controllo }, { undo: T.stepRemoved });
  await h.advance(2_000);
  h.state().toast!.action!.run();
  const state = h.state();
  assert.ok(locateStep(state.board, I.controllo));
  assert.equal(state.pill, "saved");
  assert.equal(state.pending, 0);
  assert.equal(state.toast, null);
  assert.equal(h.stored.has(KEY), false);
  await h.advance(60_000);
  assert.equal(h.server.puts.length, 0);
  assert.deepEqual(h.state().board, fixtureBoard());
});

test("«Salva ora» manda anche l'eliminazione che aspetta, e il suo toast se ne va: non c'è più niente da annullare", async () => {
  const h = harness();
  h.client.dispatch({ t: "step.remove", stepId: I.controllo }, { undo: T.stepRemoved });
  const undo = h.state().toast!.action!;
  await h.client.saveNow({ keepalive: true });
  assert.equal(h.server.puts.length, 1);
  assert.equal(h.server.puts[0].keepalive, true, "mentre la pagina si chiude la richiesta è keepalive");
  assert.equal(h.server.puts[0].ops[0].t, "step.remove");
  assert.equal(h.state().toast, null);
  assert.equal(h.state().pill, "saved");
  // Un «Annulla» premuto tardi non rimette niente e non rompe niente.
  undo.run();
  assert.equal(locateStep(h.state().board, I.controllo), null);
  assert.equal(h.state().pending, 0);
});

test("un toast alla volta: il nuovo prende il posto di quello a schermo, e «notify» dura 4,2 secondi (6 con un'azione)", async () => {
  const h = harness();
  h.client.notify(T.copied);
  const first = h.state().toast!;
  assert.equal(first.text, T.copied);
  assert.equal(first.undo, undefined);
  await h.advance(4_000);
  h.client.dispatch({ t: "note.remove", noteId: fixtureBoard().analysis[0].id }, { undo: T.noteRemoved });
  const second = h.state().toast!;
  assert.equal(second.text, T.noteRemoved);
  assert.notEqual(second.key, first.key);
  // Il timer del primo toast non spegne il secondo.
  await h.advance(1_000);
  assert.equal(h.state().toast?.key, second.key);

  let ran = 0;
  h.client.notify(T.copied, { label: BOARD_TEXT.buttons.retry, run: () => void (ran += 1) });
  assert.equal(h.state().toast?.action?.label, BOARD_TEXT.buttons.retry);
  await h.advance(AUTOSAVE.undoMs - 1);
  assert.ok(h.state().toast);
  await h.advance(1);
  assert.equal(h.state().toast, null);
  assert.equal(ran, 0);
});

test("pull rilegge la board e tiene sopra le modifiche non salvate; se niente è cambiato, lo stato resta lo stesso", async () => {
  const h = harness();
  h.client.dispatch(setTitle(I.richieste, TITLE, "Raccolta"));
  const before = h.state();
  await h.client.pull();
  assert.deepEqual(h.server.gets, [`${URL_BOARD}?since=${fixtureBoard().revision}`]);
  assert.equal(h.state(), before, "«unchanged»: nessun nuovo stato");

  // L'assistente salva un passo e cambia un titolo.
  h.someoneElse([
    { id: "0b0b0b0b-0000-4000-8000-000000000001", t: "step.add", stepId: "0c0c0c0c-0000-4000-8000-000000000001", processId: I.processB, title: "Archivio" },
    { id: "0b0b0b0b-0000-4000-8000-000000000002", ...setTitle(I.ordine, "Emissione dell'ordine", "Ordine") },
  ]);
  await h.client.pull();
  const state = h.state();
  assert.equal(state.board.revision, fixtureBoard().revision + 1);
  assert.ok(locateStep(state.board, "0c0c0c0c-0000-4000-8000-000000000001"));
  assert.equal(titleOf(state.board, I.ordine), "Ordine");
  assert.equal(titleOf(state.board, I.richieste), "Raccolta", "la modifica non salvata resta sopra");
  assert.equal(state.pill, "dirty");
  assert.equal(state.pending, 1);
  assert.equal(h.server.puts.length, 0, "pull non salva");

  // Una lettura che non riesce lascia tutto com'è.
  h.server.getStatus = 404;
  const kept = h.state();
  await h.client.pull();
  assert.equal(h.state(), kept);
});

test("una rilettura lenta che risponde dopo un salvataggio non riporta indietro la board", async () => {
  const h = harness();
  const start = h.state().board.revision;
  // Qualcun altro salva: la rilettura che parte ora porta la sua board (una revisione in più), ma la risposta è lenta.
  h.someoneElse([{ id: "0b0b0b0b-0000-4000-8000-000000000001", ...setTitle(I.confronto, "Confronto delle offerte", "Confronto dei preventivi") }]);
  h.holdGets();
  const pulling = h.client.pull();
  await flush();
  assert.equal(h.server.gets.length, 1);
  // Intanto la persona modifica e salva: la risposta del salvataggio porta la board più recente (due revisioni in più).
  h.client.dispatch(setTitle(I.richieste, TITLE, "Raccolta delle richieste d'acquisto"));
  await h.client.saveNow();
  assert.equal(h.state().board.revision, start + 2);
  // La rilettura arriva adesso, con la board di prima del salvataggio: non prende il suo posto.
  await h.releaseGets();
  await pulling;
  assert.equal(h.state().board.revision, start + 2);
  assert.equal(titleOf(h.state().board, I.richieste), "Raccolta delle richieste d'acquisto");
  assert.equal(titleOf(h.state().board, I.confronto), "Confronto dei preventivi");
  assert.equal(h.state().pill, "saved");
});

test("pull durante un salvataggio non parte: la risposta del salvataggio porta già la board più recente", async () => {
  const h = harness();
  h.client.dispatch(setTitle(I.richieste, TITLE, "Raccolta"));
  h.hold();
  const saved = h.client.saveNow();
  await flush();
  h.someoneElse([{ id: "0b0b0b0b-0000-4000-8000-000000000001", ...setTitle(I.ordine, "Emissione dell'ordine", "Ordine") }]);
  await h.client.pull();
  assert.equal(h.server.gets.length, 0);
  await h.release();
  await saved;
  assert.equal(titleOf(h.state().board, I.ordine), "Ordine");
  assert.equal(h.server.gets.length, 0);

  // Se invece il salvataggio non riesce, la lettura chiesta parte dopo.
  h.client.dispatch(setTitle(I.richieste, "Raccolta", "Richieste"));
  h.server.next.push("rete");
  h.hold();
  const failed = h.client.saveNow();
  await flush();
  h.someoneElse([{ id: "0b0b0b0b-0000-4000-8000-000000000002", ...setTitle(I.ordine, "Ordine", "Ordine al fornitore") }]);
  await h.client.pull();
  await h.release();
  await failed;
  await flush();
  assert.equal(h.server.gets.length, 1);
  assert.equal(titleOf(h.state().board, I.ordine), "Ordine al fornitore");
  assert.equal(titleOf(h.state().board, I.richieste), "Richieste");
  assert.equal(h.state().pill, "dirty");
});

test("una richiesta ripetuta dopo una risposta persa non cambia niente: stesso id, un passo solo", async () => {
  const h = harness();
  const stepId = h.client.newId();
  h.client.dispatch([
    { t: "step.add", stepId, processId: I.processB, title: "Archivio" },
    { t: "step.set", stepId, field: "who", prev: [], next: ["Buyer"] },
    { t: "process.vote", processId: I.processB, mine: 2 },
  ]);
  h.server.next.push("persa");
  await h.client.saveNow();
  assert.equal(h.state().toast?.text, T.failure);
  assert.equal(h.state().pill, "dirty");
  assert.ok(locateStep(h.server.board, stepId), "il server ha salvato, ma il browser non lo sa");

  await h.client.saveNow();
  assert.deepEqual(h.server.puts[1].ops, h.server.puts[0].ops, "le stesse operazioni, con gli stessi id");
  const steps = allSteps(h.server.board).filter((step) => step.title === "Archivio");
  assert.equal(steps.length, 1);
  assert.deepEqual(steps[0].who, ["Buyer"]);
  assert.equal(h.server.board.processes[1].myVotes, 2);
  assert.equal(h.state().pill, "saved");
  assert.equal(h.state().toast?.text ?? null, T.failure, "nessun toast di conflitto: resta quello di prima finché scade");
  assert.deepEqual(h.state().board, h.server.board);
});

test("replace prende una board già letta, tiene gli use case collegati e le modifiche non salvate, e non torna indietro", async () => {
  const links = { links: [{ id: "0e0e0e0e-0000-4000-8000-000000000001", code: "UC-0001", title: "Solleciti automatici", href: "/dashboard/x/use-cases/y", stream: null }], byStep: new Map([[I.solleciti, ["0e0e0e0e-0000-4000-8000-000000000001"]]]) };
  const initial = withUseCaseLinks(fixtureBoard(), links);
  const h = harness({ initial });
  h.client.dispatch(setTitle(I.richieste, TITLE, "Raccolta"));

  // La risposta di «Completa la mappatura»: una board classificata, senza i collegamenti (li legge solo la pagina).
  const completed: MappingBoard = { ...fixtureBoard({ classified: true }), revision: initial.revision + 2 };
  h.client.replace(completed);
  let state = h.state();
  assert.equal(state.board.revision, initial.revision + 2);
  assert.equal(locateStep(state.board, I.richieste)?.step.stream, "automate");
  assert.equal(state.board.useCases.length, 1, "i collegamenti restano");
  assert.deepEqual(locateStep(state.board, I.solleciti)?.step.useCaseIds, ["0e0e0e0e-0000-4000-8000-000000000001"]);
  assert.equal(titleOf(state.board, I.richieste), "Raccolta");
  assert.equal(state.pill, "dirty");

  // Una board più vecchia di quella a schermo si ignora.
  const kept = h.state();
  h.client.replace({ ...fixtureBoard(), revision: initial.revision + 1 });
  assert.equal(h.state(), kept);

  // Una board che arriva dalla pagina porta i suoi collegamenti: valgono quelli.
  h.client.replace({ ...completed, revision: initial.revision + 3 }, { linked: true });
  state = h.state();
  assert.equal(state.board.useCases.length, 0);
  assert.deepEqual(locateStep(state.board, I.solleciti)?.step.useCaseIds, []);
});

test("un salvataggio tiene gli use case collegati: la risposta del server non li porta", async () => {
  const links = { links: [{ id: "0e0e0e0e-0000-4000-8000-000000000001", code: "UC-0001", title: "Solleciti automatici", href: "/dashboard/x/use-cases/y", stream: null }], byStep: new Map([[I.solleciti, ["0e0e0e0e-0000-4000-8000-000000000001"]]]) };
  const h = harness({ initial: withUseCaseLinks(fixtureBoard(), links), server: fixtureBoard() });
  // Un passo collegato non si elimina nemmeno a schermo.
  h.client.dispatch({ t: "step.remove", stepId: I.solleciti }, { undo: T.stepRemoved });
  assert.ok(locateStep(h.state().board, I.solleciti));
  h.client.dispatch(setTitle(I.richieste, TITLE, "Raccolta"));
  h.server.reject.set("step.remove", "linked");
  await h.client.saveNow();
  assert.equal(h.state().toast?.text, T.linked);
  assert.equal(h.state().board.useCases.length, 1);
  assert.deepEqual(locateStep(h.state().board, I.solleciti)?.step.useCaseIds, ["0e0e0e0e-0000-4000-8000-000000000001"]);
});

test("più di 200 modifiche in coda partono a gruppi di 200: «Salva ora» le manda tutte", async () => {
  const h = harness();
  const ops = Array.from({ length: MAPPING_LIMITS.opsPerSave + 5 }, (_, index) => ({ t: "note.add", noteId: `0c0c0c0c-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, stepId: allSteps(fixtureBoard())[index % 6].id, lane: (["idee", "tempi", "dati", "attivita"] as const)[index % 4], text: `Nota ${index + 1}` }) as const);
  h.client.dispatch(ops);
  assert.equal(h.state().pending, MAPPING_LIMITS.opsPerSave + 5);
  await h.client.saveNow();
  assert.deepEqual(
    h.server.puts.map((put) => put.ops.length),
    [MAPPING_LIMITS.opsPerSave, 5],
  );
  assert.equal(h.state().pill, "saved");
  assert.deepEqual(h.state().board, h.server.board);
});

test("la pagina che si chiude: ogni salvataggio keepalive sta sotto i 64 KB; il resto parte dopo, e intanto resta nella bozza", async () => {
  const h = harness();
  // Quaranta note quasi piene (circa 80 KB in tutto, con le lettere accentate che contano due byte).
  const text = "È una nota lunga, scritta più volte. ".repeat(53).slice(0, MAPPING_LIMITS.note);
  const lanes = ["attivita", "attriti", "dati", "tempi"] as const;
  h.client.dispatch(Array.from({ length: 40 }, (_, index) => ({ t: "note.add" as const, noteId: `0d0d0d0d-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, stepId: I.richieste, lane: lanes[index % 4], text })));
  const body = (put: { baseRevision: number; ops: BoardOp[] }) => new TextEncoder().encode(JSON.stringify({ baseRevision: put.baseRevision, ops: put.ops })).length;
  h.hold();
  const closing = h.client.saveNow({ keepalive: true });
  await flush();
  assert.equal(h.server.puts.length, 1);
  assert.equal(h.server.puts[0].keepalive, true);
  assert.ok(body(h.server.puts[0]) <= KEEPALIVE_MAX_BYTES, `${body(h.server.puts[0])} byte`);
  const first = h.server.puts[0].ops.length;
  assert.ok(first > 0 && first < 40);
  // Finché il primo non torna, il resto aspetta nella bozza (la pagina potrebbe non esserci più).
  assert.equal(h.draft()?.length, 40);
  await h.release();
  await closing;
  // La pagina era ancora lì: il resto è partito dopo, sempre sotto il limite, e la bozza non c'è più.
  assert.ok(h.server.puts.length >= 2);
  for (const put of h.server.puts) assert.ok(put.keepalive && body(put) <= KEEPALIVE_MAX_BYTES, `${body(put)} byte`);
  assert.equal(h.server.puts.reduce((sum, put) => sum + put.ops.length, 0), 40);
  assert.equal(h.state().pill, "saved");
  assert.equal(h.draft(), null);
  // Un salvataggio normale non ha questo limite: tutto in una richiesta.
  const normal = harness();
  normal.client.dispatch(Array.from({ length: 40 }, (_, index) => ({ t: "note.add" as const, noteId: `0d0d0d0d-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, stepId: I.richieste, lane: lanes[index % 4], text })));
  await normal.client.saveNow();
  assert.deepEqual(normal.server.puts.map((put) => [put.keepalive, put.ops.length]), [[false, 40]]);
  // Il conto dei byte: l'involucro, le virgole; un'operazione da sola passa anche se supera il limite.
  assert.deepEqual(fitsInBody([{ a: "x" }, { a: "y" }], 3, bodySize([{ a: "x" }, { a: "y" }], 3)), [{ a: "x" }, { a: "y" }]);
  assert.deepEqual(fitsInBody([{ a: "x" }, { a: "y" }], 3, bodySize([{ a: "x" }, { a: "y" }], 3) - 1), [{ a: "x" }]);
  assert.deepEqual(fitsInBody([{ a: "x" }], 3, 1), [{ a: "x" }]);
});

const bodySize = (ops: unknown[], baseRevision: number) => new TextEncoder().encode(JSON.stringify({ baseRevision, ops })).length;

test("due «Salva ora» insieme: un salvataggio alla volta, niente mandato due volte", async () => {
  const h = harness();
  h.client.dispatch(setTitle(I.richieste, TITLE, "Uno"));
  h.hold();
  const first = h.client.saveNow();
  await flush();
  h.client.dispatch(setTitle(I.confronto, "Confronto delle offerte", "Due"));
  const second = h.client.saveNow();
  await flush();
  assert.equal(h.server.puts.length, 1, "il secondo aspetta il primo");
  await h.release();
  await Promise.all([first, second]);
  assert.deepEqual(
    h.server.puts.map((put) => put.ops.map((op) => (op.t === "step.set" ? op.next : null))),
    [["Uno"], ["Due"]],
  );
  assert.equal(h.state().pill, "saved");
});

test("una risposta che non è una board vale come un salvataggio non riuscito: niente si perde", async () => {
  const h = harness();
  const real = h.server.board;
  h.client.dispatch(setTitle(I.richieste, TITLE, "Raccolta"));
  // Un proxy risponde 200 con una pagina sua.
  const broken = createBoardClient({
    workspaceId: I.workspace,
    departmentId: I.unit,
    userId: I.user,
    initial: fixtureBoard(),
    fetch: (async () => json({ ok: true })) as typeof fetch,
    storage: null,
    now: () => 0,
    setTimer: () => 0,
    clearTimer: () => {},
    newId: () => "0a0a0a0a-0000-4000-8000-000000000001",
  });
  broken.dispatch(setTitle(I.richieste, TITLE, "Raccolta"));
  await broken.saveNow();
  assert.equal(broken.getState().pill, "dirty");
  assert.equal(broken.getState().pending, 1);
  assert.equal(broken.getState().toast?.text, T.failure);
  assert.equal(h.server.board, real);
});

test("dopo dispose niente parte più: né salvataggi, né toast, né avvisi a chi ascoltava", async () => {
  const h = harness();
  let calls = 0;
  h.client.subscribe(() => {
    calls += 1;
  });
  h.client.dispatch(setTitle(I.richieste, TITLE, "Raccolta"));
  assert.equal(calls, 1);
  h.client.dispose();
  h.client.dispatch(setTitle(I.richieste, "Raccolta", "Richieste"));
  h.client.notify(T.copied);
  h.client.start();
  h.client.setOnline(false);
  await h.client.saveNow();
  await h.client.pull();
  await h.advance(60_000);
  assert.equal(calls, 1);
  assert.equal(h.server.puts.length, 0);
  assert.equal(h.server.gets.length, 0);
});
