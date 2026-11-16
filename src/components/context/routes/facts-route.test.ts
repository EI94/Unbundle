import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installAppModules } from "../../../lib/ai/claude-test-kit.ts";

// `GET /api/context/[workspaceId]/facts/[factId]` (rilascio 9a, RILASCIO-9a-COSTRUZIONE.md §3.5): il pannello di un
// fatto per chi apre la pagina. Senza sessione 401; senza accesso, chi segue solo un corso o un fatto che chi guarda non
// vede: 404 (non si dice che c'è); archivio non pronto 503; mai in cache. Chi chiama e la memoria sono finti.

type Prova = {
  actor: { ok: true; actor: Record<string, unknown> } | { ok: false; status: 401 | 404 };
  ready: boolean;
  detail: unknown;
  asked: Array<{ actor: unknown; factId: string }>;
};
const prova: Prova = { actor: { ok: false, status: 401 }, ready: true, detail: null, asked: [] };
(globalThis as { __prova?: Prova }).__prova = prova;

await installAppModules({
  "@/lib/context/server/actor": `export async function contextActorFromSession(workspaceId) { globalThis.__prova.workspaceAsked = workspaceId; return globalThis.__prova.actor; }`,
  "@/lib/db/queries/context-store": `export async function contextStoreReady() { return globalThis.__prova.ready; }`,
  "@/lib/db/queries/context-memory": `export async function getFactDetail(actor, factId) { globalThis.__prova.asked.push({ actor, factId }); return globalThis.__prova.detail; }`,
});
const route = await import("../../../app/api/context/[workspaceId]/facts/[factId]/route.ts");

const WS = "11111111-1111-4111-8111-111111111111";
const FACT = "22222222-2222-4222-8222-222222222222";
const actorAs = (role: string, isLateralSpace: boolean) => ({ ok: true as const, actor: { workspaceId: WS, userId: "u", role, isLateralSpace, channel: "web" } });
const get = () => route.GET(new Request(`https://unbundle.test/api/context/${WS}/facts/${FACT}`), { params: Promise.resolve({ workspaceId: WS, factId: FACT }) });

const DETAIL = {
  id: FACT,
  version: 2,
  kind: "fatto",
  section: "sistemi",
  statement: "Il gestionale è SAP Business One.",
  basis: "detto",
  visibility: "tutti",
  needsCheck: false,
  sourceKind: "call",
  sourceLabel: "Call 14 nov",
  lastConfirmedOn: "2026-11-14",
  useCases: [],
  quote: null,
  source: null,
  history: [],
  confirmedBy: null,
};

beforeEach(() => {
  Object.assign(prova, { actor: actorAs("analyst", false), ready: true, detail: DETAIL, asked: [] });
});

test("la rotta è una funzione Node, mai in cache, con 30 secondi", () => {
  assert.deepEqual([route.runtime, route.dynamic, route.maxDuration], ["nodejs", "force-dynamic", 30]);
});

test("senza sessione 401; senza accesso 404; con solo un corso 404: la memoria non si legge", async () => {
  for (const [actor, status] of [
    [{ ok: false, status: 401 }, 401],
    [{ ok: false, status: 404 }, 404],
    [actorAs("learner", false), 404],
    [actorAs("ruolo_sconosciuto", true), 404],
  ] as const) {
    prova.actor = actor;
    const response = await get();
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = (await response.json()) as { error: string; message: string };
    assert.equal(typeof body.message, "string");
    assert.doesNotMatch(body.message, /^[a-z_]+$/, "a schermo una frase, mai un codice");
  }
  assert.deepEqual(prova.asked, []);
});

test("archivio non pronto: 503 «si sta preparando»", async () => {
  prova.ready = false;
  const response = await get();
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "area_spenta", message: "Il contesto si sta preparando. Riprova tra qualche minuto." });
  assert.deepEqual(prova.asked, []);
});

test("un fatto che chi guarda non vede (o non c'è): 404", async () => {
  prova.detail = null;
  const response = await get();
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "non_trovato", message: "Non trovato." });
});

test("il cliente e Lateral Space: 200 con il dettaglio, per chi chiama, mai in cache", async () => {
  for (const actor of [actorAs("contributor", false), actorAs("transformation_lead", true)]) {
    prova.actor = actor;
    prova.asked = [];
    const response = await get();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), DETAIL);
    assert.deepEqual(prova.asked, [{ actor: actor.actor, factId: FACT }]);
  }
});
