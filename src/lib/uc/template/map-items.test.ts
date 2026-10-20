import test from "node:test";
import assert from "node:assert/strict";
import { deriveItemKeys, keyMentions } from "./map-items.ts";

const KEYS = ["ent.richiesta", "richiesta.canale", "richiesta.priorita", "hc.orario", "hc.ferie", "sc.preferenza", "kpi.servizio.tempo"];

test("key mentions are found in free text, with or without a wildcard", () => {
  assert.deepEqual(keyMentions("Legge ent.richiesta e richiesta.canale; applica hc.* (vedi kpi.servizio.tempo)."), [
    "ent.richiesta",
    "richiesta.canale",
    "hc.*",
    "kpi.servizio.tempo",
  ]);
  assert.deepEqual(keyMentions("Nessuna chiave qui. Fine."), []);
  assert.deepEqual(keyMentions("Versione 1.2 e file report.csv"), ["report.csv"]);
});

test("known keys are kept in order of first mention, without repeats", () => {
  const d = deriveItemKeys(["richiesta.canale poi ent.richiesta", "di nuovo richiesta.canale"], KEYS);
  assert.deepEqual(d.keys, ["richiesta.canale", "ent.richiesta"]);
  assert.deepEqual(d.wildcards, []);
  assert.deepEqual(d.unresolved, []);
});

test("wildcards expand in template order; unknown mentions are reported", () => {
  const d = deriveItemKeys(["vincoli hc.* e sc.*", "manca richiesta.inesistente e dv.*", null, undefined], KEYS);
  assert.deepEqual(d.keys, ["hc.orario", "hc.ferie", "sc.preferenza"]);
  assert.deepEqual(d.wildcards, ["hc.*", "sc.*"]);
  assert.deepEqual(d.unresolved, ["richiesta.inesistente", "dv.*"]);
});

test("dotted names shaped like field keys are reported as unresolved, never resolved", () => {
  const d = deriveItemKeys(["esporta report.csv e versione.finale"], KEYS);
  assert.deepEqual(d.keys, []);
  // They have the shape of `<entita>.<campo>`: the normalizer only counts them.
  assert.deepEqual(d.unresolved, ["report.csv", "versione.finale"]);
});
