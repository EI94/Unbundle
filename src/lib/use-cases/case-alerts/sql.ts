/**
 * «Pronto da avviare» e «Autorizza i fornitori» (drizzle/0025): i costruttori SQL puri condivisi
 * dalla campanella (`queries/use-case-notifications.ts`), dalle scritture che li mettono nello
 * stesso batch dell'evento e dal cron. Restituiscono frammenti o `{ text, params }`.
 *
 * - `readyNowSql`: lo use case è pronto da avviare adesso, la regola di `isReadyToStart`
 *   (`../readiness.ts`) in SQL; la prova di parità sul database le confronta.
 * - `subprocessorsAckSql`: c'è l'«ok sui sub-responsabili» del workspace per la versione di adesso
 *   dell'elenco.
 *
 * Art. 15.4: nessun ORDER BY, GROUP BY o conteggio per persona.
 *
 * Modulo puro: import relativi `.ts`.
 */
import { ROME_QUARTER_NOW_SQL, readyCardPredicate } from "../../db/use-case-hub-alerts-ddl.ts";
import { SUBPROCESSORS_VERSION } from "../../uc/legal/subprocessors.ts";
import { raw, ucSql, type SqlFragment } from "../../uc/sql/statement.ts";
import { currentQuarter, nextQuarter } from "../quarter.ts";
import { READINESS_LATER_RULE } from "../readiness.ts";

const ALIAS = /^[a-z][a-z0-9_]{0,20}$/;

/**
 * Lo use case `alias` è pronto da avviare: approvato, «Da costruire», un trimestre da quello di
 * adesso (a Roma, dall'orologio del database o, solo nei test, da `clock`), nessun dossier completo
 * collegato (con `dossiers`, cioè con le tabelle dei dossier), ogni informazione del cliente a posto.
 */
export function readyNowSql(alias: string, o: { clock?: Date; dossiers: boolean }): SqlFragment {
  if (!ALIAS.test(alias)) throw new Error("Alias non valido");
  const lanes = READINESS_LATER_RULE === "oltre_il_prossimo";
  const from = o.clock || lanes ? `'${currentQuarter(o.clock ?? new Date())}'` : ROME_QUARTER_NOW_SQL;
  const to = lanes ? `'${nextQuarter(currentQuarter(o.clock ?? new Date()))}'` : null;
  return raw(readyCardPredicate(alias, { fromQuarter: from, toQuarter: to, dossiers: o.dossiers }));
}

/** C'è l'«ok sui sub-responsabili» del workspace `workspace` (un'espressione) per l'elenco di adesso. */
export function subprocessorsAckSql(workspace: SqlFragment): SqlFragment {
  return ucSql`EXISTS (SELECT 1 FROM uc_subprocessor_acks ak WHERE ak.workspace_id = ${workspace} AND ak.list_version = ${raw(`'${SUBPROCESSORS_VERSION.replace(/[^0-9a-z-]/gi, "")}'`)})`;
}
