import "server-only";
import { ciKeyManagedRepos, loadCiKeyOverview } from "@/lib/db/queries/use-case-ci-keys";
import type { UcExecutor } from "@/lib/db/uc-executor";
import { logSafeError } from "@/lib/log/safe-error";
import { ciFamiliesView, type CiFamiliesView, type CiManagedRepos } from "./ci-view";

const SCOPE = "agent-factory-ci";

/**
 * La CI delle famiglie della pagina «Agent Factory» (rilascio 8.2b), senza mai far cadere la pagina: una lettura delle
 * chiavi che non riesce va nel log (solo codici, `logSafeError`: mai la chiave) e ogni riga dice «Non ancora
 * disponibile»; una lettura di chi gestisce le chiavi che non riesce lascia la riga senza pulsanti.
 *
 * Chi gestisce le chiavi si chiede solo per chi è di Lateral Space (e-mail verificata): agli altri, anche a chi
 * costruisce da fuori, la riga senza pulsanti. La regola intera (D6) la rilegge comunque ogni azione, nel database.
 */
export async function readCiFamilies(
  executor: UcExecutor,
  input: { workspaceId: string; userId: string; isLateralSpace: boolean; lsDomains: readonly string[]; families: readonly string[]; now?: Date },
  deps: { loadOverview?: typeof loadCiKeyOverview; loadManaged?: typeof ciKeyManagedRepos; log?: Pick<Console, "error"> } = {},
): Promise<CiFamiliesView> {
  const loadOverview = deps.loadOverview ?? loadCiKeyOverview;
  const loadManaged = deps.loadManaged ?? ciKeyManagedRepos;
  const log = deps.log ?? console;
  const now = input.now ?? new Date();
  const where = { workspaceId: input.workspaceId };
  let overview: Awaited<ReturnType<typeof loadCiKeyOverview>>;
  try {
    overview = await loadOverview(executor, { workspaceId: input.workspaceId });
  } catch (error) {
    logSafeError(SCOPE, "lettura_fallita", error, where, log);
    return ciFamiliesView({ ready: false, repos: new Map(), managed: null, families: input.families, now });
  }
  let managed: CiManagedRepos | null = null;
  if (overview.ready && input.isLateralSpace) {
    try {
      managed = await loadManaged(executor, { workspaceId: input.workspaceId, userId: input.userId, lsDomains: input.lsDomains });
    } catch (error) {
      logSafeError(SCOPE, "gestori_non_letti", error, where, log);
    }
  }
  return ciFamiliesView({ ready: overview.ready, repos: overview.repos, managed, families: input.families, now });
}
