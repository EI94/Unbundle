import { db } from "..";
import { ensureDbSchema } from "../ensure-schema";
import { ASSIGN_USE_CASE_CODE_SQL } from "@/lib/portfolio/use-case-code";
import { logSafeError } from "@/lib/log/safe-error";
import { ensureWorkspaceConnectorConfig } from "./use-case-provisioning";

/**
 * Una segnalazione del workspace ancora senza codice, in un workspace senza riga di
 * `workspace_connector_configs`. `$1` workspace, `$2` segnalazione.
 */
const MISSING_CONFIG_SQL = `SELECT 1 AS missing
  FROM use_cases u
 WHERE u.id = $2::uuid AND u.workspace_id = $1::uuid AND u.code IS NULL
   AND NOT EXISTS (SELECT 1 FROM workspace_connector_configs c WHERE c.workspace_id = $1::uuid)`;

async function assignOnce(workspaceId: string, useCaseId: string): Promise<string | null> {
  const rows = (await db.$client.query(ASSIGN_USE_CASE_CODE_SQL, [workspaceId, useCaseId])) as Array<{ code?: unknown }>;
  const code = rows[0]?.code;
  return typeof code === "string" ? code : null;
}

/**
 * Assegna il prossimo codice del workspace (es. TJ-0012) a una segnalazione appena
 * creata. Un solo statement (vedi ASSIGN_USE_CASE_CODE_SQL). Restituisce il codice,
 * oppure null se la segnalazione ha già un codice, è di un altro workspace o il contatore
 * è al massimo.
 *
 * Un workspace senza riga di config (di prima, o una creazione in cui la riga non era
 * riuscita) non lascia la segnalazione senza codice: la riga nasce qui, come alla creazione del
 * workspace (connettore spento, `ensureWorkspaceConnectorConfig`), e il codice si assegna di
 * nuovo.
 */
export async function assignUseCaseCode(workspaceId: string, useCaseId: string): Promise<string | null> {
  await ensureDbSchema();
  const code = await assignOnce(workspaceId, useCaseId);
  if (code !== null) return code;
  const missing = (await db.$client.query(MISSING_CONFIG_SQL, [workspaceId, useCaseId])) as unknown[];
  if (missing.length === 0) return null;
  if ((await ensureWorkspaceConnectorConfig(workspaceId)) === "non_creata") return null;
  return assignOnce(workspaceId, useCaseId);
}

/**
 * Come assignUseCaseCode, ma non fallisce mai: se l'assegnazione non riesce la
 * segnalazione resta salvata senza codice (la recupera `use-case-admin codes`, o
 * `connector-admin backfill-codes`)
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
