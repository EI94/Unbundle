import Link from "next/link";
import { notFound } from "next/navigation";
import { Database } from "lucide-react";
import { PageContainer } from "@/components/dashboard/page-container";
import { openCaseView } from "@/components/uc/catalog/case-page";
import { DataList, DataToolbar } from "@/components/uc/catalog/model-item-list";
import { DataItemDetail, ListPagination, TestCasesList } from "@/components/uc/catalog/model-sections";
import { casePath } from "@/components/uc/catalog/paths";
import { TestCasesImportButton } from "@/components/uc/export/test-cases-import";
import { DetailSheet } from "@/components/uc/ui/detail-sheet";
import { EmptyState } from "@/components/uc/ui/empty-state";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { loadSolutionData } from "@/lib/db/queries/uc-solution";
import { testCasesImportHref } from "@/lib/uc/export/test-cases-upload";
import { readableTitle } from "@/lib/uc/views/description";
import { KIND_LABEL } from "@/lib/uc/views/labels";
import { DATA_VIEW_LABEL, groupRows, pageOffset, parseDataQuery, solutionHref, solutionPageHrefs } from "@/lib/uc/views/model";
import { audienceFor, statusView } from "@/lib/uc/views/status-groups";
import { SolutionNav } from "../_parts/solution-nav";

const EMPTY_VIEW: Readonly<Record<string, string>> = {
  entita: "Lo schema di partenza non ha entità.",
  variabili: "Lo schema di partenza non ha variabili.",
  formule: "Lo schema di partenza non ha formule.",
  fonti: "Lo schema di partenza non ha fonti.",
  qualita: "Lo schema di partenza non ha controlli sui dati.",
  prova: "Ancora nessun caso di prova.",
};

/**
 * Soluzione › Dati (DESIGN §3.7.4), per Lateral Space e lo sviluppatore nella
 * navigazione (il responsabile del cliente ha permesso e indirizzo): il
 * `Select` «Vista» (Entità, Variabili, Formule, Fonti, Qualità dei dati, Prova
 * sul passato) e «Cerca per nome». Righe con titolo, stato, una riga di testo e
 * il lucchetto; pagine di 100 righe sul server; il pannello (`?apri=`) ha le
 * parole semplici in vista e codice, valori, chiavi e disponibilità in
 * «Dettagli tecnici». `?entita=<chiave>` dei vecchi indirizzi apre l'entità.
 *
 * Un giro solo (`loadSolutionData`), voce aperta compresa.
 */
export default async function SolutionDataPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string; caseId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceId, caseId } = await params;
  const { session, access } = await requireWorkspacePage(workspaceId);
  const { caseAccess, executor, viewer } = await openCaseView({ workspaceId, caseId, session, access, page: "modello_dati" });
  const sp = await searchParams;
  const query = parseDataQuery(sp);
  const data = await loadSolutionData(executor, viewer, query);
  if (!data) notFound();

  const audience = audienceFor(viewer.roles);
  const base = casePath(workspaceId, caseId, "soluzione/dati");
  const canImport = viewer.roles.includes("ls_lead") && !viewer.readOnly && data.ctx.status !== "chiuso" && caseAccess.status !== "sospeso";
  const groups = groupRows(data.rows).map((g) => ({
    label: g.label,
    rows: g.rows.map((r) => {
      const sv = statusView(r.status, audience);
      return { id: r.id, title: r.title, line: r.line, status: { tone: sv.tone, label: sv.label, sublabel: sv.sublabel }, locked: r.locked, href: solutionHref(base, sp, { apri: r.id, entita: null }) };
    }),
  }));
  const closeHref = solutionHref(base, sp, { apri: null, entita: null });
  const shown = data.view === "prova" ? data.testCases.length : data.rows.length;

  return (
    <PageContainer>
      <SolutionNav workspaceId={workspaceId} caseId={caseId} roles={viewer.roles} active="dati" />
      <DataToolbar view={data.view} q={query.q} />

      {data.view === "prova" && (
        <div className="mb-5 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-2xl text-sm text-muted-foreground">Casi con dati inventati o pseudonimizzati, per provare il modello sul passato prima del collaudo.</p>
          {canImport && <TestCasesImportButton importHref={testCasesImportHref(workspaceId, caseId)} />}
        </div>
      )}

      {data.total === 0 ? (
        query.q ? (
          <EmptyState
            title={`Nessun risultato per “${query.q}”.`}
            action={
              <Link href={solutionHref(base, sp, { q: null, pagina: null, apri: null, entita: null })} className="inline-flex min-h-11 items-center text-sm font-medium underline-offset-4 hover:underline sm:min-h-8">
                Togli la ricerca
              </Link>
            }
          />
        ) : (
          <EmptyState variant={data.view === "prova" ? "inline" : "page"} icon={data.view === "prova" ? undefined : Database} title={EMPTY_VIEW[data.view] ?? `Nessun risultato in ${DATA_VIEW_LABEL[data.view]}.`} />
        )
      ) : shown === 0 ? (
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
          {data.view === "prova" ? <TestCasesList testCases={data.testCases} roles={viewer.roles} offset={pageOffset(data.page)} /> : <DataList groups={groups} />}
          <ListPagination page={data.page} pages={data.pages} {...solutionPageHrefs(base, sp, data.page, data.pages)} />
        </>
      )}

      {data.open && (
        <DetailSheet
          title={readableTitle(data.open.item.title, audience, KIND_LABEL[data.open.item.kind].one)}
          status={statusView(data.open.item.status, audience)}
          closeHref={closeHref}
          size="xl"
        >
          <DataItemDetail workspaceId={workspaceId} caseId={caseId} item={data.open.item} locked={data.open.locked} fields={data.open.fields} roles={viewer.roles} />
        </DetailSheet>
      )}
    </PageContainer>
  );
}
