import "server-only";
/**
 * Gli avvisi in campanella di «Contesto nel lavoro» (rilascio 9b, docs/contesto/RILASCIO-9b-COSTRUZIONE.md §2.8, D4, D5).
 *
 * - **«Il contesto è cambiato»** (`contesto_nuovo`, `notifyContextChange`): dopo ogni scrittura che cambia fatti legati a
 *   uno use case con un dossier aperto (conferma di proposte nuove o che cambiano un fatto, «Scrivi un fatto», «Non più
 *   vero»). Per «Modifica» (`notifyUseCasesContextChange`) solo gli use case la cui vista cambia: tutti con un testo nuovo
 *   o la visibilità cambiata (anche ristretta a «Solo Lateral Space»), quelli aggiunti e quelli tolti. Va a chi costruisce
 *   e al responsabile del dossier (`FACTORY_BUILDER_ROLES`); a chi costruisce da fuori Lateral Space solo se il fatto era o
 *   è «Per tutti». La campanella non porta il testo del fatto. Una riconferma non è un cambio.
 * - **«Una risposta per «Cosa serve»»** (`dalla_call`, `notifyNeedAnswered`): un fatto appena confermato può chiudere una
 *   richiesta aperta; va ai revisori del workspace, come «Risposte arrivate» (`notifyReviewersSql`).
 *
 * Mai a chi ha agito. Una riga per persona, use case, tipo e giorno di Roma, come le altre righe della campanella; nessuna
 * e-mail. Si scrivono dopo il batch dell'azione e non la fanno mai fallire: un errore va nel log (solo id e numeri) e
 * basta. Senza la 0041 (`contextWorkReady` falso) il CHECK della campanella non li ammette: niente si scrive.
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { ucLsDomains } from "@/lib/db/queries/uc-access";
import { NO_EXTERNAL_BUILDERS, caseRecipientsSql, loadBuilderScope, type BuilderScope } from "@/lib/db/queries/use-case-builders";
import { getAppUcExecutor, type UcExecutor } from "@/lib/db/uc-executor";
import { logSafeError } from "@/lib/log/safe-error";
import { romeDate } from "@/lib/uc/calendar";
import { rowString } from "@/lib/uc/sql/readiness";
import { cast, toStatement, ucSql, type UcStatement } from "@/lib/uc/sql/statement";
import { FACTORY_BUILDER_ROLES } from "@/lib/use-cases/factory/builders";
import { notifyReviewersSql } from "@/lib/use-cases/referent/sql";
import { isUuid, rowsOf, uuidArray } from "./context-shared";
import { contextWorkReady } from "./context-store";

const LOG_SCOPE = "context/notices";

/** I dossier ci sono (l'area uc può essere spenta): senza, nessuno costruisce e niente si scrive. */
async function dossiersPresent(executor: UcExecutor): Promise<boolean> {
  const [[row]] = await executor.batch([toStatement(ucSql`SELECT to_regclass('public.uc_cases') IS NOT NULL AND to_regclass('public.uc_case_members') IS NOT NULL AS ok`)]);
  return row?.ok === true;
}

/**
 * Una riga `contesto_nuovo` per chi costruisce i dossier aperti di questi use case (e per il loro responsabile), mai per
 * chi ha agito; con `scope` anche chi costruisce da fuori, adesso (il predicato unico di `use-case-builders.ts`).
 */
function contextChangeSql(i: { workspaceId: string; useCaseIds: readonly string[]; scope: BuilderScope; actorUserId: string | null; day: string }): UcStatement {
  return toStatement(ucSql`INSERT INTO use_case_notifications (workspace_id, use_case_id, recipient_user_id, kind, rome_day)
SELECT DISTINCT c.workspace_id, c.portfolio_use_case_id, r.user_id, 'contesto_nuovo', ${cast(i.day, "date")}
FROM uc_cases c CROSS JOIN LATERAL ${caseRecipientsSql(FACTORY_BUILDER_ROLES, i.scope)} r
WHERE c.workspace_id = ${cast(i.workspaceId, "uuid")} AND c.portfolio_use_case_id = ANY (${cast([...i.useCaseIds], "uuid[]")})
  AND c.status <> 'chiuso' AND c.archived_at IS NULL
  AND r.user_id IS DISTINCT FROM ${cast(i.actorUserId, "uuid")}
ON CONFLICT (recipient_user_id, use_case_id, kind, rome_day) DO UPDATE SET last_event_at = now(), read_at = NULL`);
}

/**
 * Le righe `contesto_nuovo` per questi use case (gli id sono di questo workspace: `contextChangeSql` lo ricontrolla): con
 * `shared` anche chi costruisce da fuori, adesso. Lancia per un errore del database: lo gestisce chi chiama.
 */
async function writeContextChange(ws: string, actorUserId: string | null, targets: ReadonlyArray<{ useCaseId: string; shared: boolean }>, now: Date): Promise<void> {
  if (targets.length === 0) return;
  const executor = await getAppUcExecutor();
  if (!(await dossiersPresent(executor))) return;
  const day = romeDate(now);
  const actor = isUuid(actorUserId) ? actorUserId : null;
  const shared = targets.filter((t) => t.shared).map((t) => t.useCaseId);
  const internal = targets.filter((t) => !t.shared).map((t) => t.useCaseId);
  const statements: UcStatement[] = [];
  if (shared.length > 0) statements.push(contextChangeSql({ workspaceId: ws, useCaseIds: shared, scope: await loadBuilderScope(executor, ucLsDomains()), actorUserId: actor, day }));
  if (internal.length > 0) statements.push(contextChangeSql({ workspaceId: ws, useCaseIds: internal, scope: NO_EXTERNAL_BUILDERS, actorUserId: actor, day }));
  await executor.batch(statements);
}

