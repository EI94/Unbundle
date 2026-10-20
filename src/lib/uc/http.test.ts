import test from "node:test";
import assert from "node:assert/strict";
import {
  PUBLIC_BATCH_BODY_MAX_BYTES,
  PUBLIC_BODY_MAX_BYTES,
  PUBLIC_HEADERS,
  RATE_LIMITS,
  clientIp,
  deviceFromUserAgent,
  firstExceeded,
  invalidLinkResponse,
  ipRateLimitRule,
  publicCallEnv,
  publicData,
  publicError,
  publicOriginAllowed,
  publicStatusFor,
  publicWritesAvailable,
  readPublicJson,
  requestIpHash,
  requestUserAgent,
  retryAfter,
  tokenRateLimitRule,
} from "./http.ts";
import { INVALID_LINK_MESSAGE } from "./public-view.ts";

const headers = (h: Record<string, string>) => new Headers(h);
const SECRET = "c2VncmV0by1kaS1wcm92YS1zb2xvLXBlci1pLXRlc3QtMDEyMzQ1Njc4OQ==";
const TOKEN_ID = "0b7c2f3e-6d1a-4c55-9a0e-1f2d3c4b5a69";

function jsonRequest(body: BodyInit | null, h: Record<string, string> = {}): Request {
  return new Request("https://app.test/api/r/x", { method: "POST", body, headers: { "content-type": "application/json", ...h } });
}

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
}

test("origin: same host or the configured public address, never missing, opaque or non-http", () => {
  assert.equal(publicOriginAllowed(headers({ origin: "https://app.test", host: "app.test" })), true);
  // Behind the proxy the internal protocol can be http: the host decides.
  assert.equal(publicOriginAllowed(headers({ origin: "http://127.0.0.1:53110", host: "127.0.0.1:53110" })), true);
  assert.equal(publicOriginAllowed(headers({ origin: "https://evil.test", host: "app.test" })), false);
  assert.equal(publicOriginAllowed(headers({ host: "app.test" })), false, "a write without Origin is refused");
  assert.equal(publicOriginAllowed(headers({ origin: "null", host: "app.test" })), false);
  assert.equal(publicOriginAllowed(headers({ origin: "ftp://app.test", host: "app.test" })), false);
  assert.equal(publicOriginAllowed(headers({ origin: "not a url", host: "app.test" })), false);
  assert.equal(publicOriginAllowed(headers({ origin: "https://www.app.test", host: "internal.vercel.test" }), "www.app.test"), true);
  assert.equal(publicOriginAllowed(headers({ origin: "https://www.app.test", host: "internal.vercel.test" }), "https://www.app.test/"), true);
  assert.equal(publicOriginAllowed(headers({ origin: "https://other.test", host: "internal.vercel.test" }), "www.app.test"), false);
  assert.equal(publicOriginAllowed(headers({ origin: "https://app.test.evil.test", host: "app.test" })), false);
});

test("body: JSON only, at most 256 KB even with a lying content-length, valid UTF-8", async () => {
  assert.deepEqual(await readPublicJson(jsonRequest(JSON.stringify({ a: 1 }))), { ok: true, value: { a: 1 } });
  const text = new Request("https://app.test/x", { method: "POST", body: "{}", headers: { "content-type": "text/plain" } });
  assert.deepEqual(await readPublicJson(text), { ok: false, code: "formato_non_ammesso" });
  const charset = jsonRequest("{}", { "content-type": "application/json; charset=utf-8" });
  assert.equal((await readPublicJson(charset)).ok, true);
  assert.deepEqual(await readPublicJson(jsonRequest("{}", { "content-length": String(PUBLIC_BODY_MAX_BYTES + 1) })), { ok: false, code: "corpo_troppo_grande" });
  assert.deepEqual(await readPublicJson(jsonRequest("{}", { "content-length": "12abc" })), { ok: false, code: "corpo_troppo_grande" });
  const big = new Uint8Array(PUBLIC_BODY_MAX_BYTES / 2).fill(0x20);
  const streamed = new Request("https://app.test/x", { method: "POST", body: streamOf([big, big, new Uint8Array([0x20])]), headers: { "content-type": "application/json" }, duplex: "half" } as RequestInit);
  assert.deepEqual(await readPublicJson(streamed), { ok: false, code: "corpo_troppo_grande" }, "counted while reading");
  const badUtf8 = new Request("https://app.test/x", { method: "POST", body: streamOf([new Uint8Array([0x22, 0xff, 0x22])]), headers: { "content-type": "application/json" }, duplex: "half" } as RequestInit);
  assert.deepEqual(await readPublicJson(badUtf8), { ok: false, code: "dati_non_validi" });
  assert.deepEqual(await readPublicJson(jsonRequest("{not json")), { ok: false, code: "dati_non_validi" });
  assert.deepEqual(await readPublicJson(jsonRequest(null)), { ok: false, code: "dati_non_validi" });
  assert.deepEqual(await readPublicJson(jsonRequest(JSON.stringify("x".repeat(40))), 10), { ok: false, code: "corpo_troppo_grande" });
});

