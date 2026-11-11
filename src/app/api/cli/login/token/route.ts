import { rateLimitBucket } from "@/lib/connector/rate-limit";
import { ensureDbSchema } from "@/lib/db/ensure-schema";
import { cliStoreReady, deliverCliLogin } from "@/lib/db/queries/use-case-cli-auth";
import { getAppUcExecutor } from "@/lib/db/uc-executor";
import { hashSecret, isDeviceCode } from "@/lib/use-cases/cli/codes";
import { CLI_ROUTE_LIMITS, cliError, cliJson, consumeCliLimits, readCliBody, screenCliRequest } from "@/lib/use-cases/cli/route-kit";

/**
 * `unbundle login`, passo 3 (rilascio 8.0b, RILASCIO-8.0b-COSTRUZIONE.md §3): la CLI ritira il token con il suo
 * codice, ogni 5 secondi. Il token si consegna una volta sola, dopo la conferma nel browser; prima risponde
 * «in_attesa», poi «negato», «scaduto» o «gia_consegnato». Al massimo 30 richieste al minuto per codice.
 */
export const runtime = "nodejs";

const MESSAGES: Record<string, string> = {
  in_attesa: "Aspetto la conferma nel browser.",
  negato: "Hai detto «Non l'ho chiesto io»: nessun collegamento.",
  scaduto: "Il codice è scaduto: rifai «unbundle login».",
  gia_consegnato: "Questo login è già stato usato: rifai «unbundle login».",
  sconosciuto: "Codice sconosciuto: rifai «unbundle login».",
};

export async function POST(request: Request): Promise<Response> {
  const screened = await screenCliRequest(request, "POST");
  if (screened) return screened;
  const read = await readCliBody(request);
  if (!read.ok) return read.response;
  const deviceCode = read.body.codiceDispositivo;
  if (!isDeviceCode(deviceCode)) return cliJson({ stato: "sconosciuto", messaggio: MESSAGES.sconosciuto });
  const limited = await consumeCliLimits([{ bucket: rateLimitBucket("cli", "poll", hashSecret(deviceCode).slice(0, 32)), window: "minute", limit: CLI_ROUTE_LIMITS.pollsPerMinute }]);
  if (limited) return limited;
  await ensureDbSchema();
  const executor = await getAppUcExecutor();
  if (!(await cliStoreReady(executor))) return cliError(503, "non_disponibile", "La CLI non è ancora disponibile: riprova tra qualche minuto.");
  const delivery = await deliverCliLogin(executor, deviceCode);
  if (delivery.status === "consegnato") {
    return cliJson({ stato: "consegnato", token: delivery.token, workspaceId: delivery.workspaceId, scade: delivery.expiresAt });
  }
  return cliJson({ stato: delivery.status, messaggio: MESSAGES[delivery.status] });
}
