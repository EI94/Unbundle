import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installAppModules } from "../../../lib/ai/claude-test-kit.ts";

// `GET /api/context/[workspaceId]/sources/[sourceId]` (rilascio 9a, RILASCIO-9a-COSTRUZIONE.md §3.5, §7.5): il pannello
// di un appunto o di un documento nella vista «Appunti», solo Lateral Space. Il cliente non legge gli appunti, né il
// loro testo, né «Con chi»: 404, come una rotta che non c'è. Chi chiama e la fonte sono finti.

type Prova = {
  actor: { ok: true; actor: Record<string, unknown> } | { ok: false; status: 401 | 404 };
  ready: boolean;
  detail: unknown;
  asked: string[];
};
const prova: Prova = { actor: { ok: false, status: 401 }, ready: true, detail: null, asked: [] };
(globalThis as { __prova?: Prova }).__prova = prova;

await installAppModules({
  "@/lib/context/server/actor": `export async function contextActorFromSession() { return globalThis.__prova.actor; }`,
  "@/lib/db/queries/context-store": `export async function contextStoreReady() { return globalThis.__prova.ready; }`,
  "@/lib/db/queries/context-sources": `export async function getContextSource(actor, sourceId) { globalThis.__prova.asked.push(sourceId); return globalThis.__prova.detail; }`,
});
const route = await import("../../../app/api/context/[workspaceId]/sources/[sourceId]/route.ts");

const WS = "11111111-1111-4111-8111-111111111111";
const SOURCE = "22222222-2222-4222-8222-222222222222";
const actorAs = (role: string, isLateralSpace: boolean) => ({ ok: true as const, actor: { workspaceId: WS, userId: "u", role, isLateralSpace, channel: "web" } });
const get = () => route.GET(new Request(`https://unbundle.test/api/context/${WS}/sources/${SOURCE}`), { params: Promise.resolve({ workspaceId: WS, sourceId: SOURCE }) });

const DETAIL = {
  id: SOURCE,
  kind: "appunti",
  origin: "web",
  title: "Call di avvio",
  occurredOn: "2026-11-14",
  state: "da_confermare",
  readReason: null,
  openProposals: 4,
  visibility: "ls",
  document: null,
  canRemove: true,
  body: "Il gestionale è SAP Business One.",
  participants: "Direttore operativo",
  link: null,
  addedByName: "Persona di prova",
  createdAt: new Date("2026-11-14T10:00:00Z"),
  textPurgedAt: null,
  partsTotal: 1,
  partsRead: 1,
  skipped: { persone: 1 },
};

beforeEach(() => {
  Object.assign(prova, { actor: actorAs("transformation_lead", true), ready: true, detail: DETAIL, asked: [] });
});

test("la rotta è una funzione Node, mai in cache, con 30 secondi", () => {
  assert.deepEqual([route.runtime, route.dynamic, route.maxDuration], ["nodejs", "force-dynamic", 30]);
});

test("senza sessione 401; il cliente, senza accesso o con solo un corso 404: la fonte non si legge", async () => {
  for (const [actor, status] of [
    [{ ok: false, status: 401 }, 401],
    [actorAs("exec_sponsor", false), 404],
    [actorAs("contributor", false), 404],
    [{ ok: false, status: 404 }, 404],
    [actorAs("learner", true), 404],
  ] as const) {
    prova.actor = actor;
    const response = await get();
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.deepEqual(prova.asked, []);
});

test("archivio non pronto 503; una fonte che non c'è (o di un altro workspace) 404", async () => {
  prova.ready = false;
  assert.equal((await get()).status, 503);
  prova.ready = true;
  prova.detail = null;
  const response = await get();
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "non_trovato", message: "Non trovato." });
});

test("Lateral Space: 200 con il dettaglio (le date come testo ISO), mai in cache", async () => {
  const response = await get();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { ...DETAIL, createdAt: "2026-11-14T10:00:00.000Z" });
  assert.deepEqual(prova.asked, [SOURCE]);
});
