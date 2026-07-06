import * as XLSX from "xlsx";
import type {
  AiReadinessAnswer,
  AiReadinessDashboard,
  AiReadinessTemplateDefinition,
} from "./types";

type ExportAssessment = {
  id: string;
  name: string;
  status: string;
  aggregationThreshold: number;
  anonymousMode: boolean;
  privacyConfig: Record<string, unknown> | null;
};

type ExportRespondent = {
  id: string;
  pseudonymousId: string;
  organizationUnit: string | null;
  role: string | null;
  inviteStatus: string;
  completedAt: Date | null;
  email: string | null;
  name: string | null;
  surname: string | null;
};

type ExportResponse = {
  respondentId: string;
  pseudonymousId: string;
  answers: unknown[];
  derivedScores: unknown;
  submittedAt: Date | null;
};

type ExportUseCase = {
  title: string;
  currentProcess: string | null;
  painPoint: string | null;
  desiredOutcome: string | null;
  frequency: string | null;
  estimatedBeneficiaries: number | null;
  dataNeeded: string | null;
  humanInLoop: string | null;
  riskLevel: string | null;
  impactEstimate: string | null;
  createdAt: Date;
};

type ExportInsight = {
  insightType: string;
  title: string;
  body: string;
  validationStatus: string;
  humanValidated: boolean;
  evidence: Record<string, unknown> | null;
  generatedAt: Date;
};

export type AiReadinessExportPayload = {
  assessment: ExportAssessment;
  dashboard: AiReadinessDashboard;
  template: AiReadinessTemplateDefinition;
  respondents: ExportRespondent[];
  responses: ExportResponse[];
  useCases: ExportUseCase[];
  insights?: ExportInsight[];
  includeRawResponses: boolean;
  generatedAt: Date;
};

function displayScore(score: number | null | undefined) {
  return typeof score === "number" && Number.isFinite(score)
    ? Math.round(score * 100) / 100
    : "Insufficient data";
}

function answerValue(answer: AiReadinessAnswer) {
  return Array.isArray(answer.value) ? answer.value.join(", ") : answer.value ?? "";
}

function privacyValue(config: Record<string, unknown> | null, key: string) {
  const value = config?.[key];
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : "";
}

function evidenceArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          item !== null && typeof item === "object" && !Array.isArray(item)
      )
    : [];
}

export function buildAiReadinessExcelBuffer(payload: AiReadinessExportPayload) {
  const workbook = XLSX.utils.book_new();
  const pillarRows = payload.template.pillars.map((pillar) => ({
    Pillar: pillar.title,
    Score: displayScore(payload.dashboard.pillarScores[pillar.id]),
    Weight: pillar.weight,
    Description: pillar.description,
  }));
  const sectionRows = payload.template.sections.map((section) => ({
    Pillar: payload.template.pillars.find((pillar) => pillar.id === section.pillarId)?.title ?? section.pillarId,
    Section: section.title,
    Score: displayScore(payload.dashboard.sectionScores[section.id]),
  }));
  const aggregatedRows = payload.dashboard.units.map((unit) => ({
    Unit: unit.unit,
    Respondents: unit.respondentCount,
    "Threshold met": unit.aggregationThresholdMet ? "yes" : "no",
    Score: unit.aggregationThresholdMet ? displayScore(unit.overallScore) : "Insufficient data",
    Bottleneck: unit.aggregationThresholdMet ? unit.bottleneckPillar ?? "" : "",
  }));
  const rawRows = payload.responses.flatMap((response) => {
    const respondent = payload.respondents.find((item) => item.id === response.respondentId);
    return (response.answers as AiReadinessAnswer[]).map((answer) => {
      const question = payload.template.questions.find((item) => item.id === answer.questionId);
      return {
        Respondent: payload.includeRawResponses
          ? respondent?.email ?? response.pseudonymousId
          : response.pseudonymousId,
        Unit: respondent?.organizationUnit ?? "",
        Role: respondent?.role ?? "",
        Pillar: question?.pillarId ?? answer.pillarId,
        Section: question?.sectionId ?? answer.sectionId,
        Question: question?.label ?? answer.questionId,
        Answer: answerValue(answer),
        SubmittedAt: response.submittedAt?.toISOString() ?? "",
      };
    });
  });
  const useCaseRows = payload.useCases.map((useCase) => ({
    Title: useCase.title,
    "Current process": useCase.currentProcess ?? "",
    "Pain point": useCase.painPoint ?? "",
    "Desired outcome": useCase.desiredOutcome ?? "",
    Frequency: useCase.frequency ?? "",
    Beneficiaries: useCase.estimatedBeneficiaries ?? "",
    "Data needed": useCase.dataNeeded ?? "",
    "Human in loop": useCase.humanInLoop ?? "",
    Risk: useCase.riskLevel ?? "",
    Impact: useCase.impactEstimate ?? "",
    CreatedAt: useCase.createdAt.toISOString(),
  }));
  const insightRows = (payload.insights ?? []).map((insight) => ({
    Type: insight.insightType,
    Title: insight.title,
    Body: insight.body,
    Status: insight.validationStatus,
    "Human validated": insight.humanValidated ? "yes" : "no",
    GeneratedAt: insight.generatedAt.toISOString(),
  }));
  const roadmapRows = (payload.insights ?? [])
    .filter((insight) => insight.insightType === "roadmap")
    .flatMap((insight) =>
      evidenceArray(insight.evidence?.waves).map((wave) => ({
        Title: typeof wave.title === "string" ? wave.title : "",
        Horizon: typeof wave.horizon === "string" ? wave.horizon : "",
        Focus: typeof wave.focus === "string" ? wave.focus : "",
        "Success metric":
          typeof wave.successMetric === "string" ? wave.successMetric : "",
        Status: insight.validationStatus,
      }))
    );
  const summaryRows = [
    { Metric: "Assessment", Value: payload.assessment.name },
    { Metric: "Status", Value: payload.assessment.status },
    { Metric: "Respondents invited", Value: payload.dashboard.invitedCount },
    { Metric: "Responses submitted", Value: payload.dashboard.responseCount },
    { Metric: "Aggregation threshold", Value: payload.assessment.aggregationThreshold },
    { Metric: "Overall readiness index", Value: displayScore(payload.dashboard.overallScore) },
    { Metric: "Bottleneck pillar", Value: payload.dashboard.bottleneckPillar ?? "" },
    { Metric: "Confidence", Value: payload.dashboard.confidence },
    { Metric: "Anonymous mode", Value: payload.assessment.anonymousMode ? "yes" : "no" },
    { Metric: "Generated at", Value: payload.generatedAt.toISOString() },
  ];
  const dictionaryRows = payload.template.questions.map((question) => ({
    QuestionId: question.id,
    Pillar: question.pillarId,
    Section: question.sectionId,
    Type: question.answerType,
    Required: question.required ? "yes" : "no",
    Weight: question.weight ?? "",
    Label: question.label,
  }));
  const auditRows = [
    { Field: "Controller", Value: privacyValue(payload.assessment.privacyConfig, "controllerName") },
    { Field: "Processor", Value: privacyValue(payload.assessment.privacyConfig, "processorName") },
    { Field: "Legal basis", Value: privacyValue(payload.assessment.privacyConfig, "legalBasis") },
    { Field: "Retention days", Value: privacyValue(payload.assessment.privacyConfig, "dataRetentionDays") },
    { Field: "Included personal data", Value: payload.includeRawResponses ? "yes" : "no" },
    { Field: "Raw response sheet", Value: payload.includeRawResponses ? "included" : "pseudonymized only" },
  ];

  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), "Summary");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(pillarRows), "Pillar Scores");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(sectionRows), "Section Scores");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(aggregatedRows), "Responses Aggregated");
  if (payload.includeRawResponses) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rawRows), "Responses Raw");
  }
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(useCaseRows), "Use Cases");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(useCaseRows), "Use Case Scoring");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(insightRows), "Intelligence Insights");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(roadmapRows), "Roadmap Waves");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows.concat(aggregatedRows.map((row) => ({ Metric: `Unit ${row.Unit}`, Value: row.Score })))), "Dashboard Data");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(dictionaryRows), "Data Dictionary");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(auditRows), "Audit Export Info");

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function escapePdfText(text: string) {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function splitPdfLines(text: string, max = 88) {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).trim().length > max) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = `${current} ${word}`.trim();
    }
  }
  if (current) lines.push(current);
  return lines;
}

