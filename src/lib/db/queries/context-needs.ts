import "server-only";
/**
 * Un fatto che risponde a una richiesta di «Cosa serve» (rilascio 9b, docs/contesto/RILASCIO-9b-COSTRUZIONE.md §2.2,
 * §3.2, D3): i legami di `context_need_links` (drizzle/0041).
 *
 * - `proposta`: nasce con la lettura e vale solo finché la sua proposta è aperta (ogni lettura lo controlla); la notte
 *   cancella quelli di proposte non più aperte (`purgeOrphanNeedLinks`).
 * - `aperta`: nasce alla conferma, solo con un fatto «Per tutti» e l'esigenza ancora aperta. La scheda lo mostra sotto
 *   la richiesta (`listNeedLinks`) solo se il fatto è ancora attivo e «Per tutti» e l'esigenza ancora aperta.
 * - `usata` («Chiudi con questo»: l'esigenza passa ad «A posto» con `updateNeed`, poi `markNeedLinkUsed`) e `scartata`
 *   («Non risponde», `dismissNeedLink`): decise da una persona, con la data.
 *
 * Chi: i revisori (`canSeeReviewerSources`, gli stessi ruoli di `canEditNeeds`), che vedono e modificano «Cosa serve».
 * Nessun modello. Ogni query porta `workspace_id`: un legame di un altro workspace è «non trovato». Nei log solo id e
 * numeri. Senza la 0041 (`contextWorkReady` falso) niente legami.
 */
import { sql } from "drizzle-orm";
import { dayLabel } from "@/lib/context/labels";
import { contextAbilities, type ContextActor } from "@/lib/context/visibility";
import { OPEN_NEED_STATUSES } from "@/lib/context/work/need-links";
import { db } from "@/lib/db";
import { CLIENT_SIDE_SQL } from "@/lib/db/use-case-hub-referents-ddl";
import { logSafeError } from "@/lib/log/safe-error";
import type { ServiceResult } from "@/lib/use-cases/types";
import { eventStatement, gate, isUuid, notFound, notReady, ok, retry, rowsOf, stale, toIsoDate } from "./context-shared";
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

// ─── La scheda: «Una call del 14 nov risponde: …» ────────────────────

/** Un legame aperto sotto una richiesta di «Cosa serve». `date`: il giorno della fonte come a schermo («14 nov»). */
export interface NeedLinkView {
  id: string;
  needId: string;
  /** La frase del fatto «Per tutti». */
  statement: string;
  /** «Una call del …» o «Un documento del …». */
  from: "call" | "documento";
  date: string;
}

/**
 * I legami aperti delle richieste aperte di questo use case, per esigenza (l'ultimo nato, se ce n'è più di uno): solo
 * requisiti del cliente non archiviati, in uno stato aperto, con un fatto attivo «Per tutti». A chi non è un revisore,
 * senza la 0041 o con un errore (nel log): niente.
 */