test("uniform errors: one shape, Italian message, no-store and noindex on every answer", async () => {
  const invalid = invalidLinkResponse();
  assert.equal(invalid.status, 404);
  assert.deepEqual(await invalid.json(), { ok: false, error: "link_non_valido", message: INVALID_LINK_MESSAGE });
  for (const [k, v] of Object.entries(PUBLIC_HEADERS)) assert.equal(invalid.headers.get(k), v);
  assert.equal(invalid.headers.get("x-robots-tag"), "noindex, nofollow");
  assert.equal(invalid.headers.get("cache-control"), "no-store");

  const withIssues = publicError("risposta_non_valida", {
    message: "Controlla la risposta.",
    issues: [{ code: "numero_non_valido", message: "Scrivi un numero.", field: "value" }, { code: "x", message: "y" }],
  });
  assert.equal(withIssues.status, 422);
  assert.deepEqual(await withIssues.json(), {
    ok: false,
    error: "risposta_non_valida",
    message: "Controlla la risposta.",
    issues: [{ code: "numero_non_valido", message: "Scrivi un numero.", field: "value" }, { code: "x", message: "y" }],
  });
  const many = publicError("testo_sanitario", { issues: Array.from({ length: 80 }, () => ({ code: "testo_sanitario", message: "m" })) });
  assert.equal(((await many.json()) as { issues: unknown[] }).issues.length, 50);

  const limited = publicError("troppe_richieste", { retryAfterSeconds: 12.2 });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "13");
  const unknown = publicError("qualcosa_di_nuovo");
  assert.equal(unknown.status, 409);
  assert.equal(((await unknown.json()) as { message: string }).message, "Qualcosa non ha funzionato. Riprova tra poco.");

  const data = publicData({ saved: true });
  assert.equal(data.status, 200);
  assert.deepEqual(await data.json(), { ok: true, data: { saved: true } });
  assert.equal(data.headers.get("cache-control"), "no-store");
});

test("status codes: link, origin, size, pause, privacy, personal zone, text scan", () => {
  assert.equal(publicStatusFor("link_non_valido"), 404);
  assert.equal(publicStatusFor("origine_non_ammessa"), 403);
  assert.equal(publicStatusFor("formato_non_ammesso"), 415);
  assert.equal(publicStatusFor("corpo_troppo_grande"), 413);
  assert.equal(publicStatusFor("caso_sospeso"), 409);
  assert.equal(publicStatusFor("informativa_da_leggere"), 409);
  assert.equal(publicStatusFor("zona_personale_chiusa"), 409);
  assert.equal(publicStatusFor("testo_sanitario"), 422);
  assert.equal(publicStatusFor("testo_discriminatorio"), 422);
  assert.equal(publicStatusFor("email_non_valida"), 422);
  assert.equal(publicStatusFor("motivo_mancante"), 422);
  assert.equal(publicStatusFor("approvazione_non_trovata"), 404);
  assert.equal(publicStatusFor("troppe_deleghe"), 429);
  assert.equal(publicStatusFor("non_disponibile"), 503);
});

test("IP: only a keyed hash, never the address; nothing without the secret", () => {
  const h = headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1", "x-real-ip": "198.51.100.1" });
  assert.equal(clientIp(h), "203.0.113.7");
  assert.equal(clientIp(headers({ "x-real-ip": "198.51.100.1" })), "198.51.100.1");
  assert.equal(clientIp(headers({})), null);
  assert.equal(requestIpHash(h, null), null);
  assert.equal(requestIpHash(h, ""), null);
  const hash = requestIpHash(h, SECRET);
  assert.match(hash ?? "", /^[0-9a-f]{32}$/);
  assert.ok(!(hash ?? "").includes("203"), "the address does not appear in the hash");
  assert.equal(requestIpHash(h, SECRET), hash, "stable for the same address and secret");
  assert.notEqual(requestIpHash(headers({ "x-forwarded-for": "203.0.113.8" }), SECRET), hash);
});

