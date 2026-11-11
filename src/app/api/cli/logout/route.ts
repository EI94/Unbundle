import { ensureDbSchema } from "@/lib/db/ensure-schema";
import { authenticateCli, cliStoreReady, revokeCliTokenById } from "@/lib/db/queries/use-case-cli-auth";
import { getAppUcExecutor } from "@/lib/db/uc-executor";
import { cliError, cliJson, screenCliRequest } from "@/lib/use-cases/cli/route-kit";

/**
 * `unbundle logout` (rilascio 8.0b): revoca il token con cui si chiama. La CLI poi lo toglie dal portachiavi. Basta un
 * token valido: anche chi non ha più accesso al workspace, o ha finito le richieste dell'ora, può revocare il suo.
 */
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const screened = await screenCliRequest(request, "POST");
  if (screened) return screened;
  await ensureDbSchema();
  const executor = await getAppUcExecutor();
  if (!(await cliStoreReady(executor))) return cliError(503, "non_disponibile", "La CLI non è ancora disponibile: riprova tra qualche minuto.");
  const principal = await authenticateCli(executor, request.headers.get("authorization"));
  if (!principal) return cliError(401, "token", "Token mancante, scaduto o revocato: fai «unbundle login».");
  const revoked = await revokeCliTokenById(executor, principal);
  return cliJson({ revocato: revoked });
}
