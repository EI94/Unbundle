import { resolveCliCase } from "@/lib/use-cases/cli/case";
import { CLI_CASE_NOT_FOUND, CLI_CONTEXT_UNAVAILABLE } from "@/lib/use-cases/cli/case-errors";
import { CONTEXT_LAYERS, loadCliContext, type ContextLayer } from "@/lib/use-cases/cli/context";
import { cliError, cliJson, openCli } from "@/lib/use-cases/cli/route-kit";

/**
 * `unbundle context <ID> [--progetto|--decisioni|--pacchetto|--domande|--contesto] [--dal …]` (rilascio 8.0b, standard
 * §7): il brief di al massimo 300 token, o uno strato. Il testo è pronto da leggere; `dati` serve agli script (e a
 * `unbundle start`, che ci trova il repository). Mai nomi né e-mail.
 *
 * (9b) `strato=contesto`: i fatti confermati sul cliente che toccano il caso, solo «Per tutti» (D1), con `dati.contesto`;
 * con `dal`, solo i nuovi e i cambiati. L'archivio di «Contesto» che non risponde è 503, da riprovare.
 */
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const opened = await openCli(request, { method: "GET", write: false });
  if (!opened.ok) return opened.response;
  const params = new URL(request.url).searchParams;
  const resolved = await resolveCliCase(opened.value, params.get("caso"));
  if (!resolved.ok) return resolved.response;
  const layer = params.get("strato");
  if (layer !== null && !(CONTEXT_LAYERS as readonly string[]).includes(layer)) return cliError(400, "strato", `Strato sconosciuto: uno tra ${CONTEXT_LAYERS.join(", ")}.`);
  const sinceRaw = params.get("dal");
  const since = sinceRaw ? new Date(sinceRaw) : null;
  if (since && Number.isNaN(since.getTime())) return cliError(400, "dal", "«dal» vuole una data, per esempio 2026-11-10.");
  const context = await loadCliContext(opened.value.executor, resolved.value, { layer: layer as ContextLayer | null, since });
  if (!context.ok) {
    if (context.code === "non_disponibile") return cliError(CLI_CONTEXT_UNAVAILABLE.status, CLI_CONTEXT_UNAVAILABLE.code, CLI_CONTEXT_UNAVAILABLE.message, CLI_CONTEXT_UNAVAILABLE.headers);
    return cliError(404, "non_trovato", CLI_CASE_NOT_FOUND);
  }
  return cliJson(context.value);
}
