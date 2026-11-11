import { recordBuildSession } from "@/lib/db/queries/use-case-factory";
import { parseBuildSession } from "@/lib/use-cases/cli/inputs";
import { requireCliWrite, resolveCliCase } from "@/lib/use-cases/cli/case";
import { cliError, cliJson, openCli, readCliBody } from "@/lib/use-cases/cli/route-kit";

/**
 * `unbundle session end` (rilascio 8.0b, ISPIRAZIONE-WARP §4.1): la sintesi di una sessione di un coding agent.
 * Solo numeri e riferimenti, mai il testo della conversazione né la persona. È idempotente da sé: la chiave della
 * sessione (l'impronta del suo id) scrive una volta sola, quindi niente Idempotency-Key.
 */
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const opened = await openCli(request, { method: "POST", write: true });
  if (!opened.ok) return opened.response;
  const body = await readCliBody(request);
  if (!body.ok) return body.response;
  const resolved = await resolveCliCase(opened.value, body.body.caso);
  if (!resolved.ok) return resolved.response;
  const c = resolved.value;
  const denied = requireCliWrite(c);
  if (denied) return denied;
  const parsed = parseBuildSession(body.body);
  if (!parsed.ok) return cliError(400, "dati_non_validi", parsed.message);
  const recorded = await recordBuildSession(opened.value.executor, c.target, parsed.value);
  if (!recorded.ok) return cliError(404, recorded.code, recorded.message);
  return cliJson({ registrata: recorded.value.created, ripetuta: !recorded.value.created });
}
