import "server-only";
/**
 * Le difese delle rotte `/api/ci/*` (rilascio 8.2b, docs/rilascio-8/RILASCIO-8.2b-SPEC.md §2.2 e §2.9): quelle della CLI,
 * con la chiave della CI al posto del token di una persona.
 *
 * - **Nessuna chiave nell'indirizzo**, a ogni metodo: una chiave della CI trovata lì si revoca subito (`esposta`, con
 *   l'e-mail `chiave_ci_bloccata`: `revokeCiKeysInUrl`), un token della CLI si segna esposto; 400 `chiave_nell_indirizzo`.
 * - **Niente browser** (`Origin`), **solo JSON**, **al massimo 64 KB**, come la CLI.
 * - **La 0042 pronta**, altrimenti 503 `non_disponibile` (durante il self-heal, o se è fallito).
 * - **La chiave** (`authenticateCiKey`): né revocata né scaduta, altrimenti 401 `chiave`, senza dire perché. Il primo uso
 *   della chiave nuova di una rotazione revoca la vecchia, anche con una lettura.
 * - **I limiti per chiave**: 600 letture e 120 scritture l'ora (429 `troppe_richieste`, con `Retry-After`).
 * - **L'area accesa** per il workspace della chiave, come la pagina «Agent Factory»: l'area «Use case» e i dossier. Spenta
 *   (o il workspace escluso), per la CI i casi non ci sono: la lista è vuota e un invio è 404; le tabelle dei dossier che
 *   non rispondono sono 503.
 * - **L'idempotenza** della CLI (`executeIdempotentWrite`), con `ci:<id della chiave>` al posto del token di una persona:
 *   lo stesso invio risponde come il primo (`ripetuta: true`), la stessa chiave con un altro corpo è 409 `idempotenza`.
 *
 * Nei log solo codici, nell'area `ci`: mai la chiave, mai il corpo. Mai una persona nelle risposte.
 */
import { appRateLimitExecutor } from "@/lib/connector/app-deps";
import { declaredBodyTooLarge, DEFAULT_TOKEN_PREFIXES, findTokenInUrl, isJsonContentType } from "@/lib/connector/http-hygiene";
import { consumeRateLimits, rateLimitBucket } from "@/lib/connector/rate-limit";
import { ensureDbSchema } from "@/lib/db/ensure-schema";
import { ensureUcAvailable, UcAccessError } from "@/lib/db/queries/uc-access";
import { authenticateCiKey, ciKeysStoreReady, type CiKeyPrincipal } from "@/lib/db/queries/use-case-ci-keys";
import { markIntegrationTokenExposed } from "@/lib/db/queries/workspace-integrations";
import { getAppUcExecutor, type UcExecutor } from "@/lib/db/uc-executor";
import { logSafeError } from "@/lib/log/safe-error";
import type { Result } from "@/lib/uc/types";
import { CLI_IDEMPOTENCY_KEY, cliFailureResponse, executeIdempotentWrite } from "@/lib/use-cases/cli/case";
import { CLI_DEVICE_CODE_PREFIX, CLI_TOKEN_PREFIX, hashSecret } from "@/lib/use-cases/cli/codes";
import { cliError, cliJson, revokeCiKeysInUrl } from "@/lib/use-cases/cli/route-kit";
import { isUseCaseHubWorkspace } from "@/lib/use-cases/rollout";
import { CI_ERRORS, CI_IDEMPOTENCY_MISSING_MESSAGE, CI_ROUTE_LIMITS, type CiErrorCode } from "./api";
import { ciIdempotencyOwner } from "./keys";

/** I prefissi dei segreti di Unbundle che le difese riconoscono in un indirizzo: quelli della CLI, chiave della CI compresa. */
const TOKEN_PREFIXES = [...DEFAULT_TOKEN_PREFIXES, CLI_TOKEN_PREFIX, CLI_DEVICE_CODE_PREFIX];

/** Un errore dell'API della CI, con lo stato e il messaggio di `CI_ERRORS`. */
export function ciError(code: CiErrorCode, extra: Readonly<Record<string, string>> = {}): Response {
  const e = CI_ERRORS[code];
  return cliError(e.status, code, e.message, extra);
}

const RETRY = { "Retry-After": "60" } as const;

/**
 * I controlli prima di leggere la chiave e il corpo: la chiave (o un altro segreto) nell'indirizzo, il metodo, `Origin`,
 * JSON, la lunghezza dichiarata. Null se la richiesta passa.
 */
