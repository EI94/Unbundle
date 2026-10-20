import test from "node:test";
import assert from "node:assert/strict";
import { parseRedactionNames, parseSeedText, SEED_MAX_BYTES, validateSeed } from "./schema.ts";
import { sampleSeed } from "./seed.fixtures.ts";

function issuesOf(input: unknown): string[] {
  const r = validateSeed(input);
  assert.equal(r.ok, false);
  return r.ok ? [] : r.issues.map((i) => `${i.path}:${i.code}`);
}

test("a valid seed parses, also from text with a BOM", () => {
  const r = parseSeedText(`﻿${JSON.stringify(sampleSeed())}`);
  assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.issues));
  assert.equal(r.value.answers.length, 8);
});

test("the format refuses unknown fields and wrong schema ids", () => {
  assert.ok(issuesOf({ ...sampleSeed(), extra: 1 }).some((i) => i.startsWith(":unrecognized_keys")));
  assert.ok(issuesOf({ ...sampleSeed(), schema: "unbundle.uc-case-seed/2" }).includes("schema:invalid_value"));
});

test("only import states are allowed: no validated or not-applicable items from a seed", () => {
  for (const state of ["validata", "non_applicabile", "chiesta", "parziale"]) {
    const seed = sampleSeed() as unknown as { answers: { initial_state: string }[] };
    seed.answers[0].initial_state = state;
    assert.ok(issuesOf(seed).includes("answers[0].initial_state:invalid_value"), state);
  }
});

test("a seed cannot resolve a blocker, and only the health blocker is permanent", () => {
  const resolved = sampleSeed() as unknown as { blockers: { key: string; status: string }[] };
  resolved.blockers[0].status = "sciolto";
  assert.ok(issuesOf(resolved).includes("blockers[0].status:invalid_value"));
  const health = sampleSeed();
  health.blockers[1] = { key: "sanitario", status: "aperto" };
  assert.ok(issuesOf(health).includes("blockers[1].status:solo_sanitario_permanente"));
  const permanent = sampleSeed();
  permanent.blockers[0] = { key: "a8", status: "permanente" };
  assert.ok(issuesOf(permanent).includes("blockers[0].status:solo_sanitario_permanente"));
});

test("declared values always carry their provenance, and keys are unique", () => {
  const noSource = sampleSeed();
  noSource.answers[0] = { ...noSource.answers[0], known_value_source_kind: null };
  assert.ok(issuesOf(noSource).includes("answers[0].known_value_source_kind:valore_senza_provenienza"));
  const sourceOnly = sampleSeed();
  sourceOnly.answers[5] = { ...sourceOnly.answers[5], known_value_source_kind: "dichiarato_in_call" };
  assert.ok(issuesOf(sourceOnly).includes("answers[5].known_value_source_kind:valore_senza_provenienza"));
  const dup = sampleSeed();
  dup.answers.push({ ...dup.answers[0] });
  assert.ok(issuesOf(dup).includes("answers[8]:chiave_doppia"));
  const notQuestion = sampleSeed();
  notQuestion.answers[0] = { ...notQuestion.answers[0], item_key: "kpi.vendite.tempo" };
  assert.ok(issuesOf(notQuestion).includes("answers[0].item_key:invalid_format"));
});

test("errors carry paths and codes, never the text of the file", () => {
  const seed = sampleSeed() as unknown as { case: { code: string }; answers: { known_value: unknown }[] };
  seed.case.code = "segreto del cliente";
  seed.answers[0].known_value = { segreto: "valore riservato" };
  const r = validateSeed(seed);
  assert.equal(r.ok, false);
  const json = JSON.stringify(r);
  assert.ok(!json.includes("segreto"));
  assert.ok(!json.includes("riservato"));
  assert.match(r.ok ? "" : r.message, /problemi/);
});

test("text input: invalid JSON and oversized files", () => {
  const bad = parseSeedText("{ non json");
  assert.equal(bad.ok ? "" : bad.code, "json_non_valido");
  const big = parseSeedText(" ".repeat(SEED_MAX_BYTES + 1));
  assert.equal(big.ok ? "" : big.code, "file_troppo_grande");
});

test("the names file: list or object, deduplicated, longest first", () => {
  const r = parseRedactionNames(JSON.stringify(["Anna", "  Anna   Maria ", "anna", "Bruno Esempio"]));
  assert.ok(r.ok);
  assert.deepEqual(r.value, ["Bruno Esempio", "Anna Maria", "Anna"]);
  const o = parseRedactionNames(JSON.stringify({ schema: "unbundle.uc-redaction-names/1", names: ["Carla Prova"] }));
  assert.deepEqual(o.ok ? o.value : null, ["Carla Prova"]);
  assert.equal(parseRedactionNames("[").ok, false);
  assert.equal(parseRedactionNames(JSON.stringify(["A"])).ok, false);
  assert.equal(parseRedactionNames(JSON.stringify({ nomi: [] })).ok, false);
});
