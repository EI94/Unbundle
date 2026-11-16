import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installAppModules } from "../ai/claude-test-kit.ts";
import { CHAT_ANSWER_RESERVE_MS } from "../ai/models.ts";
import { MAPPING_LIMITS } from "./vocab.ts";

// Le rotte vere della board (docs/mappatura/MAPPATURA-BOARD-PIANO.md §4.4, §6): `GET` e `PUT …/board`, `POST …/complete`.
// Sessione, appartenenze e database finti; `getCollaboratorAccess`, `boardRequest`, `readBoardSince` e `saveBoardOps`
// sono quelli veri. Il completamento è finto (ha le sue prove in complete.test.ts): qui conta che cosa gli passa la rotta.
// - 401 senza sessione; 404 a chi non è un collaboratore, a chi segue solo un corso e per un'unità di un altro workspace;
// - 400, 413, 503; `no-store` su ogni risposta;
// - lo `step.stream` di un contributore torna «forbidden» e non arriva a nessuna istruzione SQL;
// - `GET ?since` con la stessa revisione: `unchanged`;
// - `complete` ha `maxDuration` 120 e passa la scadenza di `chatDeadline`.

const WS = "11111111-aaaa-4aaa-8aaa-111111111111";
const OTHER_WS = "11111111-aaaa-4aaa-8aaa-999999999999";
const UNIT = "22222222-bbbb-4bbb-8bbb-222222222222";
const FOREIGN_UNIT = "22222222-bbbb-4bbb-8bbb-999999999999";
const USER = "33333333-cccc-4ccc-8ccc-333333333333";
const PROCESS = "44444444-dddd-4ddd-8ddd-444444444444";
const STEP = "55555555-eeee-4eee-8eee-555555555555";
let seq = 0;
const id = () => `66666666-ffff-4fff-8fff-${String(++seq).padStart(12, "0")}`;

type Statement = { text: string; params: unknown[] };
type Prova = {
  /** Chi è entrato; null: nessuna sessione. */
  user: { id: string } | null;
  /** Il ruolo di chi è entrato in ogni workspace; assente: non ne fa parte. */
  roles: Record<string, string>;
  ready: boolean;
  revision: number;
  /** Le istruzioni che scrivono, come sono arrivate al database. */
  writes: Statement[];
  /** Tutte le istruzioni, lette e scritte. */
  all: Statement[];
  completions: Array<{ scope: unknown; deadline: number; at: number }>;
  outcome: unknown;
  failWrites: boolean;
};
const prova: Prova = { user: { id: USER }, roles: { [WS]: "transformation_lead" }, ready: true, revision: 4, writes: [], all: [], completions: [], outcome: null, failWrites: false };
(globalThis as { __prova?: Prova; __provaIds?: Record<string, string> }).__prova = prova;
(globalThis as { __provaIds?: Record<string, string> }).__provaIds = { WS, OTHER_WS, UNIT, FOREIGN_UNIT, PROCESS, STEP };

