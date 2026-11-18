import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { loadHome } from "@/lib/db/queries/use-case-home";
import { ProgramHome } from "@/components/programma/program-home";
import { ContributorHome } from "./contributor-home";

/**
 * La Home (rilascio 10, ondata 2b; docs/ui-10/PROPOSTA-10.md §3.3): `/dashboard/<ws>` e il suo alias
 * `/dashboard/<ws>/programma` (§2.4: il Programma e i suoi `?apri=` restano raggiungibili da lì). Ai revisori il
 * Programma con il prossimo passo del workspace; ai contributori «I tuoi use case». Chi segue solo un corso va ai suoi
 * corsi (`requireWorkspacePage`). Le due pagine la chiamano e restituiscono il suo albero già letto.
 */
export async function homePage({ workspaceId, searchParams }: { workspaceId: string; searchParams: Record<string, string | string[] | undefined> }) {
  const { session, access } = await requireWorkspacePage(workspaceId);
  const data = await loadHome({ workspace: access.workspace, user: session.user, role: access.role });
  if (data.kind === "contributore") return <ContributorHome data={data} />;
  const apri = searchParams.apri;
  return <ProgramHome data={data} initialPanel={typeof apri === "string" ? apri : null} />;
}
