import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  CLAUDE_CLIENT_ORIGINS,
  DEFAULT_TOKEN_PREFIXES,
  findTokenInUrl,
  hygieneError,
  isJsonContentType,
  isOriginAllowed,
  loggableOrigin,
  MCP_BODY_MAX_BYTES,
  methodNotAllowed,
  normalizeAllowedOrigins,
  normalizeOrigin,
  readJsonBodyLimited,
  readMcpJsonBody,
  screenMcpRequest,
  withHygieneHeaders,
} from "./http-hygiene.ts";

// Prompt WP4 (igiene HTTP) e WP10. Token finti, generati a ogni esecuzione.

const [WORKSPACE_PREFIX, TEAM_PREFIX] = DEFAULT_TOKEN_PREFIXES;
const fakeToken = (prefix = WORKSPACE_PREFIX) => `${prefix}${randomBytes(32).toString("base64url")}`;
const BASE = "https://www.theunbundle.com/api/mcp/connettore/prova-a";

function post(url: string, init: { headers?: Record<string, string>; body?: BodyInit | null; method?: string } = {}) {
  return new Request(url, {
    method: init.method ?? "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...init.headers },
    body: init.body === undefined ? JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) : init.body,
  });
}

/** Corpo a blocchi, senza content-length: il limite si deve vedere leggendo. */
function streamOf(bytes: number, chunk = 16 * 1024) {
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= bytes) return controller.close();
      const size = Math.min(chunk, bytes - sent);
      sent += size;
      controller.enqueue(new Uint8Array(size).fill(0x20));
    },
  });
}

test("ogni risposta ha no-store e nosniff, e l'errore è solo { error }", async () => {
  const response = hygieneError("origin_not_allowed");
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(await response.json(), { error: "origin_not_allowed" });

  const allow = methodNotAllowed(["POST"]);
  assert.equal(allow.status, 405);
  assert.equal(allow.headers.get("allow"), "POST");

  const wrapped = withHygieneHeaders(new Response("{}", { status: 200, headers: { "content-type": "application/json", "mcp-session-id": "x" } }));
  assert.equal(wrapped.status, 200);
  assert.equal(wrapped.headers.get("cache-control"), "no-store");
  assert.equal(wrapped.headers.get("x-content-type-options"), "nosniff");
  assert.equal(wrapped.headers.get("mcp-session-id"), "x");
  assert.equal(await wrapped.text(), "{}");
});

test("token nell'indirizzo: nomi da credenziale, valori con prefisso, percorso, senza maiuscole", () => {
  const token = fakeToken();
  const team = fakeToken(TEAM_PREFIX);
  for (const url of [
    `${BASE}?token=abc`,
    `${BASE}?apiKey=abc`,
    `${BASE}?APIKEY=abc`,
    `${BASE}?api_key=abc`,
    `${BASE}?access_token=abc`,
    `${BASE}?Key=`,
    `${BASE}?authorization=abc`,
  ]) {
    assert.equal(findTokenInUrl(url).found, true, url.slice(BASE.length));
  }
  assert.deepEqual(findTokenInUrl(`${BASE}?q=${token}`), { found: true, candidates: [token] });
  assert.deepEqual(findTokenInUrl(`${BASE}?auth=${encodeURIComponent(`Bearer ${token}`)}`), { found: true, candidates: [token] });
  assert.deepEqual(findTokenInUrl(`https://www.theunbundle.com/api/mcp/connettore/${token}`), { found: true, candidates: [token] });
  assert.deepEqual(findTokenInUrl(`${BASE}/${encodeURIComponent(token)}`), { found: true, candidates: [token] });
  assert.deepEqual(findTokenInUrl(`${BASE}?${token}`), { found: true, candidates: [token] });
  assert.deepEqual(findTokenInUrl(`${BASE}?x=${team}`), { found: true, candidates: [team] });
  // Due volte lo stesso token: un solo candidato.
  assert.deepEqual(findTokenInUrl(`${BASE}?a=${token}&b=${token}`).candidates, [token]);
  // Il solo prefisso, troppo corto per essere un token, basta a rifiutare.
  assert.deepEqual(findTokenInUrl(`${BASE}?x=${WORKSPACE_PREFIX}`), { found: true, candidates: [] });
});

