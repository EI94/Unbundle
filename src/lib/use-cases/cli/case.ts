import "server-only";
/**
 * Il caso di una richiesta della CLI e le sue scritture (rilascio 8.0b, RILASCIO-8.0b-COSTRUZIONE.md §1 e §4).
 *
 * - `resolveCliCase`: dal codice dello use case (`TJ-0049`) nel workspace del token al suo dossier, con i ruoli nel
 *   caso riletti adesso (`resolveCaseAccess`, come le pagine). Un token di un caso solo vede solo quel caso. Un caso
 *   che la persona non vede risponde come uno che non esiste.
 * - `requireCliWrite`: le scritture vogliono un ruolo che scrive l'Agent Factory, un caso né chiuso né in pausa e
 *   la sezione non in sola lettura, come `onFactory` delle azioni della pagina.
 * - `runCliWrite`: ogni scrittura passa dal registro con la chiave di idempotenza (`use_case_mcp_requests`,
 *   `principal_key` = `cli:<token>`), come il MCP del team: la stessa richiesta ripetuta risponde come la prima,
 *   la stessa chiave con un corpo diverso è un conflitto. Un errore certo libera la chiave; uno incerto la lascia
 *   da riprendere.
 */
import { createHash } from "node:crypto";
import {
  claimTeamMcpRequest,
  completeTeamMcpRequest,
  failTeamMcpRequest,
  readTeamMcpRequest,
  releaseTeamMcpRequest,
  type TeamRequestKey,
} from "@/lib/db/queries/team-mcp-requests";
import { resolveCaseAccess, UcAccessError, type CaseAccess } from "@/lib/db/queries/uc-access";
import { factoryStoreReady, type FactoryActor, type FactoryTarget } from "@/lib/db/queries/use-case-factory";
import { viewerFromSession } from "@/lib/db/queries/use-case-hub";
import { logSafeError } from "@/lib/log/safe-error";
import { cast, toStatement, ucSql } from "@/lib/uc/sql/statement";
import type { Result } from "@/lib/uc/types";
import { canReadFactory, canWriteFactory } from "@/lib/use-cases/factory/permissions";
import { decideExistingTeamRequest } from "@/lib/use-cases/mcp/idempotency";
import { abilitiesForUseCase } from "@/lib/use-cases/permissions";
import { cliError, cliJson, type OpenedCli } from "./route-kit";

export interface CliCase {
  useCase: { id: string; code: string; title: string };
  dossierId: string;
  access: CaseAccess;
  actor: FactoryActor;
  target: FactoryTarget;
  /** Chi vede «Cosa serve» sulla scheda (`abilitiesForUseCase`): per le esigenze e il pacchetto. */
  canSeeNeeds: boolean;
}

const NOT_FOUND = "Caso non trovato in questo workspace (o non sei nel suo team).";

