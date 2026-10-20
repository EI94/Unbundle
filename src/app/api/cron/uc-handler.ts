import "server-only";
import { UcAccessError, ensureUcAvailable, isUcEnabled, ucLsDomains } from "@/lib/db/queries/uc-access";
import type { UcCronOptions } from "@/lib/db/queries/uc-cron";
import { getAppUcExecutor, type UcExecutor } from "@/lib/db/uc-executor";
import { ucLog, ucLogError } from "@/lib/uc/log";
import { checkCronAuthorization } from "@/lib/uc/notify/cron-auth";
import { cronWorkspaceFilter, ucCronWorkspaceScope } from "@/lib/uc/platform";

/**
 * Ingresso comune dei cron dei casi d'uso (`uc-reminders`, `uc-freshness`,
 * PIANO §5.7). In quest'ordine:
 * - sezione spenta (`UC_ENABLED`): 404, come le altre rotte uc;
 * - `CRON_SECRET` mancante o diverso: 401. A differenza dei cron esistenti un
 *   segreto assente rifiuta sempre (`checkCronAuthorization`);
 * - tabelle uc non pronte: 503;
 * - poi il lavoro sui soli workspace accesi (`UC_WORKSPACE_IDS`, DESIGN §7.1
 *   P0-1; `*` vale solo fuori produzione), con una risposta di soli conteggi
 *   (mai id, nomi o link) e una riga di log con la durata.
 */

const NO_STORE = { "Cache-Control": "no-store" } as const;

function plain(status: number, body: string): Response {
  return new Response(body, { status, headers: { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8" } });
}

export async function handleUcCron<T extends object>(
  request: Request,
  job: "uc-reminders" | "uc-freshness",
  run: (executor: UcExecutor, options: UcCronOptions) => Promise<T>,
): Promise<Response> {
  if (!isUcEnabled()) return plain(404, "Not found");
  const auth = checkCronAuthorization(request.headers.get("authorization"), process.env.CRON_SECRET);
  if (auth !== "ok") {
    if (auth === "segreto_mancante") ucLog({ level: "error", area: "uc.cron", op: job, code: "cron_secret_mancante" });
    return plain(401, "Unauthorized");
  }
  try {
    await ensureUcAvailable();
  } catch (error) {
    if (error instanceof UcAccessError) {
      if (error.code !== "disattivata") ucLog({ level: "error", area: "uc.cron", op: job, code: error.code });
      return plain(error.code === "disattivata" ? 404 : 503, "Unavailable");
    }
    throw error;
  }
  const scope = ucCronWorkspaceScope(process.env);
  const started = Date.now();
  try {
    const executor = await getAppUcExecutor();
    const summary = await run(executor, { env: process.env, lsDomains: ucLsDomains(), workspaceIds: cronWorkspaceFilter(scope) });
    const errors = (summary as { errors?: unknown }).errors;
    ucLog({ level: typeof errors === "number" && errors > 0 ? "warn" : "info", area: "uc.cron", op: job, code: typeof errors === "number" && errors > 0 ? "passi_non_riusciti" : "ok", durationMs: Date.now() - started });
    const workspaces = scope.kind === "tutti" ? "tutti" : scope.ids.length;
    return Response.json({ job, workspaces, ...summary }, { headers: NO_STORE });
  } catch (error) {
    ucLogError({ area: "uc.cron", op: job, durationMs: Date.now() - started }, error);
    throw error;
  }
}
