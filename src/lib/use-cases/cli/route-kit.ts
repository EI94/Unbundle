import "server-only";
/**
 * Le difese comuni delle rotte `/api/cli/*` (rilascio 8.0b, docs/rilascio-8/RILASCIO-8.0b-COSTRUZIONE.md §4),
 * le stesse del MCP del team:
 *
 * - **nessun token nell'indirizzo**: un token della CLI trovato lì si segna «esposto» (da revocare) e si risponde 400;
 * - **niente browser**: una richiesta con `Origin` si respinge (la CLI non lo manda);
 * - **solo JSON, corpo piccolo** nelle scritture;
 * - **il token, poi l'accesso al workspace riletto a ogni richiesta** (chi è uscito dal workspace non entra più,
 *   anche con un token ancora valido); i ruoli nel caso li controlla ogni rotta;
 * - **limiti per token** (600 letture e 120 scritture l'ora) e, per il login, per indirizzo e per codice.
 *
 * Le risposte sono `{ errore: { codice, messaggio } }` con il messaggio in italiano, da mostrare così com'è.
 */
import { createHash } from "node:crypto";
import { appRateLimitExecutor } from "@/lib/connector/app-deps";
import {
  declaredBodyTooLarge,
  DEFAULT_TOKEN_PREFIXES,
  findTokenInUrl,
  hygieneJson,
  isJsonContentType,
  readJsonBodyLimited,
} from "@/lib/connector/http-hygiene";
import { consumeRateLimits, rateLimitBucket, type RateLimitRule } from "@/lib/connector/rate-limit";
import { ensureDbSchema } from "@/lib/db/ensure-schema";
import { authenticateCli, cliStoreReady, type CliPrincipal } from "@/lib/db/queries/use-case-cli-auth";
import { markIntegrationTokenExposed } from "@/lib/db/queries/workspace-integrations";
import { getAppUcExecutor, type UcExecutor } from "@/lib/db/uc-executor";
import { logSafeError } from "@/lib/log/safe-error";
import { getCollaboratorAccess, type WorkspaceAccess } from "@/lib/workspace-access";
import { CLI_DEVICE_CODE_PREFIX, CLI_TOKEN_PREFIX, hashSecret } from "./codes";

export const CLI_ROUTE_LIMITS = Object.freeze({
  readsPerHour: 600,
  writesPerHour: 120,
  loginStartsPerHour: 20,
  pollsPerMinute: 30,
  /** Il corpo di una scrittura: abbastanza per una scelta o una sintesi, mai un file. */
  bodyBytes: 64 * 1024,
});

const TOKEN_PREFIXES = [...DEFAULT_TOKEN_PREFIXES, CLI_TOKEN_PREFIX, CLI_DEVICE_CODE_PREFIX];

/** Una risposta della CLI. */
export function cliJson(body: unknown, status = 200): Response {
  return hygieneJson(body, status);
}

/** Un errore per la CLI: il codice per gli script, il messaggio per la persona. */
export function cliError(status: number, codice: string, messaggio: string, extra: Readonly<Record<string, string>> = {}): Response {
  return hygieneJson({ errore: { codice, messaggio } }, status, extra);
}

/** I controlli prima di leggere il token e il corpo: token nell'indirizzo, metodo, `Origin`, JSON, lunghezza. */
export async function screenCliRequest(request: Request, method: "GET" | "POST"): Promise<Response | null> {
  const finding = findTokenInUrl(request.url, { tokenPrefixes: TOKEN_PREFIXES });
  if (finding.found) {
    for (const candidate of finding.candidates) {
      if (!candidate.startsWith(CLI_TOKEN_PREFIX)) continue;
      try {
        await markIntegrationTokenExposed(hashSecret(candidate));
      } catch (error) {
        logSafeError("cli", "segna esposto", error);
      }
    }
    return cliError(400, "token_nell_indirizzo", "Il token non va mai nell'indirizzo: è stato bloccato. Rifai «unbundle login».");
  }
  if (request.method.toUpperCase() !== method) return cliError(405, "metodo", "Metodo non ammesso.", { Allow: method });
  if (request.headers.get("origin")) return cliError(403, "origine", "La CLI non si usa da un browser.");
  if (method === "POST") {
    if (!isJsonContentType(request.headers.get("content-type"))) return cliError(415, "json", "Serve un corpo JSON.");
    if (declaredBodyTooLarge(request.headers, CLI_ROUTE_LIMITS.bodyBytes)) return cliError(413, "troppo_grande", "La richiesta è troppo grande.");
  }
  return null;
}

