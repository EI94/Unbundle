import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight, FileText } from "lucide-react";
import { PageContainer } from "@/components/dashboard/page-container";
import { SegmentedNav } from "@/components/dashboard/segmented-nav";
import { Fold } from "@/components/ui-10/fold";
import { Why } from "@/components/ui-10/why";
import { casePath } from "@/components/uc/catalog/paths";
import { RulesPanel } from "@/components/uc/catalog/rules-panel";
import { ProcessBoard } from "@/components/uc/map/process-board";
import { StepPanelContent } from "@/components/uc/map/step-panel";
import { canWrite, loadCaseHead, openShellPage } from "@/components/uc/shell/case-data";
import { BlockEditButton, type BlockEditorConfig } from "@/components/uc/shell/description-editor";
import { BlockContent, DescriptionSection, VersionsList } from "@/components/uc/shell/description-view";
import { DetailSheet } from "@/components/uc/ui/detail-sheet";
import { EmptyState } from "@/components/uc/ui/empty-state";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { loadSolutionDescription, loadSolutionMap, loadSolutionRules, rulePresenceSql } from "@/lib/db/queries/uc-solution";
import { workspaceAgentToneOf } from "@/lib/db/queries/use-case-hub";
import { rowNumber } from "@/lib/uc/sql/readiness";
import {
  askedVersion,
  blockRaw,
  blockTitle,
  blockValueForEditor,
  descriptionAtVersion,
  descriptionBlockDef,
  descriptionVersions,
  descriptionView,
  stableJson,
  type DescriptionBlockView,
} from "@/lib/uc/views/description";
import { formatDayIt, formatLongDayIt } from "@/lib/uc/views/format";
import { hasAgentProcess, mapItemTitles, mapPageViews, resolveMapPageView, type MapPageView, type ProcessStepView, type SolutionNodeView } from "@/lib/uc/views/map";
import { flowOrder } from "@/lib/uc/views/map-layout";
import { parseRulesQuery } from "@/lib/uc/views/model";
import { canOpenPage } from "@/lib/uc/views/page-access";
import { RULES_PANEL, SOLUTION_TEXT as T, boardSteps, solutionLinksFor, solutionViewHref, stepFromPanel, stepPanelHref } from "@/lib/uc/views/solution";
import { audienceFor, isLsViewer } from "@/lib/uc/views/status-groups";
import type { AgentTone } from "@/lib/use-cases/agents";
import { canReviewWorkspacePortfolio } from "@/lib/workspace-permissions";

function first(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && s ? s : null;
}

/** Il colore dell'agente dello use case, come nella sua scheda: solo ai revisori; una lettura che non riesce lascia il colore del testo. */
async function agentToneOf(workspaceId: string, title: string | null, reviewer: boolean): Promise<AgentTone | null> {
  if (!reviewer || !title) return null;
  try {
    return await workspaceAgentToneOf(workspaceId, title);
  } catch (error) {
    console.error("[soluzione] agent_tone_failed", { error: { name: error instanceof Error ? error.name : "Error" } });
    return null;
  }
}

/**
 * Soluzione (rilascio 10, docs/ui-10/PROPOSTA-10.md §3.5): una pagina di lettura, una colonna. In breve · Il problema
 * di oggi · La soluzione · «Come funziona» · Cosa non fa · Altro (chiuso). «Come funziona» disegna i passi come la
 * board, in sola lettura (`ProcessBoard`), con «Oggi | Con l'AI» e l'esempio dall'inizio alla fine (`?vista=`); un
 * passo si apre nel suo pannello (`?apri=passo-<id>`). Senza mappa, «Come funziona» è l'elenco dei passi della
 * descrizione; con la mappa quell'elenco si vede solo a chi modifica. In fondo «Regole · N ›» (il pannello
 * `?apri=regole`, dove sono finite le regole) e, per Lateral Space e lo sviluppo, «Vista di analisi ›» e «Modello dati
 * ›», le due pagine senza scheda. Il controllo «Descrizione · Mappa · Regole · Dati» non c'è più.
 *
 * Il responsabile Lateral Space modifica i blocchi (`?modifica=1`, «Completa la descrizione»); Lateral Space legge le
 * versioni (`?apri=versioni`, `?versione=N`). Letture in parallelo: descrizione, mappe (per chi apre la mappa), il
 * numero delle regole e, con il pannello aperto, la pagina di regole; il colore dell'agente come nella scheda.
 */
