import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { startFakeGranola, type FakeGranola } from "./fake-granola.ts";
import { callGranolaTool, GranolaMcpError, GRANOLA_READ_TOOLS, openGranolaSession, type GranolaMcpDeps, type GranolaReadTool } from "./mcp-client.ts";

// Il client MCP di Granola, contro il server finto su 127.0.0.1 (RILASCIO-9a-COSTRUZIONE.md §8.4, §11.5).

let fake: FakeGranola;
let deps: GranolaMcpDeps;
/** Ogni richiesta del client passa da qui: solo 127.0.0.1. */
const seen: string[] = [];

before(async () => {
  fake = await startFakeGranola({
    meetings: [
      { id: "m-1", title: "Avvio", meetingAt: "2026-11-14T09:00:00Z", updatedAt: "2026-11-14T10:00:00Z", participants: "Giulia (giulia@nardi.test)", summary: "Sintesi breve.", transcript: "Parla il direttore." },
    ],
  });
  deps = {
    endpoints: fake.endpoints,
    fetch: (input, init) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      seen.push(url.host);
      assert.equal(url.hostname, "127.0.0.1");
      return fetch(input, init);
    },
  };
});

after(async () => {
  await fake.close();
  assert.ok(seen.length > 0 && seen.every((host) => host.startsWith("127.0.0.1:")));
});

const expectCode = async (promise: Promise<unknown>, code: string, extra: Partial<GranolaMcpError> = {}) => {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof GranolaMcpError, String(error));
    assert.equal(error.code, code);
    assert.equal(error.message, `granola_${code}`, "il messaggio è il codice, mai il testo del server");
    for (const [key, value] of Object.entries(extra)) assert.deepEqual((error as unknown as Record<string, unknown>)[key], value, key);
    return true;
  });
};

test("risposta JSON: initialize, poi la notifica, poi tools/call con il testo del risultato", async () => {
  fake.sse = false;
  fake.mcpRequests.length = 0;
  const session = await openGranolaSession(fake.grant().access_token, deps);
  assert.equal(session.protocolVersion, "2025-06-18");
  assert.ok(session.sessionId, "il server ha dato un Mcp-Session-Id");
  const text = await callGranolaTool(session, "get_account_info", {}, deps);
  assert.deepEqual(JSON.parse(text), { email: "paola@ls.test", plan: "Business" });
  // MCP-Protocol-Version e Mcp-Session-Id solo dopo initialize.
  assert.deepEqual(
    fake.mcpRequests.map((r) => [r.method, r.protocolVersion, r.sessionId === session.sessionId ? "sessione" : r.sessionId]),
    [
      ["initialize", null, null],
      ["notifications/initialized", "2025-06-18", "sessione"],
      ["tools/call", "2025-06-18", "sessione"],
    ],
  );
});

test("risposta SSE: le notifiche del server si ignorano, conta il messaggio con lo stesso id", async () => {
  fake.sse = true;
  try {
    const session = await openGranolaSession(fake.grant().access_token, deps);
    const text = await callGranolaTool(session, "search_meetings", { limit: 100 }, deps);
    assert.match(text, /<meeting id="m-1"/);
    assert.equal(session.nextId, 3, "initialize e una chiamata");
  } finally {
    fake.sse = false;
  }
});

test("senza un token valido: 401 → non_autorizzato, che non si riprova", async () => {
  await expectCode(openGranolaSession("token-che-non-esiste", deps), "non_autorizzato", { retryable: false });
  const session = await openGranolaSession(fake.grant().access_token, deps);
  fake.expireAccessTokens();
  await expectCode(callGranolaTool(session, "get_meetings", { meeting_ids: ["m-1"] }, deps), "non_autorizzato");
});

test("rate_limit → limite, con i secondi da aspettare e se si può riprovare", async () => {
  const session = await openGranolaSession(fake.grant().access_token, deps);
  fake.rateLimits.push({ tool: "search_meetings", seconds: 12 });
  await expectCode(callGranolaTool(session, "search_meetings", {}, deps), "limite", { retryAfterSeconds: 12, retryable: true });
  fake.rateLimits.push({ tool: "*", seconds: 90, retryable: false });
  await expectCode(callGranolaTool(session, "get_meetings", { meeting_ids: ["m-1"] }, deps), "limite", { retryAfterSeconds: 90, retryable: false });
  // Poi risponde di nuovo.
  assert.match(await callGranolaTool(session, "get_meetings", { meeting_ids: ["m-1"] }, deps), /<summary>/);
});

