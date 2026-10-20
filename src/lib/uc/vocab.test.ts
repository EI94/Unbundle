import test from "node:test";
import assert from "node:assert/strict";
import * as vocab from "./vocab.ts";

const lists = (Object.entries(vocab) as [string, unknown][]).filter((entry): entry is [string, readonly string[]] => Array.isArray(entry[1]));

test("every vocabulary is non-empty, unique and uses stable lowercase codes", () => {
  assert.ok(lists.length >= 40, `found ${lists.length} vocabularies`);
  for (const [name, values] of lists) {
    assert.ok(values.length > 0, `${name} is empty`);
    assert.equal(new Set(values).size, values.length, `${name} has duplicates`);
    const pattern = name === "GATE_KEYS" ? /^G[1-4]$/ : /^[a-z0-9_]+$/;
    for (const value of values) assert.match(value, pattern, `${name}: ${value}`);
  }
});

test("case roles split exactly into Lateral Space, client and shared roles", () => {
  const all = [...vocab.LS_CASE_ROLES, ...vocab.CLIENT_CASE_ROLES, ...vocab.SHARED_CASE_ROLES];
  assert.equal(new Set(all).size, all.length);
  assert.deepEqual([...all].sort(), [...vocab.CASE_ROLES].sort());
  for (const role of vocab.LS_CASE_ROLES) assert.ok(role.startsWith("ls_"));
});

test("subsets stay inside their parent vocabulary", () => {
  for (const s of vocab.LIVE_REQUEST_STATUSES) assert.ok(vocab.isVocab(vocab.REQUEST_STATUSES, s));
  for (const s of vocab.ACTIVE_REQUEST_ITEM_STATES) assert.ok(vocab.isVocab(vocab.REQUEST_ITEM_STATES, s));
  for (const s of vocab.PERSONAL_PRIVACY_CLASSES) assert.ok(vocab.isVocab(vocab.PRIVACY_CLASSES, s));
  assert.ok(vocab.isVocab(vocab.PRIVACY_CLASSES, vocab.HEALTH_PRIVACY_CLASS));
  for (const s of vocab.BLOCKER_KEYS) assert.match(s, /^[a-z0-9_]+$/);
});

test("privacy classes are ordered from the most restrictive", () => {
  assert.deepEqual(vocab.PRIVACY_CLASSES, ["escluso_sanitario", "personale_equipaggio", "personale", "riservato_azienda", "nessuna"]);
});

test("the specification counts are preserved", () => {
  assert.equal(vocab.CASE_STATUSES.length, 11);
  assert.equal(vocab.ITEM_STATUSES.length, 8);
  assert.equal(vocab.ITEM_KINDS.length, 16);
  assert.equal(vocab.CASE_ROLES.length, 7);
  assert.equal(vocab.LEVERS.length, 8);
  // 21 types in the specification minus «azioni_universali», which are actions.
  assert.equal(vocab.RESPONSE_TYPES.length, 20);
  assert.ok(!vocab.isVocab(vocab.RESPONSE_TYPES, "azioni_universali"));
});

test("isVocab narrows only to known values", () => {
  assert.equal(vocab.isVocab(vocab.ITEM_STATUSES, "validata"), true);
  assert.equal(vocab.isVocab(vocab.ITEM_STATUSES, "VALIDATA"), false);
  assert.equal(vocab.isVocab(vocab.ITEM_STATUSES, null), false);
  assert.equal(vocab.isVocab(vocab.ITEM_STATUSES, 3), false);
});
