import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { granolaConfig } from "./config.ts";
import { discoverGranola, forgetGranolaDiscovery, type GranolaEndpoints } from "./endpoints.ts";
import { startFakeGranola, type FakeGranola } from "./fake-granola.ts";
import {
  authorizationUrl,
  callbackUrl,
  chooseClientMode,
  clientMetadataDocument,
  clientMetadataUrl,
  createPkce,
  createState,
  exchangeCode,
  granolaScopes,
  isStateShape,
  pkceChallenge,
  readTokenResponse,
  refreshTokens,
  registerClient,
  revokeToken,
  stateHash,
} from "./oauth.ts";

// Il collegamento a Granola: PKCE, l'indirizzo di autorizzazione, il documento del cliente, la scelta tra documento e
// registrazione, gli scope, i token (RILASCIO-9a-COSTRUZIONE.md §8.2, §8.3, §11.5). Solo il server finto su 127.0.0.1.

const ORIGIN = "https://unbundle.test";
let fake: FakeGranola;
const hosts: string[] = [];
const localFetch: typeof fetch = (input, init) => {
  const url = new URL(String(input instanceof Request ? input.url : input));
  hosts.push(url.hostname);
  if (url.hostname !== "127.0.0.1") return Promise.reject(new Error(`richiesta fuori da 127.0.0.1: ${url.hostname}`));
  return fetch(input, init);
};

before(async () => {
  fake = await startFakeGranola({ resourceScopes: ["granola:read"] });
});
after(async () => {
  await fake.close();
  assert.ok(hosts.length > 0 && hosts.every((h) => h === "127.0.0.1"));
});

test("PKCE S256: verifier di 43 caratteri, challenge = base64url(sha256(verifier)); stato e impronta", () => {
  const { verifier, challenge } = createPkce();
  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(challenge, createHash("sha256").update(verifier).digest("base64url"));
  assert.equal(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", "l'esempio della RFC 7636");
  assert.notEqual(createPkce().verifier, verifier);
  const { state, hash } = createState();
  assert.ok(isStateShape(state));
  assert.equal(hash, stateHash(state));
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(isStateShape("corto"), false);
  assert.equal(isStateShape(`${state}!`), false);
});

test("l'indirizzo di autorizzazione porta ogni parametro, con la risorsa e S256", () => {
  const endpoints = { authorization: "https://auth.esempio.test/oauth2/authorize?x=1", resource: "https://mcp.esempio.test/mcp" };
  const url = new URL(authorizationUrl(endpoints, { clientId: clientMetadataUrl(ORIGIN), redirectUri: callbackUrl(ORIGIN), scope: ["openid", "offline_access"], state: "s".repeat(43), challenge: "c".repeat(43) }));
  assert.equal(url.origin + url.pathname, "https://auth.esempio.test/oauth2/authorize");
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    x: "1",
    response_type: "code",
    client_id: "https://unbundle.test/api/granola/client-metadata",
    redirect_uri: "https://unbundle.test/api/granola/callback",
    scope: "openid offline_access",
    state: "s".repeat(43),
    code_challenge: "c".repeat(43),
    code_challenge_method: "S256",
    resource: "https://mcp.esempio.test/mcp",
  });
});

test("il documento di metadati: client_id uguale al suo indirizzo, cliente pubblico; senza client_id per la registrazione", () => {
  assert.deepEqual(clientMetadataDocument(`${ORIGIN}/`), {
    client_id: "https://unbundle.test/api/granola/client-metadata",
    client_name: "Unbundle",
    client_uri: "https://unbundle.test",
    redirect_uris: ["https://unbundle.test/api/granola/callback"],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    scope: "openid email profile offline_access",
  });
  const registration = clientMetadataDocument(ORIGIN, { withClientId: false });
  assert.equal("client_id" in registration, false);
  assert.equal(registration.token_endpoint_auth_method, "none");
});

test("documento o registrazione: il documento se Granola lo accetta e l'ambiente non chiede altro", () => {
  assert.equal(chooseClientMode({ metadataDocumentSupported: true }, "cimd"), "cimd");
  assert.equal(chooseClientMode({ metadataDocumentSupported: false }, "cimd"), "dcr");
  assert.equal(chooseClientMode({ metadataDocumentSupported: true }, "dcr"), "dcr");
});

test("gli scope: i quattro di base che il server elenca, più quelli della risorsa protetta che il server elenca", () => {
  assert.deepEqual(granolaScopes({ scopesSupported: ["openid", "email", "profile", "offline_access"] }), ["openid", "email", "profile", "offline_access"]);
  assert.deepEqual(granolaScopes({ scopesSupported: ["openid", "offline_access", "mcp:read"] }), ["openid", "offline_access"]);
  assert.deepEqual(granolaScopes({ scopesSupported: ["openid", "offline_access", "mcp:read"], resourceScopes: ["mcp:read", "mcp:write"] }), ["openid", "offline_access", "mcp:read"]);
  assert.deepEqual(granolaScopes({ scopesSupported: [] }), ["openid", "email", "profile", "offline_access"], "senza elenco, i quattro");
});

