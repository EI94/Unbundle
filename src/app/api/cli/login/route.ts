import { rateLimitBucket } from "@/lib/connector/rate-limit";
import { ensureDbSchema } from "@/lib/db/ensure-schema";
import { cliStoreReady, startCliLogin } from "@/lib/db/queries/use-case-cli-auth";
import { getAppUcExecutor } from "@/lib/db/uc-executor";
import { CLI_ROUTE_LIMITS, cliError, cliJson, clientKey, consumeCliLimits, readCliBody, screenCliRequest } from "@/lib/use-cases/cli/route-kit";

/**
 * `unbundle login`, passo 1 (rilascio 8.0b, RILASCIO-8.0b-COSTRUZIONE.md §3): la CLI chiede un codice, senza
 * token. Risponde con il codice della CLI (da tenere, per ritirare il token), il codice da leggere e l'indirizzo
 * della pagina di conferma. Al massimo 20 codici l'ora per indirizzo.
 */
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const screened = await screenCliRequest(request, "POST");
  if (screened) return screened;
  const limited = await consumeCliLimits([{ bucket: rateLimitBucket("cli", "login", clientKey(request)), window: "hour", limit: CLI_ROUTE_LIMITS.loginStartsPerHour }]);
  if (limited) return limited;
  const read = await readCliBody(request);
  if (!read.ok) return read.response;
  await ensureDbSchema();
  const executor = await getAppUcExecutor();
  if (!(await cliStoreReady(executor))) return cliError(503, "non_disponibile", "La CLI non è ancora disponibile: riprova tra qualche minuto.");
  const started = await startCliLogin(executor, { clientLabel: read.body.etichetta });
  const origin = new URL(request.url).origin;
  return cliJson({
    codiceDispositivo: started.deviceCode,
    codice: started.userCode,
    url: `${origin}/cli/collega?codice=${encodeURIComponent(started.userCode)}`,
    scadeTraSecondi: started.expiresInSeconds,
    intervalloSecondi: started.intervalSeconds,
  });
}