export async function listNeedLinks(actor: ContextActor, useCaseId: string): Promise<Record<string, NeedLinkView>> {
  if (!contextAbilities(actor).canSeeReviewerSources || !isUuid(actor.workspaceId) || !isUuid(useCaseId)) return {};
  const ws = actor.workspaceId;
  try {
    if (!(await contextWorkReady())) return {};
    const rows = rowsOf<{ id: string; need_id: string; statement: string; source_kind: string | null; day: unknown }>(
      await db.execute(sql`
        SELECT DISTINCT ON (l.need_id) l.id, l.need_id, f.statement, s.kind AS source_kind,
          coalesce(s.occurred_on, (f.created_at AT TIME ZONE 'Europe/Rome')::date) AS day
        FROM context_need_links l
        JOIN context_facts f ON f.id = l.fact_id AND f.workspace_id = l.workspace_id AND f.status = 'attivo' AND f.visibility = 'tutti'
        JOIN use_case_needs n ON n.id = l.need_id AND n.workspace_id = l.workspace_id
        JOIN use_case_need_links nl ON nl.need_id = n.id AND nl.use_case_id = ${useCaseId}::uuid
        LEFT JOIN context_sources s ON s.id = f.source_id AND s.workspace_id = f.workspace_id
        WHERE l.workspace_id = ${ws}::uuid AND l.status = 'aperta'
          AND n.type = 'requisito' AND n.archived_at IS NULL AND ${sql.raw(CLIENT_SIDE_SQL("n"))}
          AND n.status = ANY(${`{${OPEN_NEED_STATUSES.join(",")}}`}::text[])
        ORDER BY l.need_id, l.created_at DESC, l.id`),
    );
    const out: Record<string, NeedLinkView> = {};
    for (const row of rows) {
      out[row.need_id] = { id: row.id, needId: row.need_id, statement: row.statement, from: row.source_kind === "documento" ? "documento" : "call", date: dayLabel(toIsoDate(row.day)) };
    }
    return out;
  } catch (error) {
    logSafeError(LOG_SCOPE, "legami_non_letti", error, { workspaceId: ws, useCaseId });
    return {};
  }
}

/** Un legame aperto passa a `usata` o `scartata`, con la data e chi l'ha deciso; una riga di storia senza attore. */
async function decideNeedLink(actor: ContextActor, linkId: string, to: "usata" | "scartata"): Promise<ServiceResult<true>> {
  const allowed = await gate(actor, "canSeeReviewerSources");
  if (!allowed.ok) return allowed;
  if (!isUuid(linkId)) return notFound();
  const ws = actor.workspaceId;
  try {
    if (!(await contextWorkReady())) return notReady();
    const [link] = rowsOf<{ status: string; need_id: string; fact_id: string | null }>(
      await db.execute(sql`SELECT status, need_id, fact_id FROM context_need_links WHERE id = ${linkId}::uuid AND workspace_id = ${ws}::uuid`),
    );
    if (!link) return notFound();
    if (link.status !== "aperta") return stale();
    const decided = sql`EXISTS (SELECT 1 FROM context_need_links x WHERE x.id = ${linkId}::uuid AND x.status = ${to} AND x.decided_at = now())`;
    const results = await db.batch([
      db.execute(sql`
        UPDATE context_need_links SET status = ${to}, decided_at = now(), decided_by_user_id = ${actor.userId}::uuid, version = version + 1, updated_at = now()
        WHERE id = ${linkId}::uuid AND workspace_id = ${ws}::uuid AND status = 'aperta'
        RETURNING id`),
      // Nella storia senza chi l'ha deciso: il legame lo dice, e nessuno si misura per persona.
      eventStatement(
        { workspaceId: ws, action: to === "usata" ? "richiesta_chiusa" : "richiesta_scartata", channel: actor.channel, actorUserId: null, factId: link.fact_id, detail: { esigenza: link.need_id } },
        decided,
      ),
    ]);
    return rowsOf(results[0]).length === 1 ? ok(true) : stale();
  } catch (error) {
    logSafeError(LOG_SCOPE, "legame_non_deciso", error, { workspaceId: ws, linkId, stato: to });
    return retry();
  }
}

/**
 * «Chiudi con questo», dopo che l'esigenza è passata ad «A posto» (`updateNeed`, nell'azione): il legame diventa `usata`.
 * `non_trovato` per un legame di un altro workspace; `versione_superata` se non è più aperto.
 */
export async function markNeedLinkUsed(actor: ContextActor, linkId: string): Promise<ServiceResult<true>> {
  return decideNeedLink(actor, linkId, "usata");
}

/** «Non risponde»: il legame diventa `scartata` e sparisce; la richiesta resta aperta. */
export async function dismissNeedLink(actor: ContextActor, linkId: string): Promise<ServiceResult<true>> {
  return decideNeedLink(actor, linkId, "scartata");
}
