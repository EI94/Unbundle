import { runRemindersCron } from "@/lib/db/queries/uc-cron";
import { handleUcCron } from "../uc-handler";

/**
 * Solleciti dei casi d'uso (PIANO §5.7): link scaduti e voci mancanti, poi,
 * nella finestra lun–ven 9–18 di Roma, promemoria, segnalazioni all'Owner e il
 * riepilogo del lunedì; infine l'invio della coda. Pianificato in `vercel.json`
 * alle 08:00 UTC dei giorni feriali (09:00 o 10:00 a Roma).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  return handleUcCron(request, "uc-reminders", runRemindersCron);
}
