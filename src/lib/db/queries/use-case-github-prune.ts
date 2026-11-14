/**
 * (8.1b) Gli eventi di GitHub ricevuti si tengono 30 giorni: li toglie il cron dei dossier (uc-reminders).
 *
 * Modulo senza import dell'app (`@/…`, `server-only`): lo usa il cron dei dossier.
 */
import { GITHUB_DELIVERY_RETENTION_DAYS, GITHUB_PROBE_SQL } from "../use-case-hub-github-ddl.ts";
import { cast, raw, toStatement, ucSql } from "../../uc/sql/statement.ts";
import type { UcExecutor } from "../uc-executor.ts";

/** Toglie gli eventi ricevuti da più di 30 giorni; senza la 0033 non fa niente. Restituisce quanti. */
export async function pruneGithubDeliveries(executor: UcExecutor): Promise<number> {
  const [ready] = await executor.batch([toStatement(ucSql`SELECT ${raw(GITHUB_PROBE_SQL)} AS ready`)]);
  if (ready[0]?.ready !== true) return 0;
  const [rows] = await executor.batch([
    toStatement(ucSql`DELETE FROM use_case_github_deliveries WHERE received_at < now() - make_interval(days => ${cast(GITHUB_DELIVERY_RETENTION_DAYS, "int")}) RETURNING delivery_id`),
  ]);
  return rows.length;
}
