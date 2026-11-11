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

/** Un errore di una scrittura della CLI o dell'MCP del caso: lo stato HTTP, il codice, il messaggio in italiano. */
export interface CliFailure {
  status: number;
  code: string;
  message: string;
  retryAfterSeconds?: number;
}

/** Perché nel caso non si può scrivere; null se si può. */
export function cliWriteDenial(c: CliCase): CliFailure | null {
  if (c.access.status === "chiuso") return { status: 409, code: "caso_chiuso", message: "Il caso è chiuso: il progetto si legge soltanto." };
  if (c.access.status === "sospeso") return { status: 409, code: "caso_sospeso", message: "Il caso è in pausa: si riprende da Impostazioni del caso." };
  if (c.access.readOnly || !canWriteFactory(c.access.roles)) {
    return { status: 403, code: "permesso_negato", message: "Nel team del caso non hai un ruolo che scrive: serve responsabile, analista o sviluppatore di Lateral Space." };
  }
  return null;
}

/** La risposta d'errore se nel caso non si può scrivere; null se si può. */
export function requireCliWrite(c: CliCase): Response | null {
  const denial = cliWriteDenial(c);
  return denial ? failureResponse(denial) : null;
}

function failureResponse(f: CliFailure): Response {
  return cliError(f.status, f.code, f.message, f.retryAfterSeconds === undefined ? {} : { "Retry-After": String(f.retryAfterSeconds) });
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
export const CLI_IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,128}$/;

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

/** L'esito di una scrittura con la chiave: il risultato (anche quello di una ripetizione) o l'errore. */
export type CliWriteOutcome<T> = { ok: true; value: T; repeated: boolean } | ({ ok: false } & CliFailure);

const CONFLICT: CliFailure = { status: 409, code: "idempotenza", message: "La stessa chiave con una richiesta diversa: usa una chiave nuova." };
const inProgress = (retryAfterSeconds: number): CliFailure => ({ status: 409, code: "in_corso", message: "La stessa richiesta è ancora in corso: riprova tra poco.", retryAfterSeconds });

/**
 * Una scrittura con la chiave di idempotenza, per la CLI (la chiave arriva nell'intestazione) e per l'MCP del caso
 * (arriva negli argomenti). `execute` scrive in una transazione sola e restituisce solo id, codici e versioni
 * (finiscono nel registro). La stessa richiesta ripetuta restituisce il risultato della prima.
 */
export async function executeCliWrite<T extends Record<string, unknown>>(
  opened: OpenedCli,
  idempotencyKey: string,
  tool: string,
  body: unknown,
  execute: () => Promise<Result<T>>,
): Promise<CliWriteOutcome<T>> {
  if (!CLI_IDEMPOTENCY_KEY.test(idempotencyKey)) return { ok: false, status: 400, code: "idempotenza", message: "Serve una chiave di idempotenza di 8-128 caratteri (lettere, cifre, - e _)." };
  const key: TeamRequestKey = { workspaceId: opened.principal.workspaceId, principalKey: `cli:${opened.principal.tokenId}`, idempotencyKey };
  const requestHash = cliRequestHash(tool, body);
  const existing = await readTeamMcpRequest(key);
  if (existing) {
    const decision = decideExistingTeamRequest(existing, requestHash);
    if (decision.kind === "duplicate") return { ok: true, value: (existing.result ?? {}) as T, repeated: true };
    if (decision.kind === "conflict") return { ok: false, ...CONFLICT };
    if (decision.kind === "in_progress") return { ok: false, ...inProgress(decision.retryAfterSeconds) };
  }
  const claim = await claimTeamMcpRequest({ ...key, tool, requestHash, reservedIds: null });
  if (claim.status === "duplicate") return { ok: true, value: (claim.result ?? {}) as T, repeated: true };
  if (claim.status === "conflict") return { ok: false, ...CONFLICT };
  if (claim.status === "in_progress") return { ok: false, ...inProgress(claim.retryAfterSeconds) };
  let result: Result<T>;
  try {
    result = await execute();
  } catch (error) {
    logSafeError("cli", "scrittura", error, { tool });
    await failTeamMcpRequest(key, claim.attempt).catch(() => false);
    return { ok: false, status: 500, code: "errore", message: "Qualcosa non ha funzionato: riprova con la stessa chiave." };
  }
  if (!result.ok) {
    await releaseTeamMcpRequest(key, claim.attempt).catch(() => false);
    return { ok: false, status: STATUS_OF[result.code] ?? 400, code: result.code, message: result.message };
  }
  await completeTeamMcpRequest(key, claim.attempt, result.value).catch((error) => {
    logSafeError("cli", "chiusura incerta", error, { tool });
    return false;
  });
  return { ok: true, value: result.value, repeated: false };
}

/** Una scrittura della CLI: la chiave di idempotenza è nell'intestazione `Idempotency-Key`. */
export async function runCliWrite<T extends Record<string, unknown>>(
  request: Request,
  opened: OpenedCli,
  tool: string,
  body: unknown,
  execute: () => Promise<Result<T>>,
): Promise<Response> {
  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!CLI_IDEMPOTENCY_KEY.test(idempotencyKey)) return cliError(400, "idempotenza", "Manca l'intestazione Idempotency-Key (8-128 caratteri): la CLI la mette da sola.");
  const outcome = await executeCliWrite(opened, idempotencyKey, tool, body, execute);
  if (!outcome.ok) return failureResponse(outcome);
  return cliJson(outcome.repeated ? { ...outcome.value, ripetuta: true } : outcome.value);
}