/** Il caso della richiesta, dal codice dello use case; la risposta d'errore se non si può. */
export async function resolveCliCase(opened: OpenedCli, ref: unknown): Promise<{ ok: true; value: CliCase } | { ok: false; response: Response }> {
  const { principal, access, executor } = opened;
  const code = typeof ref === "string" ? ref.trim() : "";
  if (!/^[A-Za-z0-9-]{3,40}$/.test(code)) return { ok: false, response: cliError(400, "caso", "Indica il caso con il suo codice, per esempio TJ-0049.") };
  if (!(await factoryStoreReady(executor))) return { ok: false, response: cliError(503, "non_disponibile", "L'Agent Factory non è ancora disponibile: riprova tra qualche minuto.") };
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT u.id, u.code, u.title, c.id AS case_id,
  (SELECT p.email FROM users p WHERE p.id = ${cast(principal.userId, "uuid")}) AS email,
  (SELECT p.email_verified IS NOT NULL FROM users p WHERE p.id = ${cast(principal.userId, "uuid")}) AS email_verified
FROM use_cases u
LEFT JOIN uc_cases c ON c.portfolio_use_case_id = u.id AND c.workspace_id = u.workspace_id
WHERE u.workspace_id = ${cast(principal.workspaceId, "uuid")} AND (upper(u.code) = upper(${cast(code, "text")}) OR u.id::text = lower(${cast(code, "text")}))
LIMIT 1`),
  ]);
  const row = rows[0];
  if (!row || (principal.caseUseCaseId !== null && principal.caseUseCaseId !== String(row.id))) return { ok: false, response: cliError(404, "non_trovato", NOT_FOUND) };
  if (!row.case_id) return { ok: false, response: cliError(409, "senza_dossier", "Lo use case non ha ancora un dossier: si avvia dalla sua pagina in Unbundle.") };
  let caseAccess: CaseAccess | null;
  try {
    caseAccess = await resolveCaseAccess({ workspaceId: principal.workspaceId, caseId: String(row.case_id), userId: principal.userId, workspaceRole: access.role });
  } catch (error) {
    if (error instanceof UcAccessError) return { ok: false, response: cliError(404, "non_trovato", NOT_FOUND) };
    throw error;
  }
  if (!caseAccess || !canReadFactory(caseAccess.roles)) return { ok: false, response: cliError(404, "non_trovato", NOT_FOUND) };
  const viewer = viewerFromSession({ id: principal.userId, email: row.email ? String(row.email) : null, emailVerified: row.email_verified === true }, access.role);
  return {
    ok: true,
    value: {
      useCase: { id: String(row.id), code: String(row.code ?? code), title: String(row.title ?? "") },
      dossierId: String(row.case_id),
      access: caseAccess,
      actor: { kind: "persona", userId: principal.userId, roles: caseAccess.roles },
      target: { workspaceId: principal.workspaceId, useCaseId: String(row.id) },
      canSeeNeeds: abilitiesForUseCase(viewer).canSeeNeeds,
    },
  };
}

/** La risposta d'errore se nel caso non si può scrivere; null se si può. */
export function requireCliWrite(c: CliCase): Response | null {
  if (c.access.status === "chiuso") return cliError(409, "caso_chiuso", "Il caso è chiuso: il progetto si legge soltanto.");
  if (c.access.status === "sospeso") return cliError(409, "caso_sospeso", "Il caso è in pausa: si riprende da Impostazioni del caso.");
  if (c.access.readOnly || !canWriteFactory(c.access.roles)) {
    return cliError(403, "permesso_negato", "Nel team del caso non hai un ruolo che scrive: serve responsabile, analista o sviluppatore di Lateral Space.");
  }
  return null;
}

const STATUS_OF: Readonly<Record<string, number>> = {
  permesso_negato: 403,
  non_trovato: 404,
  conflitto: 409,
  progetto_non_aperto: 409,
  argomenti_mancanti: 409,
  manca_ai_board: 409,
  troppe_proposte: 429,
};

/** Una chiave di idempotenza valida: quella che la CLI genera (un UUID) o una del chiamante, 8-128 caratteri. */
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,128}$/;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((k) => [k, canonical((value as Record<string, unknown>)[k])]));
  }
  return value;
}

/** L'impronta di una richiesta: lo strumento e il corpo, con le chiavi in ordine. */
export function cliRequestHash(tool: string, body: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical({ tool, body }))).digest("hex");
}

/**
 * Una scrittura della CLI con la chiave di idempotenza. `execute` scrive in una transazione sola e restituisce solo
 * id, codici e versioni (finiscono nel registro).
 */
export async function runCliWrite<T extends Record<string, unknown>>(
  request: Request,
  opened: OpenedCli,
  tool: string,
  body: unknown,
  execute: () => Promise<Result<T>>,
): Promise<Response> {
  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!IDEMPOTENCY_KEY.test(idempotencyKey)) return cliError(400, "idempotenza", "Manca l'intestazione Idempotency-Key (8-128 caratteri): la CLI la mette da sola.");
  const key: TeamRequestKey = { workspaceId: opened.principal.workspaceId, principalKey: `cli:${opened.principal.tokenId}`, idempotencyKey };
  const requestHash = cliRequestHash(tool, body);
  const existing = await readTeamMcpRequest(key);
  if (existing) {
    const decision = decideExistingTeamRequest(existing, requestHash);
    if (decision.kind === "duplicate") return cliJson({ ...(existing.result ?? {}), ripetuta: true });
    if (decision.kind === "conflict") return cliError(409, "idempotenza", "La stessa chiave con una richiesta diversa: usa una chiave nuova.");
    if (decision.kind === "in_progress") return cliError(409, "in_corso", "La stessa richiesta è ancora in corso: riprova tra poco.", { "Retry-After": String(decision.retryAfterSeconds) });
  }
  const claim = await claimTeamMcpRequest({ ...key, tool, requestHash, reservedIds: null });
  if (claim.status === "duplicate") return cliJson({ ...(claim.result ?? {}), ripetuta: true });
  if (claim.status === "conflict") return cliError(409, "idempotenza", "La stessa chiave con una richiesta diversa: usa una chiave nuova.");
  if (claim.status === "in_progress") return cliError(409, "in_corso", "La stessa richiesta è ancora in corso: riprova tra poco.", { "Retry-After": String(claim.retryAfterSeconds) });
  let result: Result<T>;
  try {
    result = await execute();
  } catch (error) {
    logSafeError("cli", "scrittura", error, { tool });
    await failTeamMcpRequest(key, claim.attempt).catch(() => false);
    return cliError(500, "errore", "Qualcosa non ha funzionato: riprova con la stessa chiave.");
  }
  if (!result.ok) {
    await releaseTeamMcpRequest(key, claim.attempt).catch(() => false);
    return cliError(STATUS_OF[result.code] ?? 400, result.code, result.message);
  }
  await completeTeamMcpRequest(key, claim.attempt, result.value).catch((error) => {
    logSafeError("cli", "chiusura incerta", error, { tool });
    return false;
  });
  return cliJson(result.value);
}
