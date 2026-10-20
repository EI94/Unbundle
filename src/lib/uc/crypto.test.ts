import test from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, randomBytes, randomUUID } from "node:crypto";
import {
  CURRENT_KEK_VERSION,
  ENCRYPTION_KEY_REF,
  ENVELOPE_HEADER_BYTES,
  deriveWorkspaceKek,
  envelopeAad,
  envelopeKekVersion,
  isEnvelope,
  openEnvelope,
  openJson,
  parsePersonalZoneKey,
  personalZoneKeyConfigured,
  sealEnvelope,
  sealJson,
  type WorkspaceKek,
} from "./crypto.ts";

// Synthetic keys generated per run: no secret lives in the repository.
const MASTER = randomBytes(32).toString("base64");
const OTHER_MASTER = randomBytes(32).toString("base64");
const WS: string = randomUUID();
const WS_2 = randomUUID();
const CASE = randomUUID();
const OBJECT = randomUUID();
const AAD = envelopeAad({ workspaceId: WS, caseId: CASE, objectId: OBJECT });

function kek(master = MASTER, ws = WS): WorkspaceKek {
  const result = deriveWorkspaceKek(master, ws);
  assert.ok(result.ok, "KEK derivation failed");
  return result.value;
}

test("without a key the personal zone refuses", () => {
  for (const missing of [undefined, null, "", "   "]) {
    const result = deriveWorkspaceKek(missing, WS);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "chiave_assente");
    assert.equal(personalZoneKeyConfigured(missing), false);
  }
});

test("the master key must be exactly 32 bytes of base64 and not a placeholder", () => {
  assert.equal(parsePersonalZoneKey(MASTER).ok, true);
  assert.equal(parsePersonalZoneKey(` ${MASTER}\n`).ok, true);
  const url = randomBytes(32).toString("base64url");
  assert.equal(parsePersonalZoneKey(url).ok, true);
  assert.deepEqual((parsePersonalZoneKey(url) as { value: Buffer }).value, Buffer.from(url, "base64url"));
  for (const bad of [
    randomBytes(16).toString("base64"),
    randomBytes(48).toString("base64"),
    "change-me",
    "x".repeat(44),
    Buffer.alloc(32).toString("base64"),
    Buffer.alloc(32, 7).toString("base64"),
    `${MASTER.slice(0, 42)}!=`,
  ]) {
    const result = parsePersonalZoneKey(bad);
    assert.equal(result.ok, false, bad);
    if (!result.ok) assert.equal(result.code, "chiave_non_valida");
  }
  assert.equal(personalZoneKeyConfigured(MASTER), true);
});

test("a sealed envelope opens with the same KEK and AAD", () => {
  const k = kek();
  const plaintext = Buffer.from("colonna_a;colonna_b\n1;2\n", "utf8");
  const sealed = sealEnvelope(k, plaintext, AAD);
  assert.equal(sealed.subarray(0, 4).toString("ascii"), "UCZ1");
  assert.equal(sealed[4], CURRENT_KEK_VERSION);
  assert.equal(sealed.byteLength, ENVELOPE_HEADER_BYTES + plaintext.byteLength);
  assert.equal(isEnvelope(sealed), true);
  assert.equal(envelopeKekVersion(sealed), 1);
  assert.equal(sealed.includes(plaintext), false);
  const opened = openEnvelope(k, sealed, AAD);
  assert.ok(opened.ok);
  assert.deepEqual(opened.value, plaintext);
  // A KEK derived again from the same master opens it too.
  assert.ok(openEnvelope(kek(), sealed, AAD).ok);
  // Empty content works.
  const empty = openEnvelope(k, sealEnvelope(k, "", AAD), AAD);
  assert.ok(empty.ok && empty.value.byteLength === 0);
});

test("every envelope uses fresh randomness", () => {
  const k = kek();
  const a = sealEnvelope(k, "stesso contenuto", AAD);
  const b = sealEnvelope(k, "stesso contenuto", AAD);
  assert.notDeepEqual(a, b);
  assert.notDeepEqual(a.subarray(5, 17), b.subarray(5, 17));
  assert.notDeepEqual(a.subarray(33, 65), b.subarray(33, 65));
});

test("GCM detects tampering anywhere in the envelope", () => {
  const k = kek();
  const sealed = sealEnvelope(k, "contenuto riservato", AAD);
  for (let index = 5; index < sealed.byteLength; index++) {
    const tampered = Buffer.from(sealed);
    tampered[index] ^= 0x01;
    const result = openEnvelope(k, tampered, AAD);
    assert.equal(result.ok, false, `byte ${index}`);
    if (!result.ok) assert.equal(result.code, "busta_non_valida");
  }
  const truncated = openEnvelope(k, sealed.subarray(0, sealed.byteLength - 1), AAD);
  assert.equal(truncated.ok, false);
  const extended = openEnvelope(k, Buffer.concat([sealed, Buffer.from([0])]), AAD);
  assert.equal(extended.ok, false);
  const badMagic = Buffer.from(sealed);
  badMagic[0] = 0x58;
  assert.equal(openEnvelope(k, badMagic, AAD).ok, false);
  assert.equal(openEnvelope(k, Buffer.alloc(10), AAD).ok, false);
});

