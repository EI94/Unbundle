import test from "node:test";
import assert from "node:assert/strict";
import { areaLabelOf, guideAreaLabels, humaniseAreaId } from "./guide-areas.ts";

// Il filtro «Area» con i nomi della guida (rilascio 5, §11.2, D28): mai un id a schermo.

test("i titoli della guida per id; voci malformate e doppioni ignorati", () => {
  const labels = guideAreaLabels([
    { id: "amministrazione_finanza", label: "Amministrazione e finanza" },
    { id: "operations", nome: "Operazioni di volo" },
    { id: "amministrazione_finanza", label: "Doppione" },
    { label: "Senza id" },
    "testo",
    null,
  ]);
  assert.deepEqual([...labels], [
    ["amministrazione_finanza", "Amministrazione e finanza"],
    ["operations", "Operazioni di volo"],
  ]);
  assert.equal(guideAreaLabels(null).size, 0);
});

test("un'area fuori dalla guida: l'id reso leggibile, mai così com'è", () => {
  const labels = guideAreaLabels([{ id: "commerciale", label: "Commerciale e vendite" }]);
  assert.equal(areaLabelOf("commerciale", labels), "Commerciale e vendite");
  assert.equal(areaLabelOf("customer_care", labels), "Customer care");
  assert.equal(areaLabelOf("risorse-umane", labels), "Risorse umane");
  assert.equal(humaniseAreaId("Finanza"), "Finanza");
  assert.equal(humaniseAreaId("__"), "__");
  assert.doesNotMatch(areaLabelOf("ufficio_acquisti_estero", labels), /_/);
});