test("la scoperta legge i metadati del server finto e gli scope della risorsa; un emittente diverso o un indirizzo su un altro host no", async () => {
  forgetGranolaDiscovery();
  const base: GranolaEndpoints = { ...fake.endpoints, registration: "http://127.0.0.1:1/vecchio" };
  const found = await discoverGranola({ fetch: localFetch, base });
  assert.equal(found.registration, `${fake.url}/oauth2/register`, "aggiornato dai metadati");
  assert.equal(found.metadataDocumentSupported, true);
  assert.deepEqual(found.scopesSupported, ["openid", "email", "profile", "offline_access", "granola:read"]);
  assert.deepEqual(found.resourceScopes, ["granola:read"]);
  assert.deepEqual(granolaScopes(found), ["openid", "email", "profile", "offline_access", "granola:read"]);
  // In memoria per un'ora: la seconda lettura non chiede niente.
  const before = fake.requests.length;
  assert.equal(await discoverGranola({ fetch: localFetch, base }), found);
  assert.equal(fake.requests.length, before);
  // Un emittente diverso da quello atteso: restano le costanti.
  forgetGranolaDiscovery();
  const other: GranolaEndpoints = { ...fake.endpoints, issuer: `${fake.url}/altro`, registration: "http://127.0.0.1:1/vecchio" };
  assert.equal((await discoverGranola({ fetch: localFetch, base: other })).registration, "http://127.0.0.1:1/vecchio");
  // Un server che non risponde: restano le costanti, e non si tiene in memoria.
  forgetGranolaDiscovery();
  const offline = await discoverGranola({ fetch: () => Promise.reject(new Error("giù")), base });
  assert.equal(offline, base);
});

test("la scoperta rifiuta indirizzi su un altro host o in chiaro fuori da 127.0.0.1", async () => {
  forgetGranolaDiscovery();
  const issuer = "https://auth.esempio.test";
  const base: GranolaEndpoints = { ...fake.endpoints, issuer, resource: "https://mcp.esempio.test/mcp", token: `${issuer}/t` };
  const answer = (metadata: Record<string, unknown>): typeof fetch => async (input) =>
    String(input).includes("oauth-authorization-server") ? Response.json({ issuer, authorization_endpoint: `${issuer}/a`, token_endpoint: `${issuer}/t2`, ...metadata }) : new Response("", { status: 404 });
  assert.equal((await discoverGranola({ fetch: answer({ token_endpoint: "https://altro.esempio.test/t" }), base })).token, `${issuer}/t`);
  forgetGranolaDiscovery();
  assert.equal((await discoverGranola({ fetch: answer({ token_endpoint: "http://auth.esempio.test/t" }), base })).token, `${issuer}/t`);
  forgetGranolaDiscovery();
  assert.equal((await discoverGranola({ fetch: answer({ code_challenge_methods_supported: ["plain"] }), base })).token, `${issuer}/t`, "senza S256 no");
  forgetGranolaDiscovery();
  const ok = await discoverGranola({ fetch: answer({ client_id_metadata_document_supported: false }), base });
  assert.equal(ok.token, `${issuer}/t2`);
  assert.equal(ok.metadataDocumentSupported, false);
  forgetGranolaDiscovery();
});

test("codice, rinnovo e revoca contro il server finto: PKCE verificato, il codice vale una volta, il refresh_token cambia", async () => {
  const deps = { fetch: localFetch, endpoints: fake.endpoints };
  const { verifier, challenge } = createPkce();
  const { state } = createState();
  const clientId = clientMetadataUrl(ORIGIN);
  const redirectUri = callbackUrl(ORIGIN);
  const back = await fake.consent(authorizationUrl(fake.endpoints, { clientId, redirectUri, scope: ["openid"], state, challenge }));
  assert.equal(back.origin + back.pathname, redirectUri);
  assert.equal(back.searchParams.get("state"), state);
  const code = back.searchParams.get("code") ?? "";
  // Un verifier sbagliato non passa, e brucia il codice.
  const wrong = await exchangeCode(deps, { code, redirectUri, clientId, verifier: createPkce().verifier });
  assert.deepEqual(wrong, { ok: false, error: "invalid_grant" });
  assert.deepEqual(await exchangeCode(deps, { code, redirectUri, clientId, verifier }), { ok: false, error: "invalid_grant" }, "il codice vale una volta");

  const again = await fake.consent(authorizationUrl(fake.endpoints, { clientId, redirectUri, scope: ["openid"], state, challenge }));
  const exchanged = await exchangeCode(deps, { code: again.searchParams.get("code") ?? "", redirectUri, clientId, verifier });
  assert.ok(exchanged.ok);
  assert.equal(exchanged.expiresIn, 3600);
  assert.equal(exchanged.tokens.tokenType, "Bearer");
  assert.ok(exchanged.tokens.refreshToken);
  const last = fake.tokenRequests.at(-1);
  assert.deepEqual(last, { grantType: "authorization_code", clientId, resource: fake.endpoints.resource, withVerifier: true });

  const renewed = await refreshTokens(deps, { refreshToken: exchanged.tokens.refreshToken!, clientId });
  assert.ok(renewed.ok);
  assert.notEqual(renewed.tokens.refreshToken, exchanged.tokens.refreshToken, "il refresh_token cambia");
  assert.deepEqual(await refreshTokens(deps, { refreshToken: exchanged.tokens.refreshToken!, clientId }), { ok: false, error: "invalid_grant" }, "quello vecchio non vale più");

  assert.equal(await revokeToken(deps, { token: renewed.tokens.refreshToken!, hint: "refresh_token", clientId }), true);
  assert.deepEqual(fake.revoked.at(-1), { token: renewed.tokens.refreshToken, hint: "refresh_token", clientId });
  assert.equal(fake.isLive(renewed.tokens.refreshToken!), false);
});