/**
 * «Il contesto è cambiato» (§2.8) per gli use case legati a questi fatti (le versioni appena scritte, o il fatto appena
 * ritirato): a chi costruisce e al responsabile dei dossier aperti; a chi costruisce da fuori solo per uno use case
 * toccato da un fatto «Per tutti». Niente per uno use case senza dossier, o con il dossier chiuso. Non lancia: un errore
 * va nel log.
 */
export async function notifyContextChange(i: { workspaceId: string; actorUserId: string | null; factIds: readonly string[]; now?: Date }): Promise<void> {
  const factIds = [...new Set(Array.isArray(i.factIds) ? i.factIds : [])].filter(isUuid);
  if (!isUuid(i.workspaceId) || factIds.length === 0) return;
  const ws = i.workspaceId;
  try {
    if (!(await contextWorkReady())) return;
    // Gli use case toccati, e se almeno un fatto «Per tutti» li tocca.
    const touched = rowsOf<{ use_case_id: string; shared: boolean }>(
      await db.execute(sql`
        SELECT l.use_case_id, bool_or(f.visibility = 'tutti') AS shared
        FROM context_facts f
        JOIN context_fact_links l ON l.fact_id = f.id AND l.workspace_id = f.workspace_id AND l.use_case_id IS NOT NULL
        WHERE f.workspace_id = ${ws}::uuid AND f.id = ANY(${uuidArray(factIds)})
        GROUP BY l.use_case_id`),
    );
    await writeContextChange(ws, i.actorUserId, touched.map((row) => ({ useCaseId: row.use_case_id, shared: row.shared === true })), i.now ?? new Date());
  } catch (error) {
    logSafeError(LOG_SCOPE, "avviso_contesto_non_scritto", error, { workspaceId: ws, fatti: factIds.length });
  }
}

/**
 * «Il contesto è cambiato» (§2.8) per use case dati da chi chiama: «Modifica» sa quali use case vedono il fatto in modo
 * diverso (`editNoticeTargets`), anche quelli appena tolti, che i legami di adesso non dicono più. `shared`: anche chi
 * costruisce da fuori (il fatto era o è «Per tutti» per quello use case). Non lancia: un errore va nel log.
 */
export async function notifyUseCasesContextChange(i: { workspaceId: string; actorUserId: string | null; targets: ReadonlyArray<{ useCaseId: string; shared: boolean }>; now?: Date }): Promise<void> {
  const seen = new Map<string, boolean>();
  for (const target of Array.isArray(i.targets) ? i.targets : []) {
    if (!isUuid(target?.useCaseId)) continue;
    const id = target.useCaseId.toLowerCase();
    seen.set(id, (seen.get(id) ?? false) || target.shared === true);
  }
  if (!isUuid(i.workspaceId) || seen.size === 0) return;
  const ws = i.workspaceId;
  try {
    if (!(await contextWorkReady())) return;
    await writeContextChange(ws, i.actorUserId, [...seen].map(([useCaseId, shared]) => ({ useCaseId, shared })), i.now ?? new Date());
  } catch (error) {
    logSafeError(LOG_SCOPE, "avviso_contesto_non_scritto", error, { workspaceId: ws, useCase: seen.size });
  }
}

/**
 * «Una risposta per «Cosa serve»» (§2.8) per gli use case di queste richieste: ai revisori del workspace, tranne chi ha
 * confermato, come «Risposte arrivate». La riga prende l'orologio del database, come le altre righe dei revisori: `now`
 * non la cambia. Non lancia: un errore va nel log.
 */
export async function notifyNeedAnswered(i: { workspaceId: string; actorUserId: string | null; needIds: readonly string[]; now?: Date }): Promise<void> {
  const needIds = [...new Set(Array.isArray(i.needIds) ? i.needIds : [])].filter(isUuid);
  if (!isUuid(i.workspaceId) || needIds.length === 0) return;
  const ws = i.workspaceId;
  try {
    if (!(await contextWorkReady())) return;
    const executor = await getAppUcExecutor();
    const [rows] = await executor.batch([
      toStatement(ucSql`SELECT DISTINCT l.use_case_id
FROM use_case_need_links l
JOIN use_case_needs n ON n.id = l.need_id
JOIN use_cases u ON u.id = l.use_case_id AND u.workspace_id = n.workspace_id
WHERE n.workspace_id = ${cast(ws, "uuid")} AND n.id = ANY (${cast(needIds, "uuid[]")}) AND n.archived_at IS NULL`),
    ]);
    const useCaseIds = rows.map((row) => rowString(row.use_case_id)).filter((id): id is string => id !== null);
    if (useCaseIds.length === 0) return;
    const actorUserId = isUuid(i.actorUserId) ? i.actorUserId : null;
    await executor.batch(useCaseIds.map((useCaseId) => notifyReviewersSql({ workspaceId: ws, useCaseId, kind: "dalla_call", actorUserId })));
  } catch (error) {
    logSafeError(LOG_SCOPE, "avviso_richiesta_non_scritto", error, { workspaceId: ws, richieste: needIds.length });
  }
}
