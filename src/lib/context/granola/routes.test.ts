import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { installAppModules } from "../../ai/claude-test-kit.ts";

// Le rotte e le azioni di Granola (RILASCIO-9a-COSTRUZIONE.md §3.5, §8.2, §8.7): chi passa, che cosa rispondono, dove
// portano. Le rotte e le azioni sono quelle vere; la sessione, chi chiama, l'archivio e le funzioni di Granola sono
// finti (il loro comportamento lo prova granola.integration.test.ts sul database).

type Prova = {
  session: { user: { id: string; email: string; emailVerified: boolean } } | null;
  who: { ok: true; actor: Record<string, unknown> } | { ok: false; status: 401 | 404 };
  available: boolean;
  ready: boolean;
  calls: Array<[string, unknown]>;
  results: Record<string, unknown>;
  revalidated: Array<[string, string | undefined]>;
};
const prova: Prova = { session: null, who: { ok: false, status: 401 }, available: true, ready: true, calls: [], results: {}, revalidated: [] };
(globalThis as { __granolaRoutes?: Prova }).__granolaRoutes = prova;

const P = "globalThis.__granolaRoutes";
const record = (name: string) => `async (...args) => { ${P}.calls.push([${JSON.stringify(name)}, args]); return ${P}.results[${JSON.stringify(name)}]; }`;
await installAppModules({
  "@/lib/auth": `export const auth = async () => ${P}.session;`,
  "@/lib/context/server/actor": `export async function contextActorFromSession(ws) { ${P}.calls.push(["actor", [ws]]); return ${P}.who; }`,
  "@/lib/db/queries/context-store": `export async function contextStoreReady() { return ${P}.ready; }`,
  "@/lib/db/queries/context-granola": `
    export function granolaAvailable() { return ${P}.available; }
    export const syncGranolaForUser = ${record("sync")};
    export const listGranolaUnsorted = ${record("unsorted")};
    export const completeGranolaConnect = ${record("complete")};
    export const startGranolaConnect = ${record("start")};
    export const disconnectGranola = ${record("disconnect")};
    export const saveGranolaRules = ${record("rules")};
    export const listGranolaFolders = ${record("folders")};
    export const assignGranolaMeeting = ${record("assign")};
    export const leaveOutGranolaMeetings = ${record("leaveOut")};`,
  "next/cache": `export function revalidatePath(path, type) { ${P}.revalidated.push([path, type]); }`,
});

const sync = await import("../../../app/api/context/[workspaceId]/granola/sync/route.ts");
const unsorted = await import("../../../app/api/context/[workspaceId]/granola/unsorted/route.ts");
const callback = await import("../../../app/api/granola/callback/route.ts");
const metadata = await import("../../../app/api/granola/client-metadata/route.ts");
const actions = await import("../../actions/context-granola.ts");

const WS = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const LS_ACTOR = { workspaceId: WS, userId: USER, role: "transformation_lead", isLateralSpace: true, channel: "web" };
const CLIENT_ACTOR = { ...LS_ACTOR, role: "exec_sponsor", isLateralSpace: false };
const ctx = { params: Promise.resolve({ workspaceId: WS }) };

beforeEach(() => {
  Object.assign(prova, { session: null, who: { ok: true, actor: LS_ACTOR }, available: true, ready: true, calls: [], results: {}, revalidated: [] });
});

const post = (body?: unknown, type = "application/json") =>
  sync.POST(new Request(`https://unbundle.test/api/context/${WS}/granola/sync`, { method: "POST", headers: { "content-type": type }, body: body === undefined ? undefined : JSON.stringify(body) }), ctx);

test("le rotte: funzioni Node, mai in cache, con i tempi del piano", () => {
  assert.deepEqual([sync.runtime, sync.dynamic, sync.maxDuration], ["nodejs", "force-dynamic", 120]);
  assert.deepEqual([unsorted.runtime, unsorted.dynamic, unsorted.maxDuration], ["nodejs", "force-dynamic", 60]);
  assert.deepEqual([callback.runtime, callback.dynamic, callback.maxDuration], ["nodejs", "force-dynamic", 60]);
  assert.deepEqual([metadata.runtime, metadata.dynamic], ["nodejs", "force-dynamic"]);
});

