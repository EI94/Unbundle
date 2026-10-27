import test from "node:test";
import assert from "node:assert/strict";
import type { ValueModel } from "../value-model.ts";
import { PREPARED_QUESTIONS, gapsOf, missingPreparedQuestions, preparedImportKey, preparedNeedInput } from "./prepare.ts";
import { checkQuestionTitle } from "./text.ts";

// «Prepara le domande» (SPEC §6).
const UC = "3F2A9C1E-0000-4000-8000-0000000000B1";
const ALL = ["frequenza", "tempo", "persone", "sistemi", "esempio", "costi"];
const model = (components: unknown[]) => ({ components }) as unknown as ValueModel;
const base = { useCaseId: UC, intake: null, valueModel: null, linkedNeeds: [] as { kind: "dato" | "documento"; archivedAt: string | null }[] };

test("le sei domande: chiavi, tipi, ordine, testi brevi che passano il controllo", () => {
  assert.deepEqual(PREPARED_QUESTIONS.map((q) => q.key), ALL);
  assert.deepEqual(PREPARED_QUESTIONS.map((q) => q.sortOrder), [100, 110, 120, 130, 140, 150]);
  assert.equal(PREPARED_QUESTIONS.find((q) => q.key === "persone")?.kind, "dato");
  assert.equal(PREPARED_QUESTIONS.find((q) => q.key === "esempio")?.kind, "documento");
  for (const q of PREPARED_QUESTIONS) {
    assert.ok(q.title.length <= 300, q.key);
    assert.deepEqual(checkQuestionTitle(q.title), { ok: true }, q.key);
  }
});

test("una scheda vuota: tutte e sei le lacune", () => {
  assert.deepEqual(gapsOf(base), ALL);
});

test("le componenti in ore tolgono frequenza e tempo; i costi in euro tolgono i costi", () => {
  const vm = model([
    { kind: "ore", lever: "tempo", volumeYear: 5000, minutesPerUnit: 3 },
    { kind: "euro", lever: "costi", eurYear: 1200 },
  ]);
  assert.deepEqual(gapsOf({ ...base, valueModel: vm }), ["persone", "sistemi", "esempio"]);
  const zero = model([{ kind: "ore", lever: "tempo", volumeYear: 0, minutesPerUnit: 0 }, { kind: "euro", lever: "ricavi", eurYear: 9 }]);
  assert.deepEqual(gapsOf({ ...base, valueModel: zero }), ALL);
});

test("l'intake del connettore: frequenza nota, minuti, persone, programmi, valore per volta", () => {
  const intake = { frequency: "giornaliera", timeSavedMinutesPerRun: 4, beneficiaries: 3, tools: ["gestionale"], valuePerRunEur: 2 };
  assert.deepEqual(gapsOf({ ...base, intake }), ["esempio"]);
  assert.deepEqual(gapsOf({ ...base, intake: { frequency: "a volte" } }), ALL, "una frequenza sconosciuta non conta");
  assert.ok(gapsOf({ ...base, intake: { beneficiaries: 2.5 } }).includes("persone"));
  assert.ok(gapsOf({ ...base, intake: { tools: ["altro", " "] } }).includes("sistemi"));
  assert.ok(!gapsOf({ ...base, intake: { toolsOther: "Zucchetti" } }).includes("sistemi"));
});

test("un documento collegato non archiviato toglie l'esempio", () => {
  assert.ok(!gapsOf({ ...base, linkedNeeds: [{ kind: "documento", archivedAt: null }] }).includes("esempio"));
  assert.ok(gapsOf({ ...base, linkedNeeds: [{ kind: "documento", archivedAt: "2026-10-27T10:00:00.000Z" }] }).includes("esempio"));
});

test("le chiavi già nel workspace, anche archiviate, non tornano", () => {
  const keys = new Set([preparedImportKey(UC, "frequenza"), preparedImportKey(UC, "costi")]);
  assert.equal(preparedImportKey(UC, "tempo"), `referente:${UC.toLowerCase()}:tempo`);
  assert.deepEqual(missingPreparedQuestions({ ...base, existingImportKeys: keys }).map((q) => q.key), ["tempo", "persone", "sistemi", "esempio"]);
});

test("l'esigenza nuova: requisito del cliente, da chiedere, subito, con la chiave", () => {
  const q = PREPARED_QUESTIONS[0];
  assert.deepEqual(preparedNeedInput(q, UC), {
    type: "requisito",
    kind: "dato",
    title: q.title,
    detail: q.detail,
    ownerLabel: null,
    ownerSide: "cliente",
    status: "da_chiedere",
    availability: "subito",
    dueOn: null,
    dueLabel: null,
    dueIsProposal: false,
    forLabel: null,
    sortOrder: 100,
    importKey: `referente:${UC.toLowerCase()}:frequenza`,
  });
});
