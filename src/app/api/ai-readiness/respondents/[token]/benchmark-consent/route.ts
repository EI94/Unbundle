import { NextResponse } from "next/server";
import { hashInviteToken } from "@/lib/ai-readiness/token";
import {
  createAiReadinessAuditEvent,
  getRespondentPrivacyBundleByTokenHash,
  withdrawAiReadinessBenchmarkConsentByTokenHash,
} from "@/lib/db/queries/ai-readiness";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const tokenHash = hashInviteToken(token);
  const bundle = await getRespondentPrivacyBundleByTokenHash(tokenHash);
  const baseUrl = new URL(req.url).origin;
  if (!bundle) {
    return NextResponse.redirect(
      `${baseUrl}/privacy/ai-readiness/${token}?error=invalid`,
      { status: 303 }
    );
  }

  await withdrawAiReadinessBenchmarkConsentByTokenHash(tokenHash);
  await createAiReadinessAuditEvent({
    organizationId: bundle.respondent.organizationId,
    workspaceId: bundle.respondent.workspaceId,
    assessmentId: bundle.respondent.assessmentId,
    respondentId: bundle.respondent.id,
    eventType: "benchmark_consent_withdrawn",
    eventPayload: { source: "respondent_privacy_route" },
  });

  return NextResponse.redirect(
    `${baseUrl}/privacy/ai-readiness/${token}?benchmark=withdrawn`,
    { status: 303 }
  );
}
