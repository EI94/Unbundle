import { runFreshnessCron } from "@/lib/db/queries/uc-cron";
import { handleUcCron } from "../uc-handler";

/**
 * Freschezza dei casi d'uso (PIANO §5.7): dati validati scaduti di nuovo in
 * verifica, prontezza ricalcolata, pulizia di limiti e quarantena, campanella.
 * Pianificato in `vercel.json` alle 03:00 UTC di ogni giorno.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  return handleUcCron(request, "uc-freshness", runFreshnessCron);
}
