import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { connect, enabled, newFixture, opts, seed, unseed, type Connection } from "./integration-kit.ts";
import type { MappingBoard } from "./board-model.ts";
import type { BoardOp } from "./board-ops.ts";
import { createBoardClient, draftKey, type BoardClient } from "../../components/mappatura/store/board-client.ts";
import { BOARD_TEXT } from "./text.ts";

// Una bozza rimandata (docs/mappatura/MAPPATURA-BOARD-PIANO.md §4.3 R4, §4.7): la pagina si chiude mentre il salvataggio
// `keepalive` viaggia, il server lo applica, nessuno legge la risposta e la bozza resta sul dispositivo. Chi riapre la
// board la rimanda: il server ricorda le operazioni già applicate e risponde con l'esito di allora, senza scrivere di
// nuovo. Lo store vero sul database del pacchetto, il client vero con fetch e memoria finti.
// Con scripts/use-case-test/run-db-tests.mjs. Dati inventati, creati e cancellati qui.

const f = newFixture();
let db: Connection;
let q: Connection["q"];
let store: typeof import("./board-store.ts");

const scope = () => ({ workspaceId: f.ws, departmentId: f.unit });
const lead = () => ({ kind: "persona" as const, userId: f.lead, role: "transformation_lead" });
const contributor = () => ({ kind: "persona" as const, userId: f.contributor, role: "contributor" });
const op = (body: Record<string, unknown>) => ({ id: randomUUID(), ...body }) as BoardOp;
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 20));

before(async () => {
  if (!enabled) return;
  db = await connect();
  q = db.q;
  store = await import("./board-store.ts");
  await seed(q, f, "bozza");
});

after(async () => {
  if (!enabled) return;
  await unseed(q, f);
});

/** La memoria di un dispositivo: la stessa per ogni pagina che apre la board in quel browser. */
function device() {
  const stored = new Map<string, string>();
  return {
    stored,
    storage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, value),
      removeItem: (key: string) => void stored.delete(key),
    },
  };
}

/** Le rotte vere sullo store vero: PUT salva, GET legge. `closing`: la pagina si chiude dopo che la richiesta è partita. */
function routes(actor: ReturnType<typeof lead>, mode: { closing?: boolean } = {}): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    if ((init?.method ?? "GET") === "GET") {
      const since = new URL(String(input), "http://board.test").searchParams.get("since");
      const result = await store.readBoardSince(db.exec, scope(), { userId: actor.userId, role: actor.role }, since === null ? null : Number(since));
      assert.ok(result);
      return Response.json(result.unchanged ? { unchanged: true, revision: result.revision } : { board: result.board });
    }
    const result = await store.saveBoardOps(db.exec, scope(), actor, JSON.parse(String(init?.body)));
    assert.ok(result.ok, JSON.stringify(result));
    const answer = Response.json({ revision: result.revision, savedAt: result.savedAt, rejected: result.rejected, board: result.board });
    // Il salvataggio è arrivato ed è stato scritto; la pagina non c'è più, nessuno legge la risposta.
    return mode.closing ? new Promise<Response>(() => {}) : answer;
  }) as typeof fetch;
}

function open(initial: MappingBoard, storage: ReturnType<typeof device>["storage"], fetchImpl: typeof fetch): BoardClient {
  return createBoardClient({
    workspaceId: f.ws,
    departmentId: f.unit,
    userId: f.lead,
    initial,
    fetch: fetchImpl,
    storage,
    now: () => Date.now(),
    // Il salvataggio automatico parte subito: qui non conta l'attesa di 5 secondi.
    setTimer: (run) => setTimeout(run, 1),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    newId: () => randomUUID(),
  });
}

async function read(who = lead()): Promise<MappingBoard> {
  const board = await store.readBoard(db.exec, scope(), { userId: who.userId, role: who.role });
  assert.ok(board);
  return board;
}

async function untilSaved(client: BoardClient) {
  for (let i = 0; i < 100 && client.getState().pill !== "saved"; i++) await settle();
  assert.equal(client.getState().pill, "saved");
}

/** I toast che la board mostra (i timer qui scattano subito, e un toast se ne andrebbe prima di essere letto). */
function toasts(client: BoardClient): string[] {
  const seen: string[] = [];
  client.subscribe(() => {
    const text = client.getState().toast?.text;
    if (text && seen.at(-1) !== text) seen.push(text);
  });
  return seen;
}

async function processId(): Promise<string> {
  const board = await read();
  if (board.processes[0]) return board.processes[0].id;
  const id = await store.resolveProcess(db.exec, scope(), null);
  assert.ok(id);
  return id;
}

