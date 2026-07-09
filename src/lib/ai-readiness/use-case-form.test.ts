import test from "node:test";
import assert from "node:assert/strict";
import {
  USE_CASE_FORM_BLOCKS,
  USE_CASE_FORM_FIELDS,
  collectUseCaseValues,
  mapUseCaseColumns,
} from "./use-case-form.ts";
// buildUseCaseFormPdf importa solo il TIPO di UseCaseBlock: i blocchi si passano.
import { buildUseCaseFormPdf } from "./question-doc.ts";

test("il modulo ha 3 blocchi (bisogno, AS-IS, ipotesi AI) e campi unici", () => {
  assert.equal(USE_CASE_FORM_BLOCKS.length, 3);
  const ids = USE_CASE_FORM_FIELDS.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
  // AS-IS copre processo, persone, strumenti, dati
  const asIs = USE_CASE_FORM_BLOCKS[1].fields.map((f) => f.id);
  for (const id of ["currentProcess", "peopleInvolved", "toolsUsed", "dataNeeded"]) {
    assert.ok(asIs.includes(id), `AS-IS manca ${id}`);
  }
});

test("collect + mappatura su colonne DB, titolo obbligatorio", () => {
  const values = collectUseCaseValues((name) =>
    ({
      title: "Preventivi",
      painPoint: "Ci vuole troppo tempo",
      currentProcess: "Si fa a mano su Excel",
      peopleInvolved: "Ufficio vendite",
      affectedUsers: "5",
      riskLevel: "Alta",
      ignoto: "scartami",
    })[name] ?? null
  );
  assert.ok(!("ignoto" in values));
  const cols = mapUseCaseColumns(values);
  assert.ok(cols);
  assert.equal(cols.title, "Preventivi");
  assert.equal(cols.painPoint, "Ci vuole troppo tempo");
  assert.equal(cols.peopleInvolved, "Ufficio vendite");
  assert.equal(cols.affectedUsers, 5);
  assert.equal(cols.riskLevel, "Alta");
  assert.equal(cols.desiredOutcome, null);
});

test("senza titolo la mappatura fallisce (null)", () => {
  const cols = mapUseCaseColumns({ painPoint: "x" });
  assert.equal(cols, null);
});

test("PDF modulo use case: valido, con i tre blocchi e le domande chiave", () => {
  const buf = buildUseCaseFormPdf({
    assessmentName: "Test",
    displayName: "Acme",
    generatedAt: new Date("2026-07-08T10:00:00Z"),
    blocks: USE_CASE_FORM_BLOCKS,
  });
  const txt = buf.toString("latin1");
  assert.ok(txt.startsWith("%PDF-1.4"));
  assert.ok((txt.match(/\/Type \/Page[^s]/g) ?? []).length >= 1);
  assert.ok(txt.includes("Modulo use case"));
  assert.ok(txt.includes("Chi ci lavora e con che ruolo"));
  assert.ok(txt.includes("Come immagini che l'AI possa aiutare"));
  assert.ok(txt.includes("Come viene gestito oggi"));
});
