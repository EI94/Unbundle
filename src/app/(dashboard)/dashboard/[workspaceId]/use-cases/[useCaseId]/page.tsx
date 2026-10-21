import { and, asc, eq, isNotNull } from "drizzle-orm";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { notFound } from "next/navigation";
import { canReviewWorkspacePortfolio } from "@/lib/workspace-permissions";
import { db } from "@/lib/db";
import { useCases, workspaceConnectorConfigs } from "@/lib/db/schema";
import { getUseCaseById, getUseCaseKRLinks } from "@/lib/db/queries/use-cases";
import { dossierStateForUseCase, realizationOfUseCase } from "@/lib/db/queries/use-case-dossiers";
import { listUseCaseEvents, USE_CASE_EVENTS_DEFAULT_LIMIT } from "@/lib/db/queries/use-case-events";
import { getUseCaseDetail, viewerFromSession } from "@/lib/db/queries/use-case-hub";
import { abilitiesForUseCase, projectForContributor } from "@/lib/use-cases/permissions";
import type { PhaseInput } from "@/lib/use-cases/phase";
import { romeToday } from "@/lib/use-cases/quarter";
import { isUseCaseHubWorkspace } from "@/lib/use-cases/rollout";
import { reviewTeamName } from "@/lib/review-team";
import { PageContainer } from "@/components/dashboard/page-container";
import { UseCaseDetailView, chapterFromParam, showsRealization } from "@/components/use-cases/detail/detail";
import { guideLabels, type GuideLabels } from "@/components/use-cases/detail/intake-details";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import Link from "next/link";
import { ArrowLeft, ListChecks, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UseCasePortfolioActions } from "@/components/dashboard/use-case-portfolio-actions";

const categoryLabels: Record<string, string> = {
  quick_win: "Quick Win",
  strategic_bet: "Strategic Bet",
  capability_builder: "Capability Builder",
  not_yet: "Not Yet",
};

const statusLabels: Record<string, string> = {
  draft: "Bozza",
  proposed: "Proposto",
  accepted: "Accettato",
  in_progress: "In corso",
  implemented: "Implementato",
  rejected: "Rifiutato",
};


/** «Mostra tutto» della Storia: fino a mille righe (`listUseCaseEvents`). */
const HISTORY_ALL_LIMIT = 1000;

/**
 * Gli use case del workspace che possono essere l'originale di «Doppione di…» (§6.4): solo id,
 * codice e titolo, in ordine di codice. Solo per chi decide.
 */
async function duplicateCandidatesOf(workspaceId: string) {
  return db
    .select({ id: useCases.id, code: useCases.code, title: useCases.title })
    .from(useCases)
    .where(and(eq(useCases.workspaceId, workspaceId), isNotNull(useCases.code)))
    .orderBy(asc(useCases.code));
}

/**
 * I titoli della guida del connettore del workspace, letta una volta (§6.2): le aree (l'elenco
 * da cui si sceglie l'area, se c'è; altrimenti l'area resta un testo libero), gli strumenti e gli
 * agenti del catalogo, per mostrare i titoli e mai le chiavi. Si salva sempre l'id.
 */
async function guideLabelsOf(workspaceId: string): Promise<GuideLabels> {
  const [config] = await db
    .select({ guide: workspaceConnectorConfigs.guide })
    .from(workspaceConnectorConfigs)
    .where(eq(workspaceConnectorConfigs.workspaceId, workspaceId))
    .limit(1);
  return guideLabels(config?.guide);
}

/**
 * `/use-cases/[id]` (docs/use-case/DESIGN.md §2.2, §6; PIANO-LAVORI H4b). Area accesa per il
 * workspace: la scheda con i capitoli per ruolo (`UseCaseDetailView`), con i dati già proiettati
 * sul server (`getUseCaseDetail`). Area spenta: la scheda di oggi.
 *
 * Una scheda che non c'è, di un altro workspace, o nascosta alla ricerca e non sua per un
 * contributore: `notFound()`, cioè «Use case non trovato» (`not-found.tsx`). Sotto `loading.tsx`
 * la risposta è 200 con `noindex`: i test guardano il contenuto, non lo stato.
 */