export function buildAiReadinessPdfBuffer(payload: AiReadinessExportPayload) {
  const lines = [
    `AI Readiness OS - Executive Report`,
    `Assessment: ${payload.assessment.name}`,
    `Generated: ${payload.generatedAt.toISOString()}`,
    `Respondents: ${payload.dashboard.responseCount}/${payload.dashboard.invitedCount}`,
    `Privacy: aggregated results, threshold ${payload.assessment.aggregationThreshold}, raw personal data ${payload.includeRawResponses ? "included by permission" : "excluded"}.`,
    `Overall readiness index: ${displayScore(payload.dashboard.overallScore)}`,
    `Bottleneck pillar: ${payload.dashboard.bottleneckPillar ?? "n/a"}`,
    "",
    "Pillar scores:",
    ...payload.template.pillars.map(
      (pillar) => `${pillar.title}: ${displayScore(payload.dashboard.pillarScores[pillar.id])}`
    ),
    "",
    "Unit heatmap:",
    ...payload.dashboard.units.map((unit) =>
      `${unit.unit}: ${
        unit.aggregationThresholdMet
          ? displayScore(unit.overallScore)
          : `insufficient data (${unit.respondentCount}/${payload.assessment.aggregationThreshold})`
      }`
    ),
    "",
    "Use cases submitted:",
    ...(payload.useCases.length
      ? payload.useCases.slice(0, 12).map((useCase) => `- ${useCase.title}`)
      : ["No use cases submitted yet."]),
    "",
    "Intelligence insights:",
    ...((payload.insights ?? []).length
      ? (payload.insights ?? [])
          .slice(0, 8)
          .map((insight) => `- ${insight.title} (${insight.validationStatus})`)
      : ["No intelligence insights generated yet."]),
  ].flatMap((line) => splitPdfLines(line));

  const content = [
    "BT",
    "/F1 11 Tf",
    "50 790 Td",
    "14 TL",
    ...lines.slice(0, 52).flatMap((line, index) => [
      index === 0 ? "/F1 16 Tf" : index === 1 ? "/F1 11 Tf" : "",
      `(${escapePdfText(line)}) Tj`,
      "T*",
    ]),
    "ET",
  ]
    .filter(Boolean)
    .join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content, "utf8")} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
}

export function canIncludeRawResponses(assessment: ExportAssessment) {
  return assessment.privacyConfig?.allowIndividualView === true;
}