await installAppModules({
  "@/lib/auth": `export async function auth() { const user = globalThis.__prova.user; return user ? { user: { ...user, email: "persona@cliente.test", emailVerified: true } } : null; }`,
  // Le appartenenze: `getCollaboratorAccess` vero le legge da qui (chi segue solo un corso è un membro, non un collaboratore).
  "@/lib/db/queries/workspaces": `export async function getWorkspaceById(id) { return id === globalThis.__provaIds.WS || id === globalThis.__provaIds.OTHER_WS ? { id, organizationId: "org-prova", name: "Workspace di prova" } : null; }`,
  "@/lib/db/queries/organizations": `export async function getUserMembership() { return null; }`,
  "@/lib/db/queries/workspace-collaboration": `export async function getWorkspaceMembershipByUser(userId, workspaceId) { const role = globalThis.__prova.roles[workspaceId]; return role ? { role } : null; }`,
  "@/lib/db/ensure-schema": `export async function ensureDbSchema() {}`,
  // Il database: risponde secondo l'istruzione, e tiene da parte quelle che scrivono.
  "@/lib/db/uc-executor": `
    const I = globalThis.__provaIds;
    function respond(statement) {
      const p = globalThis.__prova;
      const text = statement.text;
      p.all.push({ text, params: [...statement.params] });
      if (text.includes(" AS ready")) return [{ ready: p.ready }];
      if (text.startsWith("SELECT d.id FROM departments d")) return statement.params[0] === I.UNIT && statement.params[1] === I.WS ? [{ id: I.UNIT }] : [];
      if (text.startsWith("SELECT a.id, a.created_at, ")) return [];
      if (text.includes(" AS loose")) return [{ loose: 0 }];
      if (text.includes("FROM activity_dependencies")) return [];
      if (text.startsWith("SELECT coalesce((SELECT b.revision")) return [{ revision: String(p.revision) }];
      if (text.startsWith("SELECT d.id, d.name")) return [{ id: I.UNIT, name: "Ufficio acquisti", description: null, team_size: 6, mapping_status: "in_progress", revision: String(p.revision), headline: null, saved_at: "2026-11-16T09:30:00.000Z" }];
      if (text.startsWith("SELECT p.id, p.name")) return [{ id: I.PROCESS, name: "Dalla richiesta all'ordine", owner: null, votes: 0, my_votes: 0 }];
      if (text.startsWith("SELECT a.id, btrim(a.title)")) return [{ id: I.STEP, title: "Raccolta delle richieste", tools: [], who: [], process_id: I.PROCESS, status: "confermato", origin: "board", classification: "automate" }];
      if (text.startsWith("SELECT n.id, n.activity_id")) return [];
      if (/^SELECT/.test(text)) throw new Error("lettura non prevista: " + text.slice(0, 80));
      if (p.failWrites) throw Object.assign(new Error("database giù, con un testo che non deve finire nei log"), { code: "57P01" });
      p.writes.push({ text, params: [...statement.params] });
      if (text.includes("RETURNING b.revision, b.updated_at")) { p.revision += 1; return [{ revision: String(p.revision), updated_at: "2026-11-16T10:00:00.000Z" }]; }
      return [{ outcome: "ok" }];
    }
    const executor = { async batch(statements) { return statements.map(respond); } };
    export async function getAppUcExecutor() { return executor; }`,
  "@/lib/mappatura/complete": `
    export function appCompleteDeps(executor) { return { executor }; }
    export function isCompletionRefusal(value) { return Boolean(value && "refused" in value); }
    export async function completeUnitMapping(deps, input) {
      globalThis.__prova.completions.push({ scope: input.scope, deadline: input.deadline, at: Date.now(), hasExecutor: typeof deps.executor.batch === "function", extra: Object.keys(input).sort().join(",") });
      return globalThis.__prova.outcome;
    }`,
});
const board = await import("../../app/api/workspaces/[workspaceId]/mapping/[deptId]/board/route.ts");
const complete = await import("../../app/api/workspaces/[workspaceId]/mapping/[deptId]/complete/route.ts");

function reset(over: Partial<Prova> = {}) {
  Object.assign(prova, { user: { id: USER }, roles: { [WS]: "transformation_lead" }, ready: true, revision: 4, writes: [], all: [], completions: [], outcome: null, failWrites: false }, over);
}
const context = (workspaceId = WS, deptId = UNIT) => ({ params: Promise.resolve({ workspaceId, deptId }) });
const url = (suffix = "") => `http://localhost/api/workspaces/${WS}/mapping/${UNIT}/board${suffix}`;
async function answer(response: Response) {
  assert.equal(response.headers.get("cache-control"), "no-store", "mai in cache");
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}
const get = async (suffix = "", ctx = context()) => answer(await board.GET(new Request(url(suffix)), ctx));
const put = async (body: unknown, ctx = context()) =>
  answer(await board.PUT(new Request(url(), { method: "PUT", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }), ctx));
const post = async (ctx = context()) => answer(await complete.POST(new Request(url().replace("/board", "/complete"), { method: "POST", body: "{}" }), ctx));
const vote = () => ({ id: id(), t: "process.vote", processId: PROCESS, mine: 2 });

test("senza sessione: 401 su ogni rotta, e nessuna lettura", async () => {
  reset({ user: null });
  for (const call of [() => get(), () => put({ baseRevision: 4, ops: [vote()] }), () => post()]) {
    assert.deepEqual(await call(), { status: 401, body: { code: "non_autenticato" } });
  }
  assert.deepEqual([prova.all.length, prova.completions.length], [0, 0]);
});

