import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TEXT_MAX_LENGTH,
  cleanMultiline,
  isUuid,
  normalizeCasoProva,
  normalizeCodice,
  normalizeCollegamentoSistema,
  normalizeDataset,
  normalizeFile,
  normalizeTesto,
} from "./simple.ts";

const ID1 = "0b0c3a1e-9d7b-4c52-9a7e-5f1b2c3d4e5f";
const ID2 = "6f9a1b2c-3d4e-4f50-8a1b-2c3d4e5f6a7b";
const codes = (o: { errors: { code: string }[] }) => o.errors.map((e) => e.code);

test("cleanMultiline keeps newlines but trims trailing spaces and blank runs", () => {
  assert.equal(cleanMultiline("  riga uno   \r\nriga due\n\n\n\nfine  "), "riga uno\nriga due\n\nfine");
});

test("testo: trim, minimum and maximum length", () => {
  assert.deepEqual(normalizeTesto("  Eccezione: d'estate  ", {}).value, { text: "Eccezione: d'estate" });
  assert.deepEqual(normalizeTesto({ text: "ok" }, {}).normalized, { text: "ok" });
  assert.deepEqual(codes(normalizeTesto("ab", { min_length: 3 })), ["testo_troppo_corto"]);
  assert.deepEqual(codes(normalizeTesto("abcd", { max_length: 3 })), ["testo_troppo_lungo"]);
  assert.deepEqual(codes(normalizeTesto("x".repeat(DEFAULT_TEXT_MAX_LENGTH + 1), {})), ["testo_troppo_lungo"]);
  // La lunghezza conta i caratteri, non le unità UTF-16.
  assert.deepEqual(codes(normalizeTesto("😀😀😀", { max_length: 3 })), []);
  assert.deepEqual(codes(normalizeTesto("   ", {})), ["testo_mancante"]);
  assert.deepEqual(codes(normalizeTesto(12, {})), ["testo_mancante"]);
});

test("codice: trim, uppercase, pattern (ICAO, IATA) and allowed list", () => {
  assert.deepEqual(normalizeCodice(" abcd ", { pattern: "^[A-Z]{4}$" }).normalized, { code: "ABCD" });
  assert.deepEqual(codes(normalizeCodice("ABC", { pattern: "^[A-Z]{4}$" })), ["codice_formato"]);
  assert.deepEqual(normalizeCodice("abc", { pattern: "^[A-Z]{3}$" }).value, { code: "ABC" });
  assert.deepEqual(codes(normalizeCodice("EFGH", { allowed: ["ABCD", "EFGH"] })), []);
  assert.deepEqual(codes(normalizeCodice("WXYZ", { allowed: ["ABCD", "EFGH"] })), ["codice_non_ammesso"]);
  assert.deepEqual(normalizeCodice({ code: "Ab-1" }, { preserve_case: true }).value, { code: "Ab-1" });
  assert.deepEqual(normalizeCodice("x", { ref_entity: "ent.aeroporto" }).value, { code: "X", ref_entity: "ent.aeroporto" });
  assert.deepEqual(codes(normalizeCodice("X", { pattern: "([" })), ["formato_codice_non_valido"]);
  assert.deepEqual(codes(normalizeCodice("x".repeat(121), {})), ["codice_troppo_lungo"]);
  assert.deepEqual(codes(normalizeCodice("", {})), ["codice_mancante"]);
});

test("file: only usable files of the same case and item, no duplicates", () => {
  assert.ok(isUuid(ID1) && !isUuid("not-a-uuid") && !isUuid(3));
  const o = normalizeFile({ file_ids: [ID1, ID1.toUpperCase(), ID2] }, {}, { usableFileIds: [ID1, ID2] });
  assert.deepEqual(o.value, { file_ids: [ID1, ID2] });
  assert.deepEqual(o.normalized, { file_ids: [ID1, ID2] });
  assert.deepEqual(codes(normalizeFile([ID1], {}, { usableFileIds: [ID2] })), ["file_non_utilizzabile"]);
  assert.deepEqual(codes(normalizeFile(["x"], {}, {})), ["file_non_valido"]);
  assert.deepEqual(codes(normalizeFile([], {}, {})), ["file_mancante"]);
  assert.deepEqual(codes(normalizeFile([ID1, ID2], { max_files: 1 }, {})), ["troppi_file"]);
});

test("dataset: file and dataset card must belong together", () => {
  const ok = normalizeDataset({ file_id: ID1, dataset_id: ID2 }, { usableDatasets: [{ fileId: ID1, datasetId: ID2 }] });
  assert.deepEqual(ok.normalized, { file_id: ID1, dataset_id: ID2 });
  assert.deepEqual(codes(normalizeDataset({ file_id: ID2, dataset_id: ID1 }, { usableDatasets: [{ fileId: ID1, datasetId: ID2 }] })), [
    "dataset_non_utilizzabile",
  ]);
  assert.deepEqual(codes(normalizeDataset({ file_id: ID1 }, {})), ["dataset_mancante"]);
});

test("collegamento_sistema: system from the map, object and access mode", () => {
  const cfg = { systems: ["Gestionale voli", "Excel"] };
  const o = normalizeCollegamentoSistema(
    { sistema: "gestionale VOLI", oggetto: "Aeromobili", accesso: "export", frequenza: "settimanale", chi_ha_accesso: "" },
    cfg,
  );
  assert.deepEqual(o.normalized, { sistema: "Gestionale voli", oggetto: "Aeromobili", accesso: "export", frequenza: "settimanale" });
  assert.deepEqual(codes(normalizeCollegamentoSistema({ sistema: "Altro", oggetto: "x", accesso: "export" }, cfg)), ["sistema_non_in_mappa"]);
  assert.deepEqual(codes(normalizeCollegamentoSistema({ sistema: "Excel", accesso: "a voce" }, cfg)), ["oggetto_mancante", "accesso_mancante"]);
  assert.deepEqual(codes(normalizeCollegamentoSistema("Excel", cfg)), ["sistema_mancante"]);
});

test("caso_prova: request, expected outcome, rules and kind", () => {
  const o = normalizeCasoProva({ richiesta: "4 passeggeri, andata e ritorno", atteso: "tre strategie", regole: ["rule.commerciale.x", "rule.commerciale.x"] });
  assert.deepEqual(o.normalized, { richiesta: "4 passeggeri, andata e ritorno", atteso: "tre strategie", regole: ["rule.commerciale.x"], tipo: "sintetico" });
  assert.deepEqual(codes(normalizeCasoProva({ richiesta: "x", atteso: "y", regole: ["Rule X"], tipo: "reale" })), ["regola_non_valida", "tipo_caso_non_valido"]);
  assert.deepEqual(codes(normalizeCasoProva({})), ["richiesta_mancante", "atteso_mancante", "regole_mancanti"]);
  assert.deepEqual(codes(normalizeCasoProva("x")), ["caso_mancante"]);
});
