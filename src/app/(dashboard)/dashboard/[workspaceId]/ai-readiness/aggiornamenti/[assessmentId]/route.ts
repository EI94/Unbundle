import { redirect } from "next/navigation";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { readinessEmailLanding } from "@/lib/ai-readiness/email-landing";

/**
 * `/dashboard/<ws>/ai-readiness/aggiornamenti/<rilevazione>` (0044): il link dell'email delle risposte nuove. La porta
 * della pagina dell'AI Readiness, poi la rilevazione di questo workspace, poi 307 a «Raccolta» › «Persone»
 * (`readinessEmailLanding`).
 */
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ workspaceId: string; assessmentId: string }> }) {
  const { workspaceId, assessmentId } = await params;
  await requireWorkspacePage(workspaceId);
  redirect(await readinessEmailLanding(workspaceId, assessmentId, "risposte"));
}
