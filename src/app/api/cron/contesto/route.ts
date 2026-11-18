import { granolaAvailable, syncGranolaAll } from "@/lib/db/queries/context-granola";
import { runContextNightly } from "@/lib/db/queries/context-nightly";
import { contextStoreReady } from "@/lib/db/queries/context-store";
import { logSafeError } from "@/lib/log/safe-error";
import { checkCronAuthorization } from "@/lib/uc/notify/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const NO_STORE = { "Cache-Control": "no-store" } as const;
const LOG_SCOPE = "context/cron";
/** Il giro di Granola e poi quello di «Contesto»: insieme stanno sotto i 120 secondi della funzione. */
const GRANOLA_BUDGET_MS = 35_000;
const NIGHTLY_BUDGET_MS = 70_000;

function plain(status: number, body: string): Response {
  return new Response(body, { status, headers: { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8" } });
}

/**
 * Il giro della notte di «Contesto» (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §8.8), ogni giorno alle 2
 * UTC. In quest'ordine: anteprima di Vercel → 404 (le anteprime usano il database di produzione); `CRON_SECRET`
 * mancante o diverso → 401 (un segreto assente rifiuta sempre); archivio non pronto → 503; poi Granola, se è attivo, e
 * il giro: appunti in attesa, «In breve», testi più vecchi di 12 mesi; (9b) i fatti da verificare (`toCheck`, quelli
 * appena segnati) e i legami con «Cosa serve» di proposte non più aperte (`links`, quelli tolti).
 *
 * Risponde e scrive nei log solo conteggi: mai un testo, un titolo, un nome. Se Granola non riesce il resto del giro
 * si fa lo stesso.
 */
export async function GET(request: Request): Promise<Response> {
  if (process.env.VERCEL_ENV === "preview") return plain(404, "Not found");
  const auth = checkCronAuthorization(request.headers.get("authorization"), process.env.CRON_SECRET);
  if (auth !== "ok") {
    if (auth === "segreto_mancante") console.error(`[${LOG_SCOPE}] cron_secret_mancante`);
    return plain(401, "Unauthorized");
  }
  if (!(await contextStoreReady())) return plain(503, "Unavailable");

  const started = Date.now();
  let granola = { users: 0, imported: 0, errors: 0 };
  if (granolaAvailable()) {
    try {
      granola = await syncGranolaAll({ budgetMs: GRANOLA_BUDGET_MS });
    } catch (error) {
      logSafeError(LOG_SCOPE, "granola_non_riuscito", error);
      granola = { users: 0, imported: 0, errors: 1 };
    }
  }
  try {
    const counts = await runContextNightly({ budgetMs: NIGHTLY_BUDGET_MS });
    const body = {
      granola: { users: granola.users, imported: granola.imported, errors: granola.errors },
      read: counts.read,
      failed: counts.failed,
      left: counts.left,
      briefs: counts.briefs,
      purged: counts.purged,
      toCheck: counts.toCheck,
      links: counts.links,
    };
    console.info(`[${LOG_SCOPE}] giro`, JSON.stringify({ ...body, durationMs: Date.now() - started }));
    return Response.json({ job: "contesto", ...body }, { headers: NO_STORE });
  } catch (error) {
    logSafeError(LOG_SCOPE, "giro_non_riuscito", error, { durationMs: Date.now() - started });
    return plain(503, "Unavailable");
  }
}