test("404 a chi non è un collaboratore, a chi segue solo un corso, per un'unità di un altro workspace e per un id che non è un id", async () => {
  const calls = (ctx = context()) => [() => get("", ctx), () => put({ baseRevision: 4, ops: [vote()] }, ctx), () => post(ctx)];
  // Non fa parte del workspace.
  reset({ roles: {} });
  for (const call of calls()) assert.deepEqual(await call(), { status: 404, body: { code: "non_trovata" } });
  assert.equal(prova.all.length, 0, "senza accesso il database non si tocca");
  // Segue solo un corso: è un membro, non un collaboratore.
  reset({ roles: { [WS]: "learner" } });
  for (const call of calls()) assert.deepEqual(await call(), { status: 404, body: { code: "non_trovata" } });
  assert.equal(prova.all.length, 0);
  // Un'unità di un altro workspace: chi chiede è un collaboratore del suo, e l'unità non è lì. E viceversa.
  reset({ roles: { [WS]: "analyst", [OTHER_WS]: "analyst" } });
  for (const ctx of [context(WS, FOREIGN_UNIT), context(OTHER_WS, UNIT)]) {
    for (const call of calls(ctx)) assert.deepEqual(await call(), { status: 404, body: { code: "non_trovata" } });
  }
  assert.deepEqual([prova.writes.length, prova.completions.length], [0, 0]);
  assert.ok(prova.all.every((statement) => statement.text.startsWith("SELECT d.id FROM departments d")), "solo il controllo dell'unità");
  // Id che non sono id: 404 senza arrivare al database.
  reset();
  for (const ctx of [context("non-un-id", UNIT), context(WS, "1; DROP TABLE activities")]) {
    for (const call of calls(ctx)) assert.deepEqual(await call(), { status: 404, body: { code: "non_trovata" } });
  }
  assert.equal(prova.all.length, 0);
});

test("GET: la board per chi guarda; con ?since alla stessa revisione, «unchanged» senza rileggere tutto", async () => {
  reset();
  const full = await get();
  assert.equal(full.status, 200);
  const read = full.body.board as { unit: { name: string }; revision: number; savedAt: string; processes: Array<{ steps: Array<{ title: string; stream: string }> }>; can: unknown; store: string };
  assert.deepEqual([read.unit.name, read.revision, read.savedAt, read.store], ["Ufficio acquisti", 4, "2026-11-16T09:30:00.000Z", "pronto"]);
  assert.deepEqual(read.processes[0].steps.map((step) => [step.title, step.stream]), [["Raccolta delle richieste", "automate"]]);
  assert.deepEqual(read.can, { edit: true, setStream: true, complete: true });

  reset();
  assert.deepEqual(await get("?since=4"), { status: 200, body: { unchanged: true, revision: 4 } });
  assert.ok(!prova.all.some((statement) => statement.text.startsWith("SELECT p.id, p.name")), "nessuna lettura dei processi");
  // Una revisione più vecchia, o un valore che non è un numero: la board intera.
  for (const since of ["?since=3", "?since=abc", "?since=-1", "?since="]) {
    const result = await get(since);
    assert.ok(result.status === 200 && (result.body.board as { revision: number }).revision === 4, since);
  }
  // Chi contribuisce legge la stessa board, senza poter correggere gli stream.
  reset({ roles: { [WS]: "contributor" } });
  assert.deepEqual(((await get()).body.board as { can: unknown }).can, { edit: true, setStream: false, complete: true });
  // Senza la 0039: la board dalle sole attività, in sola lettura, anche con ?since (non c'è una revisione da confrontare).
  reset({ ready: false });
  const missing = await get("?since=0");
  assert.equal(missing.status, 200);
  const fallback = missing.body.board as { store: string; revision: number; can: unknown; processes: Array<{ name: string; steps: unknown[] }> };
  assert.deepEqual([fallback.store, fallback.revision, fallback.can], ["mancante", 0, { edit: false, setStream: false, complete: false }]);
  assert.deepEqual(fallback.processes.map((process) => [process.name, process.steps.length]), [["Processo principale", 1]]);
  assert.ok(!prova.all.some((statement) => /mapping_(boards|processes|steps|notes|votes)\b/.test(statement.text) && !statement.text.includes(" AS ready")), "nessuna lettura delle tabelle nuove");
});

