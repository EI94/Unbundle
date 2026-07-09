import { auth } from "@/lib/auth";
import { getWorkspaceAccessForUser } from "@/lib/workspace-access";
import { canReviewWorkspacePortfolio } from "@/lib/workspace-permissions";
import { getAssessmentBundleById } from "@/lib/db/queries/ai-readiness";
import { filterTemplateForTrack } from "@/lib/ai-readiness/template-scope";
import {
  buildQuestionDocPdf,
  buildQuestionDocXlsx,
} from "@/lib/ai-readiness/question-doc";

function isPrefetchRequest(req: Request) {
  const h = req.headers;
  return (
    h.get("next-router-prefetch") === "1" ||
    h.get("sec-purpose")?.includes("prefetch") === true ||
    h.get("purpose") === "prefetch" ||
    h.get("x-purpose") === "prefetch"
  );
}

function safeFilename(input: string) {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "ai-readiness"
  );
}

/**
 * Download separati delle domande, sempre dal template effettivo (quindi
 * aggiornati live alle ultime modifiche dell'editor):
 *   ?track=everyone|internal & format=pdf|xlsx
 */
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

  const url = new URL(req.url);
  const track = url.searchParams.get("track") === "internal" ? "internal" : "everyone";
  const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "pdf";

  const definition = filterTemplateForTrack(bundle.templateDefinition, track);
  const brand = bundle.assessment.brandConfig as Record<string, unknown> | null;
  const displayName =
    typeof brand?.displayName === "string" ? brand.displayName : "Unbundle";

  const payload = {
    assessmentName: bundle.assessment.name,
    displayName,
    anonymous: bundle.assessment.anonymousMode !== false,
    trackTitle:
      track === "internal" ? "Assessment referenti" : "Survey organizzazione",
    trackSubtitle:
      track === "internal"
        ? "Le schede compilate dai referenti interni: infrastruttura e sistemi, dati e conoscenza, persone e processi."
        : "Il questionario condiviso con tutte le persone: strumenti e regole d'uso, adozione dell'AI, idee e casi concreti.",
    generatedAt: new Date(),
    definition,
  };

  const buffer =
    format === "xlsx" ? buildQuestionDocXlsx(payload) : buildQuestionDocPdf(payload);
  const base = `${track === "internal" ? "assessment-referenti" : "survey-organizzazione"}-${safeFilename(bundle.assessment.name)}`;

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        format === "xlsx"
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : "application/pdf",
      "Content-Disposition": `attachment; filename="${base}.${format}"`,
      "Cache-Control": "no-store",
    },
  });
}
