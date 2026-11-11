import { createCaseCliToken } from "@/lib/db/queries/use-case-cli-auth";
import { resolveCliCase } from "@/lib/use-cases/cli/case";
import { cliError, cliJson, openCli, readCliBody } from "@/lib/use-cases/cli/route-kit";
import { canWriteFactory } from "@/lib/use-cases/factory/permissions";

/**
 * `unbundle mcp <ID>` (rilascio 8.0b): un token di un caso solo, per la configurazione MCP di un coding agent. Se
 * trapela, apre solo quel caso. Lo crea solo un token di tutti i casi della persona, per un caso dove la persona
 * scrive; si vede una volta sola.
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
  if (!canWriteFactory(c.access.roles)) return cliError(403, "permesso_negato", "Il token dell'MCP del caso è per il team di Lateral Space del caso.");
  const created = await createCaseCliToken(opened.value.executor, opened.value.principal, { useCaseId: c.useCase.id, label: `MCP di ${c.useCase.code}` });
  if (!created.ok) return cliError(403, created.code, created.message);
  return cliJson({ caso: c.useCase.code, token: created.value.token, scade: created.value.expiresAt });
}