test("user agent and device", () => {
  assert.equal(requestUserAgent(headers({})), null);
  assert.equal(requestUserAgent(headers({ "user-agent": "A\tB" })), "A B");
  assert.equal(requestUserAgent(headers({ "user-agent": "x".repeat(500) }))?.length, 300);
  assert.equal(deviceFromUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"), "mobile");
  assert.equal(deviceFromUserAgent("Mozilla/5.0 (Linux; Android 14) Mobile"), "mobile");
  assert.equal(deviceFromUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)"), "desktop");
  assert.equal(deviceFromUserAgent(null), null);
});

test("rate limits: buckets per token and kind, per IP hash only with a hash, first rule over the limit", () => {
  assert.equal(ipRateLimitRule(null), null);
  assert.equal(ipRateLimitRule("203.0.113.7"), null, "a raw address is never a bucket");
  const ip = ipRateLimitRule("ab".repeat(16));
  assert.deepEqual(ip, { bucket: `ip:${"ab".repeat(16)}`, unit: "minute", limit: RATE_LIMITS.ip.limit });
  assert.equal(RATE_LIMITS.ip.limit, 120);
  const draft = tokenRateLimitRule(TOKEN_ID, "bozza");
  const send = tokenRateLimitRule(TOKEN_ID.toUpperCase(), "invio");
  assert.deepEqual(draft, { bucket: `tok:${TOKEN_ID}:bozza`, unit: "minute", limit: 60 });
  assert.deepEqual(send, { bucket: `tok:${TOKEN_ID}:invio`, unit: "minute", limit: 20 });
  assert.throws(() => tokenRateLimitRule("ucr_not-a-row-id", "invio"), /Token non valido/);
  const counts = new Map([
    [ip!.bucket, 120],
    [send.bucket, 21],
  ]);
  assert.equal(firstExceeded([ip!, draft], counts), null, "the limit itself is still allowed");
  assert.deepEqual(firstExceeded([ip!, send], counts), send);
  assert.equal(retryAfter("minute", new Date("2026-10-12T10:00:45.000Z")), 15);
  assert.equal(retryAfter("hour", new Date("2026-10-12T10:59:30.000Z")), 30);
  assert.equal(retryAfter("minute", new Date("2026-10-12T10:00:00.000Z")), 60);
});

test("batch send and uploads (P0-11): a batch of answers is one unit of «invio»; uploads 30 an hour", () => {
  assert.deepEqual(RATE_LIMITS.upload, { limit: 30, unit: "hour" });
  assert.deepEqual(RATE_LIMITS.invio, { limit: 20, unit: "minute" });
  // 60 answers in one topic = 2 batch calls (50 + 10): far below the 20 sends a minute.
  const send = tokenRateLimitRule(TOKEN_ID, "invio");
  assert.equal(firstExceeded([send], new Map([[send.bucket, 2]])), null);
  assert.ok(PUBLIC_BATCH_BODY_MAX_BYTES > PUBLIC_BODY_MAX_BYTES);
});

test("secret required in production (P0-7): public writes answer 503 without UC_SECRET", () => {
  assert.equal(publicWritesAvailable({ VERCEL_ENV: "production" }), false);
  assert.equal(publicWritesAvailable({ VERCEL_ENV: "production", UC_SECRET: "  " }), false);
  assert.equal(publicWritesAvailable({ VERCEL_ENV: "production", UC_SECRET: SECRET }), true);
  assert.equal(publicWritesAvailable({ VERCEL_ENV: "preview" }), true, "previews and the harness write without it");
  assert.equal(publicWritesAvailable({}), true);
  assert.equal(publicError("non_disponibile").status, 503);
});

test("batch body: up to 2 MB, still JSON only and read in chunks", async () => {
  const big = JSON.stringify({ answers: [{ text: "x".repeat(400 * 1024) }] });
  assert.deepEqual(await readPublicJson(jsonRequest(big)), { ok: false, code: "corpo_troppo_grande" }, "over 256 KB on a normal call");
  const read = await readPublicJson(jsonRequest(big), PUBLIC_BATCH_BODY_MAX_BYTES);
  assert.equal(read.ok, true);
  const huge = JSON.stringify({ answers: [{ text: "x".repeat(PUBLIC_BATCH_BODY_MAX_BYTES) }] });
  assert.deepEqual(await readPublicJson(jsonRequest(huge), PUBLIC_BATCH_BODY_MAX_BYTES), { ok: false, code: "corpo_troppo_grande" });
});

test("call environment: keyed IP hash, device, LS domains, email and personal zone from the variables passed in", () => {
  const h = headers({ "x-forwarded-for": "203.0.113.7", "user-agent": "Mozilla/5.0 (iPhone)" });
  const env = publicCallEnv(h, { UC_LS_EMAIL_DOMAINS: " ls.test, @Altro.test ", UC_SECRET: SECRET, RESEND_API_KEY: "k", UC_EMAIL_FROM: " ", UC_PERSONAL_ZONE_KEY: "  " });
  assert.deepEqual(env.lsDomains, ["ls.test", "altro.test"]);
  assert.match(env.ipHash ?? "", /^[0-9a-f]{32}$/);
  assert.equal(env.device, "mobile");
  assert.equal(env.emailConfigured, false, "both the API key and the sender are needed");
  assert.equal(env.personalZoneKey, null);
  assert.ok(!JSON.stringify(env).includes("203.0.113.7"), "the address never leaves");
  const bare = publicCallEnv(headers({}), {});
  assert.deepEqual(bare, { lsDomains: [], ipHash: null, userAgent: null, device: null, emailConfigured: false, personalZoneKey: null });
  assert.equal(publicCallEnv(headers({}), { RESEND_API_KEY: "k", UC_EMAIL_FROM: "Lateral Space <a@b.test>" }).emailConfigured, true);
});
