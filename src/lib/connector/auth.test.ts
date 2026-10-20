import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  bearerTokenFromHeader,
  CONNECTOR_PROVIDER,
  CONNECTOR_SCOPES,
  CONNECTOR_TOKEN_PREFIX,
  CONNECTOR_TOKEN_ROTATION_NOTE,
  CONNECTOR_TOKEN_TTL_DAYS,
  CONNECTOR_TOKEN_WARNING_DAYS,
  connectorTokenExpiresAt,
  connectorTokenExpiry,
  connectorUnauthorized,
  hasAllScopes,
  hashIntegrationToken,
  principalFromToken,
  resourceMetadataUrl,
} from "./auth.ts";
import { DEFAULT_TOKEN_PREFIXES } from "./http-hygiene.ts";

// Prompt WP4 (autenticazione di fase 1) e WP10. Token finti, generati a ogni esecuzione.

const fakeToken = () => `${CONNECTOR_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
const DAY = 24 * 60 * 60 * 1000;

test("scope e provider del connettore: due scope, mai portfolio:submit", () => {
  assert.deepEqual([...CONNECTOR_SCOPES], ["connector:read", "connector:submit"]);
  assert.equal(CONNECTOR_SCOPES.includes("portfolio:submit"), false);
  assert.equal(CONNECTOR_PROVIDER, "claude_connector");
  assert.equal(CONNECTOR_TOKEN_TTL_DAYS, 90);
  assert.equal(CONNECTOR_TOKEN_WARNING_DAYS, 14);
});

test("hash: SHA-256 esadecimale, lo stesso delle altre credenziali di workspace", () => {
  const token = fakeToken();
  assert.equal(hashIntegrationToken(token), createHash("sha256").update(token, "utf8").digest("hex"));
  assert.match(hashIntegrationToken(token), /^[0-9a-f]{64}$/);
});

test("solo Authorization: Bearer con il prefisso dei token di workspace", () => {
  const token = fakeToken();
  assert.equal(bearerTokenFromHeader(`Bearer ${token}`), token);
  assert.equal(bearerTokenFromHeader(`bearer ${token}`), token);
  assert.equal(bearerTokenFromHeader(`  Bearer \t${token}  `), token);
  for (const value of [
    null,
    "",
    token,
    `Basic ${token}`,
    `Token ${token}`,
    `Bearer`,
    `Bearer ${token} extra`,
    `Bearer ${token.slice(CONNECTOR_TOKEN_PREFIX.length)}`,
    `Bearer ${CONNECTOR_TOKEN_PREFIX}corto`,
    `Bearer ${CONNECTOR_TOKEN_PREFIX}${"a".repeat(30)}!`,
    `Bearer ${DEFAULT_TOKEN_PREFIXES[1]}${randomBytes(32).toString("base64url")}`,
  ]) {
    assert.equal(bearerTokenFromHeader(value), null, String(value).slice(0, 12));
  }
});

test("scope: servono tutti e due", () => {
  assert.equal(hasAllScopes(["connector:read", "connector:submit"], CONNECTOR_SCOPES), true);
  assert.equal(hasAllScopes(["connector:submit", "portfolio:submit", "connector:read"], CONNECTOR_SCOPES), true);
  assert.equal(hasAllScopes(["connector:read"], CONNECTOR_SCOPES), false);
  assert.equal(hasAllScopes(["connector:submit"], CONNECTOR_SCOPES), false);
  assert.equal(hasAllScopes(["portfolio:submit"], CONNECTOR_SCOPES), false);
  assert.equal(hasAllScopes(null, CONNECTOR_SCOPES), false);
  assert.equal(hasAllScopes("connector:read connector:submit", CONNECTOR_SCOPES), false);
});

test("principal di fase 1: chiave token:<id>, nessuna identità", () => {
  const id = randomUUID();
  const workspaceId = randomUUID();
  assert.deepEqual(
    principalFromToken({ id, scopes: ["connector:read", "connector:submit"] }, { workspaceId, slug: "prova-a", identityMode: "dichiarata" }),
    {
      workspaceId,
      slug: "prova-a",
      principalKey: `token:${id}`,
      identityMode: "dichiarata",
      scopes: ["connector:read", "connector:submit"],
      tokenId: id,
      identityId: null,
    }
  );
});

test("401: JSON senza WWW-Authenticate in modalità header; con i metadati della risorsa in oauth", async () => {
  for (const config of [null, { authMode: "header" as const, slug: "prova-a" }]) {
    const response = connectorUnauthorized(config);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("www-authenticate"), null);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { error: "unauthorized" });
  }
  const oauth = connectorUnauthorized({ authMode: "oauth", slug: "prova-a" });
  assert.equal(oauth.status, 401);
  assert.equal(
    oauth.headers.get("www-authenticate"),
    'Bearer resource_metadata="https://www.theunbundle.com/.well-known/oauth-protected-resource/api/mcp/connettore/prova-a"'
  );
  assert.deepEqual(await oauth.json(), { error: "unauthorized" });
  assert.equal(
    resourceMetadataUrl("prova-a", "http://127.0.0.1:53130/"),
    "http://127.0.0.1:53130/.well-known/oauth-protected-resource/api/mcp/connettore/prova-a"
  );
});

test("scadenza: 90 giorni; avviso da 14 giorni prima; scaduto", () => {
  const now = new Date("2026-10-14T08:00:00.000Z");
  const expiresAt = connectorTokenExpiresAt(now);
  assert.equal(expiresAt.toISOString(), "2027-01-12T08:00:00.000Z");
  assert.deepEqual(connectorTokenExpiry(expiresAt, now), { expired: false, daysLeft: 90, expiringSoon: false });
  // L'avviso parte a 14 giorni dalla scadenza, cioè 76 giorni dopo la creazione.
  assert.deepEqual(connectorTokenExpiry(expiresAt, new Date(now.getTime() + 75 * DAY)), { expired: false, daysLeft: 15, expiringSoon: false });
  assert.deepEqual(connectorTokenExpiry(expiresAt, new Date(now.getTime() + 76 * DAY)), { expired: false, daysLeft: 14, expiringSoon: true });
  assert.deepEqual(connectorTokenExpiry(expiresAt, new Date(now.getTime() + 90 * DAY)), { expired: true, daysLeft: 0, expiringSoon: true });
  assert.deepEqual(connectorTokenExpiry(new Date(now.getTime() + 15 * DAY), now), { expired: false, daysLeft: 15, expiringSoon: false });
  assert.deepEqual(connectorTokenExpiry(new Date(now.getTime() + 14 * DAY), now), { expired: false, daysLeft: 14, expiringSoon: true });
  assert.deepEqual(connectorTokenExpiry(new Date(now.getTime() + 60_000), now), { expired: false, daysLeft: 1, expiringSoon: true });
  assert.deepEqual(connectorTokenExpiry(now, now), { expired: true, daysLeft: 0, expiringSoon: true });
  assert.deepEqual(connectorTokenExpiry(null, now), { expired: false, daysLeft: null, expiringSoon: false });
});

test("la nota sulla rotazione dice che si rimuove e si riaggiunge il connettore", () => {
  assert.match(CONNECTOR_TOKEN_ROTATION_NOTE, /rimuove e riaggiunge il connettore/);
  assert.match(CONNECTOR_TOKEN_ROTATION_NOTE, /Connetti/);
});
