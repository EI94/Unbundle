import { cliCaseExtras, namesToHide, readFactory } from "@/lib/db/queries/use-case-factory";
import { composeBrief, composeDecisionsLayer, composePackageLayer, composeProjectLayer, composeQuestionsLayer, nextStep } from "@/lib/use-cases/cli/brief";
import { resolveCliCase } from "@/lib/use-cases/cli/case";
import { cliError, cliJson, openCli } from "@/lib/use-cases/cli/route-kit";

/**
 * `unbundle context <ID> [--progetto|--decisioni|--pacchetto|--domande] [--dal …]` (rilascio 8.0b, standard §7):
 * il brief di al massimo 300 token, o uno strato. Il testo è pronto da leggere; `dati` serve agli script (e a
 * `unbundle start`, che ci trova il repository). Mai nomi né e-mail.
 */
export const runtime = "nodejs";

const LAYERS = ["progetto", "decisioni", "pacchetto", "domande"] as const;

export async function GET(request: Request): Promise<Response> {
  const opened = await openCli(request, { method: "GET", write: false });
  if (!opened.ok) return opened.response;
  const params = new URL(request.url).searchParams;
  const resolved = await resolveCliCase(opened.value, params.get("caso"));
  if (!resolved.ok) return resolved.response;
  const c = resolved.value;
  const layer = params.get("strato");
  if (layer !== null && !(LAYERS as readonly string[]).includes(layer)) return cliError(400, "strato", `Strato sconosciuto: uno tra ${LAYERS.join(", ")}.`);
  const sinceRaw = params.get("dal");
  const since = sinceRaw ? new Date(sinceRaw) : null;
  if (since && Number.isNaN(since.getTime())) return cliError(400, "dal", "«dal» vuole una data, per esempio 2026-11-10.");
  const { executor } = opened.value;
  const read = await readFactory(executor, c.target, c.actor);
  if (!read.ok) return cliError(404, "non_trovato", read.message);
  const [extras, names] = await Promise.all([cliCaseExtras(executor, c.target, { canSeeNeeds: c.canSeeNeeds }), namesToHide(executor, c.target)]);
  const view = read.value;
  const base = {
    code: c.useCase.code,
    title: c.useCase.title,
    dossierStatus: c.access.status,
    open: view.open,
    approved: view.approved,
    latestPackage: view.latestPackage ? { version: view.latestPackage.version, createdAt: view.latestPackage.createdAt, source: view.latestPackage.source } : null,
    decisions: view.decisions,
    openNeeds: extras.openNeeds === null ? null : extras.openNeeds.length,
    proposedQuestions: extras.proposals.length,
    repos: extras.repos,
    namesToHide: names,
    since: since ? since.toISOString() : null,
  };
  const testo =
    layer === "progetto"
      ? composeProjectLayer(base)
      : layer === "decisioni"
        ? composeDecisionsLayer(base)
        : layer === "pacchetto"
          ? composePackageLayer({ code: c.useCase.code, packages: view.packages })
          : layer === "domande"
            ? composeQuestionsLayer({ code: c.useCase.code, openNeeds: extras.openNeeds, proposals: extras.proposals, namesToHide: names })
            : composeBrief(base);
  const project = view.open ?? view.approved;
  return cliJson({
    testo,
    dati: {
      caso: c.useCase.code,
      dossier: c.access.status,
      progetto: project ? { versione: project.version, stato: project.status, revisione: project.revision } : null,
      pacchetto: view.latestPackage ? { versione: view.latestPackage.version } : null,
      prossimoPasso: nextStep(base),
      repository: extras.repos,
      ruoli: c.access.roles,
    },
  });
}
