import { permanentRedirect } from "next/navigation";
import { processesRedirect } from "@/components/context/view-model";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";

/**
 * Il vecchio elenco delle unità (rilascio 10, docs/ui-10/PROPOSTA-10.md §2.4, §8.2): è la vista «Processi» di
 * «Contesto». Un 308 vero, con la query di prima dopo `vista=processi` (l'ancora la tiene il browser): sopra questa
 * pagina non c'è un `loading.tsx` (quello della board sta in `[deptId]`), così la risposta non parte in streaming. Chi
 * segue solo un corso resta fuori, come prima (`requireWorkspacePage`).
 */
export default async function MappingPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceId } = await params;
  await requireWorkspacePage(workspaceId);
  permanentRedirect(processesRedirect(workspaceId, await searchParams));
}
