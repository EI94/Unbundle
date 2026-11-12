import { after } from "next/server";
import { dispatchDue } from "@/lib/db/queries/uc-notifications-dispatch";
import {
  addTask,
  importTasks,
  listTaskNotes,
  listTasks,
  passTask,
  releaseTask,
  requestTask,
  setTaskStatus,
  takeTask,
  tasksStoreReady,
  type TaskActor,
  type TaskImportResult,
} from "@/lib/db/queries/use-case-tasks";
import { ucLogError } from "@/lib/uc/log";
import { requireCliWrite, resolveCliCase, runCliWrite } from "@/lib/use-cases/cli/case";
import { cliError, cliJson, openCli, readCliBody } from "@/lib/use-cases/cli/route-kit";
import { normalizeArea, parseTasksMarkdown, renderTasksMarkdown, TASK_REF_RE, taskRefFromBranch } from "@/lib/use-cases/factory/tasks";

/**
 * I compiti di un caso (rilascio 8.1a, RILASCIO-8.1-COSTRUZIONE.md §2).
 * - `GET ?caso=<ID>`: `unbundle compiti <ID>`, con stato, persona e aree. Lo legge chi è nel team del caso.
 * - `GET ?caso=<ID>&compito=T-n`: in più le note di quel compito (passaggi e richieste).
 * - La risposta porta anche `specchio`: il testo di `compiti.md` che `unbundle start` scrive nel repository.
 * - `POST {caso, azione: "importa", testo, cartella, ramiUniti?, aSecco?}`: `unbundle compiti importa <ID>`.
 *   - Porta in Unbundle i compiti di `compiti.md`, che si legge qui (`parseTasksMarkdown`), e «fatto» dai rami
 *     delle PR unite.
 *   - A secco dice solo cosa farebbe; altrimenti passa dal registro dell'idempotenza.
 * - `POST {caso, azione: "prendi"|"lascia"|"passa"|"chiedi"|"nuovo"|"segna", compito, …}`: `take`, `lascia`,
 *   `passa`, `chiedi`, `compito nuovo`, `compito segna`.
 *
 * Tutte le scritture le fa chi scrive nel caso e passano dal registro dell'idempotenza. Le e-mail di «passa» e
 * «chiedi» partono subito dopo la risposta.
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
  const ref = new URL(request.url).searchParams.get("compito");
  const notes = ref && TASK_REF_RE.test(ref) ? await listTaskNotes(opened.value.executor, c.target, ref) : null;
  return cliJson({
    caso: c.useCase.code,
    ...(notes ? { note: notes.map((n) => ({ tipo: n.kind, testo: n.body, quando: n.createdAt, chiede: n.requestedBy })) } : {}),
    specchio: tasks.length ? renderTasksMarkdown(c.useCase.code, `casi/${c.useCase.code.toLowerCase()}`, tasks) : null,
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
  if (b.azione !== "importa") return taskAction(request, opened.value, c, b);
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
    const r = await importTasks(opened.value.executor, c.target, { drafts, doneRefs, actorId: c.actor.kind === "persona" ? c.actor.userId : null });
    return r.ok ? { ok: true, value: summary(r.value) } : r;
  });
}

type Opened = Extract<Awaited<ReturnType<typeof openCli>>, { ok: true }>["value"];
type Resolved = Extract<Awaited<ReturnType<typeof resolveCliCase>>, { ok: true }>["value"];
const ACTIONS = ["prendi", "lascia", "passa", "chiedi", "nuovo", "segna"] as const;

/** Dopo una scrittura che mette in coda un'e-mail: il giro del caso subito dopo la risposta. */
function dispatchAfter(c: Resolved): void {
  after(async () => {
    try {
      await dispatchDue({ caseId: c.dossierId });
    } catch (error) {
      ucLogError({ area: "cli", op: "email_compiti", workspaceId: c.target.workspaceId }, error);
    }
  });
}

async function taskAction(request: Request, opened: Opened, c: Resolved, b: Record<string, unknown>): Promise<Response> {
  const action = b.azione;
  if (!(ACTIONS as readonly unknown[]).includes(action)) return cliError(400, "azione", `Azione sconosciuta: una tra importa, ${ACTIONS.join(", ")}.`);
  if (c.actor.kind !== "persona") return cliError(403, "permesso_negato", "Serve una persona.");
  const actor: TaskActor = { userId: c.actor.userId, roles: c.actor.roles };
  const ex = opened.executor;
  const ref = typeof b.compito === "string" ? b.compito.trim().toUpperCase() : "";
  if (action !== "nuovo" && !TASK_REF_RE.test(ref)) return cliError(400, "compito", "Indica il compito, per esempio T-3.");
  const body = { ...b, caso: c.useCase.code };
  if (action === "prendi") {
    const branch = typeof b.ramo === "string" && /^[A-Za-z0-9._/-]{1,120}$/.test(b.ramo) ? b.ramo : null;
    return runCliWrite(request, opened, "compiti_prendi", body, () => takeTask(ex, c.target, actor, { ref, branch, force: b.comunque === true }));
  }
  if (action === "lascia") return runCliWrite(request, opened, "compiti_lascia", body, () => releaseTask(ex, c.target, actor, { ref, note: b.nota }));
  if (action === "passa") {
    return runCliWrite(request, opened, "compiti_passa", body, async () => {
      const r = await passTask(ex, c.target, actor, { ref, toEmail: b.a, note: b.nota });
      if (r.ok) dispatchAfter(c);
      return r;
    });
  }
  if (action === "chiedi") {
    return runCliWrite(request, opened, "compiti_chiedi", body, async () => {
      const r = await requestTask(ex, c.target, actor, { ref, note: b.nota });
      if (r.ok) dispatchAfter(c);
      return r;
    });
  }
  if (action === "segna") return runCliWrite(request, opened, "compiti_segna", body, () => setTaskStatus(ex, c.target, { ref, status: b.stato }));
  // «nuovo»
  const folder = typeof b.cartella === "string" && FOLDER.test(b.cartella) ? b.cartella : `casi/${c.useCase.code.toLowerCase()}`;
  const title = typeof b.titolo === "string" ? b.titolo.replace(/\s+/g, " ").trim() : "";
  const areas = Array.isArray(b.aree) ? b.aree.map((a) => (typeof a === "string" ? normalizeArea(a, folder) : null)).filter((a): a is string => a !== null).slice(0, 20) : [];
  const hours = typeof b.ore === "number" && b.ore >= 0 && b.ore <= 1000 ? Math.round(b.ore * 10) / 10 : null;
  const evidence = typeof b.prove === "string" && b.prove.trim() ? b.prove.trim().slice(0, 300) : null;
  return runCliWrite(request, opened, "compiti_nuovo", body, () => addTask(ex, c.target, { draft: { title, areas: [...new Set(areas)], estimateHours: hours, evidence }, source: "cli" }));
}