test("la registrazione dinamica restituisce il client_id; un server giù: null, rete", async () => {
  const deps = { fetch: localFetch, endpoints: fake.endpoints };
  const clientId = await registerClient(deps, ORIGIN);
  assert.match(clientId ?? "", /^dcr-/);
  assert.equal(fake.registrations.length, 1);
  assert.equal("client_id" in fake.registrations[0], false);
  assert.deepEqual(fake.registrations[0].redirect_uris, [callbackUrl(ORIGIN)]);
  const down = { fetch: () => Promise.reject(new Error("giù")), endpoints: fake.endpoints };
  assert.equal(await registerClient(down, ORIGIN), null);
  assert.deepEqual(await refreshTokens(down, { refreshToken: "x", clientId: "y" }), { ok: false, error: "rete" });
  assert.equal(await revokeToken(down, { token: "x", hint: "access_token", clientId: "y" }), false);
});

test("una risposta dei token strana: solo il codice OAuth, mai il testo", () => {
  assert.deepEqual(readTokenResponse(400, { error: "invalid_grant", error_description: "testo del server" }), { ok: false, error: "invalid_grant" });
  assert.deepEqual(readTokenResponse(400, { error: "Errore con spazi e TESTO" }), { ok: false, error: "protocollo" });
  assert.deepEqual(readTokenResponse(200, null), { ok: false, error: "protocollo" });
  assert.deepEqual(readTokenResponse(200, { access_token: "a", token_type: "mac" }), { ok: false, error: "protocollo" });
  assert.deepEqual(readTokenResponse(200, { access_token: "a", token_type: "bearer", expires_in: "60" }), {
    ok: true,
    tokens: { accessToken: "a", refreshToken: null, tokenType: "Bearer", scope: null },
    expiresIn: 60,
  });
  const negative = readTokenResponse(200, { access_token: "a", expires_in: -5 });
  assert.ok(negative.ok);
  assert.equal(negative.expiresIn, null, "una durata negativa non vale");
});

test("che cosa serve perché Granola funzioni: chiave valida, indirizzo pubblico, non un'anteprima, non spento", () => {
  const KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1)).toString("base64");
  const ok = { CONTEXT_TOKEN_KEY: KEY, NEXT_PUBLIC_APP_URL: "https://www.unbundle.test" };
  assert.deepEqual(granolaConfig(ok), { available: true, origin: "https://www.unbundle.test", tokenKey: KEY, clientMode: "cimd" });
  assert.equal(granolaConfig({ ...ok, CONTEXT_TOKEN_KEY: undefined }).available, false);
  assert.equal(granolaConfig({ ...ok, CONTEXT_TOKEN_KEY: "corta" }).available, false);
  assert.equal(granolaConfig({ ...ok, CONTEXT_TOKEN_KEY: Buffer.alloc(32, 7).toString("base64") }).available, false, "una chiave banale no");
  assert.equal(granolaConfig({ ...ok, NEXT_PUBLIC_APP_URL: undefined }).available, false);
  assert.equal(granolaConfig({ ...ok, NEXT_PUBLIC_APP_URL: "http://esempio.test" }).available, false, "in chiaro solo in locale");
  assert.equal(granolaConfig({ ...ok, VERCEL_ENV: "preview" }).available, false);
  assert.equal(granolaConfig({ ...ok, VERCEL_ENV: "production" }).available, true);
  assert.equal(granolaConfig({ ...ok, CONTEXT_GRANOLA: " OFF " }).available, false);
  assert.equal(granolaConfig({ ...ok, CONTEXT_GRANOLA_CLIENT: "DCR" }).clientMode, "dcr");
  assert.equal(granolaConfig({}).tokenKey, null);
});
