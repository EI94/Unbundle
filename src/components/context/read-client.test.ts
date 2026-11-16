import test from "node:test";
import assert from "node:assert/strict";
import { CONTEXT_TEXT } from "../../lib/context/text.ts";
import { ask, getJson, factUrl, READ_CALLS_MAX, readPending, readUntilDone, saveNote, uploadDocument, type FetchLike } from "./read-client.ts";

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

// ─── Appunti e lettura ───────────────────────────────────────────────

const NOTE = { title: " Call di avvio ", occurredOn: "2026-11-14", body: "Il gestionale è SAP Business One.\nGli ordini a mano.", participants: "  ", link: " https://esempio.test/n " };

test("«Aggiungi»: POST degli appunti, con i campi puliti e i facoltativi vuoti a null", async () => {
  const { fetch, sent } = fakeFetch([json({ sourceId: "s1", created: true, readStatus: "da_leggere" })]);
  const result = await saveNote(fetch, WS, NOTE);
  assert.deepEqual(result, { ok: true, value: { sourceId: "s1", created: true, readStatus: "da_leggere" } });
  assert.equal(sent[0].url, `/api/context/${WS}/sources`);
  assert.deepEqual(JSON.parse(String(sent[0].init?.body)), { title: "Call di avvio", occurredOn: "2026-11-14", body: NOTE.body, participants: null, link: "https://esempio.test/n" });
});

test("«Aggiungi» fermato dal controllo: 422 con il messaggio per il campo", async () => {
  const message = "Negli appunti ci sono dati sanitari («visita medica»). Toglili e riprova.";
  const { fetch } = fakeFetch([json({ error: "dati_non_validi", message: "Controlla i campi indicati.", fieldErrors: { body: message } }, 422)]);
  const result = await saveNote(fetch, WS, NOTE);
  assert.ok(!result.ok);
  if (!result.ok) assert.deepEqual([result.status, result.fieldErrors], [422, { body: message }]);
});

const reading = (outcome: unknown, status = 200) => json(status === 200 ? { outcome } : outcome, status);

test("la lettura di un appunto lungo: si richiama finché la rotta risponde «in corso», e «Rileggi» vale solo per la prima richiesta", async () => {
  const { fetch, sent } = fakeFetch([
    reading({ status: "in_corso", partsRead: 1, partsTotal: 3 }),
    reading({ status: "in_corso", partsRead: 2, partsTotal: 3 }),
    reading({ status: "letto", proposals: 7, skipped: {} }),
  ]);
  const parts: Array<[number, number]> = [];
  const result = await readUntilDone(fetch, WS, "s1", { again: true, onPart: (p) => parts.push([p.partsRead, p.partsTotal]) });
  assert.deepEqual(result, { ok: true, outcome: { status: "letto", proposals: 7, skipped: {} } });
  assert.deepEqual(parts, [
    [1, 3],
    [2, 3],
  ]);
  assert.deepEqual(sent.map((r) => r.url), Array(3).fill(`/api/context/${WS}/sources/s1/read`));
  assert.deepEqual(sent.map((r) => JSON.parse(String(r.init?.body))), [{ again: true }, {}, {}]);
});

test("la lettura che non finisce: dopo il massimo delle richieste si ferma, a metà, senza girare per sempre", async () => {
  const replies = Array.from({ length: READ_CALLS_MAX + 2 }, () => reading({ status: "in_corso", partsRead: 1, partsTotal: 3 }));
  const { fetch, sent } = fakeFetch(replies);
  const result = await readUntilDone(fetch, WS, "s1");
  assert.equal(sent.length, READ_CALLS_MAX);
  assert.deepEqual(result, { ok: true, outcome: { status: "in_corso", partsRead: 1, partsTotal: 3 } });
});

test("la lettura: un errore della rotta, una risposta senza esito, la rete giù", async () => {
  const { fetch } = fakeFetch([json({ error: "non_trovato", message: "Non trovato." }, 404), json({ niente: true }), new TypeError("rete giù")]);
  const missing = await readUntilDone(fetch, WS, "s1");
  assert.ok(!missing.ok);
  if (!missing.ok) assert.deepEqual([missing.status, missing.message], [404, "Non trovato."]);
  const odd = await readUntilDone(fetch, WS, "s1");
  assert.ok(!odd.ok);
  if (!odd.ok) assert.equal(odd.message, T.read.failed);
  const offline = await readUntilDone(fetch, WS, "s1");
  assert.ok(!offline.ok);
  if (!offline.ok) assert.deepEqual([offline.status, offline.message], [0, T.read.failed]);
});

