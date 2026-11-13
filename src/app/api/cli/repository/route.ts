import { registerCaseRepo } from "@/lib/db/queries/use-case-factory";
import { reportRepoVersion } from "@/lib/db/queries/use-case-factory-line";
import { parseCaseRepo } from "@/lib/use-cases/cli/inputs";
import { requireCliWrite, resolveCliCase, runCliWrite } from "@/lib/use-cases/cli/case";
import { cliError, cliJson, openCli, readCliBody } from "@/lib/use-cases/cli/route-kit";

/**
 * `unbundle repo create <ID>` (rilascio 8.0b): registra il repository e la cartella del caso. Il repository lo crea
 * la CLI con il `gh` della persona: in Unbundle nessuna chiave di GitHub.
 *
 * (8.1a) Con `azione: "versione"` la CLI (`unbundle start`) dice la versione del modello che il repository ha
 * (`.agent-factory/modello.json`): la pagina «Agent Factory» mette nella coda della fabbrica quelli indietro. Si
 * riscrive uguale: niente chiave di idempotenza.
 */
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const opened = await openCli(request, { method: "POST", write: true });
  if (!opened.ok) return opened.response;
  const body = await readCliBody(request);
  if (!body.ok) return body.response;
  if (opened.value.principal.caseUseCaseId !== null) {
    return cliError(403, "token_caso", "Il repository si registra con «unbundle repo create», dal login della persona, non con il token di un caso solo.");
  }
  const resolved = await resolveCliCase(opened.value, body.body.caso);
  if (!resolved.ok) return resolved.response;
  const c = resolved.value;
  const denied = requireCliWrite(c);
  if (denied) return denied;
  if (body.body.azione === "versione") {
    const repo = typeof body.body.repository === "string" ? body.body.repository : "";
    const r = await reportRepoVersion(opened.value.executor, { workspaceId: c.target.workspaceId, useCaseId: c.target.useCaseId, repo, templateVersion: body.body.versioneModello, commonVersion: body.body.versioneComune });
    return r.ok ? cliJson({ repository: r.value.repo, versioneModello: body.body.versioneModello }) : cliError(r.code === "non_trovato" ? 404 : r.code === "non_disponibile" ? 503 : 400, r.code, r.message);
  }
  const parsed = parseCaseRepo(body.body);
  if (!parsed.ok) return cliError(400, "dati_non_validi", parsed.message);
  return runCliWrite(request, opened.value, "repository", body.body, async () => {
    const r = await registerCaseRepo(opened.value.executor, c.actor, c.target, parsed.value);
    return r.ok ? { ok: true, value: { id: r.value.id, nuovo: r.value.created } } : r;
  });
}
