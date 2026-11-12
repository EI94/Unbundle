import { importTasks, listTasks, tasksStoreReady, type TaskImportResult } from "@/lib/db/queries/use-case-tasks";
import { requireCliWrite, resolveCliCase, runCliWrite } from "@/lib/use-cases/cli/case";
import { cliError, cliJson, openCli, readCliBody } from "@/lib/use-cases/cli/route-kit";
import { parseTasksMarkdown, taskRefFromBranch } from "@/lib/use-cases/factory/tasks";

/**
 * I compiti di un caso (rilascio 8.1a, RILASCIO-8.1-COSTRUZIONE.md §2).
 * - `GET ?caso=<ID>`: `unbundle compiti <ID>`, con stato, persona e aree. Lo legge chi è nel team del caso.
 * - `POST {caso, azione: "importa", testo, cartella, ramiUniti?, aSecco?}`: `unbundle compiti importa <ID>`.
 *   - Porta in Unbundle i compiti di `compiti.md`, che si legge qui (`parseTasksMarkdown`), e «fatto» dai rami
 *     delle PR unite.
 *   - A secco dice solo cosa farebbe; altrimenti passa dal registro dell'idempotenza.
 *   - La fa chi scrive nel caso.
 */
export const runtime = "nodejs";

const NOT_READY = () => cliError(503, "non_disponibile", "I compiti non sono ancora disponibili: riprova tra qualche minuto.");

export async function GET(request: Request): Promise<Response> {
  const opened = await openCli(request, { method: "GET", write: false });
  if (!opened.ok) return opened.response;
  const resolved = await resolveCliCase(opened.value, new URL(request.url).searchParams.get("caso"));
  if (!resolved.ok) return resolved.response;
  const c = resolved.value;
  if (!(await tasksStoreReady(opened.value.executor))) return NOT_READY();
  const me = c.actor.kind === "persona" ? c.actor.userId : null;
  const tasks = await listTasks(opened.value.executor, c.target);
  return cliJson({
    caso: c.useCase.code,
    compiti: tasks.map((t) => ({
      ref: t.ref,
      titolo: t.title,
      stato: t.status,
      persona: t.holderName,
      tuo: me !== null && t.holderUserId === me,
      aree: t.areas,
      ore: t.estimateHours,
      prove: t.evidence,
      ramo: t.branch,
      pr: t.prUrl,
    })),
  });
}

const FOLDER = /^casi\/[a-z0-9][a-z0-9-]{0,40}$/;

function summary(r: TaskImportResult) {
  return {
    aSecco: r.dryRun,
    nuovi: r.ops.filter((o) => o.kind === "nuovo").map((o) => (o.kind === "nuovo" ? { ref: o.draft.ref, stato: o.status } : null)),
    aggiornati: r.ops.filter((o) => o.kind === "aggiornato").map((o) => (o.kind === "aggiornato" ? { ref: o.ref, campi: Object.keys(o.changes), fatto: o.status === "fatto" } : null)),
    uguali: r.unchanged,
    soloInUnbundle: r.onlyInUnbundle,
  };
}

export async function POST(request: Request): Promise<Response> {
  const opened = await openCli(request, { method: "POST", write: true });
  if (!opened.ok) return opened.response;
  const read = await readCliBody(request);
  if (!read.ok) return read.response;
  const b = read.body;
  const resolved = await resolveCliCase(opened.value, b.caso);
  if (!resolved.ok) return resolved.response;
  const c = resolved.value;
  const denied = requireCliWrite(c);
  if (denied) return denied;
  if (!(await tasksStoreReady(opened.value.executor))) return NOT_READY();
  if (b.azione !== "importa") return cliError(400, "azione", "Azione sconosciuta: «importa».");
  if (typeof b.testo !== "string" || b.testo.length > 60_000) return cliError(400, "testo", "Serve il testo di compiti.md.");
  if (typeof b.cartella !== "string" || !FOLDER.test(b.cartella)) return cliError(400, "cartella", "La cartella del caso è come casi/tj-0049.");
  const rami = Array.isArray(b.ramiUniti) ? b.ramiUniti.filter((r): r is string => typeof r === "string").slice(0, 500) : [];
  const doneRefs = [...new Set(rami.map((r) => taskRefFromBranch(r, c.useCase.code)).filter((r): r is string => r !== null))];
  const drafts = parseTasksMarkdown(b.testo, b.cartella);
  if (b.aSecco === true) {
    const r = await importTasks(opened.value.executor, c.target, { drafts, doneRefs, dryRun: true });
    return r.ok ? cliJson(summary(r.value)) : cliError(r.code === "dati_non_validi" || r.code.startsWith("testo_") ? 400 : 409, r.code, r.message);
  }
  return runCliWrite(request, opened.value, "compiti_importa", { caso: c.useCase.code, testo: b.testo, cartella: b.cartella, doneRefs }, async () => {
    const r = await importTasks(opened.value.executor, c.target, { drafts, doneRefs });
    return r.ok ? { ok: true, value: summary(r.value) } : r;
  });
}
