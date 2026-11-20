import "server-only";
/**
 * Il caso di una richiesta della CLI e le sue scritture (rilascio 8.0b, RILASCIO-8.0b-COSTRUZIONE.md §1 e §4).
 *
 * - `resolveCliCase`: dal codice dello use case (`TJ-0049`) nel workspace del token al suo dossier, con i ruoli nel
 *   caso riletti adesso (`resolveCaseAccess`, come le pagine). Un token di un caso solo vede solo quel caso. Un caso
 *   che la persona non vede risponde come uno che non esiste; un guasto (le tabelle dei dossier che non rispondono)
 *   risponde 503, mai «non trovato». (8.0c) In più i ruoli della fabbrica (`CliCase.factory`): quelli del caso, più
 *   `builder_esterno` per chi costruisce il caso da fuori Lateral Space (`loadFactoryAccess`). Con la 0037 non pronta, a
 *   chi ha una concessione che copre il caso: 503 anche qui, non «non hai un ruolo».
 * - `requireCliWrite`: le scritture vogliono un ruolo della fabbrica che costruisce, un caso né chiuso né in pausa e
 *   la fabbrica non in sola lettura, come `onFactoryBuild` delle azioni della pagina.
 * - `runCliWrite`: ogni scrittura passa dal registro con la chiave di idempotenza (`use_case_mcp_requests`,
 *   `principal_key` = `cli:<token>`), come il MCP del team: la stessa richiesta ripetuta risponde come la prima,
 *   la stessa chiave con un corpo diverso è un conflitto. Un errore certo libera la chiave; uno incerto la lascia
 *   da riprendere. (8.2b) Lo stesso registro per la CI, con `ci:<id della chiave>` al posto del token di una persona
 *   (`executeIdempotentWrite`, usato da `src/lib/use-cases/ci/route-kit.ts`).
 */
import { createHash, randomUUID } from "node:crypto";
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
import { hasCaseOnlyBuilder } from "@/lib/db/queries/use-case-builders";
import type { UcExecutor } from "@/lib/db/uc-executor";
import { viewerFromSession } from "@/lib/db/queries/use-case-hub";
import { logSafeError } from "@/lib/log/safe-error";
import { cast, toStatement, ucSql } from "@/lib/uc/sql/statement";
import type { Result } from "@/lib/uc/types";
import { loadFactoryAccess } from "@/lib/use-cases/factory/access";
import type { FactoryAccess } from "@/lib/use-cases/factory/builders";
import { canReadFactory, canWriteFactory } from "@/lib/use-cases/factory/permissions";
import { decideExistingTeamRequest } from "@/lib/use-cases/mcp/idempotency";
import { abilitiesForUseCase } from "@/lib/use-cases/permissions";
import { isUseCaseHubWorkspace } from "@/lib/use-cases/rollout";
import { isCaseOnly } from "@/lib/auth/case-only";
import { cliError, cliJson, type OpenedCli } from "./route-kit";
import { CLI_CASE_NOT_FOUND, CLI_CASE_UNAVAILABLE, cliCaseAccessFailure, notBuilderMessage } from "./case-errors";

export interface CliCase {
  useCase: { id: string; code: string; title: string };
  dossierId: string;
  /** L'accesso al dossier, con i ruoli del caso: per il dossier e per chi approva. */
  access: CaseAccess;
  /** (8.0c) I ruoli della fabbrica (quelli del caso, più `builder_esterno`), la sola lettura, se costruisce da fuori. */
  factory: FactoryAccess;
  /** Chi agisce nella fabbrica: con i ruoli della fabbrica. */
  actor: FactoryActor;
  target: FactoryTarget;
  /** Chi vede «Cosa serve» sulla scheda (`abilitiesForUseCase`): per le esigenze e il pacchetto. */
  canSeeNeeds: boolean;
  /**
   * (8.0d) La persona è «Solo questo use case» nel workspace: costruisce questo caso con il predicato (la porta l'ha già
   * controllato, `caseAccessPrecheck`). Della memoria del cliente riceve solo i fatti legati al caso (D7), mai «In breve»,
   * regole e parole dell'azienda; registra solo il repository del suo caso (D4).
   */
  caseOnly: boolean;
}

const NOT_FOUND = CLI_CASE_NOT_FOUND;

/**
 * (8.0d, D7) Il contesto del caso è quello di «Solo questo use case» (i soli fatti legati al caso, il pacchetto con
 * `CONTESTO.md` ridotto): per chi lo è, e per **chiunque** legga un caso che costruisce, o costruirà, qualcuno «Solo
 * questo use case» (`hasCaseOnlyBuilder`). Quello che la CLI e l'MCP del caso portano finisce nel repository del
 * caso, che chi viene da fuori legge su GitHub. Lo chiedono solo i comandi che portano il contesto: una lettura in più.
 */
