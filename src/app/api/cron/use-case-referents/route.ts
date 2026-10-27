import { referentStoreReady, runReferentCron } from "@/lib/db/queries/use-case-referents";
import { ucLog, ucLogError } from "@/lib/uc/log";
import { checkCronAuthorization } from "@/lib/uc/notify/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const NO_STORE = { "Cache-Control": "no-store" } as const;

function plain(status: number, body: string): Response {
  return new Response(body, { status, headers: { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8" } });
}

/**
 * Il cron di «Chiedi al referente» (SPEC §2.5, §3.7), nei giorni feriali alle 9 UTC. In quest'ordine:
 * funzione spenta o anteprima di Vercel → 404; `CRON_SECRET` mancante o diverso → 401 (un segreto
 * assente rifiuta sempre); archivi non pronti → 503; poi il giro, con una risposta di soli conteggi.
 */
export async function GET(request: Request): Promise<Response> {
  if (process.env.USE_CASE_REFERENTS?.trim() === "off" || process.env.VERCEL_ENV === "preview") return plain(404, "Not found");
  const auth = checkCronAuthorization(request.headers.get("authorization"), process.env.CRON_SECRET);
  if (auth !== "ok") {
    if (auth === "segreto_mancante") ucLog({ level: "error", area: "use-case.referenti", op: "cron", code: "cron_secret_mancante" });
    return plain(401, "Unauthorized");
  }
  if (!(await referentStoreReady())) return plain(503, "Unavailable");
  const started = Date.now();
  try {
    const counts = await runReferentCron({ env: process.env });
    ucLog({ level: counts.errors > 0 ? "warn" : "info", area: "use-case.referenti", op: "cron", code: counts.errors > 0 ? "passi_non_riusciti" : "ok", durationMs: Date.now() - started });
    return Response.json({ job: "use-case-referents", ...counts }, { headers: NO_STORE });
  } catch (error) {
    ucLogError({ area: "use-case.referenti", op: "cron", durationMs: Date.now() - started }, error);
    return plain(503, "Unavailable");
  }
}
