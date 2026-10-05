import Link from "next/link";
import { Settings2 } from "lucide-react";
import { getLearningResults } from "@/lib/learning/server";
import { LearningShell } from "@/components/learning/learning-shell";
import { ResultsGroup } from "@/components/learning/results-group";
import { ResultsIndividual } from "@/components/learning/results-individual";
import { ResultsExport } from "@/components/learning/results-export";
import { ResultsLocked } from "@/components/learning/results-access";
import { ResultsTabs, ResultsTurns, type ResultsView } from "@/components/learning/results-nav";
import { turnLabel } from "@/components/learning/results-format";

/**
 * Risultati del corso per chi lo tiene, in tre sezioni: di gruppo (senza nomi,
 * si aggiorna da sola e si può proiettare), individuali (con i nomi) e Scarica.
 * Ogni sezione vale nei limiti del proprio permesso; chi gestisce il corso e
 * non ha ancora un permesso lo può attivare per sé da qui.
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

export default async function LearningResultsPage({ params, searchParams }: {
  params: Promise<{ workspaceId: string; programId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ workspaceId, programId }, query] = await Promise.all([params, searchParams]);
  const requestedTurno = single(query.turno);
  const data = await loadResults(workspaceId, programId, requestedTurno);
  const base = `/dashboard/${workspaceId}/learning/${programId}`;

  const requestedView = single(query.vista);
  const view: ResultsView = requestedView === "gruppo" || requestedView === "individuali" || requestedView === "scarica"
    ? requestedView
    : data.can.group ? "gruppo" : data.can.individual ? "individuali" : data.can.export ? "scarica" : "gruppo";
  // Senza una scelta esplicita resta il turno in corso, anche quando cambia.
  const keepTurno = requestedTurno === "all" ? "all" : requestedTurno && requestedTurno === data.selectedCohort ? requestedTurno : null;

  const cohortLabels = Object.fromEntries(data.cohorts.map((cohort) => [cohort.id, turnLabel(cohort.startsAt)]));
  const contextLabel = data.selectedCohort ? cohortLabels[data.selectedCohort] ?? data.selectedCohort : "Tutti i turni";
  // «Attiva per me» chiede un permesso su tutti i turni: lo può dare solo chi li gestisce tutti.
  const locked = { workspaceId, programId, viewerId: data.viewerId, canManage: data.can.manageAll };

  return <LearningShell workspaceId={workspaceId} title="Risultati">
    <div className="-mt-3 flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <p className="text-lg text-muted-foreground">{data.program.title}</p>
        {data.program.status !== "published" && <p className="inline-flex rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground">Corso chiuso alle nuove risposte</p>}
      </div>
      {data.can.manage && <Link href={`${base}/admin`} className="inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm font-medium hover:bg-muted">
        <Settings2 aria-hidden className="size-4" /> Gestisci corso
      </Link>}
    </div>

    {/* Il file comprende sempre tutti i turni: lì la scelta del turno non serve. */}
    {view !== "scarica" && <ResultsTurns cohorts={data.cohorts} selected={data.selectedCohort} base={base} view={view} />}
    <ResultsTabs active={view} base={base} turno={keepTurno} allowed={{ gruppo: data.can.group, individuali: data.can.individual, scarica: data.can.export }} />

    {view === "gruppo" && <section data-testid="results-group" aria-label="Risultati di gruppo">
      {data.can.group && data.group
        ? <ResultsGroup group={data.group} refreshedAt={data.refreshedAt} contextLabel={contextLabel} />
        : <ResultsLocked capability="aggregate" {...locked} />}
    </section>}

    {view === "individuali" && <section data-testid="results-individual" aria-label="Risultati individuali">
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

    {view === "scarica" && <section data-testid="results-export" aria-label="Scarica">
      {data.can.export
        ? <ResultsExport workspaceId={workspaceId} programId={programId} />
        : <ResultsLocked capability="export" {...locked} />}
    </section>}
  </LearningShell>;
}
