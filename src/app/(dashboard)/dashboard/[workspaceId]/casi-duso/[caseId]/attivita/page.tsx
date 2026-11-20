import Link from "next/link";
import { notFound } from "next/navigation";
import { History } from "lucide-react";
import { PageContainer } from "@/components/dashboard/page-container";
import { FilterChips } from "@/components/ui-10/filter-chips";
import { buttonVariants } from "@/components/ui/button";
import { casePath, itemPath } from "@/components/uc/catalog/paths";
import { ActivityCsvLink, ActivityPagination, ActivityTimeline, DailyAnswerBars } from "@/components/uc/progress/audit-log";
import { loadCaseHead } from "@/components/uc/shell/case-data";
import { EmptyState } from "@/components/uc/ui/empty-state";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { ucLsDomains } from "@/lib/db/queries/uc-access";
import { loadActivityPage } from "@/lib/db/queries/uc-events";
import { romeDate } from "@/lib/uc/notify/schedule";
import { PERIOD_PARAM, periodOptions, periodValue } from "@/lib/uc/views/activity-period";
import { activeAuditFilters, activityDays, auditFamiliesFor, auditQuery, auditWhoFor, dailyAnswerBars, parseAuditFilter, withoutLegacyActor } from "@/lib/uc/views/audit";
import { canOpenShellPage, seesFilteredAudit } from "@/lib/uc/views/case-shell";
import { canOpenItem, canOpenPage, seesPersonalZoneMetadata } from "@/lib/uc/views/page-access";
import type { ItemStatus } from "@/lib/uc/vocab";
import { cn } from "@/lib/utils";

/**
 * Attività (rilascio 10, §3.5; DESIGN §3.12, PIANO §7.2, §3.3): una linea del tempo per giorno, righe di al massimo 8
 * parole, 50 eventi per pagina, il filtro comune (`FilterChips`: Tipo, Chi, Periodo, con «Dati personali» per chi vede
 * i metadati della zona personale) e «Scarica l'elenco» con gli stessi filtri. Il responsabile Lateral Space vede
 * tutto. Per i ruoli del cliente (responsabile del cliente, approvatore privacy) il filtro dell'art. 15.4 sta nella
 * query, anche nell'elenco scaricato: niente eventi dei referenti, aperture di link o informativa vista; al loro posto
 * le risposte ricevute contate per giorno, solo dai 5 in su. L'attività resta anche dopo la chiusura.
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
  const personalData = seesPersonalZoneMetadata(caseAccess.roles);
  // Il vecchio `attore` dei link del Registro diventa il «Chi» che dice la stessa cosa, o si lascia cadere (`withoutLegacyActor`).
  const filter = withoutLegacyActor(parseAuditFilter(await searchParams, clientView, { personalData }));
  const page = await loadActivityPage(executor, { workspaceId, caseId: caseAccess.caseId, filter, clientView, lsDomains: ucLsDomains() });
  const now = new Date();
  const days = activityDays(page.rows, { now, audience: clientView ? "cliente" : "ls" });
  const bars = page.daily ? dailyAnswerBars(page.daily, now) : [];
  const basePath = casePath(workspaceId, caseId, "attivita");
  const csvHref = `${casePath(workspaceId, caseId, "attivita/csv")}${auditQuery({ ...filter, pagina: 1 })}`;
  const filtered = activeAuditFilters(filter) > 0;
  // (Rilascio 10, §3.5) Il titolo di una domanda porta alla domanda, per chi la apre.
  const roles = caseAccess.roles;
  const questionHref = canOpenPage("voce", roles) ? (itemId: string, status: ItemStatus | null) => (status === null || canOpenItem(roles, status) ? itemPath(workspaceId, caseId, itemId) : null) : null;
  // Il filtro comune: i parametri di adesso, con il periodo in un parametro solo.
  const period = periodValue(filter.dal, filter.al);
  const query: Record<string, string> = {};
  if (filter.famiglia) query.tipo = filter.famiglia;
  if (filter.chi) query.chi = filter.chi;
  if (period) query[PERIOD_PARAM] = period;
  const fields = [
    { key: "tipo", label: "Tipo", options: auditFamiliesFor(clientView, personalData).map((f) => ({ value: f.key, label: f.label })), value: filter.famiglia },
    { key: "chi", label: "Chi", options: auditWhoFor(clientView).map((w) => ({ value: w.key, label: w.label })), value: filter.chi },
    { key: PERIOD_PARAM, label: "Periodo", options: periodOptions(romeDate(now), filter), value: period },
  ];

  return (
    <PageContainer>
      <div className="max-w-4xl space-y-6">
        <div className="min-w-0 space-y-3">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold">Attività</h2>
            {(page.total > 0 || bars.length > 0) && <ActivityCsvLink href={csvHref} />}
          </div>
          {clientView && <p className="max-w-2xl text-sm text-muted-foreground">Le azioni dei referenti non compaiono: vedi solo quante risposte arrivano ogni giorno.</p>}
          <FilterChips
            basePath={basePath}
            query={query}
            fields={fields}
            // (F-116) Oltre ai periodi pronti, l'intervallo libero di prima: «Scegli le date…» scrive `periodo=AAAA-MM-GG_AAAA-MM-GG`.
            dateRange={{ field: PERIOD_PARAM, choose: "Scegli le date…", fromLabel: "Dal", toLabel: "Al", from: filter.dal, to: filter.al }}
          />
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
            <ActivityTimeline days={days} questionHref={questionHref} />
            <ActivityPagination basePath={basePath} filter={filter} total={page.total} />
          </div>
        )}
      </div>
    </PageContainer>
  );
}