test("PUT: salva e risponde con revisione, ora, rifiuti e board; ogni istruzione porta workspace e unità", async () => {
  reset();
  const ops = [vote(), { id: id(), t: "step.set", stepId: STEP, field: "title", prev: "Raccolta delle richieste", next: "  Raccolta delle richieste d'acquisto " }];
  const saved = await put({ baseRevision: 4, ops });
  assert.equal(saved.status, 200);
  assert.deepEqual([saved.body.revision, saved.body.savedAt, saved.body.rejected], [5, "2026-11-16T10:00:00.000Z", []]);
  assert.equal((saved.body.board as { revision: number }).revision, 5);
  // La riga della board, le due operazioni, le operazioni vecchie dimenticate, l'unità «in corso», la revisione: tutte
  // nello scope di chi è entrato.
  assert.equal(prova.writes.length, 6);
  for (const statement of prova.writes) assert.ok(statement.params.includes(WS) && statement.params.includes(UNIT), statement.text.slice(0, 50));
  assert.ok(prova.writes[1].params.includes(USER), "i voti sono di chi è entrato, non di un id nel corpo");
  assert.ok(prova.writes[2].params.includes("Raccolta delle richieste d'acquisto"), "il testo arriva rifinito");
  assert.match(prova.writes[3].text, /^DELETE FROM mapping_applied_ops o /);
  assert.match(prova.writes[5].text, /RETURNING b\.revision, b\.updated_at$/);
});

test("PUT: 400 per un corpo che non si legge o non valido, 413 oltre 200 operazioni, 503 senza la 0039; niente scritto", async () => {
  reset();
  const invalid: unknown[] = [
    "{ non è json",
    "null",
    "[]",
    "\"testo\"",
    {},
    { ops: [vote()] },
    { baseRevision: 4 },
    { baseRevision: "4", ops: [vote()] },
    { baseRevision: 4, ops: [{ ...vote(), mine: 100 }] },
    { baseRevision: 4, ops: [{ id: id(), t: "step.set", stepId: STEP, field: "title", prev: "x", next: "" }] },
    { baseRevision: 4, ops: [{ id: id(), t: "tabella.drop" }] },
    { baseRevision: 4, ops: [vote()], departmentId: FOREIGN_UNIT },
    { baseRevision: 4, ops: "tutte" },
  ];
  for (const body of invalid) assert.deepEqual(await put(body), { status: 400, body: { code: "non_valida" } }, JSON.stringify(body));
  assert.deepEqual(await put({ baseRevision: 4, ops: Array.from({ length: MAPPING_LIMITS.opsPerSave + 1 }, vote) }), { status: 413, body: { code: "troppe_modifiche" } });
  assert.equal((await put({ baseRevision: 4, ops: Array.from({ length: MAPPING_LIMITS.opsPerSave }, vote) })).status, 200, "duecento sì");
  reset({ ready: false });
  assert.deepEqual(await put({ baseRevision: 4, ops: [vote()] }), { status: 503, body: { code: "non_disponibile" } });
  assert.equal(prova.writes.length, 0);
});

test("PUT: lo step.stream di un contributore torna «forbidden» e non arriva a nessuna istruzione SQL", async () => {
  reset({ roles: { [WS]: "contributor" } });
  const stream = { id: id(), t: "step.stream", stepId: STEP, prev: "automate", next: "innovate" };
  const resetOp = { id: id(), t: "streams.reset" };
  const denied = await put({ baseRevision: 4, ops: [stream, resetOp] });
  assert.equal(denied.status, 200);
  assert.deepEqual(denied.body.rejected, [{ id: stream.id, reason: "forbidden" }, { id: resetOp.id, reason: "forbidden" }]);
  assert.deepEqual([prova.writes.length, denied.body.revision, prova.revision], [0, 4, 4], "niente scritto, la revisione resta");
  assert.ok(!prova.all.some((statement) => /classification|proposed_stream/.test(statement.text) && /UPDATE/.test(statement.text)));
  // Insieme a un'operazione permessa: quella passa, lo stream no.
  const mine = vote();
  const mixed = await put({ baseRevision: 4, ops: [stream, mine] });
  assert.deepEqual([mixed.body.rejected, mixed.body.revision], [[{ id: stream.id, reason: "forbidden" }], 5]);
  assert.ok(prova.writes.some((statement) => statement.text.includes("INSERT INTO mapping_votes")));
  assert.ok(!prova.writes.some((statement) => statement.text.includes("SET classification")));
  // Chi rivede lo stream lo può correggere.
  reset({ roles: { [WS]: "function_lead" } });
  const allowed = await put({ baseRevision: 4, ops: [stream] });
  assert.deepEqual(allowed.body.rejected, []);
  assert.ok(prova.writes.some((statement) => statement.text.includes("UPDATE activities a SET classification")));
});

