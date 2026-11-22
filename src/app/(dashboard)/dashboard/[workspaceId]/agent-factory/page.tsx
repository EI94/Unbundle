import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PAGE_TITLE_CLASS, PageContainer } from "@/components/dashboard/page-container";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { factoryNavVisible, loadFactoryOverview } from "@/lib/db/queries/use-case-factory-line";
import { factoryStoreReady } from "@/lib/db/queries/use-case-factory";
import { cliStoreReady } from "@/lib/db/queries/use-case-cli-auth";
import { viewerFromSession, workspaceAgentPaletteOf } from "@/lib/db/queries/use-case-hub";
import { ucLsDomains } from "@/lib/db/queries/uc-access";
import { getAppUcExecutor } from "@/lib/db/uc-executor";
import { getWorkspaceById } from "@/lib/db/queries/workspaces";
import { abilitiesForUseCase } from "@/lib/use-cases/permissions";
import { isUseCaseHubWorkspace } from "@/lib/use-cases/rollout";
import { canManageWorkspaceCollaborators, canReviewWorkspacePortfolio } from "@/lib/workspace-permissions";
import { externalRefusals, listBuilders, listWhereChoices } from "@/lib/db/queries/use-case-workspace-team";
import { loadMemberCandidates } from "@/lib/db/queries/uc-shell";
import { logSafeError } from "@/lib/log/safe-error";
import type { FactoryBuildersData } from "@/components/agent-factory/builders-panel";
import { readCiFamilies } from "@/components/agent-factory/ci-load";
import type { CiFamilyRow } from "@/components/agent-factory/ci-view";
import { FactoryScreen } from "@/components/agent-factory/factory-screen";
import { FACTORY_TEXT } from "@/components/agent-factory/factory-text";
import { factoryScreenModel, stationOfParam } from "@/components/agent-factory/factory-view";