test("token nell'indirizzo: nessun falso positivo sugli indirizzi normali", () => {
  for (const url of [BASE, `${BASE}?`, `${BASE}?q=verbali`, `${BASE}?lang=it&page=2`, "https://www.theunbundle.com/api/mcp/use-case", "http://127.0.0.1:53130/api/mcp/connettore/prova-a"]) {
    assert.deepEqual(findTokenInUrl(url), { found: false, candidates: [] }, url);
  }
  assert.deepEqual(findTokenInUrl("non un indirizzo"), { found: false, candidates: [] });
});

test("token nell'indirizzo: nomi e prefissi sono parametri", () => {
  const custom = `zz_${randomBytes(16).toString("hex")}`;
  assert.deepEqual(findTokenInUrl(`${BASE}?q=${custom}`, { tokenPrefixes: ["zz_"] }), { found: true, candidates: [custom] });
  assert.equal(findTokenInUrl(`${BASE}?secret=1`, { paramNames: ["secret"] }).found, true);
  assert.equal(findTokenInUrl(`${BASE}?token=1`, { paramNames: ["secret"] }).found, false);
});

test("Origin: assente passa; presente solo se nell'elenco; elenco vuoto rifiuta ogni Origin", () => {
  assert.equal(isOriginAllowed(null, []), true);
  assert.equal(isOriginAllowed("https://claude.ai", []), false);
  assert.equal(isOriginAllowed("", ["https://claude.ai"]), false);
  assert.equal(isOriginAllowed("null", ["https://claude.ai"]), false);
  assert.equal(isOriginAllowed("https://claude.ai", ["https://claude.ai"]), true);
  assert.equal(isOriginAllowed("https://CLAUDE.ai", ["https://claude.ai/"]), true);
  assert.equal(isOriginAllowed("https://claude.ai:443", ["https://claude.ai"]), true);
  assert.equal(isOriginAllowed("http://claude.ai", ["https://claude.ai"]), false);
  assert.equal(isOriginAllowed("https://evil.claude.ai.example", ["https://claude.ai"]), false);
  assert.equal(isOriginAllowed("https://claude.ai", ["claude.ai", "https://claude.ai/path", 42 as unknown as string]), false);

  assert.equal(normalizeOrigin("https://Example.test:8443/"), "https://example.test:8443");
  assert.equal(normalizeOrigin("ftp://example.test"), null);
  assert.equal(normalizeOrigin("https://user:pw@example.test"), null);
  assert.deepEqual(normalizeAllowedOrigins(["https://a.test", "https://a.test/", "nope", null, "http://b.test:80"]), ["https://a.test", "http://b.test"]);
  assert.deepEqual(normalizeAllowedOrigins("https://a.test"), []);
});

test("Origin nel log: assente null; un'origine conosciuta normalizzata; ogni altra «other», mai il nome di host", () => {
  const known = [...CLAUDE_CLIENT_ORIGINS, "https://intranet.esempio.test"];
  assert.equal(loggableOrigin(null, known), null);
  assert.equal(loggableOrigin(undefined, known), null);
  for (const origin of CLAUDE_CLIENT_ORIGINS) assert.equal(loggableOrigin(origin, known), origin);
  assert.equal(loggableOrigin("HTTPS://Claude.AI:443/", known), "https://claude.ai");
  assert.equal(loggableOrigin("https://intranet.esempio.test", known), "https://intranet.esempio.test", "origine ammessa dal workspace");
  // Scritte dal client: sottodomini, domini simili, valori non validi, vuoti o «null».
  for (const header of ["https://persona-inventata.esempio.test", "https://x.claude.ai", "https://claude.ai.esempio.test", "http://claude.ai", "null", "", "Mario Rossi", "https://claude.ai/percorso"]) {
    assert.equal(loggableOrigin(header, known), "other", header);
  }
  // Nessuna origine è conosciuta senza elenco.
  assert.equal(loggableOrigin("https://claude.ai", []), "other");
});

test("Content-Type: solo application/json, anche con charset", () => {
  assert.equal(isJsonContentType("application/json"), true);
  assert.equal(isJsonContentType("Application/JSON; charset=utf-8"), true);
  for (const value of [null, "", "text/plain", "application/json-patch+json", "multipart/form-data", "text/event-stream"]) {
    assert.equal(isJsonContentType(value), false, String(value));
  }
});