test("PUT: se il database cade, 500 con un codice e niente testi, nella risposta e nel log", async (t) => {
  const lines: string[] = [];
  t.mock.method(console, "error", (...args: unknown[]) => lines.push(args.map(String).join(" ")));
  reset({ failWrites: true });
  assert.deepEqual(await put({ baseRevision: 4, ops: [vote()] }), { status: 500, body: { code: "errore" } });
  assert.deepEqual(lines, [`[mappatura/board] salvataggio_non_riuscito {"workspaceId":"${WS}","departmentId":"${UNIT}","attore":"persona","error":{"name":"Error","code":"57P01"}}`]);
});

test("POST complete: maxDuration 120, la scadenza di chatDeadline (95 secondi), l'esito e la board nella risposta", async () => {
  assert.equal(complete.maxDuration, 120);
  const outcome = { firstCompletion: true, total: 1, classified: 1, remaining: 0, counts: { automate: 1, differentiate: 0, innovate: 0 }, classification: "fatta", matched: 1, avgExposurePct: 30, onet: "fatto" };
  reset({ outcome });
  const before = Date.now();
  const done = await post();
  assert.equal(done.status, 200);
  assert.deepEqual(done.body.outcome, outcome);
  assert.deepEqual([(done.body.board as { unit: { name: string } }).unit.name, (done.body.board as { revision: number }).revision], ["Ufficio acquisti", 4]);
  assert.equal(prova.completions.length, 1);
  const [call] = prova.completions as Array<{ scope: unknown; deadline: number; at: number; hasExecutor?: boolean; extra?: string }>;
  assert.deepEqual(call.scope, { workspaceId: WS, departmentId: UNIT });
  // La scadenza: l'inizio della richiesta più maxDuration, meno la riserva per rispondere (25 secondi).
  const expected = 120_000 - CHAT_ANSWER_RESERVE_MS;
  assert.equal(expected, 95_000);
  assert.ok(call.deadline >= before + expected && call.deadline <= call.at + expected, `scadenza a ${call.deadline - before} ms dall'inizio`);
  assert.equal(call.hasExecutor, true);
  assert.equal(call.extra, "deadline,scope", "dal bottone nessuna sintesi: la scrive solo l'assistente");
  // Senza la 0039 il completamento non ha esito: 503.
  reset({ outcome: null });
  assert.deepEqual(await post(), { status: 503, body: { code: "non_disponibile" } });
  // Un'unità senza passi non si completa: 409, e la board non si rilegge.
  reset({ outcome: { refused: "senza_passi" } });
  assert.deepEqual(await post(), { status: 409, body: { code: "senza_passi" } });
  assert.equal(prova.all.filter((statement) => statement.text.startsWith("SELECT d.id, d.name")).length, 0);
  // Chiunque sia un collaboratore può completare, come dalla chat oggi.
  reset({ outcome, roles: { [WS]: "contributor" } });
  assert.equal((await post()).status, 200);
});

test("le rotte passano tutte da boardRequest, e il corpo non porta mai workspace o unità", () => {
  for (const file of ["board/route.ts", "complete/route.ts"]) {
    const source = readFileSync(new URL(`../../app/api/workspaces/[workspaceId]/mapping/[deptId]/${file}`, import.meta.url), "utf8");
    const handlers = source.match(/export async function (GET|PUT|POST)\(/g) ?? [];
    assert.ok(handlers.length >= 1, file);
    assert.equal((source.match(/const entry = await boardRequest\(params\);\s+if \(entry instanceof Response\) return entry;/g) ?? []).length, handlers.length, `${file}: ogni handler controlla l'accesso per prima cosa`);
    assert.doesNotMatch(source, /getWorkspaceAccessForUser|body\.(workspaceId|departmentId|deptId)/, file);
  }
  const access = readFileSync(new URL("./board-access.ts", import.meta.url), "utf8");
  assert.match(access, /getCollaboratorAccess\(session\.user\.id, workspaceId\)/);
  assert.ok(access.indexOf("await auth()") < access.indexOf("getCollaboratorAccess(") && access.indexOf("getCollaboratorAccess(") < access.indexOf("executor.batch("), "sessione, poi accesso, poi il database");
});