export default async function UseCaseDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string; useCaseId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceId, useCaseId } = await params;
  if (!isUseCaseHubWorkspace(workspaceId)) return await legacyUseCaseDetail(workspaceId, useCaseId);

  const { session, access } = await requireWorkspacePage(workspaceId);
  const viewer = viewerFromSession(session.user, access.role);
  const abilities = abilitiesForUseCase(viewer);
  if (!abilities.canOpenArea) notFound();
  const result = await getUseCaseDetail(workspaceId, useCaseId, viewer);
  if (!result) notFound();

  const query = (await searchParams) ?? {};
  const chapter = chapterFromParam(query.capitolo);
  const historyAll = query.storia === "tutta";
  const reviewer = result.projection !== "contributore";
  // Il riepilogo ricco del dossier (H6a) solo quando il capitolo «Realizzazione» c'è e la parte
  // del dossier ha risposto: i contributori non lo ricevono (il capitolo non è per loro).
  const readsRealization = reviewer && result.dossierRead === "ok" && showsRealization(result.useCase);
  const [events, candidates, guide, realization] = reviewer
    ? await Promise.all([
        abilities.canSeeHistory ? listUseCaseEvents(workspaceId, result.useCase.id, historyAll ? HISTORY_ALL_LIMIT : USE_CASE_EVENTS_DEFAULT_LIMIT) : null,
        abilities.canDecide ? duplicateCandidatesOf(workspaceId) : [],
        guideLabelsOf(workspaceId),
        readsRealization ? realizationOfUseCase(workspaceId, { userId: session.user.id, role: access.role }, result.useCase.id) : null,
      ])
    : [null, [], null, null];

  return (
    <PageContainer size="default">
      <UseCaseDetailView
        workspaceId={workspaceId}
        result={result}
        abilities={abilities}
        events={events}
        candidates={candidates}
        guide={guide}
        chapter={chapter}
        historyAll={historyAll}
        historyAllHref={`/dashboard/${workspaceId}/use-cases/${result.useCase.id}?storia=tutta#storia`}
        realization={realization}
        teamName={reviewTeamName(access.workspace)}
      />
    </PageContainer>
  );
}

/**
 * La scheda di oggi, con l'area spenta per il workspace (DESIGN §2.2, §12.3): resta com'è, con D4
 * per chi non valuta (H2e). Una funzione chiamata e attesa dalla pagina, non un componente
 * `async` annidato: la pagina resta una funzione che restituisce l'albero già pronto.
 */