test("il giro: 401 senza sessione, 404 al cliente e con Granola spento, 503 senza archivio; mai il giro", async () => {
  prova.who = { ok: false, status: 401 };
  assert.equal((await post({ force: true })).status, 401);
  prova.who = { ok: false, status: 404 };
  assert.equal((await post()).status, 404);
  prova.who = { ok: true, actor: CLIENT_ACTOR };
  const client = await post();
  assert.equal(client.status, 404);
  assert.deepEqual(await client.json(), { error: "non_trovato", message: "Non trovato." });
  prova.who = { ok: true, actor: LS_ACTOR };
  prova.available = false;
  assert.equal((await post()).status, 404);
  prova.available = true;
  prova.ready = false;
  const notReady = await post();
  assert.equal(notReady.status, 503);
  assert.equal(notReady.headers.get("cache-control"), "no-store");
  assert.deepEqual(prova.calls.filter(([name]) => name === "sync"), []);
});

test("il giro: la persona della sessione, `force` solo se lo dice il corpo JSON, 90 secondi; risponde l'esito", async () => {
  const outcome = { status: "fatto", imported: 2, updated: 1, blocked: 0, unsorted: 3 };
  prova.results.sync = outcome;
  const response = await post({ force: true });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), outcome);
  assert.deepEqual(prova.calls.find(([name]) => name === "sync")?.[1], [USER, { force: true, budgetMs: 90_000 }]);
  assert.deepEqual(prova.calls.find(([name]) => name === "actor")?.[1], [WS]);
  for (const [body, type] of [[undefined, "application/json"], [{ force: "sì" }, "application/json"], [{ force: true }, "text/plain"]] as const) {
    prova.calls = [];
    await post(body, type);
    assert.deepEqual((prova.calls.find(([name]) => name === "sync")?.[1] as unknown[])[1], { force: false, budgetMs: 90_000 }, `${type} ${JSON.stringify(body)}`);
  }
});

test("«Da smistare»: le call, o l'errore con il messaggio da mostrare", async () => {
  const get = () => unsorted.GET(new Request(`https://unbundle.test/api/context/${WS}/granola/unsorted`), ctx);
  prova.who = { ok: true, actor: CLIENT_ACTOR };
  assert.equal((await get()).status, 404);
  prova.who = { ok: true, actor: LS_ACTOR };
  const meetings = [{ id: "m-1", title: "Call", date: "2026-11-14", participants: "Giulia (giulia@alfa.test)" }];
  prova.results.unsorted = { ok: true, value: meetings };
  const ok = await get();
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { meetings });
  prova.results.unsorted = { ok: false, error: "riprova", message: "Granola chiede di aspettare. Riprova tra qualche minuto." };
  const limited = await get();
  assert.equal(limited.status, 503);
  assert.deepEqual(await limited.json(), { error: "riprova", message: "Granola chiede di aspettare. Riprova tra qualche minuto." });
  prova.results.unsorted = { ok: false, error: "non_trovato", message: "Collega Granola da «Il tuo account» per far entrare le call da sole." };
  assert.equal((await get()).status, 404);
  prova.available = false;
  prova.calls = [];
  assert.equal((await get()).status, 404);
  assert.deepEqual(prova.calls.filter(([name]) => name === "unsorted"), []);
});

test("il ritorno da Granola: senza sessione al login; poi dove dice l'esito, senza cache", async () => {
  const back = (query: string, headers: Record<string, string> = {}) => callback.GET(new Request(`https://www.unbundle.test/api/granola/callback?${query}`, { headers }));
  const where = (response: Response) => response.headers.get("location");
  const anonymous = await back("code=c&state=s");
  assert.equal(anonymous.status, 303);
  assert.equal(where(anonymous), "https://www.unbundle.test/login");
  assert.equal(where(await back("code=c&state=s", { cookie: "tema=scuro; __session=vecchio" })), "https://www.unbundle.test/login?session=stale");
  assert.deepEqual(prova.calls.filter(([name]) => name === "complete"), [], "senza sessione lo stato non si tocca");

  prova.session = { user: { id: USER, email: "paola@ls.test", emailVerified: true } };
  prova.results.complete = { status: "collegato", workspaceId: WS };
  const done = await back("code=c0d3&state=st4t3");
  assert.equal(where(done), `https://www.unbundle.test/dashboard/${WS}/settings?granola=collegato#granola`);
  assert.equal(done.headers.get("cache-control"), "no-store");
  assert.deepEqual(prova.calls.find(([name]) => name === "complete")?.[1], [{ userId: USER, state: "st4t3", code: "c0d3", error: null }]);
  for (const status of ["annullato", "errore"]) {
    prova.results.complete = { status, workspaceId: WS };
    assert.equal(where(await back("error=access_denied&state=s")), `https://www.unbundle.test/dashboard/${WS}/settings?granola=${status}#granola`);
  }
  // Uno stato che non vale più: alle Impostazioni del workspace dell'ultimo collegamento, dove la riga lo dice.
  prova.results.complete = { status: "scaduto", workspaceId: WS };
  assert.equal(where(await back("state=s")), `https://www.unbundle.test/dashboard/${WS}/settings?granola=scaduto#granola`);
  // Senza traccia di un collegamento: la lista dei workspace, con la riga.
  prova.results.complete = { status: "scaduto", workspaceId: null };
  assert.equal(where(await back("state=s")), "https://www.unbundle.test/dashboard?granola=scaduto");
  // Con Granola spento la rotta non c'è: 404, e lo stato non si tocca.
  prova.available = false;
  prova.calls = [];
  const off = await back("code=c&state=s");
  assert.equal(off.status, 404);
  assert.equal(off.headers.get("cache-control"), "no-store");
  assert.deepEqual(prova.calls, []);
});

