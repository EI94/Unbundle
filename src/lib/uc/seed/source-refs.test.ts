import test from "node:test";
import assert from "node:assert/strict";
import { extractContractRefs, extractSourceRefs, SOURCE_REF_UNKNOWN, sourceRefLabel } from "./source-refs.ts";

test("source ids: facts F…, F-M/F-T and emails E1/E2, in order and without duplicates", () => {
  assert.deepEqual(extractSourceRefs("Circa 40 (F001, F014a); confermato in E2 e F-M3, poi F-T12 e di nuovo F001."), ["F001", "F014a", "E2", "F-M3", "F-T12"]);
  assert.deepEqual(extractSourceRefs("F12, F0012, E3, XF001, F001b2, e1"), []);
  assert.deepEqual(extractSourceRefs("nessuna fonte"), []);
});

test("source_ref label: joined ids, a fixed text without ids, capped at 500 characters", () => {
  assert.equal(sourceRefLabel(["F001", "E1"]), "F001, E1");
  assert.equal(sourceRefLabel([]), SOURCE_REF_UNKNOWN);
  assert.equal(SOURCE_REF_UNKNOWN, "dichiarato in call (fonte non indicata)");
  const many = Array.from({ length: 200 }, (_, i) => `F${String(i).padStart(3, "0")}`);
  const label = sourceRefLabel(many);
  assert.ok(label.length <= 500);
  assert.ok(label.endsWith("F082"));
});

test("contract references: articles and annexes, normalized and deduplicated", () => {
  assert.deepEqual(extractContractRefs(["Vale l'art. 5.1 (vedi anche Art. 5.1).", "Artt. 2, 3 e 4 e All. B.3; art. 15.4."]), [
    "art. 5.1",
    "art. 2",
    "art. 3",
    "art. 4",
    "All. B.3",
    "art. 15.4",
  ]);
  assert.deepEqual(extractContractRefs(["Allegato tecnico", "l'arte. 5", "art. A"]), []);
  assert.deepEqual(extractContractRefs(["all. C"]), ["All. C"]);
});
