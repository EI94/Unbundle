import { db } from "..";
import { ensureDbSchema } from "../ensure-schema";
import { logSafeError } from "@/lib/log/safe-error";
import {
  INSERT_CONFIGS_SQL,
  PROVISION_FACTS_SQL,
  PROVISION_MODEL_V2_SQL,
  existingModelOutcome,
  insertConfigParams,
  isSettled,
  modelV2Params,
  needsModelV2,
  planWorkspaceConfig,
  provisionFactsFrom,
  type ProvisionFacts,
} from "@/lib/use-cases/provisioning";

/**
 * Prerequisiti dell'area «Use case» di un workspace, idempotenti (regole in
 * `src/lib/use-cases/provisioning.ts`): la riga di `workspace_connector_configs` (prefisso dal
 * nome, slug unico per costruzione, connettore spento) e, se il workspace non ha né modello né
 * use case, il modello in v2 come lo crea `scoring-v2 --apply`. Un modello che c'è non si tocca.
 *
 * Chi la chiama:
 * - `createWorkspace`, subito dopo l'INSERT del workspace (ogni workspace nuovo nasce pronto);
 * - il layout del workspace con l'area accesa, dopo la risposta (`after()`): recupera un
 *   workspace di prima o una creazione in cui questo passo non era riuscito;
 * - `assignUseCaseCode`, quando una proposta arriva in un workspace senza riga (solo la riga).
 *
 * Un workspace già a posto si ricorda per processo: le richieste dopo la prima non leggono più.
 */

export type ProvisionOutcome =
  | { ok: true; workspace: "assente" }
  | { ok: true; workspace: "pronto"; config: "creata" | "presente" | "non_creata"; model: "creato_v2" | "presente" | "lasciato" };

/** Workspace già a posto in questo processo (nessuna rilettura). Svuotato oltre questo numero. */
const SETTLED_LIMIT = 5000;
const settled = new Set<string>();

type Row = Record<string, unknown>;

async function query(text: string, params: unknown[]): Promise<Row[]> {
  return (await db.$client.query(text, params)) as Row[];
}

async function readFacts(workspaceId: string): Promise<ProvisionFacts | null> {
  return provisionFactsFrom((await query(PROVISION_FACTS_SQL, [workspaceId]))[0]);
}

/**
 * La riga di config, se manca (`planWorkspaceConfig`: slug unico per costruzione, quindi
 * nessun conflitto con gli altri workspace). Se un'altra richiesta la crea nello stesso momento,
 * `ON CONFLICT DO NOTHING` non scrive niente e la riga è `presente`.
 */
export async function ensureWorkspaceConnectorConfig(workspaceId: string, name?: string): Promise<"creata" | "presente" | "non_creata"> {
  const facts = await readFacts(workspaceId);
  if (!facts) return "non_creata";
  if (facts.hasConfig) return "presente";
  const inserted = await query(INSERT_CONFIGS_SQL, insertConfigParams(planWorkspaceConfig({ id: facts.id, name: name ?? facts.name })));
  if (inserted.length > 0) return "creata";
  return (await readFacts(workspaceId))?.hasConfig ? "presente" : "non_creata";
}

/** I prerequisiti del workspace. Lancia sugli errori del database: per chi non deve fallire c'è `provisionUseCaseWorkspaceSafely`. */
export async function provisionUseCaseWorkspace(workspaceId: string): Promise<ProvisionOutcome> {
  await ensureDbSchema();
  const facts = await readFacts(workspaceId);
  if (!facts) return { ok: true, workspace: "assente" };
  const config = facts.hasConfig ? "presente" : await ensureWorkspaceConnectorConfig(workspaceId, facts.name);
  let model: "creato_v2" | "presente" | "lasciato" = existingModelOutcome(facts);
  let after: ProvisionFacts | null = { ...facts, hasConfig: config !== "non_creata" };
  if (needsModelV2(facts)) {
    const [row] = await query(PROVISION_MODEL_V2_SQL, modelV2Params(workspaceId));
    if (row?.esito === "creato_v2") {
      model = "creato_v2";
      after = { ...after, hasModel: true, scoringVersion: 2 };
    } else {
      // Nel frattempo un'altra richiesta ha creato il modello, o è arrivato un use case.
      after = await readFacts(workspaceId);
      model = after ? existingModelOutcome(after) : "lasciato";
    }
  }
  if (after && isSettled(after)) remember(workspaceId);
  return { ok: true, workspace: "pronto", config, model };
}

function remember(workspaceId: string) {
  if (settled.size >= SETTLED_LIMIT) settled.clear();
  settled.add(workspaceId.toLowerCase());
}

/**
 * Come `provisionUseCaseWorkspace`, ma non lancia mai: un guasto si registra (solo nome e
 * codice dell'errore) e il chiamante prosegue. Un workspace già a posto in questo processo non
 * si rilegge.
 */
export async function provisionUseCaseWorkspaceSafely(workspaceId: string): Promise<ProvisionOutcome | null> {
  if (settled.has(workspaceId.toLowerCase())) return null;
  try {
    return await provisionUseCaseWorkspace(workspaceId);
  } catch (error) {
    logSafeError("use-case-provisioning", "provision_failed", error);
    return null;
  }
}

/** Solo per le prove: dimentica i workspace ricordati. */
export function forgetProvisionedWorkspacesForTests(): void {
  settled.clear();
}
