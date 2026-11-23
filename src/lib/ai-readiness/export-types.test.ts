import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AI_READINESS_EXPORT_TYPES, exportTypeLabel } from "./export-types.ts";

// (Revisione 7b, harness delle schermate) «Impostazioni › File scaricati» chiamava ogni PDF «Dati in Excel»: la pagina
// cercava `"pdf"`, la rotta dell'export scrive `"executive_pdf"`. Ora la rotta e la pagina usano lo stesso elenco, e ogni
// tipo che la rotta scrive ha il suo nome. Dati inventati.

test("every export type the route writes comes from the shared list, and has its own Italian label", () => {
  const route = readFileSync(new URL("../../app/api/ai-readiness/assessments/[assessmentId]/export/route.ts", import.meta.url), "utf8");
  assert.match(route, /exportType: type === "pdf" \? AI_READINESS_EXPORT_TYPES\.pdf : AI_READINESS_EXPORT_TYPES\.excel,/);
  assert.doesNotMatch(route, /"executive_pdf"|"excel_aggregated"/, "nessun tipo scritto a mano nella rotta");
  assert.deepEqual({ ...AI_READINESS_EXPORT_TYPES }, { pdf: "executive_pdf", excel: "excel_aggregated" }, "i valori già salvati nel database");
  assert.equal(exportTypeLabel(AI_READINESS_EXPORT_TYPES.pdf), "Report in PDF");
  assert.equal(exportTypeLabel(AI_READINESS_EXPORT_TYPES.excel), "Dati in Excel");
  for (const type of Object.values(AI_READINESS_EXPORT_TYPES)) assert.notEqual(exportTypeLabel(type), "File scaricato", `${type}: un nome suo`);
  // La pagina usa lo stesso nome.
  const page = readFileSync(new URL("../../app/(dashboard)/dashboard/[workspaceId]/ai-readiness/page.tsx", import.meta.url), "utf8");
  assert.match(page, /label: exportTypeLabel\(item\.exportType\),/);
  assert.doesNotMatch(page, /exportType === "pdf"/);
});

test("an unknown type takes its name from the format, otherwise a neutral one; never the stored key", () => {
  assert.equal(exportTypeLabel("pdf"), "Report in PDF");
  assert.equal(exportTypeLabel("board_pdf"), "Report in PDF");
  assert.equal(exportTypeLabel("excel_raw"), "Dati in Excel");
  assert.equal(exportTypeLabel("xlsx"), "Dati in Excel");
  assert.equal(exportTypeLabel("qualcosa_di_nuovo"), "File scaricato");
  assert.equal(exportTypeLabel(""), "File scaricato");
});