test("corpo: 256 KB al massimo, letto a blocchi anche senza content-length", async () => {
  const ok = await readJsonBodyLimited(post(BASE));
  assert.deepEqual(ok, { ok: true, value: { jsonrpc: "2.0", id: 1, method: "tools/list" } });

  const declared = await readJsonBodyLimited(post(BASE, { headers: { "content-length": String(MCP_BODY_MAX_BYTES + 1) } }));
  assert.deepEqual(declared, { ok: false, code: "payload_too_large" });

  const streamed = new Request(BASE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: streamOf(MCP_BODY_MAX_BYTES + 10),
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  assert.deepEqual(await readJsonBodyLimited(streamed), { ok: false, code: "payload_too_large" });

  const exact = JSON.stringify({ pad: "x".repeat(MCP_BODY_MAX_BYTES - 10) });
  assert.equal(Buffer.byteLength(exact), MCP_BODY_MAX_BYTES);
  assert.equal((await readJsonBodyLimited(post(BASE, { body: exact }))).ok, true);

  assert.deepEqual(await readJsonBodyLimited(post(BASE, { body: "{ non json" })), { ok: false, code: "invalid_json" });
  assert.deepEqual(await readJsonBodyLimited(post(BASE, { body: new Uint8Array([0x7b, 0xff, 0x7d]) })), { ok: false, code: "invalid_json" });
  assert.deepEqual(await readJsonBodyLimited(post(BASE, { body: null })), { ok: false, code: "invalid_json" });
  assert.deepEqual(await readJsonBodyLimited(post(BASE, { headers: { "content-type": "text/plain" } })), { ok: false, code: "unsupported_media_type" });

  const tooBig = await readMcpJsonBody(post(BASE, { headers: { "content-length": "abc" } }));
  assert.equal(tooBig.ok, false);
  if (!tooBig.ok) {
    assert.equal(tooBig.response.status, 413);
    assert.deepEqual(await tooBig.response.json(), { error: "payload_too_large" });
  }
});

test("screenMcpRequest: token nell'indirizzo prima di tutto, poi metodo, Origin, Content-Type, lunghezza", async () => {
  const token = fakeToken();
  const leaked = screenMcpRequest(post(`${BASE}?token=${token}`, { method: "GET", body: null, headers: { origin: "https://evil.test" } }), { allowedOrigins: [] });
  assert.equal(leaked.ok, false);
  if (!leaked.ok) {
    assert.equal(leaked.code, "token_in_url");
    assert.deepEqual(leaked.exposedTokens, [token]);
    assert.equal(leaked.response.status, 400);
    const text = await leaked.response.text();
    assert.equal(text, JSON.stringify({ error: "token_in_url" }));
    assert.equal(text.includes(token), false);
  }

  const cases: Array<[Request, string, number]> = [
    [post(BASE, { method: "GET", body: null }), "method_not_allowed", 405],
    [post(BASE, { method: "DELETE", body: null }), "method_not_allowed", 405],
    [post(BASE, { headers: { origin: "https://evil.test" } }), "origin_not_allowed", 403],
    [post(BASE, { headers: { "content-type": "text/plain" } }), "unsupported_media_type", 415],
    [post(BASE, { headers: { "content-length": String(MCP_BODY_MAX_BYTES * 2) } }), "payload_too_large", 413],
  ];
  for (const [request, code, status] of cases) {
    const result = screenMcpRequest(request, { allowedOrigins: ["https://claude.ai"] });
    assert.equal(result.ok, false, code);
    if (!result.ok) {
      assert.equal(result.code, code);
      assert.equal(result.response.status, status);
      assert.deepEqual(result.exposedTokens, []);
    }
  }
  const get = screenMcpRequest(post(BASE, { method: "GET", body: null }), { allowedOrigins: [] });
  assert.equal(!get.ok && get.response.headers.get("allow"), "POST");

  assert.deepEqual(screenMcpRequest(post(BASE), { allowedOrigins: [] }), { ok: true });
  assert.deepEqual(screenMcpRequest(post(BASE, { headers: { origin: "https://claude.ai" } }), { allowedOrigins: ["https://claude.ai"] }), { ok: true });
  // L'Accept con text/event-stream (richiesto dall'SDK) non si rifiuta mai qui.
  assert.deepEqual(screenMcpRequest(post(BASE, { headers: { accept: "text/event-stream" } }), { allowedOrigins: [] }), { ok: true });
});
