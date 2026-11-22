import { notFound } from "next/navigation";
import { ContextPage, type HeaderStep } from "@/components/context/context-page";
import { GranolaInbox } from "@/components/context/granola/granola-inbox";
import { MemoryView } from "@/components/context/memory-view";
import { NotesView } from "@/components/context/notes-view";
import { loadUseCaseOptions, romeToday } from "@/components/context/page-data";
import { PendingReader } from "@/components/context/pending-reader";
import { briefMaterial, confirmStep, consentNoticeNeeded, contextMenu, contextViewOf, sheetIdParam } from "@/components/context/view-model";
import { PageContainer } from "@/components/dashboard/page-container";
import { ProcessesView } from "@/components/mappatura/board/processes-view";
import { VIEW_TEXT } from "@/components/mappatura/board/text";
import { processesStep } from "@/components/mappatura/board/view-model";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { contextActorFor } from "@/lib/context/server/actor";
import { CONTEXT_TEXT } from "@/lib/context/text";
import { contextAbilities } from "@/lib/context/visibility";
import { loadAiConsentNotice } from "@/lib/db/queries/context-consent";
import { loadContextMemory } from "@/lib/db/queries/context-memory";
import { listContextSources } from "@/lib/db/queries/context-sources";
import { contextStoreReady } from "@/lib/db/queries/context-store";
import { getAppUcExecutor } from "@/lib/db/uc-executor";
import { boardAbilities } from "@/lib/mappatura/abilities";
import { UNIT_TEXT } from "@/lib/mappatura/text";
import { listUnitBoards } from "@/lib/mappatura/units";
import { canReviewWorkspacePortfolio } from "@/lib/workspace-permissions";

export const metadata = { title: CONTEXT_TEXT.page.title };
// «Leggo gli appunti…» e «Chiedi al contesto» passano dalle loro rotte: la pagina legge e basta.
export const maxDuration = 60;

/**
 * `/contesto` (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §7; rilascio 10, docs/ui-10/PROPOSTA-10.md §3.7):
 * la memoria viva del cliente. Chi è nel workspace (chi segue solo un corso va ai suoi corsi); quello che vede lo decide
 * `contextAbilities`, e ogni lista arriva già filtrata dalle funzioni condivise.
 *
 * Tre viste sotto la stessa testata: la Memoria (senza `?vista`; `?apri=<fatto>` apre il pannello di un fatto), i
 * Processi (`?vista=processi`: le unità, prima `/mapping`, che porta qui), le Fonti (`?vista=fonti`; `?fonte=<id>` apre il pannello di una fonte). Il vecchio `?vista=appunti` porta
 * a `?vista=fonti` con gli altri parametri (§8.2): lo fa il proxy, prima della pagina. Senza la 0038 una riga: si sta preparando.
 */
