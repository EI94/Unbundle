import { registerCaseRepo } from "@/lib/db/queries/use-case-factory";
import { parseCaseRepo } from "@/lib/use-cases/cli/inputs";
import { requireCliWrite, resolveCliCase, runCliWrite } from "@/lib/use-cases/cli/case";
import { cliError, openCli, readCliBody } from "@/lib/use-cases/cli/route-kit";

/**
 * `unbundle repo create <ID>` (rilascio 8.0b): registra il repository e la cartella del caso. Il repository lo crea
 * la CLI con il `gh` della persona: in Unbundle nessuna chiave di GitHub.
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
  const parsed = parseCaseRepo(body.body);
  if (!parsed.ok) return cliError(400, "dati_non_validi", parsed.message);
  return runCliWrite(request, opened.value, "repository", body.body, async () => {
    const r = await registerCaseRepo(opened.value.executor, c.actor, c.target, parsed.value);
    return r.ok ? { ok: true, value: { id: r.value.id, nuovo: r.value.created } } : r;
  });
}
