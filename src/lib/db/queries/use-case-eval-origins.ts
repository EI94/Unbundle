/**
 * Da dove sono arrivate le esecuzioni delle evals e del banco di un caso (rilascio 8.2b,
 * docs/rilascio-8/RILASCIO-8.2b-SPEC.md §2.3, §2.6, §2.8): la fonte (`cli`, una persona con la sua CLI; `ci`, la CI di
 * main con la chiave del repository) e, per la CI, l'esecuzione su GitHub. Per «Evals e banco di prova» del progetto:
 * «… · dalla CI» oppure «… · dalla CLI».
 *
 * - Le colonne della 0042 si leggono solo quando la sua sonda è vera (`ciKeysStoreReady`): prima, ogni esecuzione è
 *   «dalla CLI», ed è vero (il codice di prima della 8.2b scrive `cli`).
 * - Solo le esecuzioni chieste, del caso e del workspace dati; mai una persona, mai la chiave che le ha scritte.
 * - L'indirizzo dell'esecuzione si rilegge con la regola della 0042 (`https://github.com/<owner>/<nome>/actions/runs/<n>`):
 *   un altro testo non diventa mai un link.
 *
 * Modulo senza import dell'app (`@/…`, `server-only`): lo usano la pagina e le prove sul database.
 */
import type { UcExecutor } from "../uc-executor.ts";
import { CI_RUN_URL_RE, type EvalRunSource } from "../use-case-hub-ci-keys-ddl.ts";
import { cast, toStatement, ucSql } from "../../uc/sql/statement.ts";
import { ciKeysStoreReady } from "./use-case-ci-keys.ts";

/** Da dove è arrivata un'esecuzione: la fonte e, solo per la CI, l'esecuzione su GitHub (o null). */
export interface EvalRunOrigin {
  source: EvalRunSource;
  ciRunUrl: string | null;
}

/** «dalla CLI», senza link: le esecuzioni di prima della 8.2b e quelle di una persona. */
export const CLI_ORIGIN: EvalRunOrigin = Object.freeze({ source: "cli", ciRunUrl: null });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** La fonte letta: `ci` con l'indirizzo che rispetta la regola (altrimenti senza link); tutto il resto `cli`. */
export function evalRunOriginOf(source: unknown, ciRunUrl: unknown): EvalRunOrigin {
  if (source !== "ci") return CLI_ORIGIN;
  return { source: "ci", ciRunUrl: typeof ciRunUrl === "string" && CI_RUN_URL_RE.test(ciRunUrl) ? ciRunUrl : null };
}

/**
 * Le fonti delle esecuzioni `runIds` del caso (`target`), per id in minuscolo. Gli id che non sono del caso non ci sono;
 * senza la 0042, tutte «dalla CLI».
 */
export async function loadEvalRunOrigins(executor: UcExecutor, target: { workspaceId: string; useCaseId: string }, runIds: readonly string[]): Promise<Map<string, EvalRunOrigin>> {
  const ids = [...new Set(runIds.filter((id) => typeof id === "string" && UUID.test(id)).map((id) => id.toLowerCase()))];
  const out = new Map<string, EvalRunOrigin>();
  if (ids.length === 0) return out;
  if (!(await ciKeysStoreReady(executor))) {
    for (const id of ids) out.set(id, CLI_ORIGIN);
    return out;
  }
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT r.id, r.source, r.ci_run_url FROM use_case_eval_runs r
WHERE r.workspace_id = ${cast(target.workspaceId, "uuid")} AND r.use_case_id = ${cast(target.useCaseId, "uuid")} AND r.id = ANY (${cast(ids, "uuid[]")})`),
  ]);
  for (const row of rows) out.set(String(row.id).toLowerCase(), evalRunOriginOf(row.source, row.ci_run_url));
  return out;
}
