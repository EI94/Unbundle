import "server-only";

/**
 * «Mappatura board»: gli use case nati dalla mappatura, collegati ai passi (docs/mappatura/MAPPATURA-BOARD-PIANO.md §4.6).
 *
 * Gli use case proposti dalla mappatura sono bozze nascoste per quasi tutti: la board mostra solo quelli che
 * `listHubItems` restituisce a chi guarda. Gli id in `related_activity_ids` li ha scritti un modello: valgono solo
 * quelli che sono passi di questa unità. Con l'area «Use case» spenta, nessuno.
 *
 * Serve alla pagina, una volta sola: le riletture dopo un salvataggio non la chiamano (`readBoard` restituisce sempre
 * `useCases` vuoto), e il browser tiene i collegamenti che ha.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { listHubItems } from "@/lib/db/queries/use-case-hub";
import { useCases } from "@/lib/db/schema";
import type { UseCaseViewer } from "@/lib/use-cases/permissions";
import { isUseCaseHubWorkspace } from "@/lib/use-cases/rollout";
import type { BoardUseCaseLink } from "./board-model";

const NONE = (): { links: BoardUseCaseLink[]; byStep: Map<string, string[]> } => ({ links: [], byStep: new Map() });

/** Gli use case nati dalla mappatura che chi guarda può vedere (listHubItems), con i passi a cui sono legati. Area spenta: nessuno. */
export async function boardUseCaseLinks(workspaceId: string, viewer: UseCaseViewer, stepIds: ReadonlySet<string>): Promise<{ links: BoardUseCaseLink[]; byStep: Map<string, string[]> }> {
  if (stepIds.size === 0 || !isUseCaseHubWorkspace(workspaceId)) return NONE();
  const list = await listHubItems(workspaceId, viewer);
  if (!list || list.items.length === 0) return NONE();
  const visible = new Map(list.items.map((item) => [item.id, { title: item.title, code: "code" in item ? item.code : null }]));
  const rows = await db
    .select({ id: useCases.id, relatedActivityIds: useCases.relatedActivityIds })
    .from(useCases)
    .where(and(eq(useCases.workspaceId, workspaceId), eq(useCases.source, "activity_mapping"), inArray(useCases.id, [...visible.keys()])));
  const links: BoardUseCaseLink[] = [];
  const byStep = new Map<string, string[]>();
  for (const row of rows) {
    const item = visible.get(row.id);
    const related = Array.isArray(row.relatedActivityIds) ? row.relatedActivityIds.filter((id): id is string => typeof id === "string" && stepIds.has(id)) : [];
    if (!item || related.length === 0) continue;
    // Lo stream lo mette `withUseCaseLinks`, dai passi della board.
    links.push({ id: row.id, code: item.code, title: item.title, href: `/dashboard/${workspaceId}/use-cases/${row.id}`, stream: null });
    for (const stepId of new Set(related)) byStep.set(stepId, [...(byStep.get(stepId) ?? []), row.id]);
  }
  links.sort((a, b) => (a.code ?? "").localeCompare(b.code ?? "", "it") || a.title.localeCompare(b.title, "it") || a.id.localeCompare(b.id));
  return { links, byStep };
}
