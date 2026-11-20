import { listCiKeyCases } from "@/lib/db/queries/use-case-ci-keys";
import { ciCasesBody } from "@/lib/use-cases/ci/api";
import { ciMethodNotAllowed, openCi } from "@/lib/use-cases/ci/route-kit";
import { cliJson } from "@/lib/use-cases/cli/route-kit";

/**
 * `GET /api/ci/casi` (rilascio 8.2b, docs/rilascio-8/RILASCIO-8.2b-SPEC.md §2.3 e §2.9), con
 * `Authorization: Bearer ub_ci_…`: i casi registrati in Unbundle sul repository della chiave, nel suo workspace, per
 * `unbundle ci casi` e `unbundle ci evals` nella CI di main.
 *
 * `{ repository, casi: [{ caso, cartella, aperto, perche? }], soloMain: true, scade }`: un caso chiuso, in pausa o
 * senza la realizzazione ha `aperto: false` e il perché (`chiuso`, `sospeso`, `senza_dossier`). Con l'area spenta per il
 * workspace la lista è vuota. Mai una persona. Le difese e gli errori sono quelli di `openCi`.
 */
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const opened = await openCi(request, { method: "GET", write: false });
  if (!opened.ok) return opened.response;
  const { principal, executor, area } = opened.value;
  const cases = area === "accesa" ? await listCiKeyCases(executor, principal) : [];
  return cliJson(ciCasesBody(principal, cases));
}

/** Solo lettura: 405, dopo le difese (una chiave nell'indirizzo si revoca anche qui). */
export async function POST(request: Request): Promise<Response> {
  return ciMethodNotAllowed(request, "GET");
}
