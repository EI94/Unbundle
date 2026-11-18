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
import { CONTEXT_WORK_PROBE_SQL } from "@/lib/db/context-work-ddl";
import { ensureDbSchema } from "@/lib/db/ensure-schema";
import { logSafeError } from "@/lib/log/safe-error";

/**
 * Che cosa dice la sonda della 0038:
 * - `pronto`: la 0038 c'è;
 * - `assente`: la sonda risponde falso. La 0038 non c'è, quindi nessun documento è «Solo Lateral Space»;
 * - `sconosciuto`: la sonda non risponde (un errore del database, o `ensureDbSchema()` che lancia a freddo). Non si sa
 *   se la 0038 c'è: chi filtra per visibilità chiude, non apre.
 */
export type ContextStoreState = "pronto" | "assente" | "sconosciuto";

let ready = false;

/** Lo stato della 0038 (la sonda del §2.5, dopo `ensureDbSchema()`); una volta `pronto` resta così nel processo. */
export async function contextStoreState(): Promise<ContextStoreState> {
  if (ready) return "pronto";
  try {
    await ensureDbSchema();
    const result = (await db.execute(sql`SELECT ${sql.raw(CONTEXT_PROBE_SQL)} AS ready`)) as unknown as { rows?: Array<{ ready?: unknown }> };
    ready = result.rows?.[0]?.ready === true;
    return ready ? "pronto" : "assente";
  } catch (error) {
    logSafeError("context/store", "sonda_non_riuscita", error);
    return "sconosciuto";
  }
}

/** Vero se la 0038 è applicata. Falso anche quando la sonda non risponde: chi lo usa per aprire, usi `contextStoreState`. */
export async function contextStoreReady(): Promise<boolean> {
  return (await contextStoreState()) === "pronto";
}

let workReady = false;

/**
 * Vero se la 0041 («Contesto nel lavoro», RILASCIO-9b-COSTRUZIONE.md §3.3) è applicata: la sua sonda, dopo
 * `ensureDbSchema()`, come `contextStoreState`; una volta vera resta così nel processo. Falso anche quando la sonda non
 * risponde. Senza la 0041: niente legami con «Cosa serve», niente fonti dalle risposte, niente campanella nuova, e `nota`
 * e `impara` rispondono «riprova»; quello che legge solo la 0038 funziona.
 */
export async function contextWorkReady(): Promise<boolean> {
  if (workReady) return true;
  try {
    await ensureDbSchema();
    const result = (await db.execute(sql`SELECT ${sql.raw(CONTEXT_WORK_PROBE_SQL)} AS ready`)) as unknown as { rows?: Array<{ ready?: unknown }> };
    workReady = result.rows?.[0]?.ready === true;
    return workReady;
  } catch (error) {
    logSafeError("context/store", "sonda_0041_non_riuscita", error);
    return false;
  }
}
