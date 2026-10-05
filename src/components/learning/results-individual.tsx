import Link from "next/link";
import { EyeOff, Users } from "lucide-react";
import type { IndividualCell, IndividualRow, ResultsActivity } from "@/lib/learning/results";
import { cn } from "@/lib/utils";
import { outcomeLabel } from "./learning-shell";
import { outcomeTone, shortActivityTitle } from "./results-format";
import { ResultsRefreshButton, ResultsUpdatedAt } from "./results-auto-refresh";

/**
 * Risultati individuali: una riga per persona, una colonna per esercizio.
 * Ogni risultato consegnato apre le risposte di quella persona. Ha i nomi:
 * è per chi tiene il corso, non per lo schermo dell'aula.
 */
export function ResultsIndividual({ rows, activities, base, turno, refreshedAt, showCohort, cohortLabels }: {
  rows: IndividualRow[]; activities: ResultsActivity[]; base: string; turno: string | null; refreshedAt: number;
  showCohort: boolean; cohortLabels: Record<string, string>;
}) {
  const sorted = [...rows].sort((a, b) => a.name.localeCompare(b.name, "it", { sensitivity: "base" }) || a.email.localeCompare(b.email, "it"));
  const finished = rows.filter((row) => row.completion.status === "completed").length;
  return <div className="space-y-4">
    <p className="flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-200">
      <EyeOff aria-hidden className="size-4 shrink-0" /> Vista con i nomi: non proiettarla in aula.
    </p>
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <ResultsUpdatedAt refreshedAt={refreshedAt} />
      <ResultsRefreshButton label="Aggiorna" />
    </div>
    {rows.length === 0 ? <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed p-8 text-center">
      <Users aria-hidden className="size-8 text-muted-foreground" />
      <p className="font-medium">Ancora nessun iscritto in questo turno.</p>
      <p className="text-sm text-muted-foreground">Le persone compaiono qui appena entrano nel corso.</p>
    </div> : <>
      <p className="text-base"><strong className="tabular-nums">{rows.length}</strong> iscritti · <strong className="tabular-nums">{finished}</strong> {finished === 1 ? "ha finito" : "hanno finito"} gli esercizi</p>
      <div className="relative overflow-x-auto rounded-2xl border bg-card">
        <table data-testid="individual-table" className="w-full min-w-max border-collapse text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th scope="col" className="sticky left-0 z-10 bg-card px-4 py-3 font-medium">Persona</th>
              {showCohort && <th scope="col" className="px-3 py-3 font-medium">Turno</th>}
              {activities.map((activity) => <th key={activity.id} scope="col" title={activity.title} className="px-3 py-3 text-center font-medium">
                {shortActivityTitle(activity.title)}
                {!activity.required && <span className="block font-normal">facoltativo</span>}
              </th>)}
              <th scope="col" className="px-4 py-3 font-medium">Esercizi</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => <tr key={`${row.userId}:${row.cohortId}`} className="border-b last:border-0 hover:bg-muted/40">
              <th scope="row" title={row.email} className="sticky left-0 z-10 bg-card px-4 py-3 text-left font-normal">
                {/* La larghezza sta sui testi: su un telefono la colonna fissa non copre i risultati. */}
                <span className="block max-w-32 truncate font-medium text-foreground sm:max-w-56">{row.name}</span>
                {row.email !== row.name && <span className="block max-w-32 truncate text-xs text-muted-foreground sm:max-w-56">{row.email}</span>}
              </th>
              {showCohort && <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">{cohortLabels[row.cohortId] ?? row.cohortId}</td>}
              {activities.map((activity) => {
                const cell = row.cells.find((entry) => entry.activityId === activity.id);
                return <td key={activity.id} className="px-3 py-2 text-center">
                  <ResultCell cell={cell} name={row.name} activityTitle={activity.title} base={base} turno={turno} />
                </td>;
              })}
              <td className="px-4 py-2">
                <div className="flex items-center gap-2 whitespace-nowrap">
                  <span className="tabular-nums">{row.completion.required ? `${row.completion.submitted}/${row.completion.required}` : "—"}</span>
                  {row.completion.status === "completed" && row.completion.outcome && <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", outcomeTone(row.completion.outcome))}>
                    {outcomeLabel(row.completion.outcome)}
                  </span>}
                </div>
              </td>
            </tr>)}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <span>Tocca un risultato per leggere le risposte.</span>
        <Legend status="consolidated" />
        <Legend status="needs_practice" />
        <Legend status="formative_completed" />
      </div>
    </>}
  </div>;
}

function Legend({ status }: { status: string }) {
  return <span className="inline-flex items-center gap-1.5">
    <span aria-hidden className={cn("inline-block size-3 rounded border", outcomeTone(status))} />
    {outcomeLabel(status)}
  </span>;
}

function ResultCell({ cell, name, activityTitle, base, turno }: { cell: IndividualCell | undefined; name: string; activityTitle: string; base: string; turno: string | null }) {
  if (!cell || cell.state === "not_started") return <span className="text-muted-foreground"><span aria-hidden>—</span><span className="sr-only">Non iniziato</span></span>;
  if (cell.state === "draft" || !cell.result || !cell.attemptId) return <span className="text-xs text-muted-foreground">In corso</span>;
  const { correct, total, status } = cell.result;
  return <div className="inline-flex flex-col items-center gap-0.5">
    <Link
      href={`${base}/manage/${cell.attemptId}${turno ? `?${new URLSearchParams({ turno })}` : ""}`}
      aria-label={`${name}, ${activityTitle}: ${correct} risposte giuste su ${total}, ${outcomeLabel(status)}. Apri le risposte`}
      className={cn("inline-flex min-h-10 min-w-14 items-center justify-center rounded-lg border px-3 font-semibold tabular-nums transition-colors hover:brightness-125 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50", outcomeTone(status))}
    >
      {correct}/{total}
    </Link>
    {cell.attempts > 1 && <span className="text-[11px] text-muted-foreground">{cell.attempts} prove</span>}
  </div>;
}
