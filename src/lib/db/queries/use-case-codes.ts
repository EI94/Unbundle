import { db } from "..";
import { ensureDbSchema } from "../ensure-schema";
import { ASSIGN_USE_CASE_CODE_SQL } from "@/lib/portfolio/use-case-code";
import { logSafeError } from "@/lib/log/safe-error";

/**
 * Assegna il prossimo codice del workspace (es. TJ-0012) a una segnalazione appena
 * creata. Un solo statement (vedi ASSIGN_USE_CASE_CODE_SQL). Restituisce il codice,
 * oppure null se il workspace non ha il connettore configurato o la segnalazione
 * ha già un codice.
 */
export async function assignUseCaseCode(workspaceId: string, useCaseId: string): Promise<string | null> {
  await ensureDbSchema();
  const rows = (await db.$client.query(ASSIGN_USE_CASE_CODE_SQL, [workspaceId, useCaseId])) as Array<{ code?: unknown }>;
  const code = rows[0]?.code;
  return typeof code === "string" ? code : null;
}

/**
 * Come assignUseCaseCode, ma non fallisce mai: se l'assegnazione non riesce la
 * segnalazione resta salvata senza codice (la recupera lo script backfill-codes)
 * e il log contiene solo nome e codice dell'errore, mai il payload.
 */
export async function assignUseCaseCodeSafely(workspaceId: string, useCaseId: string): Promise<string | null> {
  try {
    return await assignUseCaseCode(workspaceId, useCaseId);
  } catch (error) {
    logSafeError("use-case-code", "assign_failed", error, { useCaseId });
    return null;
  }
}
