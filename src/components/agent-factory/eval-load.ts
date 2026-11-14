import "server-only";
import { unstable_rethrow } from "next/navigation";
import { loadEvalOverview } from "@/lib/db/queries/use-case-evals";
import type { FactoryTarget } from "@/lib/db/queries/use-case-factory";
import type { UcExecutor } from "@/lib/db/uc-executor";
import { logSafeError } from "@/lib/log/safe-error";
import type { EvalOverview } from "@/lib/use-cases/factory/benchmark";
import { normalizeEvalOverview } from "./eval-format";

/** Quello che la sezione riceve: la panoramica (o null) e se la lettura non è riuscita. */
export interface EvalOverviewRead {
  overview: EvalOverview | null;
  /** La lettura è fallita o ha dato una forma inattesa: la sezione lo dice, sopra lo stato vuoto. */
  unavailable: boolean;
}

const SCOPE = "progetto-banco";

/**
 * Le evals e i banchi di un use case per la pagina del progetto, senza mai far cadere la pagina: un errore della
 * lettura si scrive nel log (senza dati di chi guarda, `logSafeError`) e la sezione mostra lo stato vuoto con l'avviso.
 * Gli errori di Next (`notFound`, `redirect`…) passano. Quello che arriva si controlla (`normalizeEvalOverview`):
 * le righe che non si leggono si tolgono e si contano nel log.
 */
export async function readEvalOverview(
  executor: UcExecutor,
  target: FactoryTarget,
  deps: { load?: typeof loadEvalOverview; log?: Pick<Console, "error"> } = {},
): Promise<EvalOverviewRead> {
  const load = deps.load ?? loadEvalOverview;
  const log = deps.log ?? console;
  const where = { workspaceId: target.workspaceId, useCaseId: target.useCaseId };
  let raw: unknown;
  try {
    raw = await load(executor, target);
  } catch (error) {
    unstable_rethrow(error);
    logSafeError(SCOPE, "lettura_fallita", error, where, log);
    return { overview: null, unavailable: true };
  }
  if (raw === null || raw === undefined) return { overview: null, unavailable: false };
  const read = normalizeEvalOverview(raw);
  if (!read) {
    logSafeError(SCOPE, "forma_inattesa", new TypeError("EvalOverview"), where, log);
    return { overview: null, unavailable: true };
  }
  if (read.dropped > 0) logSafeError(SCOPE, "righe_scartate", new TypeError("EvalOverview"), { ...where, dropped: read.dropped }, log);
  return { overview: read.overview, unavailable: false };
}