test("a wrong key or a wrong AAD is an error", () => {
  const sealed = sealEnvelope(kek(), "contenuto riservato", AAD);
  const wrongMaster = openEnvelope(kek(OTHER_MASTER), sealed, AAD);
  assert.equal(wrongMaster.ok, false);
  if (!wrongMaster.ok) assert.equal(wrongMaster.code, "busta_non_valida");
  const otherObject = envelopeAad({ workspaceId: WS, caseId: CASE, objectId: randomUUID() });
  assert.equal(openEnvelope(kek(), sealed, otherObject).ok, false);
  const otherCase = envelopeAad({ workspaceId: WS, caseId: randomUUID(), objectId: OBJECT });
  assert.equal(openEnvelope(kek(), sealed, otherCase).ok, false);
});

test("each workspace has its own KEK", () => {
  const a = kek(MASTER, WS);
  const b = kek(MASTER, WS_2);
  assert.notDeepEqual(a.key, b.key);
  assert.deepEqual(kek(MASTER, WS.toUpperCase()).key, a.key);
  const sealed = sealEnvelope(a, "contenuto", AAD);
  assert.equal(openEnvelope(b, sealed, AAD).ok, false);
  assert.equal(deriveWorkspaceKek(MASTER, "not-a-uuid").ok, false);
});

test("the version byte is checked and authenticated", () => {
  const k = kek();
  const sealed = sealEnvelope(k, "contenuto", AAD);
  const future: WorkspaceKek = { ...k, version: 2 };
  const result = openEnvelope(future, sealed, AAD);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "versione_chiave");
  // Rewriting the version byte breaks authentication even with a matching KEK version.
  const rewritten = Buffer.from(sealed);
  rewritten[4] = 2;
  const forged = openEnvelope(future, rewritten, AAD);
  assert.equal(forged.ok, false);
  if (!forged.ok) assert.equal(forged.code, "busta_non_valida");
});

test("the layout matches the documented format", () => {
  const k = kek();
  const plaintext = Buffer.from("verifica del formato");
  const sealed = sealEnvelope(k, plaintext, AAD);
  // Re-encrypt by hand with the DEK unwrapped from the envelope: the parts sit where the format says.
  const ad = Buffer.concat([Buffer.from("UCZ1"), Buffer.from([1]), Buffer.from(AAD)]);
  const ivWrap = sealed.subarray(5, 17);
  const dekWrapped = sealed.subarray(33, 65);
  const iv = sealed.subarray(65, 77);
  const ct = sealed.subarray(93);
  // GCM is CTR-based: encrypting the wrapped DEK with the same key and IV gives back the DEK.
  const unwrap = createCipheriv("aes-256-gcm", k.key, ivWrap);
  unwrap.setAAD(ad);
  const dek = unwrap.update(dekWrapped);
  const again = createCipheriv("aes-256-gcm", dek, iv);
  again.setAAD(ad);
  assert.deepEqual(again.update(ct), plaintext);
});

test("JSON values round-trip and the AAD is strict", () => {
  const k = kek();
  const value = { righe: [["a", 1], ["b", 2]], nota: "valore personale sintetico" };
  const sealed = sealJson(k, value, AAD);
  const opened = openJson(k, sealed, AAD);
  assert.ok(opened.ok);
  assert.deepEqual(opened.value, value);
  const garbage = sealEnvelope(k, "{not json", AAD);
  const bad = openJson(k, garbage, AAD);
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.code, "json_non_valido");
  assert.throws(() => envelopeAad({ workspaceId: WS, caseId: CASE, objectId: "x|y" }));
  assert.throws(() => envelopeAad({ workspaceId: "", caseId: CASE, objectId: OBJECT }));
  assert.equal(envelopeAad({ workspaceId: WS.toUpperCase(), caseId: CASE, objectId: OBJECT }), AAD);
  assert.throws(() => sealEnvelope(k, "x", ""));
  assert.throws(() => sealEnvelope({ ...k, key: Buffer.alloc(16) }, "x", AAD));
});

test("the key reference stored on files names the variable, never the key", () => {
  assert.equal(ENCRYPTION_KEY_REF, "UC_PERSONAL_ZONE_KEY/v1/hkdf");
  assert.ok(ENCRYPTION_KEY_REF.length <= 120);
  assert.equal(ENCRYPTION_KEY_REF.includes(MASTER), false);
});
