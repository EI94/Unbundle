import Link from "next/link";
import { notFound } from "next/navigation";
import { History } from "lucide-react";
import { PageContainer } from "@/components/dashboard/page-container";
import { buttonVariants } from "@/components/ui/button";
import { casePath } from "@/components/uc/catalog/paths";
import { ActivityCsvLink, ActivityPagination, ActivityTimeline, DailyAnswerBars } from "@/components/uc/progress/audit-log";
import { loadCaseHead } from "@/components/uc/shell/case-data";
import { EmptyState } from "@/components/uc/ui/empty-state";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { ucLsDomains } from "@/lib/db/queries/uc-access";
import { loadActivityPage } from "@/lib/db/queries/uc-events";
import { activeAuditFilters, activityDays, auditFamiliesFor, auditQuery, auditWhoFor, dailyAnswerBars, parseAuditFilter } from "@/lib/uc/views/audit";
import { canOpenShellPage, seesFilteredAudit } from "@/lib/uc/views/case-shell";
import { cn } from "@/lib/utils";
import { ActivityFilter } from "./activity-filter";

/**
 * Attività (DESIGN §3.12, PIANO §7.2, §3.3): una linea del tempo per giorno,
 * 50 eventi per pagina, «Filtra» (tipo, chi, periodo) e «Scarica CSV» con gli
 * stessi filtri. Il responsabile Lateral Space vede tutto. Per i ruoli del
 * cliente (responsabile del cliente, approvatore privacy) il filtro dell'art.
 * 15.4 sta nella query, anche nel CSV: niente eventi dei referenti, aperture di
 * link o informativa vista; al loro posto le risposte ricevute contate per
 * giorno, solo dai 5 in su. L'attività resta anche dopo la chiusura del caso.
 */
export default async function ActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string; caseId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceId, caseId } = await params;
  const { session, access } = await requireWorkspacePage(workspaceId);
  const { caseAccess, executor } = await loadCaseHead(workspaceId, caseId, session.user.id, access.role);
  if (!canOpenShellPage("registro", caseAccess.roles)) notFound();
  const clientView = seesFilteredAudit(caseAccess.roles);
  const filter = parseAuditFilter(await searchParams, clientView);
  const page = await loadActivityPage(executor, { workspaceId, caseId: caseAccess.caseId, filter, clientView, lsDomains: ucLsDomains() });
  const now = new Date();
  const days = activityDays(page.rows, { now, audience: clientView ? "cliente" : "ls" });
  const bars = page.daily ? dailyAnswerBars(page.daily, now) : [];
  const basePath = casePath(workspaceId, caseId, "attivita");
  const csvHref = `${casePath(workspaceId, caseId, "attivita/csv")}${auditQuery({ ...filter, pagina: 1 })}`;
  const filtered = activeAuditFilters(filter) > 0;

  return (
    <PageContainer>
      <div className="max-w-4xl space-y-8">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">Attività</h2>
            {clientView && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Le azioni dei referenti non compaiono: vedi solo quante risposte arrivano ogni giorno.</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <ActivityFilter
              basePath={basePath}
              families={auditFamiliesFor(clientView)}
              who={auditWhoFor(clientView)}
              values={{ tipo: filter.famiglia, chi: filter.chi, attore: filter.attore, dal: filter.dal, al: filter.al }}
            />
            {(page.total > 0 || bars.length > 0) && <ActivityCsvLink href={csvHref} />}
          </div>
        </div>

        {clientView && page.daily && (
          <section aria-labelledby="uc-attivita-risposte" className="space-y-3">
            <h3 id="uc-attivita-risposte" className="text-sm font-medium">
              Risposte ricevute
            </h3>
            <DailyAnswerBars bars={bars} />
          </section>
        )}

        {page.total === 0 ? (
          bars.length > 0 ? (
            // Le barrette dicono già che le risposte arrivano: qui manca solo il resto.
            <p className="text-sm text-muted-foreground">{filtered ? "Nessun'altra attività con questi filtri." : "Nessun'altra attività."}</p>
          ) : filtered ? (
            <EmptyState
              icon={History}
              title="Nessuna attività con questi filtri."
              action={
                <Link href={basePath} scroll={false} className={cn(buttonVariants({ variant: "outline" }), "min-h-11 sm:min-h-8")}>
                  Togli i filtri
                </Link>
              }
            />
          ) : (
            <EmptyState icon={History} title="Ancora nessuna attività." />
          )
        ) : (
          <div className="space-y-6">
            <ActivityTimeline days={days} />
            <ActivityPagination basePath={basePath} filter={filter} total={page.total} />
          </div>
        )}
      </div>
    </PageContainer>
  );
}
