import Link from "next/link";
import { Settings2 } from "lucide-react";
import { getLearningResults } from "@/lib/learning/server";
import { LEARNING_TEXT } from "@/lib/learning/text";
import { Button } from "@/components/ui/button";
import { LearningShell } from "@/components/learning/learning-shell";
import { LearningForbidden, isLearningForbidden } from "@/components/learning/learning-forbidden";
import { LiveRefresh } from "@/components/learning/live-refresh";
import { ResultsGroup } from "@/components/learning/results-group";
import { ResultsIndividual } from "@/components/learning/results-individual";
import { DOWNLOAD_SHEET, ResultsDownload, ResultsExportBody } from "@/components/learning/results-export";
import { ResultsLocked } from "@/components/learning/results-access";
import { ResultsTabs, ResultsTurns, type ResultsView } from "@/components/learning/results-nav";
import { turnLabel } from "@/components/learning/results-format";

/**
 * Risultati del corso per chi lo tiene (rilascio 10, ondata 7a, docs/ui-10/PROPOSTA-10.md §3.9): l'H1 è il titolo del
 * corso; due schede, «In aula» (senza nomi, si può proiettare, `?vista=gruppo`) e «Persone» (con i nomi,
 * `?vista=individuali`); un numero solo, «12 su 20 hanno finito»; «Presenta in aula» il solo pulsante pieno; «Scarica»
 * e «Gestisci» bordati in testata. La pagina si aggiorna da sola ogni 10 secondi (con la rete e la scheda in vista),
 * le lezioni si scelgono solo quando sono più d'una. Ogni sezione vale nei limiti del proprio permesso; chi gestisce il
 * corso e non ha ancora un permesso lo può attivare per sé (il lucchetto lo vede solo lui). Il vecchio `?vista=scarica`
 * apre il pannello «Scarica».
 */

type SearchParams = Record<string, string | string[] | undefined>;

function single(value: string | string[] | undefined) {
  const first = Array.isArray(value) ? value[0] : value;
  return first ? first.slice(0, 100) : null;
}

// L'istante della lettura si prende qui, fuori dal render.
async function loadResults(workspaceId: string, programId: string, turno: string | null) {
  const data = await getLearningResults(workspaceId, programId, turno);
  return { ...data, refreshedAt: Date.now() };
}

const R = LEARNING_TEXT.results;

export default async function LearningResultsPage({ params, searchParams }: {
  params: Promise<{ workspaceId: string; programId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ workspaceId, programId }, query] = await Promise.all([params, searchParams]);
  const requestedTurno = single(query.turno);
  let data: Awaited<ReturnType<typeof loadResults>>;
  try {
    data = await loadResults(workspaceId, programId, requestedTurno);
  } catch (error) {
    // Nessun permesso del corso (per esempio chi amministra il workspace senza averne uno): la spiegazione, non l'errore.
    if (isLearningForbidden(error)) return <LearningForbidden workspaceId={workspaceId} title={R.title} message={LEARNING_TEXT.forbidden.results} />;
    throw error;
  }
  const base = `/dashboard/${workspaceId}/learning/${programId}`;

  const requestedView = single(query.vista);
  const canGrant = data.can.manageAll;
  const allowed: Record<ResultsView, boolean> = { gruppo: data.can.group, individuali: data.can.individual };
  // La scheda chiesta, se chi guarda la può vedere (o la può sbloccare); altrimenti la prima che vede.
  const reachable = (view: ResultsView) => allowed[view] || canGrant;
  const view: ResultsView = (requestedView === "gruppo" || requestedView === "individuali") && reachable(requestedView)
    ? requestedView
    : data.can.group ? "gruppo" : data.can.individual ? "individuali" : "gruppo";
  // Senza una scelta esplicita resta la lezione in corso, anche quando cambia.
  const keepTurno = requestedTurno === "all" ? "all" : requestedTurno && requestedTurno === data.selectedCohort ? requestedTurno : null;
  // Chi può solo scaricare non ha schede: il file sta nella pagina, come prima nella sezione «Scarica».
  const exportOnly = !data.can.group && !data.can.individual && !canGrant && data.can.export;
  const download = !exportOnly && (data.can.export || canGrant);
  const openSheet = single(query.apri) ?? (requestedView === DOWNLOAD_SHEET ? DOWNLOAD_SHEET : null);

  const cohortLabels = Object.fromEntries(data.cohorts.map((cohort) => [cohort.id, turnLabel(cohort.startsAt)]));
  const contextLabel = data.selectedCohort ? cohortLabels[data.selectedCohort] ?? R.lessons : R.allLessons;
  const locked = { workspaceId, programId, viewerId: data.viewerId, canManage: canGrant };

  const actions = <>
    {download ? <ResultsDownload workspaceId={workspaceId} programId={programId} canExport={data.can.export} canGrant={canGrant} viewerId={data.viewerId} initialOpen={openSheet} /> : null}
    {data.can.manage ? <Button render={<Link href={`${base}/admin`} />} nativeButton={false} variant="outline" className="min-h-11 flex-1 sm:min-h-9 sm:flex-none">
      <Settings2 aria-hidden data-icon="inline-start" />{R.manage}
    </Button> : null}
  </>;

  return <LearningShell
    workspaceId={workspaceId}
    title={data.program.title}
    back={{ href: base, label: LEARNING_TEXT.backToCourse }}
    subtitle={data.program.status !== "published" ? R.closed : null}
    actions={download || data.can.manage ? actions : null}
  >
    <LiveRefresh from={0} seconds={10} />
    {exportOnly ? <section aria-label={R.downloadTitle}><ResultsExportBody workspaceId={workspaceId} programId={programId} /></section> : <>
    <ResultsTurns cohorts={data.cohorts} selected={data.selectedCohort} base={base} view={view} />
    <ResultsTabs active={view} base={base} turno={keepTurno} allowed={allowed} canGrant={canGrant} />

    {view === "gruppo" && <section data-testid="results-group" aria-label={R.tabs.group}>
      {data.can.group && data.group
        ? <ResultsGroup group={data.group} refreshedAt={data.refreshedAt} contextLabel={contextLabel} />
        : <ResultsLocked capability="aggregate" {...locked} />}
    </section>}

    {view === "individuali" && <section data-testid="results-individual" aria-label={R.tabs.people}>
      {data.can.individual && data.individuals
        ? <ResultsIndividual
            rows={data.individuals}
            activities={data.activities}
            base={base}
            turno={keepTurno}
            refreshedAt={data.refreshedAt}
            showCohort={data.selectedCohort === null && data.cohorts.length > 1}
            cohortLabels={cohortLabels}
          />
        : <ResultsLocked capability="review" {...locked} />}
    </section>}
    </>}
  </LearningShell>;
}