/**
 * «Agent Factory» (rilascio 8.1a, docs/rilascio-8/RILASCIO-8.1-COSTRUZIONE.md §2; rilascio 10, ondata 6b,
 * docs/ui-10/PROPOSTA-10.md §3.6 e prototipo S5): i casi di un cliente dall'impostazione all'uso, con lo stesso contesto
 * per tutti quelli che ci lavorano.
 *
 * - Il prossimo passo è la prima voce di «Da fare per te», il solo pulsante pieno; sotto, al massimo tre voci e «Altre
 *   N». Solo le tue cose, con il link dove si agisce; i comandi della CLI stanno lì, non nella riga.
 * - «La linea»: un filtro per stazione (`?stazione=`), senza zeri.
 * - Le famiglie (i repository), con un nome di parole e repository e versioni nei «Dettagli»; una riga per caso, con
 *   il tag dell'agente, la stazione, il prossimo passo e la qualità delle evals. Mai una cifra per persona.
 * - Il pannello del caso (`?apri=<codice>`): compiti, modifiche, sessioni, costi, evals e banco (8.1b, 8.2a); senza
 *   repository il comando che lo crea.
 * - (8.1b, 8.0c) «Chi costruisce», un pannello dal «⋯», solo per il manager di Lateral Space: il team di Lateral Space
 *   del cliente e chi costruisce da fuori, «Sviluppatore esterno», con il suo «Dove»; «Togli» chiede conferma con i
 *   casi e i repository di GitHub (da togliere a mano). (Ondata 6b) «Aggiungi» accetta anche un'e-mail nuova, a chi
 *   può invitare nel workspace: crea l'invito come Analista.
 * - «Repository da aggiornare» (prima «la coda»), un pannello dal «⋯», solo per il manager.
 * - (8.2b) Sotto i casi di ogni famiglia la riga della CI: lo stato della chiave per tutti quelli che vedono la
 *   famiglia; «Collega la CI», «Ruota» e «Revoca» solo a chi gestisce le chiavi del repository (D6), con le finestre
 *   dell'app e la chiave che si vede una volta. In «Da fare per te», solo a loro, la chiave nuova da mettere su GitHub,
 *   quella in scadenza e la CI da collegare, con il link alla famiglia. La conferma di «Togli» per chi costruisce da
 *   fuori chiede di ruotare le chiavi vive dei suoi repository.
 *
 * La vede chi costruisce (ruolo di Lateral Space nel team di un caso o, 8.0c, da fuori con il predicato unico), con i
 * suoi casi, e il manager del workspace di Lateral Space, con tutti. Agli altri: 404.
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Agent Factory" };

export default async function AgentFactoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceId } = await params;
  const { session, access } = await requireWorkspacePage(workspaceId);
  if (!isUseCaseHubWorkspace(workspaceId) || process.env.UC_ENABLED !== "true") notFound();
  const viewer = viewerFromSession(session.user, access.role);
  const lsManager = viewer.isLateralSpace && canReviewWorkspacePortfolio(access.role);
  const executor = await getAppUcExecutor();
  const lsDomains = ucLsDomains();
  if (!(await factoryNavVisible(executor, { workspaceId, userId: session.user.id, lsManager, lsDomains }))) notFound();
  // La pagina legge le tabelle della 0030 e della 0031: finché non ci sono (il primo avvio dopo un rilascio), lo dice.
  const [factoryReady, cliReady] = await Promise.all([factoryStoreReady(executor), cliStoreReady(executor)]);
  if (!factoryReady || !cliReady) {
    return (
      <PageContainer>
        <h1 className={PAGE_TITLE_CLASS}>{FACTORY_TEXT.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{FACTORY_TEXT.notReady}</p>
      </PageContainer>
    );
  }
  const search = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
  const view = await loadFactoryOverview(executor, { workspaceId, userId: session.user.id, seeAll: lsManager, canSeeNeeds: abilitiesForUseCase(viewer).canSeeNeeds, lsDomains });
  const [builders, candidates, choices, workspace, palette] = await Promise.all([
    lsManager ? listBuilders(executor, workspaceId, lsDomains) : Promise.resolve(null),
    lsManager ? loadMemberCandidates(executor, { workspaceId, lsDomains }) : Promise.resolve([]),
    lsManager ? listWhereChoices(executor, workspaceId) : Promise.resolve([]),
    getWorkspaceById(workspaceId),
    // I toni degli agenti: gli stessi delle card degli use case. Senza, i tag restano neutri.
    workspaceAgentPaletteOf(workspaceId).catch((error) => {
      logSafeError("agent-factory", "tavolozza_non_letta", error, { workspaceId });
      return null;
    }),
  ]);
  // (8.0c) Chi da fuori oggi «Aggiungi» rifiuterebbe (Contributore, e-mail da verificare): si vede, non si sceglie.
  const refused = lsManager
    ? await externalRefusals(
        executor,
        workspaceId,
        candidates.filter((c) => !c.isLateralSpace).map((c) => c.userId),
        lsDomains,
      )
    : new Map<string, string>();
  // (8.2b) La CI delle famiglie: lo stato per tutti, i pulsanti e «Da fare per te» solo a chi gestisce le chiavi. Una
  // lettura che non riesce non fa cadere la pagina: la riga dice «Non ancora disponibile».
  const ci = await readCiFamilies(executor, {
    workspaceId,
    userId: session.user.id,
    isLateralSpace: viewer.isLateralSpace,
    lsDomains,
    families: view.families.flatMap((f) => (f.repo ? [f.repo] : [])),
  });
  const model = factoryScreenModel({
    workspaceId,
    manager: lsManager,
    overview: view,
    ciTodos: ci.todos,
    palette,
    station: stationOfParam(one(search.stazione)),
    clientName: workspace?.name ?? "",
    now: new Date(),
  });
  const buildersData: FactoryBuildersData | null = builders
    ? {
        rows: builders,
        candidates: candidates.map((c) => ({ userId: c.userId, name: c.name, isLateralSpace: c.isLateralSpace, blocked: c.isLateralSpace ? null : (refused.get(c.userId) ?? null) })),
        choices,
        ciLive: [...ci.liveRepos],
        canInvite: canManageWorkspaceCollaborators(access.role),
      }
    : null;
  const ciRows: Record<string, CiFamilyRow> = Object.fromEntries(ci.rows);

  return <FactoryScreen model={model} initialPanel={one(search.apri)} builders={buildersData} ciRows={ciRows} />;
}