export async function caseOnlyContextOf(executor: UcExecutor, c: CliCase): Promise<boolean> {
  return c.caseOnly || (await hasCaseOnlyBuilder(executor, c.target));
}

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
  const viewer = viewerFromSession({ id: principal.userId, email: row.email ? String(row.email) : null, emailVerified: row.email_verified === true }, access.role);
  const abilities = abilitiesForUseCase(viewer);
  const caseOnly = isCaseOnly(access.role);
  if (!row.case_id) {
    // Che il codice esista lo dice solo a chi vede tutti i codici nella pagina: per gli altri è «non trovato».
    if (!abilities.canSeeAllCodes) return { ok: false, response: cliError(404, "non_trovato", NOT_FOUND) };
    return { ok: false, response: cliError(409, "senza_dossier", "Il caso non ha ancora una realizzazione: si avvia dalla sua pagina in Unbundle.") };
  }
  let caseAccess: CaseAccess | null;
  try {
    caseAccess = await resolveCaseAccess({ workspaceId: principal.workspaceId, caseId: String(row.case_id), userId: principal.userId, workspaceRole: access.role });
  } catch (error) {
    // Un guasto (le tabelle dei dossier non pronte) non è «caso non trovato»: la CLI deve dire di riprovare.
    if (error instanceof UcAccessError) {
      const failure = cliCaseAccessFailure(error.code);
      return { ok: false, response: cliError(failure.status, failure.code, failure.message, failure.headers) };
    }
    throw error;
  }
  if (!caseAccess || !canReadFactory(caseAccess.roles)) return { ok: false, response: cliError(404, "non_trovato", NOT_FOUND) };
  const factory = await loadFactoryAccess(executor, caseAccess);
  // (8.0c) La 0037 non è pronta e la persona costruisce il caso da fuori (o non si sa): «riprova», mai «non hai un ruolo».
  if (factory.blocked === "non_disponibile") return { ok: false, response: cliError(503, "non_disponibile", CLI_CASE_UNAVAILABLE, { "Retry-After": "60" }) };
  return {
    ok: true,
    value: {
      useCase: { id: String(row.id), code: String(row.code ?? code), title: String(row.title ?? "") },
      dossierId: String(row.case_id),
      access: caseAccess,
      factory,
      actor: { kind: "persona", userId: principal.userId, roles: factory.roles },
      target: { workspaceId: principal.workspaceId, useCaseId: String(row.id) },
      // (8.0d, D7) «Solo questo use case» riceve tutto quello che riguarda il suo caso, «Cosa serve» compreso: è del caso.
      canSeeNeeds: abilities.canSeeNeeds || caseOnly,
      caseOnly,
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

/** Il rifiuto di una scrittura a chi nel caso non costruisce (lo stesso testo nella CLI del modello 1.5.0). */
export const CLI_NOT_A_BUILDER = "Nel team del caso non hai un ruolo che costruisce: te lo dà il responsabile del caso.";

/** Perché nel caso non si può scrivere; null se si può. */
export function cliWriteDenial(c: CliCase): CliFailure | null {
  if (c.access.status === "chiuso") return { status: 409, code: "caso_chiuso", message: "Il caso è chiuso: il progetto si legge soltanto." };
  if (c.access.status === "sospeso") return { status: 409, code: "caso_sospeso", message: "Il caso è in pausa: si riprende da Impostazioni del caso." };
  if (c.factory.blocked === "non_disponibile") return { status: 503, code: "non_disponibile", message: CLI_CASE_UNAVAILABLE, retryAfterSeconds: 60 };
  if (c.factory.readOnly || !canWriteFactory(c.factory.roles)) {
    return { status: 403, code: "permesso_negato", message: notBuilderMessage(c.factory.blocked, CLI_NOT_A_BUILDER) };
  }
  return null;
}

/**
 * Perché non si può proporre una domanda; null se si può. Le proposte si decidono in «Cosa serve»: dove la sezione
 * non c'è (workspace fuori dall'area), nessuno le vedrebbe.
 */
export function proposalsDenial(c: CliCase): CliFailure | null {
  if (!isUseCaseHubWorkspace(c.target.workspaceId)) {
    return { status: 409, code: "proposte_non_disponibili", message: "In questo workspace «Cosa serve» non c'è ancora: la domanda chiedila al team." };
  }
  return null;
}

/** La risposta d'errore se nel caso non si può scrivere; null se si può. */
export function requireCliWrite(c: CliCase): Response | null {
  const denial = cliWriteDenial(c);
  return denial ? cliFailureResponse(denial) : null;
}

/** La risposta di un errore della CLI (e, 8.2b, della CI): il codice, il messaggio e, se c'è, quando riprovare. */
export function cliFailureResponse(f: CliFailure): Response {
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
  // (8.1a) I compiti.
  progetto_non_approvato: 409,
  gia_preso: 409,
  aree_sovrapposte: 409,
  libero: 409,
  // (8.2a) Il banco e le evals: la 0036 non c'è ancora.
  non_disponibile: 503,
  // (8.0c) Un repository già registrato per un altro cliente (a Lateral Space); a chi costruisce da fuori un repository
  // che non è dei casi del cliente, nuovo o di un altro cliente, con un testo solo; il repository modello, a tutti.
  repo_di_altro_cliente: 409,
  repo_non_del_cliente: 403,
  repo_modello: 400,
  // (8.0d, D4) Un caso di «Solo questo use case» sta in un repository suo, mai condiviso con altri casi.
  repo_condiviso: 409,
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
 * Chi scrive nel registro dell'idempotenza: il workspace e la chiave del chiamante, `cli:<token>` per una persona o
 * (8.2b) `ci:<id della chiave>` per la CI. `logScope`: l'area dei log (`cli`, `ci`), mai un dato.
 */
export interface IdempotentWriter {
  workspaceId: string;
  principalKey: string;
  logScope: string;
}

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
  execute: (reservedId: string | null) => Promise<Result<T>>,
  opts: { reserveId?: boolean } = {},
): Promise<CliWriteOutcome<T>> {
  const writer: IdempotentWriter = { workspaceId: opened.principal.workspaceId, principalKey: `cli:${opened.principal.tokenId}`, logScope: "cli" };
  return executeIdempotentWrite(writer, idempotencyKey, tool, body, execute, opts);
}

/**
 * La scrittura con la chiave di idempotenza di `executeCliWrite`, per chi scrive (`writer`): una persona con la CLI o
 * (8.2b) la CI con la sua chiave. Le stesse regole: la stessa richiesta ripetuta risponde come la prima, la stessa
 * chiave con un corpo diverso è un conflitto, un errore certo libera la chiave, uno incerto la lascia da riprendere.
 */
export async function executeIdempotentWrite<T extends Record<string, unknown>>(
  writer: IdempotentWriter,
  idempotencyKey: string,
  tool: string,
  body: unknown,
  execute: (reservedId: string | null) => Promise<Result<T>>,
  opts: { reserveId?: boolean } = {},
): Promise<CliWriteOutcome<T>> {
  if (!CLI_IDEMPOTENCY_KEY.test(idempotencyKey)) return { ok: false, status: 400, code: "idempotenza", message: "Serve una chiave di idempotenza di 8-128 caratteri (lettere, cifre, - e _)." };
  const key: TeamRequestKey = { workspaceId: writer.workspaceId, principalKey: writer.principalKey, idempotencyKey };
  const requestHash = cliRequestHash(tool, body);
  const existing = await readTeamMcpRequest(key);
  if (existing) {
    const decision = decideExistingTeamRequest(existing, requestHash);
    if (decision.kind === "duplicate") return { ok: true, value: (existing.result ?? {}) as T, repeated: true };
    if (decision.kind === "conflict") return { ok: false, ...CONFLICT };
    if (decision.kind === "in_progress") return { ok: false, ...inProgress(decision.retryAfterSeconds) };
  }
  // Con `reserveId` l'id della riga nasce qui e resta nel registro: una ripresa dopo un esito incerto lo ritrova.
  const claim = await claimTeamMcpRequest({ ...key, tool, requestHash, reservedIds: opts.reserveId ? [randomUUID()] : null });
  if (claim.status === "duplicate") return { ok: true, value: (claim.result ?? {}) as T, repeated: true };
  if (claim.status === "conflict") return { ok: false, ...CONFLICT };
  if (claim.status === "in_progress") return { ok: false, ...inProgress(claim.retryAfterSeconds) };
  let result: Result<T>;
  try {
    result = await execute(claim.reservedIds?.[0] ?? null);
  } catch (error) {
    logSafeError(writer.logScope, "scrittura", error, { tool });
    await failTeamMcpRequest(key, claim.attempt).catch(() => false);
    return { ok: false, status: 500, code: "errore", message: "Qualcosa non ha funzionato: riprova con la stessa chiave." };
  }
  if (!result.ok) {
    await releaseTeamMcpRequest(key, claim.attempt).catch(() => false);
    return { ok: false, status: STATUS_OF[result.code] ?? 400, code: result.code, message: result.message };
  }
  await completeTeamMcpRequest(key, claim.attempt, result.value).catch((error) => {
    logSafeError(writer.logScope, "chiusura incerta", error, { tool });
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
  execute: (reservedId: string | null) => Promise<Result<T>>,
  opts: { reserveId?: boolean } = {},
): Promise<Response> {
  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!CLI_IDEMPOTENCY_KEY.test(idempotencyKey)) return cliError(400, "idempotenza", "Manca l'intestazione Idempotency-Key (8-128 caratteri): la CLI la mette da sola.");
  const outcome = await executeCliWrite(opened, idempotencyKey, tool, body, execute, opts);
  if (!outcome.ok) return cliFailureResponse(outcome);
  return cliJson(outcome.repeated ? { ...outcome.value, ripetuta: true } : outcome.value);
}