export default async function ContextRoute({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceId } = await params;
  const { session, access } = await requireWorkspacePage(workspaceId);
  const actor = contextActorFor(session.user, access, workspaceId);
  const abilities = contextAbilities(actor);
  if (!abilities.canOpen) notFound();

  // Il vecchio `?vista=appunti` lo porta a `?vista=fonti` il proxy (src/proxy.ts, `notesViewAlias`), con un 308 vero.
  const search = await searchParams;

  if (!(await contextStoreReady())) {
    return (
      <PageContainer size="narrow" className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{CONTEXT_TEXT.page.title}</h1>
        <p className="text-sm text-muted-foreground">{CONTEXT_TEXT.page.notReady}</p>
      </PageContainer>
    );
  }

  const view = contextViewOf(search.vista);
  const lateralSpace = abilities.seesLateralSpace;
  const workspaceName = access.workspace.name;
  const reviewer = canReviewWorkspacePortfolio(access.role);
  const today = romeToday();
  const [useCaseOptions, consentNotice] = await Promise.all([
    abilities.canEditMemory ? loadUseCaseOptions(workspaceId) : Promise.resolve([]),
    // L'avviso dell'ok ai fornitori, per Lateral Space: null se l'ok c'è. «Aggiungi appunti» lo mostra dopo il salvataggio.
    lateralSpace ? loadAiConsentNotice({ workspaceId, userId: actor.userId, role: actor.role }) : Promise.resolve(null),
  ]);
  const shell = { workspaceId, today, lateralSpace, canEditMemory: abilities.canEditMemory, canUpload: abilities.canUploadDocuments, useCaseOptions, consentNotice };
  const confirm = (openProposals: number): HeaderStep | null => {
    const step = confirmStep({ lateralSpace, openProposals, workspaceId });
    return step ? { kind: "link", icon: "check", ...step } : null;
  };

  if (view === "processi") {
    // (Rilascio 10, §3.7) I Processi: le unità con i numeri della loro board, in una lettura sola (prima `/mapping`).
    const units = await listUnitBoards(await getAppUcExecutor(), workspaceId);
    const canAddUnit = boardAbilities(access.role).edit;
    const next = processesStep(units);
    const P = VIEW_TEXT.processes;
    const step: HeaderStep | null =
      next.kind === "add"
        ? canAddUnit
          ? { kind: "action", action: "add-unit", label: UNIT_TEXT.add, why: P.addWhy }
          : null
        : {
            kind: "link",
            icon: "continue",
            label: next.kind === "continue" ? P.continueStep(next.unit.name) : P.startStep(next.unit.name),
            why: next.kind === "continue" ? P.continueWhy : P.startWhy,
            href: `/dashboard/${workspaceId}/mapping/${next.unit.id}`,
          };
    return (
      <PageContainer size="narrow">
        <ContextPage {...shell} tab="processi" step={step} menu={contextMenu({ workspaceId, reviewer, toCheck: 0, lateralSpace })} canAddUnit={canAddUnit}>
          <ProcessesView workspaceId={workspaceId} units={units} interviewHref={reviewer ? `/dashboard/${workspaceId}/setup/leadership` : null} />
        </ContextPage>
      </PageContainer>
    );
  }

  if (view === "fonti") {
    const sources = await listContextSources(actor);
    const fonte = typeof search.fonte === "string" && search.fonte.trim() ? search.fonte.trim() : null;
    const open = sources.reduce((sum, source) => sum + (source.openProposals > 0 ? source.openProposals : 0), 0);
    return (
      <PageContainer size="narrow">
        <ContextPage {...shell} tab="fonti" step={confirm(open)} menu={contextMenu({ workspaceId, reviewer, toCheck: 0, lateralSpace })}>
          <NotesView
            key={fonte ?? ""}
            workspaceId={workspaceId}
            today={today}
            lateralSpace={lateralSpace}
            sources={sources}
            granola={lateralSpace ? <GranolaInbox workspaceId={workspaceId} workspaceName={workspaceName} /> : null}
            initialSourceId={fonte}
          />
        </ContextPage>
      </PageContainer>
    );
  }

  const memory = await loadContextMemory(actor);
  // Nella riga di stato (§6.3) l'avviso c'è solo se c'è qualcosa da leggere o un «In breve» da scrivere.
  const serviceNotice = consentNotice && consentNoticeNeeded({ unreadSources: memory.counts.unreadSources, brief: memory.brief, material: briefMaterial(memory.sections) }) ? consentNotice : null;
  // Gli appunti in attesa si leggono appena Lateral Space apre la Memoria, e solo con l'ok (senza, c'è l'avviso).
  const pending = lateralSpace && consentNotice === null ? memory.counts.pendingSourceIds : [];

  return (
    <PageContainer size="narrow">
      <ContextPage
        {...shell}
        tab="memoria"
        step={confirm(lateralSpace ? memory.counts.openProposals : 0)}
        menu={contextMenu({ workspaceId, reviewer, toCheck: memory.counts.toCheck, lateralSpace })}
      >
        <MemoryView
          workspaceId={workspaceId}
          today={today}
          lateralSpace={lateralSpace}
          canEditMemory={abilities.canEditMemory}
          memory={memory}
          useCaseOptions={useCaseOptions}
          consentNotice={serviceNotice}
          granola={lateralSpace ? <GranolaInbox workspaceId={workspaceId} workspaceName={workspaceName} compact /> : null}
          reader={pending.length > 0 ? <PendingReader workspaceId={workspaceId} sourceIds={pending} /> : null}
          initialFact={sheetIdParam(search.apri)}
        />
      </ContextPage>
    </PageContainer>
  );
}
