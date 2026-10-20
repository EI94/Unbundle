import Link from "next/link";
import { notFound } from "next/navigation";
import { Scale } from "lucide-react";
import { PageContainer } from "@/components/dashboard/page-container";
import { openCaseView } from "@/components/uc/catalog/case-page";
import { ListPagination, RuleDetail } from "@/components/uc/catalog/model-sections";
import { casePath } from "@/components/uc/catalog/paths";
import { RulesList, RulesToolbar } from "@/components/uc/catalog/rules-browser";
import { DetailSheet } from "@/components/uc/ui/detail-sheet";
import { EmptyState } from "@/components/uc/ui/empty-state";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { loadSolutionRules } from "@/lib/db/queries/uc-solution";
import { readableTitle } from "@/lib/uc/views/description";
import { KIND_LABEL } from "@/lib/uc/views/labels";
import { PERIMETER_PARAM, parseRulesQuery, ruleGroupHeading, rulesFiltered, solutionHref, solutionPageHrefs } from "@/lib/uc/views/model";
import { STATUS_GROUP_SLUG, audienceFor, statusView } from "@/lib/uc/views/status-groups";
import { SolutionNav } from "../_parts/solution-nav";

/**
 * Soluzione › Regole (DESIGN §3.7.3): regole raggruppate per «Chi la
 * conferma», cercate, filtrate e paginate sul server (`?q=&stato=&perimetro=
 * &vincoli=1&pagina=`); il pannello (`?apri=<id>`) ha le parole semplici in
 * vista e il resto in «Dettagli tecnici».
 *
 * Un giro solo (`loadSolutionRules`), regola aperta compresa.
 */
export default async function SolutionRulesPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string; caseId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceId, caseId } = await params;
  const { session, access } = await requireWorkspacePage(workspaceId);
  const { executor, viewer } = await openCaseView({ workspaceId, caseId, session, access, page: "regole" });
  const sp = await searchParams;
  const query = parseRulesQuery(sp);
  const data = await loadSolutionRules(executor, viewer, query);
  if (!data) notFound();

  const audience = audienceFor(viewer.roles);
  const base = casePath(workspaceId, caseId, "soluzione/regole");
  const filtered = rulesFiltered(query);
  const groups = data.groups.map((g) => ({
    key: g.roleKey ?? "nessuno",
    heading: ruleGroupHeading(g),
    rows: g.rows.map((r) => {
      const sv = statusView(r.status, audience);
      return { id: r.id, title: r.title, status: { tone: sv.tone, label: sv.label }, href: solutionHref(base, sp, { apri: r.id }) };
    }),
  }));
  const closeHref = solutionHref(base, sp, { apri: null });
  const clearHref = solutionHref(base, {}, { vincoli: query.vincoli ? "1" : null });

  return (
    <PageContainer>
      <SolutionNav workspaceId={workspaceId} caseId={caseId} roles={viewer.roles} active="regole" />
      {!data.hasRules && !data.hasConstraints ? (
        <EmptyState variant="page" icon={Scale} title="Lo schema di partenza non ha regole." />
      ) : (
        <div className="min-w-0">
          <RulesToolbar
            q={query.q}
            stato={query.stato ? STATUS_GROUP_SLUG[query.stato] : null}
            perimetro={query.perimetro ? PERIMETER_PARAM[query.perimetro] : null}
            vincoli={query.vincoli}
            hasConstraints={data.hasConstraints}
            audience={audience}
          />
          {data.total === 0 ? (
            filtered ? (
              <EmptyState
                title={query.q ? `Nessuna regola trovata per “${query.q}”.` : "Nessuna regola con questi filtri."}
                action={
                  <Link href={clearHref} className="inline-flex min-h-11 items-center text-sm font-medium underline-offset-4 hover:underline sm:min-h-8">
                    Togli i filtri
                  </Link>
                }
              />
            ) : (
              <EmptyState title="Lo schema di partenza non ha regole." />
            )
          ) : groups.length === 0 ? (
            <EmptyState
              title="Questa pagina è vuota."
              action={
                <Link href={solutionHref(base, sp, { pagina: null, apri: null })} className="inline-flex min-h-11 items-center text-sm font-medium underline-offset-4 hover:underline sm:min-h-8">
                  Torna alla prima pagina
                </Link>
              }
            />
          ) : (
            <>
              <RulesList groups={groups} allOpen={filtered} />
              <ListPagination page={data.page} pages={data.pages} {...solutionPageHrefs(base, sp, data.page, data.pages)} />
            </>
          )}
        </div>
      )}

      {data.open && (
        <DetailSheet title={readableTitle(data.open.title, audience, KIND_LABEL[data.open.kind].one)} status={statusView(data.open.status, audience)} closeHref={closeHref}>
          <RuleDetail workspaceId={workspaceId} caseId={caseId} rule={data.open} roles={viewer.roles} />
        </DetailSheet>
      )}
    </PageContainer>
  );
}
