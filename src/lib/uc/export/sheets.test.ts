import test from "node:test";
import assert from "node:assert/strict";
import { csvCell } from "../../learning/policy.ts";
import { buildCatalogSnapshot, type CatalogSnapshot } from "../snapshot.ts";
import { sampleInput } from "../snapshot.fixtures.ts";
import { catalogToSheets, sheetText } from "./sheets.ts";

function snap(over: Parameters<typeof sampleInput>[0] = {}): CatalogSnapshot {
  const r = buildCatalogSnapshot(sampleInput(over));
  assert.ok(r.ok);
  return r.value;
}

test("sheetText applies the csvCell formula guard without CSV quotes", () => {
  for (const sample of ["=1+1", "+cmd", "-2", "@SUM(A1)", "  =x", "\t=x", "normale", "", "a=b"]) {
    const inner = csvCell(sample).slice(1, -1).replaceAll('""', '"');
    assert.equal(sheetText(sample).replace(/[\t]/g, ""), inner.replace(/[\t]/g, ""), sample);
  }
  assert.equal(sheetText("a\u0000b\u0007c"), "abc");
  assert.equal(sheetText("x".repeat(40_000)).length, 32_767);
});

test("sheets: five named sheets, formula-safe text, draft column only in drafts", () => {
  const sheets = catalogToSheets(snap());
  assert.deepEqual(sheets.map((s) => s.name), ["Catalogo", "Dizionario dati", "Regole", "KPI", "Gate"]);
  const catalog = sheets[0].rows;
  assert.equal(catalog.length, 10);
  const formula = catalog.find((r) => r.ID === "q.esempio.05");
  assert.equal(formula?.Valore, "'=SOMMA(A1)");
  assert.equal(catalog[0].Validazione, undefined);
  assert.ok(!JSON.stringify(sheets).includes("dato personale inventato"));
  assert.deepEqual(sheets[1].rows.map((r) => [r.Entità, r.Campo]), [
    ["ent.richiesta", ""],
    ["ent.richiesta", "richiesta.cliente"],
    ["ent.richiesta", "richiesta.durata"],
  ]);
  assert.equal(sheets[2].rows[0]["Forma logica"], "SE urgente ALLORA prima");
  assert.equal(sheets[3].rows[0].Formula, "media(durata)");
  assert.equal(sheets[3].rows[0].Unità, "min");
  assert.deepEqual(sheets[4].rows[0]["Voci richieste"], 3);
  assert.equal(sheets[4].rows[0]["Versione del catalogo"], 1);

  const draft = catalogToSheets(snap({ version: "bozza", frozenAt: null }));
  const row = draft[0].rows.find((r) => r.ID === "q.esempio.03");
  assert.equal(row?.Validazione, "non validata");
  assert.equal(draft[0].rows.find((r) => r.ID === "q.esempio.01")?.Validazione, "");
});
