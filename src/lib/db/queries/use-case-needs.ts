import "server-only";
import { and, asc, eq, getTableColumns, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { ensureDbSchema } from "@/lib/db/ensure-schema";
import { useCaseNeeds, useCases } from "@/lib/db/schema";
import type { NeedUseCaseRef, NeedView } from "@/lib/use-cases/needs";
import { abilitiesForUseCase, type UseCaseViewer } from "@/lib/use-cases/permissions";
import type { IsoDate } from "@/lib/use-cases/types";

/**
 * Letture di «Cosa serve» (`use_case_needs` e `use_case_need_links`, drizzle/0022): solo per i
 * revisori (`canSeeNeeds`). Per chiunque altro `null`, prima di toccare il database: le esigenze
 * non arrivano mai a un contributore, né nella pagina né altrove.
 *
 * Una query: le esigenze del workspace con gli id degli use case collegati, solo quelli dello
 * stesso workspace (un legame non porta il workspace: lo controlla il JOIN). Le archiviate restano
 * fuori, salvo `includeArchived`. Nessun ordinamento o raggruppamento per persona: «Chi» è un
 * testo della riga.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Gli use case collegati, per codice. La sottoquery nomina `use_case_needs` per esteso: nella lista
 * del SELECT Drizzle scrive le colonne senza la tabella.
 */
const LINKED_USE_CASES = sql<string[] | null>`(SELECT array_agg(l.use_case_id::text ORDER BY u.code NULLS LAST, l.use_case_id)
  FROM use_case_need_links l
  JOIN use_cases u ON u.id = l.use_case_id AND u.workspace_id = "use_case_needs"."workspace_id"
  WHERE l.need_id = "use_case_needs"."id")`;

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

type NeedRowRead = typeof useCaseNeeds.$inferSelect & { useCaseIds: string[] | null };

function toView(row: NeedRowRead): NeedView {
  return {
    id: row.id,
    type: row.type,
    kind: row.kind,
    title: row.title,
    detail: row.detail,
    ownerLabel: row.ownerLabel,
    ownerSide: row.ownerSide,
    status: row.status,
    availability: row.availability,
    dueOn: (row.dueOn ?? null) as IsoDate | null,
    dueLabel: row.dueLabel,
    dueIsProposal: row.dueIsProposal,
    forLabel: row.forLabel,
    sortOrder: row.sortOrder,
    version: row.version,
    importKey: row.importKey,
    createdAt: iso(row.createdAt) ?? "",
    updatedAt: iso(row.updatedAt) ?? "",
    doneAt: iso(row.doneAt),
    archivedAt: iso(row.archivedAt),
    archiveReason: row.archiveReason,
    useCaseIds: (row.useCaseIds ?? []).map((id) => id.toLowerCase()),
  };
}

/**
 * Le esigenze del workspace per chi guarda: i revisori le ricevono tutte (non archiviate), gli
 * altri `null`. In ordine di tipo, ordine scelto, scadenza e arrivo.
 */
export async function listWorkspaceNeeds(
  workspaceId: string,
  viewer: UseCaseViewer,
  opts: { includeArchived?: boolean } = {},
): Promise<NeedView[] | null> {
  if (!abilitiesForUseCase(viewer).canSeeNeeds || !UUID.test(workspaceId)) return null;
  await ensureDbSchema();
  const rows = await db
    .select({ ...getTableColumns(useCaseNeeds), useCaseIds: LINKED_USE_CASES })
    .from(useCaseNeeds)
    .where(and(eq(useCaseNeeds.workspaceId, workspaceId), opts.includeArchived ? undefined : isNull(useCaseNeeds.archivedAt)))
    .orderBy(asc(useCaseNeeds.type), asc(useCaseNeeds.sortOrder), sql`${useCaseNeeds.dueOn} ASC NULLS LAST`, asc(useCaseNeeds.createdAt), asc(useCaseNeeds.id));
  return rows.map(toView);
}

/** Un'esigenza del workspace (anche archiviata), per i revisori; `null` se non c'è o per gli altri. */
export async function getWorkspaceNeed(workspaceId: string, needId: string, viewer: UseCaseViewer): Promise<NeedView | null> {
  if (!abilitiesForUseCase(viewer).canSeeNeeds || !UUID.test(workspaceId) || !UUID.test(needId)) return null;
  await ensureDbSchema();
  const [row] = await db
    .select({ ...getTableColumns(useCaseNeeds), useCaseIds: LINKED_USE_CASES })
    .from(useCaseNeeds)
    .where(and(eq(useCaseNeeds.workspaceId, workspaceId), eq(useCaseNeeds.id, needId)))
    .limit(1);
  return row ? toView(row) : null;
}

/**
 * Codice e titolo degli use case nominati dalle esigenze (per «Anche per» nella scheda), solo dello
 * stesso workspace e solo per i revisori; id in minuscolo. Vuoto per gli altri o senza id.
 */
export async function needUseCaseRefs(workspaceId: string, ids: readonly string[], viewer: UseCaseViewer): Promise<Record<string, NeedUseCaseRef>> {
  const wanted = [...new Set(ids.map((id) => id.toLowerCase()))].filter((id) => UUID.test(id));
  if (!abilitiesForUseCase(viewer).canSeeNeeds || !UUID.test(workspaceId) || !wanted.length) return {};
  const rows = await db
    .select({ id: useCases.id, code: useCases.code, title: useCases.title })
    .from(useCases)
    .where(and(eq(useCases.workspaceId, workspaceId), inArray(useCases.id, wanted)));
  return Object.fromEntries(rows.map((row) => [row.id.toLowerCase(), { id: row.id.toLowerCase(), code: row.code, title: row.title }]));
}