test("il documento del cliente: con Granola spento 404; altrimenti il JSON pubblico, un'ora in cache", async () => {
  const keys = ["CONTEXT_TOKEN_KEY", "NEXT_PUBLIC_APP_URL", "VERCEL_ENV", "CONTEXT_GRANOLA"] as const;
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    for (const k of keys) delete process.env[k];
    assert.equal((await metadata.GET()).status, 404);
    process.env.CONTEXT_TOKEN_KEY = randomBytes(32).toString("base64");
    process.env.NEXT_PUBLIC_APP_URL = "https://www.unbundle.test";
    const response = await metadata.GET();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "public, max-age=3600");
    assert.equal(((await response.json()) as { client_id: string }).client_id, "https://www.unbundle.test/api/granola/client-metadata");
    process.env.VERCEL_ENV = "preview";
    assert.equal((await metadata.GET()).status, 404, "nelle anteprime Granola è spento");
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});

test("le azioni: senza la persona permesso_mancante e niente; poi la funzione condivisa, e «Contesto» si aggiorna solo se riesce", async () => {
  prova.who = { ok: false, status: 404 };
  for (const run of [
    () => actions.startGranolaConnectAction(WS),
    () => actions.disconnectGranolaAction(WS),
    () => actions.saveGranolaRulesAction(WS, { folderId: null, folderName: null, emails: [], domains: [], titleWords: [], wantTranscript: false }),
    () => actions.listGranolaFoldersAction(WS),
    () => actions.assignGranolaMeetingAction(WS, "m-1"),
    () => actions.leaveOutGranolaMeetingsAction(WS, ["m-1"]),
  ]) {
    assert.deepEqual(await run(), { ok: false, error: "permesso_mancante", message: "Non hai i permessi per farlo." });
  }
  assert.deepEqual(prova.calls.filter(([name]) => name !== "actor"), []);
  assert.deepEqual(prova.revalidated, []);

  prova.who = { ok: true, actor: LS_ACTOR };
  prova.results = { start: { ok: true, value: { url: "http://127.0.0.1:1/oauth2/authorize" } }, disconnect: { ok: true, value: true }, assign: { ok: true, value: { sourceId: "s-1" } }, leaveOut: { ok: false, error: "riprova", message: "Non è riuscito." } };
  assert.deepEqual(await actions.startGranolaConnectAction(WS), { ok: true, value: { url: "http://127.0.0.1:1/oauth2/authorize" } });
  assert.deepEqual(prova.calls.find(([name]) => name === "start")?.[1], [LS_ACTOR]);
  assert.deepEqual(prova.revalidated, [], "iniziare il collegamento non cambia le pagine");
  await actions.disconnectGranolaAction(WS);
  assert.deepEqual(prova.calls.find(([name]) => name === "disconnect")?.[1], [USER], "si scollega solo la persona che chiama");
  assert.deepEqual(prova.revalidated, [
    [`/dashboard/${WS}/contesto`, "layout"],
    [`/dashboard/${WS}/settings`, undefined],
  ]);
  prova.revalidated = [];
  await actions.assignGranolaMeetingAction(WS, "m-1");
  assert.deepEqual(prova.calls.find(([name]) => name === "assign")?.[1], [LS_ACTOR, "m-1"]);
  assert.deepEqual(prova.revalidated, [[`/dashboard/${WS}/contesto`, "layout"]]);
  prova.revalidated = [];
  assert.equal((await actions.leaveOutGranolaMeetingsAction(WS, ["m-1"])).ok, false);
  assert.deepEqual(prova.revalidated, [], "non riuscito: niente si aggiorna");
});