test("gli appunti in attesa, uno alla volta: i problemi di uno non fermano gli altri; il progresso «1 di 3»", async () => {
  const { fetch, sent } = fakeFetch([
    reading({ status: "rifiuto" }),
    reading({ error: "non_trovato", message: "Non trovato." }, 404),
    reading({ status: "in_corso", partsRead: 1, partsTotal: 2 }),
    reading({ status: "letto", proposals: 2, skipped: {} }),
    reading({ status: "in_lettura" }),
    reading({ status: "letto", proposals: 0, skipped: {} }),
  ]);
  const progress: Array<[number, number]> = [];
  const run = await readPending(fetch, WS, ["a", "b", "c", "d", "e"], { onProgress: (i, n) => progress.push([i, n]) });
  assert.deepEqual(run, { read: 2, stoppedBy: null });
  assert.deepEqual(progress, [
    [1, 5],
    [2, 5],
    [3, 5],
    [4, 5],
    [5, 5],
  ]);
  assert.deepEqual(
    sent.map((r) => r.url.split("/").at(-2)),
    ["a", "b", "c", "c", "d", "e"],
  );
});

test("gli appunti in attesa: ci si ferma senza l'ok, al limite del giorno, senza sessione, con la rotta giù", async () => {
  for (const [reply, stoppedBy] of [
    [reading({ status: "ok_mancante" }), "ok_mancante"],
    [reading({ status: "limite" }), "limite"],
    [reading({ error: "non_autenticato", message: "Non hai i permessi per farlo." }, 401), "sessione"],
    [reading({ error: "area_spenta", message: "Il contesto si sta preparando." }, 503), "errore"],
  ] as const) {
    const { fetch, sent } = fakeFetch([reply, reading({ status: "letto", proposals: 1, skipped: {} })]);
    assert.deepEqual(await readPending(fetch, WS, ["a", "b"]), { read: 0, stoppedBy });
    assert.equal(sent.length, 1, `${stoppedBy}: il secondo appunto non si legge`);
  }
});

// ─── Documenti ───────────────────────────────────────────────────────

test("un documento da «Aggiungi appunti»: multipart con file, workspace, origine e i campi facoltativi solo se ci sono", async () => {
  const uploaded = { id: "d1", sourceId: "s9", fileName: "verbale.docx", summary: "", textRead: true, ai: "non_serve" };
  const { fetch, sent } = fakeFetch([json(uploaded)]);
  const file = new File([new Uint8Array([80, 75, 3, 4])], "verbale.docx");
  const result = await uploadDocument(fetch, { workspaceId: WS, file, origine: "appunti", occurredOn: "2026-11-14", title: "Verbale", participants: " ", link: "" });
  assert.deepEqual(result, { ok: true, value: uploaded });
  assert.equal(sent[0].url, "/api/documents/upload");
  const form = sent[0].init?.body as FormData;
  assert.ok(form instanceof FormData);
  assert.deepEqual(
    [...form.keys()].sort(),
    ["data", "file", "origine", "titolo", "workspaceId"],
  );
  assert.deepEqual([form.get("workspaceId"), form.get("origine"), form.get("data"), form.get("titolo")], [WS, "appunti", "2026-11-14", "Verbale"]);
  assert.equal(new Headers(sent[0].init?.headers).get("content-type"), null, "il confine del multipart lo mette il browser");
});

test("un documento rifiutato: il messaggio della rotta; una risposta senza la fonte: riprova", async () => {
  const { fetch } = fakeFetch([json({ error: "File troppo grande: al massimo 4 MB." }, 400), json({ id: "d1", fileName: "a.pdf" })]);
  const file = new File([new Uint8Array([37, 80, 68, 70])], "a.pdf");
  const tooBig = await uploadDocument(fetch, { workspaceId: WS, file, origine: "chat" });
  assert.ok(!tooBig.ok);
  if (!tooBig.ok) assert.deepEqual([tooBig.status, tooBig.message], [400, "File troppo grande: al massimo 4 MB."]);
  const noSource = await uploadDocument(fetch, { workspaceId: WS, file, origine: "chat" });
  assert.ok(!noSource.ok);
  if (!noSource.ok) assert.equal(noSource.message, T.errors.retry);
});
