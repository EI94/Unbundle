import { readFactory } from "@/lib/db/queries/use-case-factory";
import { canWriteFactory } from "@/lib/use-cases/factory/permissions";
import { resolveCliCase } from "@/lib/use-cases/cli/case";
import { cliError, cliJson, openCli } from "@/lib/use-cases/cli/route-kit";

/**
 * `unbundle start <ID>` (rilascio 8.0b): i tre file dell'ultima versione del pacchetto, per `casi/<id>/unbundle/`.
 * Solo al team di Lateral Space del caso, come nella pagina «Progetto dell'agente». Il pacchetto non ha nomi.
 */
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const opened = await openCli(request, { method: "GET", write: false });
  if (!opened.ok) return opened.response;
  const resolved = await resolveCliCase(opened.value, new URL(request.url).searchParams.get("caso"));
  if (!resolved.ok) return resolved.response;
  const c = resolved.value;
  if (!canWriteFactory(c.access.roles)) return cliError(403, "permesso_negato", "Il pacchetto lo legge il team di Lateral Space del caso.");
  const read = await readFactory(opened.value.executor, c.target, c.actor);
  if (!read.ok) return cliError(404, "non_trovato", read.message);
  const latest = read.value.latestPackage;
  if (!latest) return cliError(404, "senza_pacchetto", "Nessun pacchetto ancora: si genera dalla pagina «Progetto dell'agente».");
  return cliJson({ caso: c.useCase.code, versione: latest.version, creatoIl: latest.createdAt, fonte: latest.source, file: latest.files });
}
