import { auth } from "@/lib/auth";
import { getWorkspaceAccessForUser } from "@/lib/workspace-access";
import { canReviewWorkspacePortfolio } from "@/lib/workspace-permissions";
import {
  createAiReadinessAuditEvent,
  createAiReadinessExport,
  getAiReadinessDashboard,
  getAssessmentBundleById,
  listAiReadinessInsights,
  listRespondentsByAssessment,
  listResponsesByAssessment,
  listUseCaseSubmissionsByAssessment,
} from "@/lib/db/queries/ai-readiness";
import {
  buildAiReadinessExcelBuffer,
  buildAiReadinessPdfBuffer,
  canIncludeRawResponses,
} from "@/lib/ai-readiness/export";

function safeFilename(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "ai-readiness";
}

function isPrefetchRequest(req: Request) {
  const h = req.headers;
  return (
    h.get("next-router-prefetch") === "1" ||
    h.get("sec-purpose")?.includes("prefetch") === true ||
    h.get("purpose") === "prefetch" ||
    h.get("x-purpose") === "prefetch"
  );
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ assessmentId: string }> }
) {
  // Difesa in profondità: un prefetch del browser/router non deve mai
  // generare l'export né scrivere righe di audit.
  if (isPrefetchRequest(req)) {
    return new Response(null, { status: 204 });
  }

  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { assessmentId } = await params;
  const bundle = await getAssessmentBundleById(assessmentId);
  if (!bundle) {
    return Response.json({ error: "Assessment not found" }, { status: 404 });
  }
  const access = await getWorkspaceAccessForUser(
    session.user.id,
    bundle.assessment.workspaceId
  );
  if (!access || !canReviewWorkspacePortfolio(access.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const type = url.searchParams.get("type") === "pdf" ? "pdf" : "excel";
  const includeRawRequested = url.searchParams.get("includeRaw") === "1";
  const includeRawResponses =
    includeRawRequested && canIncludeRawResponses({
      ...bundle.assessment,
      privacyConfig: bundle.assessment.privacyConfig ?? null,
    });
  const [dashboard, respondents, responses, useCases, insights] = await Promise.all([
    getAiReadinessDashboard(assessmentId),
    listRespondentsByAssessment(assessmentId),
    listResponsesByAssessment(assessmentId),
    listUseCaseSubmissionsByAssessment(assessmentId),
    listAiReadinessInsights(assessmentId),
  ]);
  if (!dashboard) {
    return Response.json({ error: "Dashboard unavailable" }, { status: 404 });
  }

  const payload = {
    assessment: {
      id: bundle.assessment.id,
      name: bundle.assessment.name,
      status: bundle.assessment.status,
      aggregationThreshold: bundle.assessment.aggregationThreshold,
      anonymousMode: bundle.assessment.anonymousMode,
      privacyConfig: bundle.assessment.privacyConfig ?? null,
    },
    dashboard,
    template: bundle.templateDefinition,
    respondents: respondents.map((respondent) => ({
      id: respondent.id,
      pseudonymousId: respondent.pseudonymousId,
      organizationUnit: respondent.organizationUnit,
      role: respondent.role,
      inviteStatus: respondent.inviteStatus,
      completedAt: respondent.completedAt,
      email: respondent.email,
      name: respondent.name,
      surname: respondent.surname,
    })),
    responses: responses.map((response) => ({
      respondentId: response.respondentId,
      pseudonymousId: response.pseudonymousId,
      answers: response.answers,
      derivedScores: response.derivedScores,
      submittedAt: response.submittedAt,
    })),
    useCases: useCases.map((useCase) => ({
      title: useCase.title,
      currentProcess: useCase.currentProcess,
      painPoint: useCase.painPoint,
      desiredOutcome: useCase.desiredOutcome,
      frequency: useCase.frequency,
      estimatedBeneficiaries: useCase.estimatedBeneficiaries,
      dataNeeded: useCase.dataNeeded,
      humanInLoop: useCase.humanInLoop,
      riskLevel: useCase.riskLevel,
      impactEstimate: useCase.impactEstimate,
      createdAt: useCase.createdAt,
    })),
    insights: insights.map((insight) => ({
      insightType: insight.insightType,
      title: insight.title,
      body: insight.body,
      validationStatus: insight.validationStatus,
      humanValidated: insight.humanValidated,
      evidence: insight.evidence ?? null,
      generatedAt: insight.generatedAt,
    })),
    includeRawResponses,
    generatedAt: new Date(),
  };

  const buffer =
    type === "pdf"
      ? buildAiReadinessPdfBuffer(payload)
      : buildAiReadinessExcelBuffer(payload);
  const extension = type === "pdf" ? "pdf" : "xlsx";
  const contentType =
    type === "pdf"
      ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  await createAiReadinessExport({
    assessmentId,
    workspaceId: bundle.assessment.workspaceId,
    exportType: type === "pdf" ? "executive_pdf" : "excel_aggregated",
    requestedByUserId: session.user.id,
    includedPersonalData: includeRawResponses,
    anonymized: !includeRawResponses,
  });
  await createAiReadinessAuditEvent({
    organizationId: bundle.assessment.organizationId,
    workspaceId: bundle.assessment.workspaceId,
    assessmentId,
    actorUserId: session.user.id,
    eventType: "export_generated",
    eventPayload: {
      type,
      includeRawRequested,
      includedPersonalData: includeRawResponses,
    },
  });

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${safeFilename(
        bundle.assessment.name
      )}.${extension}"`,
      "Cache-Control": "no-store",
    },
  });
}
