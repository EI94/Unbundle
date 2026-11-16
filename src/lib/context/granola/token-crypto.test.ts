import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { openGranolaTokens, openGranolaVerifier, sealGranolaTokens, sealGranolaVerifier, type GranolaTokens } from "./token-crypto.ts";

// I token di Granola cifrati (RILASCIO-9a-COSTRUZIONE.md §8.3): si aprono solo con la stessa chiave e per la stessa
// persona; una busta alterata no; senza chiave un esito, mai un'eccezione. Chiavi e token inventati.

const KEY = randomBytes(32).toString("base64");
const OTHER_KEY = randomBytes(32).toString("base64");
const USER = randomUUID();
const TOKENS: GranolaTokens = { accessToken: "at-segreto-di-prova", refreshToken: "rt-segreto-di-prova", tokenType: "Bearer", scope: "openid offline_access" };

test("si apre con la stessa chiave e la stessa persona; il testo cifrato non contiene i token", () => {
  const sealed = sealGranolaTokens(KEY, USER, TOKENS);
  assert.ok(sealed.ok);
  assert.match(sealed.value, /^[A-Za-z0-9+/]+={0,2}$/);
  assert.ok(sealed.value.length >= 100, "il CHECK della colonna vuole almeno 100 caratteri");
  for (const secret of ["at-segreto", "rt-segreto", Buffer.from("at-segreto").toString("base64")]) assert.equal(sealed.value.includes(secret), false);
  assert.deepEqual(openGranolaTokens(KEY, USER, sealed.value), { ok: true, value: TOKENS });
  // La stessa cosa cifrata due volte dà due buste diverse.
  const again = sealGranolaTokens(KEY, USER, TOKENS);
  assert.ok(again.ok && again.value !== sealed.value);
  // Maiuscole o minuscole nell'id della persona: la stessa persona.
  assert.deepEqual(openGranolaTokens(KEY, USER.toUpperCase(), sealed.value), { ok: true, value: TOKENS });
});

test("un'altra chiave, un'altra persona, i dati del verifier, una busta alterata: non si apre", () => {
  const sealed = sealGranolaTokens(KEY, USER, TOKENS);
  assert.ok(sealed.ok);
  assert.equal(openGranolaTokens(OTHER_KEY, USER, sealed.value).ok, false);
  assert.equal(openGranolaTokens(KEY, randomUUID(), sealed.value).ok, false, "una busta copiata sulla riga di un'altra persona");
  assert.equal(openGranolaVerifier(KEY, USER, sealed.value).ok, false, "un token non è un verifier");
  const bytes = Buffer.from(sealed.value, "base64");
  bytes[bytes.length - 1] ^= 1;
  assert.deepEqual(openGranolaTokens(KEY, USER, bytes.toString("base64")), { ok: false, code: "busta_non_valida", message: "Il dato cifrato non si può aprire." });
  assert.equal(openGranolaTokens(KEY, USER, "non è base64!").ok, false);
  assert.equal(openGranolaTokens(KEY, USER, "").ok, false);
});

test("senza chiave, o con una chiave sbagliata, un esito e non un'eccezione", () => {
  for (const key of [undefined, "", "corta", Buffer.alloc(32, 1).toString("base64")]) {
    const sealed = sealGranolaTokens(key, USER, TOKENS);
    assert.equal(sealed.ok, false, String(key));
    assert.ok(!sealed.ok && ["chiave_assente", "chiave_non_valida"].includes(sealed.code));
    assert.equal(openGranolaTokens(key, USER, "QUJD").ok, false);
    assert.equal(sealGranolaVerifier(key, USER, "v".repeat(43)).ok, false);
  }
  assert.equal(sealGranolaTokens(KEY, "non-un-uuid", TOKENS).ok, false);
  assert.equal(sealGranolaTokens(KEY, USER, { ...TOKENS, accessToken: "" }).ok, false);
});

test("il verifier: stessa busta, dati associati suoi", () => {
  const verifier = randomBytes(32).toString("base64url");
  const sealed = sealGranolaVerifier(KEY, USER, verifier);
  assert.ok(sealed.ok);
  assert.deepEqual(openGranolaVerifier(KEY, USER, sealed.value), { ok: true, value: verifier });
  assert.equal(openGranolaTokens(KEY, USER, sealed.value).ok, false);
  assert.equal(openGranolaVerifier(KEY, randomUUID(), sealed.value).ok, false);
  assert.equal(sealGranolaVerifier(KEY, USER, "corto").ok, false);
  // Senza refresh token e con campi vuoti: valori predefiniti.
  const minimal = sealGranolaTokens(KEY, USER, { accessToken: "a", refreshToken: null, tokenType: "", scope: "" });
  assert.ok(minimal.ok);
  assert.deepEqual(openGranolaTokens(KEY, USER, minimal.value), { ok: true, value: { accessToken: "a", refreshToken: null, tokenType: "Bearer", scope: null } });
});
