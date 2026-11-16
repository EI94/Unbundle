import { notFound } from "next/navigation";
import { ContextPage } from "@/components/context/context-page";
import { GranolaInbox } from "@/components/context/granola/granola-inbox";
import { MemoryView } from "@/components/context/memory-view";
import { loadUseCaseOptions, romeToday } from "@/components/context/page-data";
import { PendingReader } from "@/components/context/pending-reader";
import { briefMaterial, consentNoticeNeeded, isMemoryEmpty } from "@/components/context/view-model";
import { PageContainer } from "@/components/dashboard/page-container";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { contextActorFor } from "@/lib/context/server/actor";
import { CONTEXT_TEXT } from "@/lib/context/text";
import { contextAbilities } from "@/lib/context/visibility";
import { loadAiConsentNotice } from "@/lib/db/queries/context-consent";
import { loadContextMemory } from "@/lib/db/queries/context-memory";
import { contextStoreReady } from "@/lib/db/queries/context-store";

export const metadata = { title: CONTEXT_TEXT.page.title };
// «Leggo gli appunti…» e «Chiedi al contesto» passano dalle loro rotte: la pagina legge e basta.
export const maxDuration = 60;

/**
 * `/contesto` (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §7): la memoria viva del cliente. Chi è nel
 * workspace (chi segue solo un corso va ai suoi corsi); quello che vede lo decide `contextAbilities`, e ogni lista
 * arriva già filtrata dalle funzioni condivise. Senza la 0038 una riga: si sta preparando.
 */
export default async function ContextRoute({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const { session, access } = await requireWorkspacePage(workspaceId);
  const actor = contextActorFor(session.user, access, workspaceId);
  const abilities = contextAbilities(actor);
  if (!abilities.canOpen) notFound();

  if (!(await contextStoreReady())) {
    return (
      <PageContainer size="narrow" className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{CONTEXT_TEXT.page.title}</h1>
        <p className="text-sm text-muted-foreground">{CONTEXT_TEXT.page.notReady}</p>
      </PageContainer>
    );
  }

  const lateralSpace = abilities.seesLateralSpace;
  const today = romeToday();
  const [memory, useCaseOptions, consentNotice] = await Promise.all([
    loadContextMemory(actor),
    abilities.canEditMemory ? loadUseCaseOptions(workspaceId) : Promise.resolve([]),
    // L'avviso dell'ok ai fornitori, per Lateral Space: null se l'ok c'è. «Aggiungi appunti» lo mostra dopo il salvataggio.
    lateralSpace ? loadAiConsentNotice({ workspaceId, userId: actor.userId, role: actor.role }) : Promise.resolve(null),
  ]);
  // Nelle righe di servizio (§6.3) l'avviso c'è solo se c'è qualcosa da leggere o un «In breve» da scrivere.
  const serviceNotice = consentNotice && consentNoticeNeeded({ unreadSources: memory.counts.unreadSources, brief: memory.brief, material: briefMaterial(memory.sections) }) ? consentNotice : null;
  const empty = isMemoryEmpty(memory);
  // Gli appunti in attesa si leggono appena Lateral Space apre la Memoria, e solo con l'ok (senza, c'è l'avviso).
  const pending = lateralSpace && consentNotice === null ? memory.counts.pendingSourceIds : [];

  return (
    <PageContainer size="narrow">
      <ContextPage
        workspaceId={workspaceId}
        workspaceName={access.workspace.name}
        today={today}
        tab="memoria"
        lateralSpace={lateralSpace}
        canEditMemory={abilities.canEditMemory}
        addNotesInHeader={!empty}
        useCaseOptions={useCaseOptions}
        consentNotice={consentNotice}
      >
        <MemoryView
          workspaceId={workspaceId}
          today={today}
          lateralSpace={lateralSpace}
          canEditMemory={abilities.canEditMemory}
          memory={memory}
          useCaseOptions={useCaseOptions}
          consentNotice={serviceNotice}
          granola={lateralSpace ? <GranolaInbox workspaceId={workspaceId} workspaceName={access.workspace.name} compact /> : null}
          reader={pending.length > 0 ? <PendingReader workspaceId={workspaceId} sourceIds={pending} /> : null}
        />
      </ContextPage>
    </PageContainer>
  );
}
