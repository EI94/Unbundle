import { landFromReadinessEmail } from "@/lib/ai-readiness/email-landing";

/**
 * `/dashboard/<ws>/ai-readiness/aggiornamenti/<rilevazione>/risultati` (0044): il link dell'email dei risultati
 * disponibili. Controlla l'accesso come la pagina, poi 307 a «Risultati» della rilevazione (`landFromReadinessEmail`).
 */
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ workspaceId: string; assessmentId: string }> }) {
  return landFromReadinessEmail(params, "risultati");
}