/** Il corpo JSON di una scrittura, o la risposta d'errore. */
export async function readCliBody(request: Request): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; response: Response }> {
  const read = await readJsonBodyLimited(request, CLI_ROUTE_LIMITS.bodyBytes);
  if (!read.ok) return { ok: false, response: cliError(400, "json", "Il corpo non è un JSON valido o è troppo grande.") };
  const body = read.value;
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { ok: false, response: cliError(400, "json", "Serve un oggetto JSON.") };
  return { ok: true, body: body as Record<string, unknown> };
}

/** Una chiave anonima dell'indirizzo di chi chiama, per i limiti del login: mai l'indirizzo. */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "ignoto";
  return createHash("sha256").update(`cli:${forwarded}`).digest("hex").slice(0, 32);
}

/** Consuma i limiti; la risposta 429 se uno è finito, altrimenti null. */
export async function consumeCliLimits(rules: readonly RateLimitRule[]): Promise<Response | null> {
  const decision = await consumeRateLimits(appRateLimitExecutor, rules);
  if (decision.ok) return null;
  return cliError(429, "troppe_richieste", "Troppe richieste: riprova tra poco.", { "Retry-After": String(decision.retryAfterSeconds) });
}

export interface OpenedCli {
  principal: CliPrincipal;
  access: WorkspaceAccess;
  executor: UcExecutor;
}

/** Consuma il limite orario del token: letture o scritture. Il secondo valore dice tra quanti secondi riprovare. */
export async function consumeCliTokenLimit(tokenId: string, write: boolean): Promise<{ ok: true } | { ok: false; retryAfterSeconds: number }> {
  const decision = await consumeRateLimits(appRateLimitExecutor, [
    { bucket: rateLimitBucket("cli", write ? "w" : "r", tokenId), window: "hour", limit: write ? CLI_ROUTE_LIMITS.writesPerHour : CLI_ROUTE_LIMITS.readsPerHour },
  ]);
  return decision.ok ? { ok: true } : { ok: false, retryAfterSeconds: decision.retryAfterSeconds };
}

/**
 * Apre una richiesta della CLI con il token: lo schema, il token, l'accesso al workspace riletto adesso, il
 * limite del token. Il resto (ruoli nel caso, regole dell'Agent Factory) lo fa la rotta. L'MCP del caso passa
 * `limit: false` e consuma il limite per ogni strumento chiamato, come il MCP del team.
 */
export async function openCli(
  request: Request,
  input: { method: "GET" | "POST"; write: boolean; limit?: boolean },
): Promise<{ ok: true; value: OpenedCli } | { ok: false; response: Response }> {
  const screened = await screenCliRequest(request, input.method);
  if (screened) return { ok: false, response: screened };
  await ensureDbSchema();
  const executor = await getAppUcExecutor();
  if (!(await cliStoreReady(executor))) return { ok: false, response: cliError(503, "non_disponibile", "La CLI non è ancora disponibile: riprova tra qualche minuto.") };
  const principal = await authenticateCli(executor, request.headers.get("authorization"));
  if (!principal) return { ok: false, response: cliError(401, "token", "Token mancante, scaduto o revocato: fai «unbundle login».") };
  const access = await getCollaboratorAccess(principal.userId, principal.workspaceId);
  if (!access) return { ok: false, response: cliError(403, "workspace", "Non hai più accesso a questo workspace.") };
  if (input.limit !== false) {
    const limited = await consumeCliTokenLimit(principal.tokenId, input.write);
    if (!limited.ok) return { ok: false, response: cliError(429, "troppe_richieste", "Troppe richieste: riprova tra poco.", { "Retry-After": String(limited.retryAfterSeconds) }) };
  }
  return { ok: true, value: { principal, access, executor } };
}
