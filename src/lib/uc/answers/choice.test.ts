import test from "node:test";
import assert from "node:assert/strict";
import { choiceOptions, isDontKnowText, isOtherOption, normalizeScelta, normalizeSceltaMultipla, normalizeSiNo, parseYesNo } from "./choice.ts";

const OPTIONS = { options: ["Ogni ora", "Ogni settimana", "Ogni mese"] };
const codes = (o: { errors: { code: string }[] }) => o.errors.map((e) => e.code);

test("si_no accepts sì, si, no, vero, falso and booleans, with an optional note", () => {
  for (const yes of ["sì", "Si", "SI", "vero", "true", true, 1, "sì."]) assert.equal(parseYesNo(yes), true, String(yes));
  for (const no of ["no", "NO", "falso", "false", false, 0]) assert.equal(parseYesNo(no), false, String(no));
  for (const neither of ["forse", "", 2, null, "non lo so"]) assert.equal(parseYesNo(neither), null, String(neither));
  assert.deepEqual(normalizeSiNo({ value: "sì", note: " solo d'estate " }).value, { value: true, note: "solo d'estate" });
  assert.deepEqual(normalizeSiNo("no").normalized, { value: false });
  assert.deepEqual(codes(normalizeSiNo("forse")), ["scelta_mancante"]);
});

test("choiceOptions accepts strings and {value,label} objects", () => {
  assert.deepEqual(choiceOptions({ options: [" A ", { value: "b", label: "B" }, "", 3, { value: "" }] as never }), [
    { value: "A", label: "A" },
    { value: "b", label: "B" },
  ]);
  assert.deepEqual(choiceOptions({}), []);
});

test("«Non lo so» is never an option and «Altro» needs the text", () => {
  for (const t of ["Non lo so", "non so", "boh", "Non saprei"]) assert.ok(isDontKnowText(t), t);
  assert.ok(!isDontKnowText("Non lo sappiamo ancora tutto"));
  // Same rule as the template normalizer and validator.
  for (const t of ["Non lo sappiamo", "Non lo so ancora", "Nessuna idea"]) assert.ok(isDontKnowText(t), t);
  for (const t of ["Altro", "altri", "Altro (specificare)", "Altro: quale?", "Altro (da specificare)"]) assert.ok(isOtherOption(t), t);
  for (const t of ["Altre compagnie", "Altrove", "Alto"]) assert.ok(!isOtherOption(t), t);
  assert.deepEqual(codes(normalizeScelta("Non lo so", OPTIONS)), ["non_so_non_e_opzione"]);
});

test("scelta matches options without accents or case", () => {
  assert.deepEqual(normalizeScelta("ogni ora", OPTIONS).value, { option: "Ogni ora" });
  assert.deepEqual(normalizeScelta({ option: "OGNI  MESE" }, OPTIONS).normalized, { option: "Ogni mese" });
  assert.deepEqual(normalizeScelta({ option: "b" }, { options: [{ value: "b", label: "Per volo" }] }).value, { option: "b" });
  assert.deepEqual(normalizeScelta("per volo", { options: [{ value: "b", label: "Per volo" }] }).value, { option: "b" });
  assert.deepEqual(codes(normalizeScelta("Ogni anno", OPTIONS)), ["opzione_non_valida"]);
  assert.deepEqual(codes(normalizeScelta("", OPTIONS)), ["scelta_mancante"]);
});

test("scelta with «Altro»: from the list or allowed by the item", () => {
  const withOther = { options: ["A", "B", "Altro"] };
  assert.deepEqual(codes(normalizeScelta({ option: "Altro" }, withOther)), ["altro_senza_testo"]);
  assert.deepEqual(normalizeScelta({ option: "Altro", other_text: " Ogni stagione " }, withOther).normalized, {
    option: "Altro",
    other_text: "Ogni stagione",
  });
  assert.deepEqual(normalizeScelta({ option: "altro", other_text: "x" }, { options: ["A", "B"], allow_other: true }).value, {
    option: "altro",
    other_text: "x",
  });
  assert.deepEqual(codes(normalizeScelta({ option: "altro" }, { options: ["A", "B"] })), ["opzione_non_valida"]);
});

test("scelta without a list keeps the text with a warning", () => {
  const o = normalizeScelta("qualcosa", {});
  assert.deepEqual(o.value, { option: "qualcosa" });
  assert.equal(o.warnings[0].code, "opzioni_assenti");
});

test("scelta_multipla: no duplicates, min and max", () => {
  const cfg = { options: ["WhatsApp", "Email", "Telefono", "Sito"], min_choices: 1, max_choices: 3 };
  assert.deepEqual(normalizeSceltaMultipla({ options: ["whatsapp", "Email"] }, cfg).normalized, { options: ["WhatsApp", "Email"] });
  assert.deepEqual(normalizeSceltaMultipla("WhatsApp; Email\nSito", cfg).value, { options: ["WhatsApp", "Email", "Sito"] });
  assert.deepEqual(codes(normalizeSceltaMultipla({ options: ["Email", "email"] }, cfg)), ["opzione_doppia"]);
  assert.deepEqual(codes(normalizeSceltaMultipla({ options: [] }, cfg)), ["troppo_poche_scelte"]);
  assert.deepEqual(codes(normalizeSceltaMultipla({ options: ["WhatsApp", "Email", "Telefono", "Sito"] }, cfg)), ["troppe_scelte"]);
  assert.deepEqual(codes(normalizeSceltaMultipla({ options: ["Fax"] }, cfg)), ["opzione_non_valida", "troppo_poche_scelte"]);
  assert.deepEqual(codes(normalizeSceltaMultipla({ options: ["Non lo so"] }, cfg)), ["non_so_non_e_opzione", "troppo_poche_scelte"]);
  assert.deepEqual(codes(normalizeSceltaMultipla({ options: ["Email"] }, { ...cfg, min_choices: 2 })), ["troppo_poche_scelte"]);
  assert.deepEqual(codes(normalizeSceltaMultipla(42, cfg)), ["scelta_mancante"]);
  assert.equal(normalizeSceltaMultipla({ options: ["Fax"] }, cfg).errors[0].field, "options[0]");
});

test("scelta_multipla with «Altro» needs the text", () => {
  const cfg = { options: ["A", "Altro"] };
  assert.deepEqual(codes(normalizeSceltaMultipla({ options: ["A", "Altro"] }, cfg)), ["altro_senza_testo"]);
  assert.deepEqual(normalizeSceltaMultipla({ options: ["A", "Altro"], other_text: "Z" }, cfg).normalized, { options: ["A", "Altro"], other_text: "Z" });
});
