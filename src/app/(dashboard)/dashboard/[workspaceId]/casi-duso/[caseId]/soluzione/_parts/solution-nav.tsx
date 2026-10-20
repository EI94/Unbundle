import { SegmentedNav } from "@/components/dashboard/segmented-nav";
import { casePath } from "@/components/uc/catalog/paths";
import { solutionSegmentsFor, type SolutionSegment } from "@/lib/uc/views/case-shell";
import type { CaseRole } from "@/lib/uc/vocab";

/**
 * «Descrizione · Mappa · Regole · Dati» (DESIGN §3.7): link con
 * `aria-current="page"`, per ruolo (§2.3). Sta in 368 px: niente etichette
 * corte, i quattro nomi ci stanno già.
 */
export function SolutionNav({ workspaceId, caseId, roles, active, className = "mb-6" }: { workspaceId: string; caseId: string; roles: readonly CaseRole[]; active: SolutionSegment; className?: string }) {
  const items = solutionSegmentsFor(roles).map((s) => ({ key: s.key, label: s.label, href: casePath(workspaceId, caseId, s.segment) }));
  if (items.length < 2) return null;
  return <SegmentedNav className={className} ariaLabel="Parti della soluzione" active={active} items={items} />;
}
