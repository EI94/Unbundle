import test from "node:test";
import assert from "node:assert/strict";
import {
  isSessionCookieExpired,
  loginPathForMissingSession,
} from "./session-signal.ts";

function fakeJwt(payload: Record<string, unknown>) {
  const enc = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${enc({ alg: "RS256", typ: "JWT" })}.${enc(payload)}.firma-finta`;
}

test("un JWT con exp futura non è considerato scaduto", () => {
  const now = 1_800_000_000;
  assert.equal(isSessionCookieExpired(fakeJwt({ exp: now + 3600 }), now), false);
});

test("un JWT con exp passata è scaduto", () => {
  const now = 1_800_000_000;
  assert.equal(isSessionCookieExpired(fakeJwt({ exp: now - 1 }), now), true);
  assert.equal(isSessionCookieExpired(fakeJwt({ exp: now }), now), true);
});

test("token malformati o senza exp vanno trattati come scaduti (da cancellare)", () => {
  assert.equal(isSessionCookieExpired("garbage", 0), true);
  assert.equal(isSessionCookieExpired("a.b", 0), true);
  assert.equal(isSessionCookieExpired("a.!!!.c", 0), true);
  assert.equal(isSessionCookieExpired(fakeJwt({}), 0), true);
  assert.equal(isSessionCookieExpired(fakeJwt({ exp: "domani" }), 0), true);
});

test("loginPathForMissingSession aggiunge il marker stale solo se c'era un cookie", () => {
  assert.equal(loginPathForMissingSession({ hadCookie: false }), "/login");
  assert.equal(
    loginPathForMissingSession({ hadCookie: true }),
    "/login?session=stale"
  );
});

test("loginPathForMissingSession accetta solo callback interni", () => {
  assert.equal(
    loginPathForMissingSession({ hadCookie: true, callbackPath: "/invite/abc" }),
    "/login?session=stale&callbackUrl=%2Finvite%2Fabc"
  );
  // esterni o protocol-relative: ignorati
  assert.equal(
    loginPathForMissingSession({ hadCookie: false, callbackPath: "https://evil.com" }),
    "/login"
  );
  assert.equal(
    loginPathForMissingSession({ hadCookie: false, callbackPath: "//evil.com" }),
    "/login"
  );
});
