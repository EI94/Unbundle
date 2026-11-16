import "server-only";
/**
 * L'archivio di «Contesto» è pronto? (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §2.4, §3.4.1)
 *
 * La 0038 la applica il self-heal al primo avvio dopo il deploy, senza fermare il resto dell'app se non riesce. Finché
 * la sua sonda è falsa il codice della 9a non tocca le tabelle nuove: la pagina dice che si sta preparando, le rotte
 * rispondono 503, la tesi del valore resta quella dell'organizzazione.
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { CONTEXT_PROBE_SQL } from "@/lib/db/context-ddl";
import { ensureDbSchema } from "@/lib/db/ensure-schema";
import { logSafeError } from "@/lib/log/safe-error";

let ready = false;

/** Vero se la 0038 è applicata (la sonda del §2.5, dopo `ensureDbSchema()`); una volta vero resta vero nel processo. */
export async function contextStoreReady(): Promise<boolean> {
  if (ready) return true;
  try {
    await ensureDbSchema();
    const result = (await db.execute(sql`SELECT ${sql.raw(CONTEXT_PROBE_SQL)} AS ready`)) as unknown as { rows?: Array<{ ready?: unknown }> };
    ready = result.rows?.[0]?.ready === true;
    return ready;
  } catch (error) {
    logSafeError("context/store", "sonda_non_riuscita", error);
    return false;
  }
}
