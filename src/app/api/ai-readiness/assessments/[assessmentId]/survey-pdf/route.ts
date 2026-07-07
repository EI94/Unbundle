import { auth } from "@/lib/auth";
import { getWorkspaceAccessForUser } from "@/lib/workspace-access";
import { canReviewWorkspacePortfolio } from "@/lib/workspace-permissions";
import {
  getAssessmentBundleById,
  listRespondentsByAssessment,
} from "@/lib/db/queries/ai-readiness";
import { buildSurveyPreviewPdfBuffer } from "@/lib/ai-readiness/export";

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
  if (isPrefetchRequest(req)) return new Response(null, { status: 204 });

  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { assessmentId } = await params;
  const bundle = await getAssessmentBundleById(assessmentId);
  if (!bundle) return Response.json({ error: "Not found" }, { status: 404 });
  const access = await getWorkspaceAccessForUser(
    session.user.id,
    bundle.assessment.workspaceId
  );
  if (!access || !canReviewWorkspacePortfolio(access.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const respondents = await listRespondentsByAssessment(assessmentId);
  const def = bundle.templateDefinition;
  const scored = def.questions.filter((q) => q.answerType !== "text").length;
  const scoringConfig = bundle.assessment.scoringConfig as
    | Record<string, unknown>
    | null;
  const expectedRaw = scoringConfig?.expectedRespondents;
  const brand = bundle.assessment.brandConfig as Record<string, unknown> | null;

  const buffer = buildSurveyPreviewPdfBuffer({
    assessmentName: bundle.assessment.name,
    displayName:
      typeof brand?.displayName === "string" ? brand.displayName : "Unbundle",
    anonymous: bundle.assessment.anonymousMode !== false,
    aggregationThreshold: bundle.assessment.aggregationThreshold,
    expectedRespondents:
      typeof expectedRaw === "number" && Number.isFinite(expectedRaw)
        ? expectedRaw
        : null,
    invitedCount: respondents.length,
    completedCount: respondents.filter((r) => r.inviteStatus === "completed")
      .length,
    estimatedMinutes: Math.max(2, Math.round(scored * 0.5)),
    pillars: def.pillars.map((pillar) => ({
      title: pillar.title,
      description: pillar.description,
      questionCount: def.questions.filter((q) => q.pillarId === pillar.id)
        .length,
    })),
    sections: def.sections.map((section) => ({
      pillarTitle:
        def.pillars.find((p) => p.id === section.pillarId)?.title ??
        section.pillarId,
      title: section.title,
      description: section.description,
      audience: section.audience,
      questions: def.questions
        .filter((q) => q.sectionId === section.id)
        .map((q) => ({
          label: q.label,
          description: q.description,
          answerType: q.answerType,
          required: q.required,
          scaleAnchors: q.scaleAnchors,
          levels: q.levels,
          allowUnsure: q.allowUnsure,
        })),
    })),
    generatedAt: new Date(),
  });

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="survey-preview-${assessmentId.slice(0, 8)}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
