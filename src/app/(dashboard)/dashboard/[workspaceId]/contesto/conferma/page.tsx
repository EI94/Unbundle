import { notFound } from "next/navigation";
import { ConfirmView } from "@/components/context/confirm-view";
import { loadUseCaseOptions, romeToday } from "@/components/context/page-data";
import { PageContainer } from "@/components/dashboard/page-container";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { contextActorFor } from "@/lib/context/server/actor";
import { CONTEXT_TEXT } from "@/lib/context/text";
import { contextAbilities } from "@/lib/context/visibility";
import { listOpenProposals } from "@/lib/db/queries/context-proposals";
import { contextStoreReady } from "@/lib/db/queries/context-store";

export const metadata = { title: CONTEXT_TEXT.confirm.title };
// «Conferma» è un'azione di questa pagina: dopo la risposta «In breve» si riscrive con `after()`, dentro questo tempo.
export const maxDuration = 60;

/**
 * `/contesto/conferma` (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §7.4): le proposte da confermare, solo
 * per Lateral Space; agli altri «non trovata», come una pagina che non c'è. `?fonte=<id>` mostra quelle di un solo
 * appunto.
 */
export default async function ContextConfirmRoute({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceId } = await params;
  const { session, access } = await requireWorkspacePage(workspaceId);
  const actor = contextActorFor(session.user, access, workspaceId);
  if (!contextAbilities(actor).canConfirm) notFound();

  if (!(await contextStoreReady())) {
    return (
      <PageContainer size="narrow" className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{CONTEXT_TEXT.confirm.title}</h1>
        <p className="text-sm text-muted-foreground">{CONTEXT_TEXT.page.notReady}</p>
      </PageContainer>
    );
  }

  const fonte = (await searchParams).fonte;
  const sourceId = typeof fonte === "string" && fonte.trim() ? fonte.trim() : undefined;
  const [open, useCaseOptions] = await Promise.all([listOpenProposals(actor, sourceId ? { sourceId } : {}), loadUseCaseOptions(workspaceId)]);
  if (!open) notFound();

  return (
    <PageContainer size="narrow">
      <ConfirmView workspaceId={workspaceId} today={romeToday()} open={open} useCaseOptions={useCaseOptions} filteredBySource={sourceId !== undefined} />
    </PageContainer>
  );
}
