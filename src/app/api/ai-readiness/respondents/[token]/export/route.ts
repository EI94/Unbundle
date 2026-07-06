import { hashInviteToken } from "@/lib/ai-readiness/token";
import { getRespondentPrivacyBundleByTokenHash } from "@/lib/db/queries/ai-readiness";

export const dynamic = "force-dynamic";

function safeFilename(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "ai-readiness-respondent";
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const bundle = await getRespondentPrivacyBundleByTokenHash(hashInviteToken(token));
  if (!bundle) {
    return Response.json({ error: "Privacy link not found" }, { status: 404 });
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    assessment: {
      id: bundle.assessment.id,
      name: bundle.assessment.name,
      status: bundle.assessment.status,
      privacyConfig: bundle.assessment.privacyConfig ?? null,
    },
    respondent: {
      id: bundle.respondent.id,
      email: bundle.respondent.email,
      name: bundle.respondent.name,
      surname: bundle.respondent.surname,
      role: bundle.respondent.role,
      seniority: bundle.respondent.seniority,
      organizationUnit: bundle.respondent.organizationUnit,
      inviteStatus: bundle.respondent.inviteStatus,
      hasAcceptedPrivacyNotice: bundle.respondent.hasAcceptedPrivacyNotice,
      hasMarketingConsent: bundle.respondent.hasMarketingConsent,
      hasBenchmarkConsent: bundle.respondent.hasBenchmarkConsent,
      createdAt: bundle.respondent.createdAt,
      completedAt: bundle.respondent.completedAt,
    },
    responses: bundle.responses.map((response) => ({
      status: response.status,
      answers: response.answers,
      derivedScores: response.derivedScores,
      freeTextAnswers: response.freeTextAnswers,
      submittedAt: response.submittedAt,
    })),
    submittedUseCases: bundle.useCases.map((item) => ({
      title: item.title,
      currentProcess: item.currentProcess,
      painPoint: item.painPoint,
      desiredOutcome: item.desiredOutcome,
      frequency: item.frequency,
      estimatedBeneficiaries: item.estimatedBeneficiaries,
      dataNeeded: item.dataNeeded,
      toolsUsed: item.toolsUsed,
      humanInLoop: item.humanInLoop,
      riskLevel: item.riskLevel,
      impactEstimate: item.impactEstimate,
      createdAt: item.createdAt,
    })),
  };

  return Response.json(payload, {
    headers: {
      "Content-Disposition": `attachment; filename="${safeFilename(
        bundle.assessment.name
      )}-respondent.json"`,
      "Cache-Control": "no-store",
    },
  });
}