test("il piano a pagamento → piano; un errore 500 → rete; il tempo scaduto → tempo", async () => {
  const session = await openGranolaSession(fake.grant().access_token, deps);
  fake.account.plan = "Free";
  try {
    await expectCode(callGranolaTool(session, "get_meeting_transcript", { meeting_id: "m-1" }, deps), "piano", { retryable: false });
  } finally {
    fake.account.plan = "Business";
  }
  fake.failures.push("list_meeting_folders");
  await expectCode(callGranolaTool(session, "list_meeting_folders", {}, deps), "rete", { retryable: true });
  fake.mcpDelayMs = 300;
  try {
    await expectCode(callGranolaTool(session, "get_account_info", {}, { ...deps, timeoutMs: 50 }), "tempo");
  } finally {
    fake.mcpDelayMs = 0;
  }
});

test("uno strumento che scrive lancia prima di ogni richiesta; i cinque di lettura sono quelli del piano", async () => {
  assert.deepEqual([...GRANOLA_READ_TOOLS], ["search_meetings", "get_meetings", "list_meeting_folders", "get_account_info", "get_meeting_transcript"]);
  const session = await openGranolaSession(fake.grant().access_token, deps);
  const before = { calls: fake.toolCalls.length, requests: fake.mcpRequests.length, nextId: session.nextId };
  // Il nome si compone a pezzi: gli strumenti che scrivono non compaiono nel codice.
  for (const forbidden of [["update", "private", "notes"], ["create", "folder"], ["sign", "out"], ["search", "meetings", "x"]]) {
    await expectCode(callGranolaTool(session, forbidden.join("_") as GranolaReadTool, {}, deps), "strumento_vietato", { retryable: false });
  }
  assert.deepEqual({ calls: fake.toolCalls.length, requests: fake.mcpRequests.length, nextId: session.nextId }, before, "nessuna richiesta è partita");
});

test("oltre 2 MB la risposta si ferma (protocollo); con un tetto più basso, lo stesso", async () => {
  const session = await openGranolaSession(fake.grant().access_token, deps);
  const big = { id: "m-grande", title: "Lunga", meetingAt: "2026-11-13T09:00:00Z", updatedAt: "2026-11-13T09:00:00Z", participants: "", summary: "x".repeat(2 * 1024 * 1024 + 10) };
  fake.meetings.push(big);
  try {
    await expectCode(callGranolaTool(session, "get_meetings", { meeting_ids: ["m-grande"] }, deps), "protocollo");
    fake.sse = true;
    await expectCode(callGranolaTool(session, "get_meetings", { meeting_ids: ["m-grande"] }, deps), "protocollo");
  } finally {
    fake.sse = false;
    fake.meetings.pop();
  }
  await expectCode(callGranolaTool(session, "get_meetings", { meeting_ids: ["m-1"] }, { ...deps, maxBytes: 200 }), "protocollo");
});

test("una richiesta che non arriva (rete) e un server che risponde altro (protocollo)", async () => {
  const session = await openGranolaSession(fake.grant().access_token, deps);
  const offline: GranolaMcpDeps = { ...deps, fetch: async () => Promise.reject(new TypeError("fetch failed")) };
  await expectCode(callGranolaTool(session, "get_account_info", {}, offline), "rete");
  const html: GranolaMcpDeps = { ...deps, fetch: async () => new Response("<html>ciao</html>", { status: 200, headers: { "Content-Type": "text/html" } }) };
  await expectCode(callGranolaTool(session, "get_account_info", {}, html), "protocollo");
  const unknownMethod: GranolaMcpDeps = { ...deps, fetch: async () => Response.json({ jsonrpc: "2.0", id: 99, result: {} }) };
  await expectCode(callGranolaTool(session, "get_account_info", {}, unknownMethod), "protocollo", {});
});
