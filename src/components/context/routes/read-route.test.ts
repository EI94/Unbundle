import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installAppModules } from "../../../lib/ai/claude-test-kit.ts";

// `POST /api/context/[workspaceId]/sources/[sourceId]/read` (rilascio 9a, RILASCIO-9a-COSTRUZIONE.md §3.5, §11.3):
// «Leggi» e «Rileggi», solo Lateral Space. Ogni esito della lettura risponde 200 `{ outcome }` (rifiuto, tempo, manca
// l'ok, limite: lo dice l'esito); `again` solo se il corpo lo chiede. Chi chiama e la lettura sono finti (con il
// database e il Claude finto: routes.integration.test.ts).

type Prova = {
  actor: { ok: true; actor: Record<string, unknown> } | { ok: false; status: 401 | 404 };
  ready: boolean;
  result: unknown;
  reads: Array<{ actor: unknown; sourceId: string; opts: Record<string, unknown> }>;
};
const prova: Prova = { actor: { ok: false, status: 401 }, ready: true, result: null, reads: [] };
(globalThis as { __prova?: Prova }).__prova = prova;

await installAppModules({
  "@/lib/context/server/actor": `export async function contextActorFromSession() { return globalThis.__prova.actor; }`,
  "@/lib/db/queries/context-store": `export async function contextStoreReady() { return globalThis.__prova.ready; }`,
  "@/lib/db/queries/context-read": `export async function readContextSource(actor, sourceId, opts) { globalThis.__prova.reads.push({ actor, sourceId, opts }); return globalThis.__prova.result; }`,
});
const route = await import("../../../app/api/context/[workspaceId]/sources/[sourceId]/read/route.ts");

const WS = "11111111-1111-4111-8111-111111111111";
const SOURCE = "22222222-2222-4222-8222-222222222222";
const actorAs = (role: string, isLateralSpace: boolean) => ({ ok: true as const, actor: { workspaceId: WS, userId: "u", role, isLateralSpace, channel: "web" } });
const post = (body?: string) =>
  route.POST(new Request(`https://unbundle.test/api/context/${WS}/sources/${SOURCE}/read`, { method: "POST", ...(body === undefined ? {} : { body, headers: { "Content-Type": "application/json" } }) }), {
    params: Promise.resolve({ workspaceId: WS, sourceId: SOURCE }),
  });

beforeEach(() => {
  Object.assign(prova, { actor: actorAs("transformation_lead", true), ready: true, result: { ok: true, value: { status: "letto", proposals: 3, skipped: { persone: 1 } } }, reads: [] });
});

test("la rotta è una funzione Node, mai in cache, con 120 secondi (la lettura ne ha 90)", () => {
  assert.deepEqual([route.runtime, route.dynamic, route.maxDuration], ["nodejs", "force-dynamic", 120]);
});

test("senza sessione 401; il cliente, senza accesso o con solo un corso 404; archivio non pronto 503: il modello non parte", async () => {
  for (const [actor, ready, status] of [
    [{ ok: false, status: 401 }, true, 401],
    [actorAs("analyst", false), true, 404],
    [actorAs("contributor", false), true, 404],
    [{ ok: false, status: 404 }, true, 404],
    [actorAs("learner", true), true, 404],
    [actorAs("transformation_lead", true), false, 503],
  ] as const) {
    prova.actor = actor;
    prova.ready = ready;
    const response = await post("{}");
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.deepEqual(prova.reads, []);
});

test("ogni esito della lettura risponde 200 `{ outcome }`, com'è", async () => {
  for (const outcome of [
    { status: "letto", proposals: 3, skipped: { persone: 1 } },
    { status: "in_corso", partsRead: 1, partsTotal: 3 },
    { status: "ok_mancante" },
    { status: "in_lettura" },
    { status: "rifiuto" },
    { status: "tempo" },
    { status: "errore" },
    { status: "limite" },
  ]) {
    prova.result = { ok: true, value: outcome };
    const response = await post("{}");
    assert.equal(response.status, 200, outcome.status);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { outcome });
  }
});

test("«Rileggi» solo con `again: true`; un corpo vuoto, non JSON o con altro vale «Leggi»", async () => {
  for (const [body, again] of [
    ['{"again":true}', true],
    ['{"again":"true"}', false],
    ["{}", false],
    ["", false],
    [undefined, false],
    ["non json", false],
  ] as const) {
    prova.reads = [];
    await post(body);
    assert.equal(prova.reads.length, 1, String(body));
    assert.equal(prova.reads[0].sourceId, SOURCE);
    assert.deepEqual(prova.reads[0].opts, { again }, String(body));
  }
});

test("una fonte di un altro workspace o che non c'è: 404; un errore della lettura: 503", async () => {
  prova.result = { ok: false, error: "non_trovato", message: "Non trovato." };
  let response = await post("{}");
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "non_trovato", message: "Non trovato." });
  prova.result = { ok: false, error: "permesso_mancante", message: "Non hai i permessi per farlo." };
  response = await post("{}");
  assert.equal(response.status, 404, "il permesso mancante risponde come una fonte che non c'è");
  prova.result = { ok: false, error: "riprova", message: "Non è riuscito. Riprova tra poco." };
  response = await post("{}");
  assert.equal(response.status, 503);
});