export default async function SolutionPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string; caseId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceId, caseId } = await params;
  const { session, access } = await requireWorkspacePage(workspaceId);
  const { caseAccess, executor } = await openShellPage({ workspaceId, caseId, session, access, page: "descrizione" });
  const { header } = await loadCaseHead(workspaceId, caseId, session.user.id, access.role);
  const sp = await searchParams;
  const roles = caseAccess.roles;
  const ls = isLsViewer(roles);
  const audience = audienceFor(roles);
  const viewer = { workspaceId, caseId, roles, user: caseAccess.user, readOnly: caseAccess.readOnly };
  const apri = first(sp.apri);
  const canMap = canOpenPage("mappa", roles);
  const canRules = canOpenPage("regole", roles);
  const rulesOpen = canRules && apri === RULES_PANEL;
  // Il pannello delle regole: `regola=<id>` è la regola aperta; i vincoli solo per Lateral Space (F-090).
  const rulesQuery = rulesOpen ? parseRulesQuery({ ...sp, apri: first(sp.regola) ?? undefined }) : null;
  const [data, mapData, rules, rulesCount, agentTone] = await Promise.all([
    loadSolutionDescription(executor, { workspaceId, caseId }),
    canMap ? loadSolutionMap(executor, viewer) : Promise.resolve(null),
    rulesQuery ? loadSolutionRules(executor, viewer, ls ? rulesQuery : { ...rulesQuery, vincoli: false }) : Promise.resolve(null),
    canRules ? executor.batch([rulePresenceSql(caseId)]).then(([rows]) => ({ rules: rowNumber(rows[0]?.rules) ?? 0, constraints: rowNumber(rows[0]?.constraints) ?? 0 })) : Promise.resolve(null),
    agentToneOf(workspaceId, header.parent?.title ?? null, canReviewWorkspacePortfolio(access.role)),
  ]);
  if (!data) notFound();

  // Le versioni (autori, blocchi cambiati) restano a Lateral Space (DESIGN §3.7.1, §6.1): il cliente legge solo quella attuale.
  const versions = descriptionVersions(data.description, data.history);
  const shownVersion = ls ? askedVersion(sp.versione, versions[0].version) : null;
  const shown = shownVersion !== null ? descriptionAtVersion(data.description, data.history, shownVersion) : data.description;
  if (!shown) notFound();

  // In pausa e a caso chiuso i controlli di scrittura non ci sono (DESIGN §3.3).
  const canEdit = shownVersion === null && roles.includes("ls_lead") && canWrite(caseAccess) && caseAccess.status !== "sospeso";
  const editing = canEdit && first(sp.modifica) === "1";
  const view = descriptionView(shown, { audience, includeEmpty: editing });
  const base = casePath(workspaceId, caseId, "soluzione");
  const all = canEdit ? descriptionView(shown, { audience: "ls", includeEmpty: true }) : null;
  const hasEmpty = all ? [...all.main, ...all.more].some((b) => b.empty) : false;

  const editorFor = (key: string): BlockEditorConfig | null => {
    if (!canEdit) return null;
    const def = descriptionBlockDef(key);
    if (!def) return null;
    return {
      workspaceId,
      caseId,
      blockKey: def.key,
      title: def.title,
      kind: def.kind,
      fields: def.fields ?? [],
      hint: def.hint ?? null,
      value: blockValueForEditor(def, blockRaw(def, shown)),
      base: stableJson(shown[def.key] ?? null),
    };
  };
  const section = (b: DescriptionBlockView, level: "h2" | "h3") => (
    <DescriptionSection key={b.def.key} title={b.def.title} level={level} editor={editorFor(b.def.key)} editing={editing} empty={b.empty} addLabel={b.def.add}>
      <BlockContent blockKey={b.def.key} content={b.content} perimeterLabel={data.perimeterLabel} />
    </DescriptionSection>
  );
  const block = (key: string) => view.main.find((b) => b.def.key === key) ?? null;

  // ── «Come funziona»: il processo disegnato come la board ──
  const maps = mapData?.maps ?? null;
  const views = maps ? mapPageViews(maps) : [];
  const mapView: MapPageView | null = maps ? resolveMapPageView(first(sp.vista), views) : null;
  const stepsOf = (v: MapPageView): readonly (ProcessStepView | SolutionNodeView)[] =>
    !maps
      ? []
      : v === "con-agente"
        ? maps.toBe && hasAgentProcess(maps)
          ? maps.toBe.steps
          : maps.solution
            ? flowOrder(maps.solution.nodes, maps.solution.edges)
            : []
        : v === "oggi"
          ? (maps.asIs?.steps ?? [])
          : (maps.example?.steps ?? []);
  const rawSteps = mapView ? stepsOf(mapView) : [];
  const steps = mapView ? boardSteps(mapView, rawSteps) : [];
  const drawn = mapView !== null && steps.length > 0;
  const segments = views.filter((v): v is Exclude<MapPageView, "esempio"> => v !== "esempio").map((v) => ({ key: v, label: T.views[v], href: solutionViewHref(base, v) }));
  const openStepId = mapView ? stepFromPanel(apri) : null;
  const openStep = openStepId ? (rawSteps.find((s) => s.id === openStepId) ?? null) : null;
  const titles = maps ? mapItemTitles(maps) : new Map<string, string>();

  const current = versions[0];
  const lastChange = ls && versions.length > 1 ? formatDayIt(current.createdAt, { now: new Date() }) : null;
  const versionsOpen = ls && apri === "versioni" && versions.length > 1;
  const pageHref = shownVersion !== null ? `${base}?versione=${shownVersion}` : base;
  const inBreve = editorFor("in_breve");
  const hasMore = view.more.length > 0 || view.extras.length > 0;
  const howBlock = block("come_funziona");
  const exampleBlock = block("esempio");

  // ── In fondo: le regole e, per Lateral Space e lo sviluppo, le due pagine senza scheda ──
  const links = solutionLinksFor(roles);
  const rulesShown = rulesCount !== null && (rulesCount.rules > 0 || (ls && rulesCount.constraints > 0));
  const analysisShown = links.analysis && (maps?.solution?.nodes.length ?? 0) > 0;
  const bottom = [
    rulesShown ? { key: "regole", label: T.rules(rulesCount!.rules), href: `${base}?apri=${RULES_PANEL}` } : null,
    analysisShown ? { key: "analisi", label: T.analysis, href: casePath(workspaceId, caseId, "soluzione/mappa") } : null,
    links.dataModel ? { key: "dati", label: T.dataModel, href: casePath(workspaceId, caseId, "soluzione/dati") } : null,
  ].filter((l): l is { key: string; label: string; href: string } => l !== null);

  return (
    <PageContainer>
      <div className="max-w-3xl min-w-0 space-y-8">
        {shownVersion !== null && (
          <p className="rounded-xl bg-muted/50 p-3 text-sm ring-1 ring-foreground/10">
            {T.oldVersion(shownVersion)}{" "}
            <Link href={base} className="font-medium underline underline-offset-4">
              {T.backToCurrent}
            </Link>
          </p>
        )}

        {view.empty && !editing && !drawn ? (
          <EmptyState
            variant="page"
            icon={FileText}
            title={T.noDescription}
            action={inBreve ? <BlockEditButton editor={inBreve} variant="scrivi" label={descriptionBlockDef("in_breve")?.add ?? "Scrivi «In breve»"} /> : undefined}
          />
        ) : (
          <>
            {view.main.filter((b) => b.def.key === "in_breve" || b.def.key === "problema" || b.def.key === "soluzione").map((b) => section(b, "h2"))}

            {drawn ? (
              <section id={T.howId} aria-labelledby="come-funziona-titolo" className="min-w-0 scroll-mt-40 space-y-3">
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                  <h2 id="come-funziona-titolo" className="text-base font-semibold">
                    {T.howTitle}
                  </h2>
                  <div className="flex min-w-0 items-center gap-1">
                    {mapView !== "esempio" && segments.length > 1 ? <SegmentedNav size="sm" ariaLabel={T.viewsLabel} active={mapView} items={segments} /> : null}
                    <Why id="come-funziona-legenda" text={T.legend(audience)} label={T.legendLabel} />
                  </div>
                </div>
                {mapView === "esempio" ? (
                  <div className="space-y-1">
                    <Link href={solutionViewHref(base, "con-agente")} scroll={false} className="inline-flex min-h-11 items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground sm:min-h-0">
                      <ChevronLeft className="size-4" aria-hidden />
                      {T.backToProcess}
                    </Link>
                    <h3 className="text-sm font-semibold">{T.exampleTitle}</h3>
                  </div>
                ) : null}
                <ProcessBoard steps={steps} hrefFor={(id) => stepPanelHref(base, mapView!, id)} agentTone={agentTone} audience={audience} label={mapView === "esempio" ? T.exampleTitle : T.howTitle} />
                {mapView !== "esempio" && views.includes("esempio") ? (
                  <Link href={solutionViewHref(base, "esempio")} scroll={false} className="inline-flex min-h-11 items-center gap-0.5 text-sm font-medium hover:underline sm:min-h-0">
                    {T.example}
                    <ChevronRight className="size-4" aria-hidden />
                  </Link>
                ) : null}
                {exampleBlock ? section(exampleBlock, "h3") : null}
                {editing && howBlock ? section(howBlock, "h3") : null}
              </section>
            ) : (
              <>
                {howBlock ? section(howBlock, "h2") : null}
                {exampleBlock ? section(exampleBlock, "h2") : null}
              </>
            )}

            {view.main.filter((b) => b.def.key === "cosa_non_fa").map((b) => section(b, "h2"))}

            {hasMore && (
              <Fold id="altro" title={T.more} defaultOpen={editing}>
                {view.more.map((b) => section(b, "h3"))}
                {view.extras.map((x) => (
                  <section key={x.key} className="min-w-0 space-y-2">
                    <h3 className="text-sm font-semibold break-words">{x.title}</h3>
                    <ul className="list-disc space-y-1.5 pl-5 text-sm">
                      {x.lines.map((l, i) => (
                        <li key={i} className="pl-1 break-words">
                          {l}
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </Fold>
            )}
          </>
        )}

        {bottom.length > 0 && (
          <ul aria-label={T.partsLabel} className="divide-y divide-border border-y border-border">
            {bottom.map((l) => (
              <li key={l.key}>
                <Link href={l.href} scroll={l.key !== "regole"} className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm font-medium hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
                  <span>{l.label}</span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}

        {(lastChange || (canEdit && (hasEmpty || editing))) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {lastChange && (
              <p>
                {T.changedOn(lastChange)}{" "}
                <Link href={`${pageHref}${pageHref.includes("?") ? "&" : "?"}apri=versioni`} scroll={false} className="inline-flex min-h-11 items-center underline-offset-4 hover:text-foreground hover:underline sm:min-h-0">
                  {T.versions} ›
                </Link>
              </p>
            )}
            {canEdit && editing && (
              <Link href={base} className="inline-flex min-h-11 items-center underline-offset-4 hover:text-foreground hover:underline sm:min-h-0">
                {T.editDone}
              </Link>
            )}
            {canEdit && !editing && hasEmpty && !view.empty && (
              <Link href={`${base}?modifica=1`} className="inline-flex min-h-11 items-center underline-offset-4 hover:text-foreground hover:underline sm:min-h-0">
                {T.editComplete}
              </Link>
            )}
          </div>
        )}
      </div>

      {versionsOpen && (
        <DetailSheet title={T.versionsTitle} closeHref={pageHref}>
          <VersionsList
            versions={versions}
            shownVersion={shownVersion}
            authorOf={(id) => (id ? (data.authors.get(id) ?? "Persona di Lateral Space") : null)}
            dayOf={(iso) => formatLongDayIt(iso)}
            changedText={(v) => (v.changed.length > 0 ? `Cambiati: ${v.changed.map(blockTitle).join(", ")}` : null)}
            readHref={(v) => (v.current ? base : `${base}?versione=${v.version}`)}
          />
        </DetailSheet>
      )}

      {openStep && mapView && (
        <DetailSheet title={openStep.label} description={T.step(rawSteps.indexOf(openStep) + 1)} closeHref={solutionViewHref(base, mapView)}>
          <StepPanelContent workspaceId={workspaceId} caseId={caseId} step={openStep} titles={titles} audience={audience} roles={roles} />
        </DetailSheet>
      )}

      {rules && rulesQuery && (
        <RulesPanel workspaceId={workspaceId} caseId={caseId} base={base} sp={sp} query={ls ? rulesQuery : { ...rulesQuery, vincoli: false }} data={rules} audience={audience} roles={roles} />
      )}
    </PageContainer>
  );
}
