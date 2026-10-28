import "server-only";
import { ensureDbSchema } from "@/lib/db/ensure-schema";
import { getAppUcExecutor } from "@/lib/db/uc-executor";
import { CLIENT_SIDE_SQL, type ReferentItemState, type ReferentRequestStatus } from "@/lib/db/use-case-hub-referents-ddl";
import { rowBool, rowDate, rowNumber, rowString } from "@/lib/uc/sql/readiness";
import { cast, raw, toStatement, ucSql } from "@/lib/uc/sql/statement";
import { clientSideNeeds, deriveInfoProgress, infoProgressView, type InfoAskFact, type InfoNeedFact, type InfoProgressView } from "@/lib/use-cases/info-progress";
import type { NeedStatus, UseCaseNeedLists } from "@/lib/use-cases/needs";
import { abilitiesForUseCase, type UseCaseViewer } from "@/lib/use-cases/permissions";

/**
 * «Raccolta informazioni» (SPEC §P2.8): lo stato derivato dalle esigenze del cliente di una scheda e
 * dalle richieste al referente, mai salvato. Solo per chi vede «Cosa serve» (`canSeeNeeds`).
 * Nessuna colonna del referente o dell'informativa; nessun ordinamento in SQL (l'ultima richiesta la
 * sceglie TypeScript, per `created_at`).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Le domande delle richieste (inviate, scadute o completate) del workspace, o di una scheda. */
export async function loadInfoAsks(workspaceId: string, useCaseId: string | null): Promise<Array<InfoAskFact & { useCaseId: string }>> {
  if (!UUID.test(workspaceId) || (useCaseId !== null && !UUID.test(useCaseId))) return [];
  await ensureDbSchema();
  const executor = await getAppUcExecutor();
  const [[present]] = await executor.batch([toStatement(ucSql`SELECT to_regclass('public.use_case_referent_requests') IS NOT NULL AS ok`)]);
  if (!rowBool(present?.ok)) return [];
  const uc = useCaseId ? ucSql` AND r.use_case_id = ${cast(useCaseId, "uuid")}` : raw("");
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT r.use_case_id, i.need_id, r.id AS request_id, r.status, r.expires_at, r.created_at, r.sent_at, r.reminder_count, r.last_reminder_at, i.state
FROM use_case_referent_requests r
JOIN use_case_referent_request_items i ON i.request_id = r.id AND i.workspace_id = r.workspace_id
WHERE r.workspace_id = ${cast(workspaceId, "uuid")}${uc} AND r.status IN ('inviata', 'scaduta', 'completata')`),
  ]);
  return rows.flatMap((r): Array<InfoAskFact & { useCaseId: string }> => {
    const expiresAt = rowDate(r.expires_at);
    const createdAt = rowDate(r.created_at);
    if (!expiresAt || !createdAt) return [];
    return [
      {
        useCaseId: String(r.use_case_id).toLowerCase(),
        needId: String(r.need_id).toLowerCase(),
        requestId: String(r.request_id).toLowerCase(),
        status: (rowString(r.status) ?? "inviata") as ReferentRequestStatus,
        expiresAt,
        createdAt,
        sentAt: rowDate(r.sent_at),
        reminderCount: rowNumber(r.reminder_count) ?? 0,
        lastReminderAt: rowDate(r.last_reminder_at),
        itemState: (rowString(r.state) ?? "aperta") as ReferentItemState,
      },
    ];
  });
}

/**
 * Lo stato di ogni scheda del workspace con requisiti del cliente (chiave: id della scheda in
 * minuscolo), oppure null per chi non vede «Cosa serve». Per la lista e la Roadmap.
 */
export async function listInfoProgress(workspaceId: string, viewer: UseCaseViewer, o: { now?: Date } = {}): Promise<Record<string, InfoProgressView> | null> {
  const abilities = abilitiesForUseCase(viewer);
  if (!abilities.canSeeNeeds || !UUID.test(workspaceId)) return null;
  const now = o.now ?? new Date();
  await ensureDbSchema();
  const executor = await getAppUcExecutor();
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT l.use_case_id, n.id, n.status
FROM use_case_needs n
JOIN use_case_need_links l ON l.need_id = n.id
JOIN use_cases u ON u.id = l.use_case_id AND u.workspace_id = n.workspace_id
WHERE n.workspace_id = ${cast(workspaceId, "uuid")} AND n.type = 'requisito' AND n.archived_at IS NULL AND ${raw(CLIENT_SIDE_SQL("n"))}`),
  ]);
  const byCard = new Map<string, InfoNeedFact[]>();
  for (const r of rows) {
    const card = String(r.use_case_id).toLowerCase();
    const list = byCard.get(card) ?? [];
    list.push({ id: String(r.id).toLowerCase(), status: (rowString(r.status) ?? "da_chiedere") as NeedStatus });
    byCard.set(card, list);
  }
  if (byCard.size === 0) return {};
  const asks = await loadInfoAsks(workspaceId, null);
  const out: Record<string, InfoProgressView> = {};
  for (const [card, needs] of byCard) {
    const view = infoProgressView(deriveInfoProgress(needs, asks.filter((a) => a.useCaseId === card), now));
    if (view) out[card] = view;
  }
  return out;
}

/** Lo stato di una scheda, dalle esigenze che la pagina ha già letto (mai rilette qui). */
export async function loadUseCaseInfoProgress(i: {
  workspaceId: string;
  useCaseId: string;
  viewer: UseCaseViewer;
  needs: UseCaseNeedLists;
  now?: Date;
}): Promise<InfoProgressView | null> {
  if (!abilitiesForUseCase(i.viewer).canSeeNeeds || !UUID.test(i.workspaceId) || !UUID.test(i.useCaseId)) return null;
  const now = i.now ?? new Date();
  const needs = clientSideNeeds(i.needs.requirements, i.useCaseId);
  if (needs.length === 0) return null;
  const asks = await loadInfoAsks(i.workspaceId, i.useCaseId);
  return infoProgressView(deriveInfoProgress(needs, asks, now));
}
