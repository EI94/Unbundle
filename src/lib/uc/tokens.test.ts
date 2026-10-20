import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { hashInviteToken } from "../ai-readiness/token.ts";
import * as tokens from "./tokens.ts";
import {
  deriveSubkey,
  hashRequestToken,
  ipHash,
  ipHashFromSecret,
  looksLikeRequestToken,
  newRequestToken,
  normalizeIp,
  pseudonym,
  requestLinkPath,
  requestTokenPrefix,
} from "./tokens.ts";

const SECRET = randomBytes(32).toString("base64");
const WS_A = "0b9d4c1e-6f2a-4d8b-9c3e-1a2b3c4d5e6f";
const WS_B = "7f6e5d4c-3b2a-4190-8a7b-6c5d4e3f2a1b";

test("a request token is ucr_ plus 32 base64url characters from 24 random bytes", () => {
  const issued = newRequestToken();
  assert.match(issued.token, /^ucr_[A-Za-z0-9_-]{32}$/);
  assert.equal(Buffer.from(issued.token.slice(4), "base64url").byteLength, 24);
  assert.equal(issued.prefix, issued.token.slice(0, 12));
  assert.equal(issued.prefix.length, 12);
  assert.match(issued.hash, /^[0-9a-f]{64}$/);
  assert.ok(Object.isFrozen(issued));
});

test("the stored hash is the same sha256 as the existing invite tokens", () => {
  const { token, hash } = newRequestToken();
  assert.equal(hash, hashInviteToken(token));
  assert.equal(hash, createHash("sha256").update(token).digest("hex"));
  assert.equal(hashRequestToken(token), hash);
  assert.notEqual(hash.slice(0, 12), token.slice(0, 12));
});

test("two tokens in a row are different and so are their hashes", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const { token, hash } = newRequestToken();
    assert.ok(!seen.has(token));
    assert.ok(!seen.has(hash));
    seen.add(token);
    seen.add(hash);
  }
});

test("no exported function rebuilds a token from a secret, a nonce or the database", () => {
  // newRequestToken takes no input: a token never derives from anything stored.
  assert.equal(newRequestToken.length, 0);
  const exported = Object.keys(tokens).sort();
  assert.deepEqual(exported, [
    "IP_HASH_LENGTH",
    "PSEUDONYM_HEX_LENGTH",
    "REQUEST_TOKEN_BYTES",
    "REQUEST_TOKEN_PREFIX",
    "REQUEST_TOKEN_PREFIX_LENGTH",
    "UC_KEY_PURPOSES",
    "UC_SECRET_MIN_LENGTH",
    "deriveSubkey",
    "hashRequestToken",
    "ipHash",
    "ipHashFromSecret",
    "looksLikeRequestToken",
    "newRequestToken",
    "normalizeIp",
    "pseudonym",
    "requestLinkPath",
    "requestTokenPrefix",
  ]);
  // The UC_SECRET subkeys only cover IP hashes and pseudonyms.
  assert.deepEqual([...tokens.UC_KEY_PURPOSES], ["ip", "pseudonym"]);
  assert.throws(() => deriveSubkey(SECRET, "token" as never));
});

test("the format guard accepts only request tokens", () => {
  const { token } = newRequestToken();
  assert.equal(looksLikeRequestToken(token), true);
  for (const bad of [
    "",
    "ucr_",
    `air_${token.slice(4)}`,
    `lrn_${token.slice(4)}`,
    `${token}x`,
    token.slice(0, -1),
    `UCR_${token.slice(4)}`,
    `ucr_${"a".repeat(31)}=`,
    `ucr_${"a".repeat(31)}/`,
    ` ${token}`,
    `${token}\n`,
    null,
    undefined,
    42,
    { token },
  ]) {
    assert.equal(looksLikeRequestToken(bad), false, String(bad));
  }
  assert.throws(() => hashRequestToken("not-a-token"));
  assert.throws(() => requestTokenPrefix("ucr_short"));
  assert.equal(requestLinkPath(token), `/r/${token}`);
  assert.throws(() => requestLinkPath("../x"));
});

