import "server-only";
/**
 * STUB del ramo UI: lo sostituisce il ramo dell'API (rilascio 8.2a)
 *
 * Il ramo della pagina (feat/rilascio-8-2-banco-ui) ha bisogno solo della firma di `loadEvalOverview`; la lettura
 * vera (tabelle della 0036, l'ultimo banco per ruolo, le ultime evals e l'andamento) arriva con il ramo dell'API.
 * Fino ad allora la pagina del progetto mostra lo stato vuoto della sezione «Evals e banco di prova».
 */
import type { UcExecutor } from "@/lib/db/uc-executor";
import type { FactoryTarget } from "@/lib/db/queries/use-case-factory";
import type { EvalOverview } from "@/lib/use-cases/factory/benchmark";

export async function loadEvalOverview(executor: UcExecutor, target: FactoryTarget): Promise<EvalOverview | null> {
  void executor;
  void target;
  return null;
}
