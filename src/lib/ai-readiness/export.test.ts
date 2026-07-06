import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { AI_READINESS_SYSTEM_TEMPLATE } from "./default-template.ts";
import {
  buildAiReadinessExcelBuffer,
  buildAiReadinessPdfBuffer,
  canIncludeRawResponses,
  type AiReadinessExportPayload,
} from "./export.ts";

const payload: AiReadinessExportPayload = {
  assessment: {
    id: "assessment_1",
    name: "AI Readiness NATIVA",
    status: "open",
    aggregationThreshold: 3,
    anonymousMode: true,
    privacyConfig: {
      controllerName: "NATIVA",
      processorName: "Unbundle",
      legalBasis: "Legitimate interest",
      dataRetentionDays: 365,
      allowIndividualView: false,
    },
  },
  dashboard: {
    responseCount: 3,
    invitedCount: 5,
    startedCount: 3,
    completedCount: 3,
    overallScore: 3.42,
    bottleneckPillar: "context",
    confidence: 1,
    aggregationThresholdMet: true,
    pillarScores: {
      technology: 4,
      context: 2,
      workflow: 3,
      adoption: 4,
      use_cases: 3,
    },
    sectionScores: {},
    units: [
      {
        unit: "Ops",
        respondentCount: 2,
        aggregationThresholdMet: false,
        overallScore: null,
        bottleneckPillar: null,
        pillarScores: {},
      },
    ],
  },
  template: AI_READINESS_SYSTEM_TEMPLATE,
  respondents: [],
  responses: [],
  useCases: [],
  includeRawResponses: false,
  generatedAt: new Date("2026-07-05T10:00:00.000Z"),
};

test("excel export include i fogli core e non include raw se non richiesto", () => {
  const buffer = buildAiReadinessExcelBuffer(payload);
  const workbook = XLSX.read(buffer, { type: "buffer" });

  assert.ok(workbook.SheetNames.includes("Summary"));
  assert.ok(workbook.SheetNames.includes("Pillar Scores"));
  assert.ok(workbook.SheetNames.includes("Responses Aggregated"));
  assert.equal(workbook.SheetNames.includes("Responses Raw"), false);
  assert.ok(workbook.SheetNames.includes("Audit Export Info"));
});

test("pdf export produce un PDF valido di base", () => {
  const buffer = buildAiReadinessPdfBuffer(payload);

  assert.equal(buffer.subarray(0, 8).toString("utf8"), "%PDF-1.4");
  assert.ok(buffer.toString("utf8").includes("AI Readiness OS"));
});

test("raw responses richiedono flag privacy esplicito", () => {
  assert.equal(canIncludeRawResponses(payload.assessment), false);
  assert.equal(
    canIncludeRawResponses({
      ...payload.assessment,
      privacyConfig: { allowIndividualView: true },
    }),
    true
  );
});