test("subkeys come from HKDF per purpose and need a real secret", () => {
  const ip = deriveSubkey(SECRET, "ip");
  const ps = deriveSubkey(SECRET, "pseudonym");
  assert.ok(ip && ps);
  assert.equal(ip.byteLength, 32);
  assert.notDeepEqual(ip, ps);
  assert.deepEqual(deriveSubkey(` ${SECRET} `, "ip"), ip);
  assert.notDeepEqual(deriveSubkey(randomBytes(32).toString("base64"), "ip"), ip);
  assert.equal(deriveSubkey(undefined, "ip"), null);
  assert.equal(deriveSubkey(null, "ip"), null);
  assert.equal(deriveSubkey("", "ip"), null);
  assert.equal(deriveSubkey("short-secret", "ip"), null);
  assert.equal(deriveSubkey("x".repeat(31), "ip"), null);
});

test("IP hash is a keyed HMAC truncated to 32 hex characters", () => {
  const key = deriveSubkey(SECRET, "ip");
  const h = ipHash(key, "203.0.113.7");
  assert.match(h ?? "", /^[0-9a-f]{32}$/);
  // Accepted by the audit event guard (/^[0-9a-f]{16,64}$/).
  assert.match(h ?? "", /^[0-9a-f]{16,64}$/);
  assert.equal(ipHash(key, "203.0.113.7"), h);
  assert.notEqual(ipHash(key, "203.0.113.8"), h);
  assert.notEqual(ipHash(deriveSubkey(randomBytes(32).toString("base64"), "ip"), "203.0.113.7"), h);
  // Not a plain hash of the IP: without the key it cannot be rebuilt.
  assert.notEqual(h, createHash("sha256").update("203.0.113.7").digest("hex").slice(0, 32));
  assert.notEqual(h, createHash("sha256").update("ip:203.0.113.7").digest("hex").slice(0, 32));
  assert.equal(ipHashFromSecret(SECRET, "203.0.113.7"), h);
});

test("without a secret there is no IP hash at all", () => {
  assert.equal(ipHash(null, "203.0.113.7"), null);
  assert.equal(ipHash(undefined, "203.0.113.7"), null);
  assert.equal(ipHash(new Uint8Array(8), "203.0.113.7"), null);
  assert.equal(ipHashFromSecret(undefined, "203.0.113.7"), null);
  assert.equal(ipHashFromSecret("", "203.0.113.7"), null);
});

test("IP addresses are normalized before hashing, junk gives null", () => {
  assert.equal(normalizeIp(" 203.0.113.7 "), "203.0.113.7");
  assert.equal(normalizeIp("203.0.113.7:443"), "203.0.113.7");
  assert.equal(normalizeIp("::ffff:203.0.113.7"), "203.0.113.7");
  assert.equal(normalizeIp("2001:0DB8:0000:0000:0000:0000:0000:0001"), "2001:db8::1");
  assert.equal(normalizeIp("[2001:db8::1]:8443"), "2001:db8::1");
  assert.equal(normalizeIp("fe80::1%en0"), "fe80::1");
  for (const bad of ["", "   ", "unknown", "1.2.3", "999.1.1.1", "203.0.113.7, 10.0.0.1", "<script>", null, undefined]) {
    assert.equal(normalizeIp(bad), null, String(bad));
  }
  const key = deriveSubkey(SECRET, "ip");
  assert.equal(ipHash(key, "2001:0db8::0001"), ipHash(key, "[2001:db8::1]"));
  assert.equal(ipHash(key, "::ffff:203.0.113.7"), ipHash(key, "203.0.113.7"));
  assert.equal(ipHash(key, "not an ip"), null);
});

test("pseudonyms are keyed per workspace and need the secret", () => {
  const key = deriveSubkey(SECRET, "pseudonym");
  const a = pseudonym(key, WS_A, "Codice Equipaggio 7");
  assert.match(a ?? "", /^ps_[0-9a-f]{20}$/);
  assert.equal(pseudonym(key, WS_A, "  codice   equipaggio 7 "), a);
  assert.equal(pseudonym(key, WS_A.toUpperCase(), "Codice Equipaggio 7"), a);
  assert.notEqual(pseudonym(key, WS_B, "Codice Equipaggio 7"), a);
  assert.notEqual(pseudonym(key, WS_A, "Codice Equipaggio 8"), a);
  assert.notEqual(pseudonym(deriveSubkey(SECRET, "ip"), WS_A, "Codice Equipaggio 7"), a);
  assert.equal(pseudonym(null, WS_A, "x"), null);
  assert.equal(pseudonym(key, WS_A, "   "), null);
  assert.throws(() => pseudonym(key, "workspace", "x"));
});
