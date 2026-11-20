import { after } from "next/server";
import { dispatchDue } from "@/lib/db/queries/uc-notifications-dispatch";
import { ucLsDomains } from "@/lib/db/queries/uc-access";
import { evalsStoreReady, loadEvalOverview, recordEvalRun } from "@/lib/db/queries/use-case-evals";
import { ucLogError } from "@/lib/uc/log";
import { ok } from "@/lib/uc/types";
import { requireCliWrite, resolveCliCase, runCliWrite, type CliCase } from "@/lib/use-cases/cli/case";
import { cliError, cliJson, openCli, readCliBody } from "@/lib/use-cases/cli/route-kit";
import { ciLinkVisible } from "@/lib/use-cases/ci/api";
import { evalOverviewForCli, parseEvalRun, recommendationOf } from "@/lib/use-cases/factory/benchmark-input";
import { canWriteFactory } from "@/lib/use-cases/factory/permissions";

/**
 * Il banco di prova e le evals di un caso (rilascio 8.2a, docs/rilascio-8/BANCO-DI-PROVA.md §2).
 * - `POST {caso, tipo: "banco"|"evals", …}`: `unbundle banco <ID> --invia` e `unbundle eval <ID> --invia`. Scrive chi
 *   costruisce il caso (`requireCliWrite`), con la chiave di idempotenza (`runCliWrite`, strumento «evals»): la stessa
 *   richiesta ripetuta risponde come la prima, la stessa chiave con un corpo diverso è un conflitto. Risponde
 *   `{ id, raccomandazione: {tipo, modello?, testo} | null, avviso: "sotto_soglia" | "in_calo" | null, link }`: la
 *   raccomandazione del banco (mai con i modelli finti), l'avviso delle evals, la sezione del progetto. Se è partito un
 *   avviso al team, le e-mail partono subito dopo la risposta. Il banco dice sempre il modello di oggi del suo ruolo
 *   (`modelli[ruolo]`); il banco di un ruolo nuovo quando il caso ne ha già 20 è un conflitto (409).
 * - `GET ?caso=<ID>`: l'ultimo banco di ogni ruolo, le evals che fanno lo stato del caso e il loro andamento, per la
 *   CLI. Lo legge chi è nel team del caso. (8.2b) Ogni esecuzione dice la sua fonte (`fonte`: `cli` o `ci`) e, se è
 *   arrivata dalla CI, il link all'esecuzione su GitHub (`ci`) a chi costruisce il caso o è di Lateral Space; al cliente
 *   `ci` è null (là si vede chi ha unito).
 *
 * Mai una persona nelle risposte: né chi ha lanciato il banco, né chi ha mandato le evals.
 */
export const runtime = "nodejs";

const NOT_READY = () => cliError(503, "non_disponibile", "Il banco e le evals non sono ancora disponibili: riprova tra qualche minuto.");

export async function GET(request: Request): Promise<Response> {
  const opened = await openCli(request, { method: "GET", write: false });
  if (!opened.ok) return opened.response;
  const resolved = await resolveCliCase(opened.value, new URL(request.url).searchParams.get("caso"));
  if (!resolved.ok) return resolved.response;
  const c = resolved.value;
  const overview = await loadEvalOverview(opened.value.executor, c.target);
  if (!overview) return NOT_READY();
  const ciLinks = ciLinkVisible({ isLateralSpace: c.access.user.isLateralSpace, builds: canWriteFactory(c.factory.roles) });
  return cliJson(evalOverviewForCli(c.useCase.code, overview, { ciLinks }));
}

/** Dopo un avviso al team: il giro delle e-mail del caso subito dopo la risposta. */
function dispatchAfter(c: CliCase): void {
  after(async () => {
    try {
      await dispatchDue({ caseId: c.dossierId });
    } catch (error) {
      ucLogError({ area: "cli", op: "email_evals", workspaceId: c.target.workspaceId }, error);
    }
  });
}

export async function POST(request: Request): Promise<Response> {
  const opened = await openCli(request, { method: "POST", write: true });
  if (!opened.ok) return opened.response;
  const read = await readCliBody(request);
  if (!read.ok) return read.response;
  const resolved = await resolveCliCase(opened.value, read.body.caso);
  if (!resolved.ok) return resolved.response;
  const c = resolved.value;
  const denied = requireCliWrite(c);
  if (denied) return denied;
  if (!(await evalsStoreReady(opened.value.executor))) return NOT_READY();
  const parsed = parseEvalRun(read.body);
  if (!parsed.ok) return cliError(400, "dati_non_validi", parsed.message);
  const input = parsed.value;
  const link = `${new URL(request.url).origin}/dashboard/${c.target.workspaceId}/use-cases/${c.target.useCaseId}/progetto#banco`;
  // L'impronta della richiesta è quella del corpo controllato: lo stesso banco riscritto in un altro ordine di chiavi è lo
  // stesso; un numero diverso è un'altra richiesta.
  return runCliWrite(
    request,
    opened.value,
    "evals",
    { caso: c.useCase.code, ...input },
    async (id) => {
      const r = await recordEvalRun(opened.value.executor, c.target, input, { id, actorUserId: c.actor.kind === "persona" ? c.actor.userId : null, lsDomains: ucLsDomains() });
      if (!r.ok) return r;
      if (r.value.notified) dispatchAfter(c);
      return ok({ id: r.value.id, raccomandazione: recommendationOf(r.value.analysis), avviso: r.value.alert?.kind ?? null, link });
    },
    { reserveId: true },
  );
}
