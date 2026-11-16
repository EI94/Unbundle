import { redirect } from "next/navigation";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";

/**
 * Il vecchio indirizzo di «Contesto» (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §7.1): porta alla pagina
 * nuova, dove i dati della Discovery stanno nella Memoria. La cartella non ha `loading.tsx`, così la risposta è un 307
 * vero e non una pagina che si ricarica.
 */
export default async function ContextSetupRedirect({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  await requireWorkspacePage(workspaceId);
  redirect(`/dashboard/${workspaceId}/contesto`);
}
