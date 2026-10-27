import test from "node:test";
import assert from "node:assert/strict";
import type { NeedView } from "../needs.ts";
import { ASKABLE_SIDES, ASKABLE_STATUSES, answerableNeeds, askableNeeds } from "./questions.ts";

// Quali esigenze si chiedono al referente e quali accettano una risposta del team (SPEC §3.1, §3.9).
const UC = "3f2a9c1e-0000-4000-8000-0000000000b1";
const OTHER_UC = "3f2a9c1e-0000-4000-8000-0000000000b2";
let n = 0;
function need(over: Partial<NeedView> = {}): NeedView {
  n++;
  return {
    id: `3f2a9c1e-0000-4000-8000-${String(n).padStart(12, "0")}`,
    type: "requisito",
    kind: "dato",
    title: `Esigenza ${n}`,
    detail: null,
    ownerLabel: null,
    ownerSide: "cliente",
    status: "da_chiedere",
    availability: null,
    dueOn: null,
    dueLabel: null,
    dueIsProposal: false,
    forLabel: null,
    sortOrder: n,
    version: 1,
    importKey: null,
    createdAt: "2026-10-27T09:00:00.000Z",
    updatedAt: "2026-10-27T09:00:00.000Z",
    doneAt: null,
    archivedAt: null,
    archiveReason: null,
    useCaseIds: [UC],
    ...over,
  };
}

test("stati e lati che si chiedono", () => {
  assert.deepEqual([...ASKABLE_STATUSES], ["da_chiedere", "mancante", "parziale"]);
  assert.deepEqual([...ASKABLE_SIDES], [null, "cliente", "insieme"]);
});

test("askableNeeds: requisiti del cliente da chiedere, mancanti o parziali, collegati e non archiviati", () => {
  const yes = [need({ status: "da_chiedere" }), need({ status: "mancante", ownerSide: "insieme" }), need({ status: "parziale", ownerSide: null })];
  const no = [
    need({ status: "chiesta" }),
    need({ status: "in_verifica" }),
    need({ status: "validata" }),
    need({ status: "non_applicabile" }),
    need({ ownerSide: "lateral_space" }),
    need({ ownerSide: "fornitore" }),
    need({ type: "passo", status: "da_fare" as NeedView["status"] }),
    need({ archivedAt: "2026-10-27T10:00:00.000Z" }),
    need({ useCaseIds: [OTHER_UC] }),
  ];
  assert.deepEqual(askableNeeds([...no, ...yes].reverse(), UC).map((x) => x.id), yes.map((x) => x.id));
  assert.deepEqual(askableNeeds(yes, UC.toUpperCase()).length, 3);
});

test("askableNeeds: una «chiesta» senza risposta si chiede di nuovo (Parte 2)", () => {
  const asked = need({ status: "chiesta" });
  assert.deepEqual(askableNeeds([asked], UC), []);
  assert.deepEqual(askableNeeds([asked], UC, { silentNeedIds: new Set([asked.id]) }).map((x) => x.id), [asked.id]);
});

test("answerableNeeds: ogni requisito collegato e non archiviato, in ogni stato e di ogni lato", () => {
  const all = [need({ status: "validata", ownerSide: "lateral_space" }), need({ status: "chiesta" }), need({ status: "in_verifica", ownerSide: "fornitore" })];
  const out = [need({ type: "passo" }), need({ archivedAt: "2026-10-27T10:00:00.000Z" }), need({ useCaseIds: [OTHER_UC] })];
  assert.deepEqual(answerableNeeds([...out, ...all], UC).map((x) => x.id), all.map((x) => x.id));
});
