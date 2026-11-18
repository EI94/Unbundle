import "server-only";
/**
 * Un fatto che risponde a una richiesta di «Cosa serve» (rilascio 9b, docs/contesto/RILASCIO-9b-COSTRUZIONE.md §2.2,
 * §3.2, D3): i legami di `context_need_links` (drizzle/0041).
 *
 * - `proposta`: nasce con la lettura e vale solo finché la sua proposta è aperta (ogni lettura lo controlla); la notte
 *   cancella quelli di proposte non più aperte (`purgeOrphanNeedLinks`).
 *
 * Ogni query porta `workspace_id`. Nei log solo id e numeri. Senza la 0041 (`contextWorkReady` falso) niente legami.
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { logSafeError } from "@/lib/log/safe-error";
import { rowsOf } from "./context-shared";
import { contextWorkReady } from "./context-store";

const LOG_SCOPE = "context/needs";

/**
 * La notte: cancella i legami `proposta` la cui proposta non è più aperta (confermata, scartata, superata, o tolta con la
 * sua fonte). Quanti; zero senza la 0041 o con un errore (nel log).
 */
export async function purgeOrphanNeedLinks(): Promise<number> {
  try {
    if (!(await contextWorkReady())) return 0;
    const rows = rowsOf(
      await db.execute(sql`
        DELETE FROM context_need_links l
        WHERE l.status = 'proposta'
          AND (l.proposal_id IS NULL
               OR NOT EXISTS (SELECT 1 FROM context_proposals p WHERE p.id = l.proposal_id AND p.workspace_id = l.workspace_id AND p.status = 'aperta'))
        RETURNING l.id`),
    );
    return rows.length;
  } catch (error) {
    logSafeError(LOG_SCOPE, "legami_orfani_non_tolti", error);
    return 0;
  }
}
