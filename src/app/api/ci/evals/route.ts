import { after } from "next/server";
import { ucLsDomains } from "@/lib/db/queries/uc-access";
import { dispatchDue } from "@/lib/db/queries/uc-notifications-dispatch";
import { findCiKeyCase } from "@/lib/db/queries/use-case-ci-keys";
import { evalsStoreReady, recordEvalRun } from "@/lib/db/queries/use-case-evals";
import { logSafeError } from "@/lib/log/safe-error";
import { ok } from "@/lib/uc/types";
import { ciCaseFailureCode, ciEvalsWriteBody, parseCiEvals } from "@/lib/use-cases/ci/api";
import { ciError, ciMethodNotAllowed, openCi, runCiWrite } from "@/lib/use-cases/ci/route-kit";
import { cliError, cliPublicOrigin, readCliBody } from "@/lib/use-cases/cli/route-kit";
import { recommendationOf } from "@/lib/use-cases/factory/benchmark-input";

/**
 * `POST /api/ci/evals` (rilascio 8.2b, docs/rilascio-8/RILASCIO-8.2b-SPEC.md §2.3 e §2.9): le evals (e il banco) di main
 * che la CI manda per un caso del repository della chiave, con `Authorization: Bearer ub_ci_…` e
 * `Idempotency-Key: gh-<esecuzione>-<caso>` (per il banco `gh-<esecuzione>-<caso>-<ruolo>`).
 *
 * - Il corpo è quello di `POST /api/cli/evals` (`tipo` `evals` o `banco`), più `ci: { esecuzione, tentativo, url }`.
 * - Il caso: registrato sul repository della chiave e nel suo workspace (404 `non_trovato`), con la realizzazione,
 *   aperto (409 `senza_dossier`, `caso_chiuso`, `caso_sospeso`), nell'area accesa.
 * - Solo main (403 `solo_main`), con il commit intero e l'esecuzione di GitHub di quel repository (400 `dati_non_validi`).
 * - L'esecuzione si scrive con la fonte `ci`, la chiave e il link a GitHub, senza persona: le regole della 8.2a (lo stato
 *   del caso, gli avvisi `evals_in_calo` e `banco_consiglio` a tutto il team che costruisce), e la versione del modello
 *   del repository diventa quella di main. Dopo un avviso le e-mail partono subito dopo la risposta.
 * - La risposta è quella della CLI: `{ id, raccomandazione, avviso, link }`, con `ripetuta: true` per un invio già
 *   arrivato (lo stesso corpo con la stessa chiave di idempotenza, anche da un job rilanciato).
 */
export const runtime = "nodejs";

/** Dopo un avviso al team: il giro delle e-mail del caso subito dopo la risposta (se non parte, lo riprende il cron). */
function dispatchAfter(dossierId: string): void {
  after(async () => {
    try {
      await dispatchDue({ caseId: dossierId });
    } catch (error) {
      logSafeError("ci", "email evals", error);
    }
  });
}

export async function POST(request: Request): Promise<Response> {
  const opened = await openCi(request, { method: "POST", write: true });
  if (!opened.ok) return opened.response;
  const { principal, executor, area } = opened.value;
  const read = await readCliBody(request);
  if (!read.ok) return read.response;
  if (area !== "accesa") return ciError("non_trovato");
  const found = await findCiKeyCase(executor, principal, read.body.caso);
  if (!found.ok) return ciError(ciCaseFailureCode(found.code));
  const c = found.value;
  if (!(await evalsStoreReady(executor))) return ciError("non_disponibile", { "Retry-After": "60" });
  const parsed = parseCiEvals(read.body, principal.repo);
  if (!parsed.ok) return cliError(parsed.status, parsed.code, parsed.message);
  const { input, run } = parsed.value;
  const target = { workspaceId: principal.workspaceId, useCaseId: c.useCaseId };
  const link = `${cliPublicOrigin(request)}/dashboard/${target.workspaceId}/use-cases/${target.useCaseId}/progetto#banco`;
  return runCiWrite(request, opened.value, "evals", ciEvalsWriteBody(c.code, parsed.value), async (id) => {
    const r = await recordEvalRun(executor, target, input, {
      id,
      actorUserId: null,
      lsDomains: ucLsDomains(),
      source: { kind: "ci", keyId: principal.keyId, runUrl: run.url, repo: principal.repo },
    });
    if (!r.ok) return r;
    if (r.value.notified && c.dossierId) dispatchAfter(c.dossierId);
    return ok({ id: r.value.id, raccomandazione: recommendationOf(r.value.analysis), avviso: r.value.alert?.kind ?? null, link });
  });
}

/** Solo scrittura: 405, dopo le difese (una chiave nell'indirizzo si revoca anche qui). */
export async function GET(request: Request): Promise<Response> {
  return ciMethodNotAllowed(request, "POST");
}
