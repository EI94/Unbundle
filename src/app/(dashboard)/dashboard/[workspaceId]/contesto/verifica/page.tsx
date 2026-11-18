import { notFound } from "next/navigation";
import { romeToday } from "@/components/context/page-data";
import { VerifyView } from "@/components/context/verify-view";
import { PageContainer } from "@/components/dashboard/page-container";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { contextActorFor } from "@/lib/context/server/actor";
import { CONTEXT_TEXT } from "@/lib/context/text";
import { contextAbilities } from "@/lib/context/visibility";
import { listFactsToCheck } from "@/lib/db/queries/context-freshness";
import { contextStoreReady } from "@/lib/db/queries/context-store";

export const metadata = { title: CONTEXT_TEXT.verify.title };
// «Non più vero» è un'azione di questa pagina: dopo la risposta «In breve» si riscrive con `after()`, dentro questo tempo.
export const maxDuration = 60;

/**
 * `/contesto/verifica` (rilascio 9b, docs/contesto/RILASCIO-9b-COSTRUZIONE.md §2.10, D9): i fatti attivi che nessuno ha
 * riconfermato da più di 6 mesi (la notte li segna «da verificare»), con «Ancora veri (n)» e «Non più vero». Solo per
 * Lateral Space (`canEditMemory`); agli altri «non trovata», come una pagina che non c'è. Nessun modello.
 */
export default async function ContextVerifyRoute({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const { session, access } = await requireWorkspacePage(workspaceId);
  const actor = contextActorFor(session.user, access, workspaceId);
  if (!contextAbilities(actor).canEditMemory) notFound();

  if (!(await contextStoreReady())) {
    return (
      <PageContainer size="narrow" className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{CONTEXT_TEXT.verify.title}</h1>
        <p className="text-sm text-muted-foreground">{CONTEXT_TEXT.page.notReady}</p>
      </PageContainer>
    );
  }

  const facts = await listFactsToCheck(actor);
  if (!facts) notFound();

  return (
    <PageContainer size="narrow">
      <VerifyView workspaceId={workspaceId} today={romeToday()} facts={facts} />
    </PageContainer>
  );
}
