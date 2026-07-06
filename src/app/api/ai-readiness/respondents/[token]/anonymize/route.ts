import { NextResponse } from "next/server";
import { hashInviteToken } from "@/lib/ai-readiness/token";
import {
  anonymizeAiReadinessRespondentByTokenHash,
  createAiReadinessAuditEvent,
  getRespondentPrivacyBundleByTokenHash,
} from "@/lib/db/queries/ai-readiness";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const baseUrl = new URL(req.url).origin;
  const formData = await req.formData();
  const confirmation = String(formData.get("confirmation") ?? "").trim().toUpperCase();
  if (confirmation !== "ANONIMIZZA") {
    return NextResponse.redirect(
      `${baseUrl}/privacy/ai-readiness/${token}?error=confirmation`,
      { status: 303 }
    );
  }

  const tokenHash = hashInviteToken(token);
  const bundle = await getRespondentPrivacyBundleByTokenHash(tokenHash);
  if (!bundle) {
    return NextResponse.redirect(
      `${baseUrl}/privacy/ai-readiness/${token}?error=invalid`,
      { status: 303 }
    );
  }

  await anonymizeAiReadinessRespondentByTokenHash(tokenHash);
  await createAiReadinessAuditEvent({
    organizationId: bundle.respondent.organizationId,
    workspaceId: bundle.respondent.workspaceId,
    assessmentId: bundle.respondent.assessmentId,
    respondentId: bundle.respondent.id,
    eventType: "respondent_anonymized",
    eventPayload: { source: "respondent_privacy_route" },
  });

  return NextResponse.redirect(
    `${baseUrl}/privacy/ai-readiness/${token}?anonymized=1`,
    { status: 303 }
  );
}
