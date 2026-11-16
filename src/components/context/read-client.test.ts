import test from "node:test";
import assert from "node:assert/strict";
import { CONTEXT_TEXT } from "../../lib/context/text.ts";
import { ask, getJson, factUrl, type FetchLike } from "./read-client.ts";

// Le chiamate della pagina «Contesto» alle sue rotte (rilascio 9a, RILASCIO-9a-COSTRUZIONE.md §3.5, §7): che cosa
// mandano e come leggono le risposte, con una `fetch` finta. Mai un codice interno come messaggio.

const T = CONTEXT_TEXT;
const WS = "11111111-1111-4111-8111-111111111111";

type Sent = { url: string; init: RequestInit | undefined };
/** Una `fetch` finta: registra le richieste e risponde con le risposte date, in ordine. */
function fakeFetch(replies: Array<Response | Error>): { fetch: FetchLike; sent: Sent[] } {
  const sent: Sent[] = [];
  const fetch: FetchLike = async (url, init) => {
    sent.push({ url, init });
    const reply = replies.shift();
    if (!reply) throw new Error("nessuna risposta finta rimasta");
    if (reply instanceof Error) throw reply;
    return reply;
  };
  return { fetch, sent };
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, { status, headers });

// ─── «Chiedi al contesto» ────────────────────────────────────────────

test("una domanda: POST JSON alla rotta del workspace, e la risposta com'è", async () => {
  const answer = { status: "risposta", answer: "Usano SAP.", sources: [] };
  const { fetch, sent } = fakeFetch([json(answer)]);
  const result = await ask(fetch, WS, "Che gestionale usano?");
  assert.deepEqual(result, { ok: true, value: answer });
  assert.equal(sent[0].url, `/api/context/${WS}/ask`);
  assert.equal(sent[0].init?.method, "POST");
  assert.equal(JSON.parse(String(sent[0].init?.body)).question, "Che gestionale usano?");
  assert.equal(new Headers(sent[0].init?.headers).get("content-type"), "application/json");
});

test("troppe domande: l'errore porta il messaggio della rotta e i secondi da aspettare", async () => {
  const { fetch } = fakeFetch([json({ error: "limite", message: T.ask.limit }, 429, { "Retry-After": "90" })]);
  const result = await ask(fetch, WS, "Che gestionale usano?");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual([result.status, result.error, result.message, result.retryAfterSeconds], [429, "limite", T.ask.limit, 90]);
});

test("una domanda non valida: gli errori per campo; una rete che non risponde: il messaggio di «Chiedi»", async () => {
  const { fetch } = fakeFetch([json({ error: "dati_non_validi", message: "Controlla i campi indicati.", fieldErrors: { question: "Scrivi una domanda.", altro: 3 } }, 422), new TypeError("rete giù")]);
  const invalid = await ask(fetch, WS, "a");
  assert.ok(!invalid.ok);
  if (!invalid.ok) assert.deepEqual(invalid.fieldErrors, { question: "Scrivi una domanda." });
  const offline = await ask(fetch, WS, "Che gestionale usano?");
  assert.deepEqual(offline, { ok: false, status: 0, error: "rete", message: T.ask.failed, fieldErrors: {}, retryAfterSeconds: null });
});

test("un errore senza frase (un codice, una pagina HTML): il messaggio di riserva, mai il codice", async () => {
  const { fetch } = fakeFetch([json({ error: "riprova" }, 503), new Response("<html>errore</html>", { status: 502 })]);
  for (let i = 0; i < 2; i += 1) {
    const result = await ask(fetch, WS, "Che gestionale usano?");
    assert.ok(!result.ok);
    if (!result.ok) assert.equal(result.message, T.ask.failed);
  }
});

test("un'interruzione (una domanda nuova prende il posto della vecchia) arriva a chi chiama, non diventa un errore", async () => {
  const abort = Object.assign(new Error("interrotta"), { name: "AbortError" });
  const { fetch } = fakeFetch([abort]);
  await assert.rejects(ask(fetch, WS, "Che gestionale usano?", new AbortController().signal), { name: "AbortError" });
});

// ─── Pannelli ────────────────────────────────────────────────────────

test("il pannello di un fatto: GET sull'indirizzo del fatto; 404 con il messaggio della rotta", async () => {
  const { fetch, sent } = fakeFetch([json({ id: "f1" }), json({ error: "non_trovato", message: "Non trovato." }, 404)]);
  assert.deepEqual(await getJson(fetch, factUrl(WS, "f1")), { ok: true, value: { id: "f1" } });
  assert.equal(sent[0].url, `/api/context/${WS}/facts/f1`);
  assert.equal(sent[0].init?.method, "GET");
  const missing = await getJson(fetch, factUrl(WS, "f2"));
  assert.ok(!missing.ok);
  if (!missing.ok) assert.deepEqual([missing.status, missing.message], [404, "Non trovato."]);
});
