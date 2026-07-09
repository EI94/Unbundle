import test from "node:test";
import assert from "node:assert/strict";
import XLSXStyle from "xlsx-js-style";
import { AI_READINESS_SYSTEM_TEMPLATE } from "./default-template.ts";
import { filterTemplateForTrack } from "./template-scope.ts";
import { buildQuestionDocPdf, buildQuestionDocXlsx } from "./question-doc.ts";

const basePayload = (track: "everyone" | "internal") => ({
  assessmentName: "Assessment Cliente",
  displayName: "Acme Corp",
  anonymous: true,
  trackTitle: track === "internal" ? "Assessment referenti" : "Survey organizzazione",
  trackSubtitle: "Sottotitolo di prova",
  generatedAt: new Date("2026-07-08T10:00:00Z"),
  definition: filterTemplateForTrack(AI_READINESS_SYSTEM_TEMPLATE, track),
});

test("PDF survey: valido, multi-pagina, contiene domande e livelli del binario giusto", () => {
  const buf = buildQuestionDocPdf(basePayload("everyone"));
  const txt = buf.toString("latin1");
  assert.ok(txt.startsWith("%PDF-1.4"));
  assert.ok((txt.match(/\/Type \/Page[^s]/g) ?? []).length >= 2);
  assert.ok(txt.includes("Survey organizzazione"));
  assert.ok(txt.includes("quali strumenti di AI puoi usare"));
  assert.ok(txt.includes("Nessuno mi ha mai detto nulla")); // livello 1
  assert.ok(txt.includes("Non so / non applicabile"));
  assert.ok(!txt.includes("vale 0,5")); // dettaglio interno mai nel file cliente
  assert.ok(!txt.includes("Infrastruttura e sistemi")); // sezione interna esclusa
});

test("PDF referenti: contiene solo le schede interne", () => {
  const buf = buildQuestionDocPdf(basePayload("internal"));
  const txt = buf.toString("latin1");
  assert.ok(txt.includes("Assessment referenti"));
  assert.ok(txt.includes("INFRASTRUTTURA E SISTEMI") || txt.includes("Infrastruttura e sistemi"));
  assert.ok(txt.includes("Tutto su server nostri"));
  assert.ok(!txt.includes("Quanto conosci l'AI"));
});

test("Excel: workbook valido con copertina e domande complete di livelli", () => {
  const buf = buildQuestionDocXlsx(basePayload("everyone"));
  const wb = XLSXStyle.read(buf, { type: "buffer" });
  assert.deepEqual(wb.SheetNames, ["Copertina", "Domande"]);
  const rows = XLSXStyle.utils.sheet_to_json(wb.Sheets["Domande"], { header: 1 }) as string[][];
  const flat = rows.flat().join(" | ");
  assert.ok(flat.includes("Livello 1") && flat.includes("Livello 5"));
  assert.ok(flat.includes("quali strumenti di AI puoi usare"));
  assert.ok(flat.includes("Nessuno mi ha mai detto nulla"));
  assert.ok(!flat.includes("Infrastruttura e sistemi"));
  assert.ok(!flat.includes("vale 0,5"));
});

test("Excel referenti: solo sezioni interne, riflette il template passato (live)", () => {
  const payload = basePayload("internal");
  // simula una modifica live: rinomina una domanda
  payload.definition = {
    ...payload.definition,
    questions: payload.definition.questions.map((q) =>
      q.id === "infra-cloud" ? { ...q, label: "DOMANDA RINOMINATA DAL CLIENTE" } : q
    ),
  };
  const buf = buildQuestionDocXlsx(payload);
  const wb = XLSXStyle.read(buf, { type: "buffer" });
  const flat = (XLSXStyle.utils.sheet_to_json(wb.Sheets["Domande"], { header: 1 }) as string[][])
    .flat()
    .join(" | ");
  assert.ok(flat.includes("DOMANDA RINOMINATA DAL CLIENTE"));
  assert.ok(flat.includes("Persone, ruoli e processi"));
  assert.ok(!flat.includes("Idee e casi concreti"));
});
