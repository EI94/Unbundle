import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { REFERENT_TOKEN_BYTES, RECIPIENT_HASH_SQL, hashReferentToken, looksLikeReferentToken, newReferentToken, recipientHash } from "./tokens.ts";

// Link personali di «Chiedi al referente» (SPEC §0, §2.1).

test("token: prefisso ucq_, 192 bit in base64url, impronta di 64 esadecimali", () => {
  assert.equal(REFERENT_TOKEN_BYTES * 8, 192);
  const seen = new Set<string>();
  for (let i = 0; i < 50; i++) {
    const { token, hash } = newReferentToken();
    assert.match(token, /^ucq_[A-Za-z0-9_-]{32}$/);
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.equal(hash, hashReferentToken(token));
    assert.equal(hash, createHash("sha256").update(token).digest("hex"));
    assert.ok(!seen.has(token));
    seen.add(token);
  }
});

test("token: la forma si controlla prima di ogni lettura", () => {
  const { token } = newReferentToken();
  assert.ok(looksLikeReferentToken(token));
  assert.equal(looksLikeReferentToken(token.replace("ucq_", "ucr_")), false);
  assert.equal(looksLikeReferentToken(`${token}x`), false);
  assert.equal(looksLikeReferentToken(token.slice(0, -1)), false);
  assert.equal(looksLikeReferentToken("ucq_" + "a".repeat(31) + "!"), false);
  assert.equal(looksLikeReferentToken(undefined), false);
  assert.equal(looksLikeReferentToken(42), false);
  assert.throws(() => hashReferentToken("ucr_abc"));
});

test("recipientHash: spazi intorno e maiuscole non contano", () => {
  const base = createHash("sha256").update("mario.rossi@topjet.it", "utf8").digest("hex");
  assert.equal(recipientHash("mario.rossi@topjet.it"), base);
  assert.equal(recipientHash("  Mario.Rossi@TopJet.IT \n"), base);
  assert.notEqual(recipientHash("mario.rossi2@topjet.it"), base);
});

test("RECIPIENT_HASH_SQL: la stessa impronta in SQL, solo su colonne fidate", () => {
  assert.equal(RECIPIENT_HASH_SQL("c.email"), "encode(sha256(convert_to(lower(btrim(c.email)), 'UTF8')), 'hex')");
  assert.throws(() => RECIPIENT_HASH_SQL("c.email); DROP TABLE x; --"));
  assert.throws(() => RECIPIENT_HASH_SQL("'a'"));
});