export async function screenCiRequest(request: Request, method: "GET" | "POST"): Promise<Response | null> {
  const finding = findTokenInUrl(request.url, { tokenPrefixes: TOKEN_PREFIXES });
  if (finding.found) {
    for (const candidate of finding.candidates) {
      if (!candidate.startsWith(CLI_TOKEN_PREFIX)) continue;
      try {
        await markIntegrationTokenExposed(hashSecret(candidate));
      } catch (error) {
        logSafeError("ci", "segna esposto", error);
      }
    }
    await revokeCiKeysInUrl(finding.candidates);
    return ciError("chiave_nell_indirizzo");
  }
  if (request.method.toUpperCase() !== method) return ciError("metodo", { Allow: method });
  if (request.headers.get("origin")) return ciError("origine");
  if (method === "POST") {
    if (!isJsonContentType(request.headers.get("content-type"))) return ciError("json");
    if (declaredBodyTooLarge(request.headers, CI_ROUTE_LIMITS.bodyBytes)) return ciError("troppo_grande");
  }
  return null;
}

/**
 * Un metodo che la rotta non ha: le stesse difese (una chiave nell'indirizzo si revoca anche qui), poi 405 con `Allow`.
 */
export async function ciMethodNotAllowed(request: Request, allowed: "GET" | "POST"): Promise<Response> {
  return (await screenCiRequest(request, allowed)) ?? ciError("metodo", { Allow: allowed });
}

/** L'area per il workspace della chiave: accesa, spenta (o il workspace escluso), o le tabelle dei dossier che non rispondono. */
async function ciArea(workspaceId: string): Promise<"accesa" | "spenta" | "non_disponibile"> {
  if (!isUseCaseHubWorkspace(workspaceId)) return "spenta";
  try {
    await ensureUcAvailable(workspaceId);
    return "accesa";
  } catch (error) {
    if (error instanceof UcAccessError) return error.code === "non_disponibile" ? "non_disponibile" : "spenta";
    throw error;
  }
}

export interface OpenedCi {
  principal: CiKeyPrincipal;
  executor: UcExecutor;
  /** L'area per il workspace della chiave: spenta, per la CI i casi non ci sono. */
  area: "accesa" | "spenta";
}

/**
 * Apre una richiesta della CI: le difese, lo schema, la 0042, la chiave, il limite della chiave, l'area. Il resto (il
 * caso, il corpo) lo fa la rotta.
 */
export async function openCi(request: Request, input: { method: "GET" | "POST"; write: boolean }): Promise<{ ok: true; value: OpenedCi } | { ok: false; response: Response }> {
  const screened = await screenCiRequest(request, input.method);
  if (screened) return { ok: false, response: screened };
  await ensureDbSchema();
  const executor = await getAppUcExecutor();
  if (!(await ciKeysStoreReady(executor))) return { ok: false, response: ciError("non_disponibile", RETRY) };
  const principal = await authenticateCiKey(executor, request.headers.get("authorization"));
  if (!principal) return { ok: false, response: ciError("chiave") };
  const decision = await consumeRateLimits(appRateLimitExecutor, [
    {
      bucket: rateLimitBucket("ci", input.write ? "w" : "r", principal.keyId),
      window: "hour",
      limit: input.write ? CI_ROUTE_LIMITS.writesPerHour : CI_ROUTE_LIMITS.readsPerHour,
    },
  ]);
  if (!decision.ok) return { ok: false, response: ciError("troppe_richieste", { "Retry-After": String(decision.retryAfterSeconds) }) };
  const area = await ciArea(principal.workspaceId);
  if (area === "non_disponibile") return { ok: false, response: ciError("non_disponibile", RETRY) };
  return { ok: true, value: { principal, executor, area } };
}

/**
 * Una scrittura della CI con la chiave di idempotenza dell'intestazione (`Idempotency-Key: gh-<esecuzione>-<caso>`), nel
 * registro della CLI con `ci:<id della chiave>`. La stessa richiesta ripetuta risponde come la prima, con
 * `ripetuta: true`; la stessa chiave con un altro corpo è 409 `idempotenza`; ancora in corso, 409 `in_corso`.
 */
export async function runCiWrite<T extends Record<string, unknown>>(
  request: Request,
  opened: OpenedCi,
  tool: string,
  body: unknown,
  execute: (reservedId: string | null) => Promise<Result<T>>,
): Promise<Response> {
  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!CLI_IDEMPOTENCY_KEY.test(idempotencyKey)) return cliError(400, "idempotenza", CI_IDEMPOTENCY_MISSING_MESSAGE);
  const writer = { workspaceId: opened.principal.workspaceId, principalKey: ciIdempotencyOwner(opened.principal.keyId), logScope: "ci" };
  const outcome = await executeIdempotentWrite(writer, idempotencyKey, tool, body, execute, { reserveId: true });
  if (!outcome.ok) return cliFailureResponse(outcome);
  return cliJson(outcome.repeated ? { ...outcome.value, ripetuta: true } : outcome.value);
}
