import { SETUP_TOPICS, SETUP_TOPIC_LABELS, FACTORY_FRAMEWORKS } from "@/lib/db/use-case-hub-factory-ddl";
import { familyChoices, namesToHide, readFactory, saveProjectDetails, saveProjectTopic, startProject, submitProject } from "@/lib/db/queries/use-case-factory";
import { givenNames, nameTokens, redact } from "@/lib/use-cases/factory/package";
import { SETUP_GUIDE } from "@/lib/use-cases/cli/brief";
import { requireCliWrite, resolveCliCase, runCliWrite } from "@/lib/use-cases/cli/case";
import { cliError, cliJson, openCli, readCliBody } from "@/lib/use-cases/cli/route-kit";

/**
 * `unbundle setup <ID>` (rilascio 8.0b, standard §3): l'impostazione guidata. La guida sta in Unbundle, la skill
 * «imposta» la conduce.
 *
 * - GET: la guida dei 10 argomenti con le scelte di adesso, il catalogo dei framework, le scelte approvate degli
 *   altri casi della famiglia, la revisione del progetto aperto.
 * - POST `azione`: `apri` (una versione nuova, con le scelte dell'ultima), `scelta` (un argomento: diventa anche
 *   una decisione), `dettagli` (framework, strumenti nuovi, stima), `invia` (in approvazione, con la revisione
 *   vista). Le stesse regole della pagina «Progetto dell'agente».
 */
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const opened = await openCli(request, { method: "GET", write: false });
  if (!opened.ok) return opened.response;
  const resolved = await resolveCliCase(opened.value, new URL(request.url).searchParams.get("caso"));
  if (!resolved.ok) return resolved.response;
  const c = resolved.value;
  const { executor } = opened.value;
  const read = await readFactory(executor, c.target, c.actor);
  if (!read.ok) return cliError(404, "non_trovato", read.message);
  const [family, names] = await Promise.all([familyChoices(executor, c.target), namesToHide(executor, c.target)]);
  const tokens = nameTokens(names);
  const given = givenNames(names);
  const hide = (text: string) => redact(text, tokens, given);
  const project = read.value.open ?? read.value.approved;
  return cliJson({
    caso: c.useCase.code,
    progetto: project
      ? { versione: project.version, stato: project.status, revisione: project.revision, framework: project.framework, strumentiNuovi: project.newTools, ore: project.estimateHours, euroAlMese: project.monthlyCostEur }
      : null,
    argomenti: SETUP_TOPICS.map((t) => ({
      chiave: t,
      nome: SETUP_TOPIC_LABELS[t],
      guida: SETUP_GUIDE[t],
      scelta: project?.topics[t] ? { scelta: hide(project.topics[t]!.scelta), perche: project.topics[t]!.perche ? hide(project.topics[t]!.perche!) : null, alternativa: project.topics[t]!.alternativa } : null,
    })),
    framework: FACTORY_FRAMEWORKS,
    famiglia: family.map((f) => ({ caso: f.code, scelte: Object.fromEntries(SETUP_TOPICS.filter((t) => f.topics[t]).map((t) => [t, hide(f.topics[t]!.scelta)])) })),
    pacchetto: read.value.latestPackage ? { versione: read.value.latestPackage.version } : null,
  });
}

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
  const { executor } = opened.value;
  const b = body.body;
  const action = b.azione;
  if (action === "apri") {
    return runCliWrite(request, opened.value, "setup.apri", b, async () => {
      const r = await startProject(executor, c.actor, c.target);
      return r.ok ? { ok: true, value: { versione: r.value.version, creata: r.value.created } } : r;
    });
  }
  if (action === "scelta") {
    return runCliWrite(request, opened.value, "setup.scelta", b, async () => {
      const r = await saveProjectTopic(executor, c.actor, c.target, { topic: b.argomento, scelta: b.scelta, perche: b.perche, alternativa: b.alternativa });
      return r.ok ? { ok: true, value: { versione: r.value.version } } : r;
    });
  }
  if (action === "dettagli") {
    return runCliWrite(request, opened.value, "setup.dettagli", b, async () => {
      const r = await saveProjectDetails(executor, c.actor, c.target, { framework: b.framework, newTools: b.strumentiNuovi, estimateHours: b.ore, monthlyCostEur: b.euroAlMese });
      return r.ok ? { ok: true, value: { versione: r.value.version } } : r;
    });
  }
  if (action === "invia") {
    return runCliWrite(request, opened.value, "setup.invia", b, async () => {
      const r = await submitProject(executor, c.actor, c.target, { revision: b.revisione });
      return r.ok ? { ok: true, value: { versione: r.value.version, strumentiNuovi: r.value.newTools } } : r;
    });
  }
  return cliError(400, "azione", "azione: una tra apri, scelta, dettagli, invia.");
}