test("un passo eliminato da un collega non torna quando chi l'aveva aggiunto riapre la board con la bozza di allora", opts, async () => {
  const phone = device();
  const process = await processId();
  // A aggiunge un passo con un attrito e chiude la scheda entro 5 secondi: `pagehide` manda il salvataggio keepalive.
  const first = open(await read(), phone.storage, routes(lead(), { closing: true }));
  const stepId = randomUUID();
  first.dispatch([
    { t: "step.add", stepId, processId: process, title: "Controllo fatture fornitori" },
    { t: "note.add", noteId: randomUUID(), stepId, lane: "attriti", text: "Le fatture arrivano in tre formati." },
  ]);
  void first.saveNow({ keepalive: true });
  await settle();
  assert.equal((await q(`SELECT count(*)::int AS n FROM activities WHERE id = $1`, [stepId]))[0].n, 1, "il salvataggio è arrivato");
  assert.ok(phone.stored.has(draftKey(f.lead, f.unit)), "la bozza resta: nessuno ha letto la risposta");

  // B elimina quel passo.
  const removed = await store.saveBoardOps(db.exec, scope(), contributor(), { baseRevision: 0, ops: [op({ t: "step.remove", stepId })] });
  assert.ok(removed.ok && removed.rejected.length === 0);

  // A riapre la board sullo stesso dispositivo: la bozza torna sopra la board e si rimanda.
  const again = open(await read(), phone.storage, routes(lead()));
  const shown = toasts(again);
  again.start();
  assert.equal(again.getState().pill, "dirty");
  await untilSaved(again);
  assert.deepEqual(shown, []);
  assert.equal((await q(`SELECT count(*)::int AS n FROM activities WHERE id = $1`, [stepId]))[0].n, 0, "il passo eliminato non torna");
  assert.equal(again.getState().board.processes.some((item) => item.steps.some((step) => step.id === stepId)), false);
  assert.equal(phone.stored.has(draftKey(f.lead, f.unit)), false, "la bozza se ne va");
});

test("un valore cambiato da un collega dopo il salvataggio non si copre con la bozza di allora, anche se è tornato quello di prima", opts, async () => {
  const phone = device();
  const process = await processId();
  const stepId = randomUUID();
  const made = await store.saveBoardOps(db.exec, scope(), lead(), { baseRevision: 0, ops: [op({ t: "step.add", stepId, processId: process, title: "Verifica ordini" })] });
  assert.ok(made.ok);
  // A rinomina il passo e chiude la scheda: il salvataggio arriva, la risposta no.
  const first = open(await read(), phone.storage, routes(lead(), { closing: true }));
  first.dispatch({ t: "step.set", stepId, field: "title", prev: "Verifica ordini", next: "Verifica ordini aperti" });
  void first.saveNow({ keepalive: true });
  await settle();
  // B vede «Verifica ordini aperti» e rimette apposta il nome di prima.
  const back = await store.saveBoardOps(db.exec, scope(), contributor(), { baseRevision: 0, ops: [op({ t: "step.set", stepId, field: "title", prev: "Verifica ordini aperti", next: "Verifica ordini" })] });
  assert.ok(back.ok && back.rejected.length === 0);
  // A riapre: la bozza si rimanda, e il nome di B resta.
  const again = open(await read(), phone.storage, routes(lead()));
  const shown = toasts(again);
  again.start();
  await untilSaved(again);
  assert.equal((await q(`SELECT title FROM activities WHERE id = $1`, [stepId]))[0].title, "Verifica ordini");
  assert.deepEqual(shown, []);
});

test("un'operazione rifiutata mentre la pagina si chiudeva risponde di nuovo «conflitto» quando si rimanda, e non scrive", opts, async () => {
  const phone = device();
  const process = await processId();
  const stepId = randomUUID();
  await store.saveBoardOps(db.exec, scope(), lead(), { baseRevision: 0, ops: [op({ t: "step.add", stepId, processId: process, title: "Archivio delle bolle" })] });
  const seen = await read();
  // Un collega cambia il nome; A, che ha ancora quello di prima, lo cambia e chiude la scheda: il server rifiuta.
  await store.saveBoardOps(db.exec, scope(), contributor(), { baseRevision: 0, ops: [op({ t: "step.set", stepId, field: "title", prev: "Archivio delle bolle", next: "Archivio dei documenti" })] });
  const first = open(seen, phone.storage, routes(lead(), { closing: true }));
  first.dispatch({ t: "step.set", stepId, field: "title", prev: "Archivio delle bolle", next: "Archivio bolle firmate" });
  void first.saveNow({ keepalive: true });
  await settle();
  // Il collega rimette il nome che A aveva visto: la stessa operazione rimandata non passa per questo.
  await store.saveBoardOps(db.exec, scope(), contributor(), { baseRevision: 0, ops: [op({ t: "step.set", stepId, field: "title", prev: "Archivio dei documenti", next: "Archivio delle bolle" })] });
  const again = open(await read(), phone.storage, routes(lead()));
  const shown = toasts(again);
  again.start();
  await untilSaved(again);
  assert.equal((await q(`SELECT title FROM activities WHERE id = $1`, [stepId]))[0].title, "Archivio delle bolle");
  assert.deepEqual(shown, [BOARD_TEXT.toast.conflict]);
});

test("le operazioni applicate si dimenticano dopo 30 giorni, al prossimo salvataggio dell'unità; quelle di un'altra unità no", opts, async () => {
  const old = randomUUID();
  const recent = randomUUID();
  const elsewhere = randomUUID();
  await q(
    `INSERT INTO mapping_applied_ops (op_id, workspace_id, department_id, outcome, created_at) VALUES
       ($1, $4, $5, 'ok', now() - interval '31 days'), ($2, $4, $5, 'ok', now() - interval '29 days'), ($3, $4, $6, 'ok', now() - interval '31 days')`,
    [old, recent, elsewhere, f.ws, f.unit, f.otherUnit],
  );
  const saved = await store.saveBoardOps(db.exec, scope(), lead(), { baseRevision: 0, ops: [op({ t: "board.set", field: "headline", prev: null, next: "Un terzo del tempo va nei solleciti." })] });
  assert.ok(saved.ok);
  const left = (await q(`SELECT op_id FROM mapping_applied_ops WHERE op_id = ANY($1::uuid[]) ORDER BY op_id`, [[old, recent, elsewhere]])).map((row) => String(row.op_id));
  assert.deepEqual(left, [recent, elsewhere].sort());
});
