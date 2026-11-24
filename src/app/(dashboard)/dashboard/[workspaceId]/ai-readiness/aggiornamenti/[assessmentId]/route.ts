import { landFromReadinessEmail } from "@/lib/ai-readiness/email-landing";

/**
 * `/dashboard/<ws>/ai-readiness/aggiornamenti/<rilevazione>` (0044): il link dell'email delle risposte nuove. Controlla
 * l'accesso come la pagina, poi 307 a «Raccolta» › «Persone» della rilevazione (`landFromReadinessEmail`).
 */
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ workspaceId: string; assessmentId: string }> }) {
  return landFromReadinessEmail(params, "risposte");
}