async function legacyUseCaseDetail(workspaceId: string, useCaseId: string) {
  const { session, access } = await requireWorkspacePage(workspaceId);
  const useCase = await getUseCaseById(useCaseId);
  if (!useCase || useCase.workspaceId !== workspaceId) notFound();

  if (!canReviewWorkspacePortfolio(access.role)) {
    // D4 e D13 (docs/use-case/DESIGN.md §6.9, §11): chi non valuta vede titolo, fase e
    // «Quando»; delle proprie proposte anche codice e nota pubblica. Niente punteggi,
    // matrice, sotto-punteggi o testi. Una scheda nascosta alla ricerca che non è sua non c'è.
    const read = await dossierStateForUseCase(workspaceId, useCase.id);
    const dossier = read.ok ? read.dossier : null;
    const item = projectForContributor(
      { userId: session.user.id, email: session.user.email, emailVerified: session.user.emailVerified },
      {
        ...useCase,
        intake: useCase.intake as PhaseInput["intake"],
        linkedCaseCode: dossier?.code ?? null,
        dossierStatus: dossier?.status ?? null,
        duplicateOfCode: null,
        today: romeToday(),
      },
    );
    if (!item) notFound();
    return (
      <div className="mx-auto w-full min-w-0 max-w-2xl flex-1 space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <Link href={`/dashboard/${workspaceId}/use-cases`} className="text-sm text-muted-foreground hover:text-foreground">
          ‹ Use Cases
        </Link>
        <div className="space-y-2">
          {item.own && item.code && <div className="font-mono text-sm text-muted-foreground">{item.code}</div>}
          <h1 className="text-3xl font-bold tracking-tight break-words">{item.title}</h1>
          <Badge variant="outline">{item.phaseLabel}</Badge>
        </div>
        {item.own && item.publicNote && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Nota pubblica</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-sm">{item.publicNote}</p>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  const krLinks = await getUseCaseKRLinks(useCaseId);

  // «Avvia caso d'uso» (Casi d'uso, PIANO §5.2): solo con UC_ENABLED e le tabelle
  // uc presenti (to_regclass). Un errore lo registra e la pagina resta com'è.
  const caseLink =
    process.env.UC_ENABLED === "true"
      ? await (await import("@/lib/db/queries/uc-nav")).portfolioCaseLink({
          userId: session.user.id,
          workspaceId,
          role: access.role,
          useCaseId,
          useCaseStatus: useCase.status,
        })
      : null;

  const impactItems = [
    { label: "Economico", value: useCase.impactEconomic },
    { label: "Tempo", value: useCase.impactTime },
    { label: "Qualita'", value: useCase.impactQuality },
    { label: "Coordinamento", value: useCase.impactCoordination },
    { label: "Sociale", value: useCase.impactSocial },
  ];

  const feasibilityItems = [
    { label: "Dati", value: useCase.feasibilityData },
    { label: "Workflow", value: useCase.feasibilityWorkflow },
    { label: "Rischio", value: useCase.feasibilityRisk },
    { label: "Tech", value: useCase.feasibilityTech },
    { label: "Team", value: useCase.feasibilityTeam },
  ];

  const esgItems = [
    { label: "Ambientale", value: useCase.esgEnvironmental, color: "text-green-400" },
    { label: "Sociale", value: useCase.esgSocial, color: "text-blue-400" },
    { label: "Governance", value: useCase.esgGovernance, color: "text-violet-400" },
  ];

  const hasEsg = esgItems.some((i) => (i.value ?? 0) > 0);

  return (
    <div className="mx-auto w-full min-w-0 max-w-4xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
      <Link href={`/dashboard/${workspaceId}/use-cases`}>
        <Button variant="ghost" size="sm" className="mb-4">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Torna al portfolio
        </Button>
      </Link>

      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <Badge variant="outline" className="uppercase text-xs">
            {categoryLabels[useCase.category ?? "not_yet"]}
          </Badge>
          <Badge variant="secondary" className="text-xs">
            {statusLabels[useCase.status]}
          </Badge>
          {useCase.source === "slack_proposed" && (
            <Badge variant="outline" className="text-xs gap-1 border-purple-500/30 text-purple-400">
              <MessageSquare className="h-3 w-3" />
              Proposto via Slack
            </Badge>
          )}
        </div>
        <h1 className="text-3xl font-bold tracking-tight">{useCase.title}</h1>
        <p className="mt-2 text-muted-foreground">{useCase.description}</p>
      </div>

      {/* Stato e quadrante li cambia solo chi valuta: le action rifiutano gli altri ruoli. */}
      {canReviewWorkspacePortfolio(access.role) && (
        <UseCasePortfolioActions
          workspaceId={workspaceId}
          useCaseId={useCaseId}
          initialStatus={useCase.status}
          initialCategory={useCase.category}
        />
      )}

      {caseLink?.existing ? (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Questa scheda ha già un caso d&apos;uso, dove si raccolgono i dati per lo sviluppo.</p>
          <Button render={<Link href={`/dashboard/${workspaceId}/casi-duso/${caseLink.existing.id}`} />} nativeButton={false} variant="outline">
            <ListChecks className="h-4 w-4" />
            Caso d&apos;uso {caseLink.existing.code}
          </Button>
        </div>
      ) : caseLink?.canStart ? (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">La scheda è accettata: avvia il caso d&apos;uso per spiegarlo e raccogliere i dati dal cliente.</p>
          <Button render={<Link href={`/dashboard/${workspaceId}/casi-duso/nuovo?useCaseId=${useCaseId}`} />} nativeButton={false}>
            <ListChecks className="h-4 w-4" />
            Avvia caso d&apos;uso
          </Button>
        </div>
      ) : null}

      {krLinks.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Collegamenti a Key Result</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {krLinks.length === 1
                ? "Un collegamento a obiettivi strategici (KR)."
                : `${krLinks.length} collegamenti a obiettivi strategici (KR).`}
            </p>
          </CardContent>
        </Card>
      )}

      <div className={`grid gap-4 mb-8 ${hasEsg ? "grid-cols-4" : "grid-cols-3"}`}>
        <Card>
          <CardContent className="pt-4 text-center">
            <div className="text-3xl font-bold text-primary">
              {useCase.overallImpactScore?.toFixed(1)}
            </div>
            <p className="text-sm text-muted-foreground">Impatto</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <div className="text-3xl font-bold text-primary">
              {useCase.overallFeasibilityScore?.toFixed(1)}
            </div>
            <p className="text-sm text-muted-foreground">Fattibilita&apos;</p>
          </CardContent>
        </Card>
        {hasEsg && (
          <Card>
            <CardContent className="pt-4 text-center">
              <div className="text-3xl font-bold text-green-400">
                {useCase.overallEsgScore?.toFixed(1) ?? "-"}
              </div>
              <p className="text-sm text-muted-foreground">ESG</p>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardContent className="pt-4 text-center">
            <div className="text-3xl font-bold">
              {useCase.overallScore?.toFixed(1)}
            </div>
            <p className="text-sm text-muted-foreground">Score totale</p>
          </CardContent>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Business Case</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm whitespace-pre-wrap">{useCase.businessCase}</p>
        </CardContent>
      </Card>

      {useCase.flowDescription && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Flusso (As-Is → To-Be)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{useCase.flowDescription}</p>
          </CardContent>
        </Card>
      )}

      {(useCase.humanInTheLoop || useCase.guardrails || useCase.dataRequirements) && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {useCase.humanInTheLoop && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Human in the Loop</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">{useCase.humanInTheLoop}</p>
              </CardContent>
            </Card>
          )}
          {useCase.guardrails && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Guardrail</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">{useCase.guardrails}</p>
              </CardContent>
            </Card>
          )}
          {useCase.dataRequirements && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Dati Necessari</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">{useCase.dataRequirements}</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-6 mb-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Scoring Impatto</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {impactItems.map((item) => (
              <div key={item.label}>
                <div className="flex justify-between text-sm mb-1">
                  <span>{item.label}</span>
                  <span className="font-mono">{item.value ?? 0}/5</span>
                </div>
                <Progress
                  value={((item.value ?? 0) / 5) * 100}
                  className="h-2"
                />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Scoring Fattibilita&apos;
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {feasibilityItems.map((item) => (
              <div key={item.label}>
                <div className="flex justify-between text-sm mb-1">
                  <span>{item.label}</span>
                  <span className="font-mono">{item.value ?? 0}/5</span>
                </div>
                <Progress
                  value={((item.value ?? 0) / 5) * 100}
                  className="h-2"
                />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {hasEsg && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">ESG Impact</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {esgItems.map((item) => (
              <div key={item.label}>
                <div className="flex justify-between text-sm mb-1">
                  <span className={item.color}>{item.label}</span>
                  <span className="font-mono">{item.value ?? 0}/5</span>
                </div>
                <Progress
                  value={((item.value ?? 0) / 5) * 100}
                  className="h-2"
                />
              </div>
            ))}
            <Separator className="my-2" />
            <div className="flex justify-between text-sm font-medium">
              <span>Score ESG complessivo</span>
              <span className="font-mono">
                {useCase.overallEsgScore?.toFixed(1) ?? "-"}/5
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {useCase.requirements && (useCase.requirements as string[]).length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Requisiti</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc list-inside space-y-1 text-sm">
              {(useCase.requirements as string[]).map((req, i) => (
                <li key={i}>{req}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {useCase.timeline && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{useCase.timeline}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
