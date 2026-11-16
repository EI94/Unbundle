import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installAppModules } from "../../../lib/ai/claude-test-kit.ts";

// `POST /api/context/[workspaceId]/sources` (rilascio 9a, RILASCIO-9a-COSTRUZIONE.md §3.5, §11.3): «Aggiungi appunti»
// dal web, solo Lateral Space. Senza sessione 401; il cliente 404 (non si dice che la rotta c'è); archivio non pronto
// 503; dati non validi o testo fermato dal controllo 422 con il messaggio per il campo; lo stesso testo già salvato 200
// con `created: false`. Chi chiama e il salvataggio sono finti (con il database: routes.integration.test.ts).

type Prova = {
  actor: { ok: true; actor: Record<string, unknown> } | { ok: false; status: 401 | 404 };
  ready: boolean;
  result: unknown;
  saved: Array<{ actor: unknown; input: Record<string, unknown> }>;
};
const prova: Prova = { actor: { ok: false, status: 401 }, ready: true, result: null, saved: [] };
(globalThis as { __prova?: Prova }).__prova = prova;

await installAppModules({
  "@/lib/context/server/actor": `export async function contextActorFromSession() { return globalThis.__prova.actor; }`,
  "@/lib/db/queries/context-store": `export async function contextStoreReady() { return globalThis.__prova.ready; }`,
  "@/lib/db/queries/context-sources": `export async function addContextNote(actor, input) { globalThis.__prova.saved.push({ actor, input }); return globalThis.__prova.result; }`,
});
const route = await import("../../../app/api/context/[workspaceId]/sources/route.ts");

const WS = "11111111-1111-4111-8111-111111111111";
const SOURCE = "22222222-2222-4222-8222-222222222222";
const actorAs = (role: string, isLateralSpace: boolean) => ({ ok: true as const, actor: { workspaceId: WS, userId: "u", role, isLateralSpace, channel: "web" } });
const NOTE = { title: "Call di avvio", occurredOn: "2026-11-14", body: "Il gestionale è SAP Business One. Gli ordini si inseriscono a mano.", participants: "Direttore operativo", link: "https://esempio.test/nota" };
const post = (body: unknown = NOTE) =>
  route.POST(
    new Request(`https://unbundle.test/api/context/${WS}/sources`, { method: "POST", headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }),
    { params: Promise.resolve({ workspaceId: WS }) },
  );

beforeEach(() => {
  Object.assign(prova, { actor: actorAs("transformation_lead", true), ready: true, result: { ok: true, value: { sourceId: SOURCE, created: true, readStatus: "da_leggere" } }, saved: [] });
});

test("la rotta è una funzione Node, mai in cache, con 30 secondi (salva e basta: la lettura è un'altra rotta)", () => {
  assert.deepEqual([route.runtime, route.dynamic, route.maxDuration], ["nodejs", "force-dynamic", 30]);
});

test("senza sessione 401; il cliente (revisore o contributore), senza accesso o con solo un corso 404: niente si salva", async () => {
  for (const [actor, status] of [
    [{ ok: false, status: 401 }, 401],
    [actorAs("analyst", false), 404],
    [actorAs("contributor", false), 404],
    [actorAs("exec_sponsor", false), 404],
    [{ ok: false, status: 404 }, 404],
    [actorAs("learner", true), 404],
  ] as const) {
    prova.actor = actor;
    const response = await post();
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.deepEqual(prova.saved, []);
});

test("archivio non pronto: 503 e niente si salva", async () => {
  prova.ready = false;
  const response = await post();
  assert.equal(response.status, 503);
  assert.deepEqual(prova.saved, []);
});

test("un appunto nuovo: 200 con la fonte; arriva com'è, dal web, senza leggerlo", async () => {
  const response = await post();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { sourceId: SOURCE, created: true, readStatus: "da_leggere" });
  assert.equal(prova.saved.length, 1);
  assert.deepEqual(prova.saved[0].input, { ...NOTE, origin: "web" });
});

test("lo stesso testo già salvato: 200 con `created: false` e la fonte che c'era", async () => {
  prova.result = { ok: true, value: { sourceId: SOURCE, created: false, readStatus: "letto" } };
  const response = await post();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { sourceId: SOURCE, created: false, readStatus: "letto" });
});

test("un testo fermato dal controllo: 422 con il messaggio per il campo, com'è (la parola trovata)", async () => {
  const blocked = { ok: false, error: "dati_non_validi", message: "Controlla i campi indicati.", fieldErrors: { body: "Negli appunti ci sono dati sanitari («visita medica»). Toglili e riprova." } };
  prova.result = blocked;
  const response = await post({ ...NOTE, body: "Il direttore ha una visita medica martedì, poi parliamo del gestionale." });
  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), { error: blocked.error, message: blocked.message, fieldErrors: blocked.fieldErrors });
});

test("campi che mancano o non sono testo: arrivano vuoti o nulli alla funzione condivisa, che li rifiuta", async () => {
  prova.result = { ok: false, error: "dati_non_validi", message: "Controlla i campi indicati.", fieldErrors: { title: "Scrivi un titolo." } };
  const response = await post({ body: 42, participants: ["a"], link: null });
  assert.equal(response.status, 422);
  assert.deepEqual(prova.saved[0].input, { title: "", occurredOn: "", body: "", participants: null, link: null, origin: "web" });
});

test("un corpo che non è JSON, o non è un oggetto: 422 e niente si salva", async () => {
  for (const body of ["non json", "[]", "\"testo\""]) assert.equal((await post(body)).status, 422, body);
  assert.deepEqual(prova.saved, []);
});

test("un errore del salvataggio: 503 «riprova» con il suo messaggio", async () => {
  prova.result = { ok: false, error: "riprova", message: "Non è riuscito. Riprova tra poco." };
  const response = await post();
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "riprova", message: "Non è riuscito. Riprova tra poco." });
});
