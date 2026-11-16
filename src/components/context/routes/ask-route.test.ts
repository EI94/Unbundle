import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installAppModules } from "../../../lib/ai/claude-test-kit.ts";

// `POST /api/context/[workspaceId]/ask` (rilascio 9a, RILASCIO-9a-COSTRUZIONE.md §3.5, §11.3): «Chiedi al contesto»
// per chi apre la pagina. La risposta con le fonti, «non lo sappiamo», i soli brani senza l'ok, 429 con `Retry-After`
// oltre il limite, 422 per una domanda non valida, 503 se il modello non risponde. Chi chiama e la domanda sono finti
// (le prove con il database e il Claude finto sono in routes.integration.test.ts).

type Prova = {
  actor: { ok: true; actor: Record<string, unknown> } | { ok: false; status: 401 | 404 };
  ready: boolean;
  result: unknown;
  asked: Array<{ actor: unknown; question: unknown }>;
};
const prova: Prova = { actor: { ok: false, status: 401 }, ready: true, result: null, asked: [] };
(globalThis as { __prova?: Prova }).__prova = prova;

await installAppModules({
  "@/lib/context/server/actor": `export async function contextActorFromSession() { return globalThis.__prova.actor; }`,
  "@/lib/db/queries/context-store": `export async function contextStoreReady() { return globalThis.__prova.ready; }`,
  "@/lib/db/queries/context-ask": `export async function askContext(actor, question) { globalThis.__prova.asked.push({ actor, question }); return globalThis.__prova.result; }`,
});
const route = await import("../../../app/api/context/[workspaceId]/ask/route.ts");

const WS = "11111111-1111-4111-8111-111111111111";
const actorAs = (role: string, isLateralSpace: boolean) => ({ ok: true as const, actor: { workspaceId: WS, userId: "u", role, isLateralSpace, channel: "web" } });
const post = (body: unknown = { question: "Che gestionale usano?" }) =>
  route.POST(
    new Request(`https://unbundle.test/api/context/${WS}/ask`, { method: "POST", headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }),
    { params: Promise.resolve({ workspaceId: WS }) },
  );

const SOURCES = [{ n: 1, kind: "fatto", label: "Call 14 nov", date: "2026-11-14", excerpt: "Il gestionale è SAP Business One." }];

beforeEach(() => {
  Object.assign(prova, { actor: actorAs("contributor", false), ready: true, result: { ok: true, value: { status: "risposta", answer: "Usano SAP Business One.", sources: SOURCES } }, asked: [] });
});

test("la rotta è una funzione Node, mai in cache, con 60 secondi (la chiamata al modello ne ha 40)", () => {
  assert.deepEqual([route.runtime, route.dynamic, route.maxDuration], ["nodejs", "force-dynamic", 60]);
});

test("senza sessione 401; senza accesso o con solo un corso 404; archivio non pronto 503: nessuna domanda parte", async () => {
  for (const [actor, ready, status] of [
    [{ ok: false, status: 401 }, true, 401],
    [{ ok: false, status: 404 }, true, 404],
    [actorAs("learner", false), true, 404],
    [actorAs("analyst", false), false, 503],
  ] as const) {
    prova.actor = actor;
    prova.ready = ready;
    const response = await post();
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.deepEqual(prova.asked, []);
});

test("una risposta con le sue fonti: 200, la domanda arriva com'è a chi risponde, per chi chiama", async () => {
  const response = await post({ question: "  Che gestionale usano?  " });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { status: "risposta", answer: "Usano SAP Business One.", sources: SOURCES });
  assert.equal(prova.asked.length, 1);
  assert.equal((prova.asked[0].actor as { workspaceId: string }).workspaceId, WS);
  assert.equal(prova.asked[0].question, "  Che gestionale usano?  ");
});

test("«non lo sappiamo», i soli brani senza l'ok, niente trovato: 200 con l'esito com'è", async () => {
  for (const value of [{ status: "non_so", sources: SOURCES }, { status: "solo_ricerca", sources: SOURCES }, { status: "niente" }]) {
    prova.result = { ok: true, value };
    const response = await post();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), value);
  }
});

test("troppe domande: 429 con il messaggio e Retry-After in secondi interi", async () => {
  for (const [seconds, header] of [
    [125, "125"],
    [0.2, "1"],
    [Number.NaN, "60"],
  ] as const) {
    prova.result = { ok: true, value: { status: "limite", retryAfterSeconds: seconds } };
    const response = await post();
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), header);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { error: "limite", message: "Troppe domande in poco tempo. Riprova tra qualche minuto." });
  }
});

test("una domanda non valida: 422 con il messaggio per il campo; il modello che non risponde: 503", async () => {
  prova.result = { ok: false, error: "dati_non_validi", message: "Controlla i campi indicati.", fieldErrors: { question: "Scrivi una domanda." } };
  let response = await post({ question: "ab" });
  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), { error: "dati_non_validi", message: "Controlla i campi indicati.", fieldErrors: { question: "Scrivi una domanda." } });
  prova.result = { ok: false, error: "riprova", message: "Non è riuscito. Riprova tra poco." };
  response = await post();
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "riprova", message: "Non è riuscito. Riprova tra poco." });
});

test("un corpo che non è JSON, o non è un oggetto: 422 e nessuna domanda parte", async () => {
  for (const body of ["non json", "[1,2]", "null"]) {
    const response = await post(body);
    assert.equal(response.status, 422, body);
  }
  assert.deepEqual(prova.asked, []);
  // Una domanda che non è testo arriva vuota: la scarta la funzione condivisa.
  await post({ question: 42 });
  const asked: Prova["asked"] = prova.asked;
  assert.equal(asked[0].question, "");
});
