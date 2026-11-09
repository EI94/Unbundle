"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ChevronRight, Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatEuro, formatInteger } from "@/lib/use-cases/format";
import { keepTogether } from "@/lib/use-cases/line-breaks";
import { PROGRAM_TEXT, kpiValueText, longDate, nextStepText, salChangeText, signedEuro, signedInteger } from "@/lib/programma/text";
import type { ProgramView } from "@/lib/programma/view";
import { cn } from "@/lib/utils";
import { AsksEditor, CloseSalButton, FactAsk } from "./program-forms";
import { ProgramPanelSheet, isProgramPanel, type ProgramPanel } from "./program-panels";
import { ValueCostChart, breakevenText } from "./value-cost-chart";

const T = PROGRAM_TEXT;

/** Il pannello nell'indirizzo (`?apri=`), senza ricaricare la pagina: un link al pannello si può condividere. */
function usePanel(initial: string | null) {
  const [panel, setPanel] = useState<ProgramPanel | null>(isProgramPanel(initial) ? initial : null);
  const write = useCallback((next: ProgramPanel | null) => {
    setPanel(next);
    const url = new URL(window.location.href);
    const wasOpen = url.searchParams.has("apri");
    if (next) url.searchParams.set("apri", next);
    else url.searchParams.delete("apri");
    // Aprire aggiunge un passo alla cronologia: «Indietro» (anche il gesto del telefono) chiude il pannello.
    if (next && !wasOpen) window.history.pushState(window.history.state, "", url);
    else window.history.replaceState(window.history.state, "", url);
  }, []);
  useEffect(() => {
    const onPop = () => {
      const value = new URL(window.location.href).searchParams.get("apri");
      setPanel(isProgramPanel(value) ? value : null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return [panel, write] as const;
}

/** Giorni da `a` a `b` (`AAAA-MM-GG`). */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

const OPENER = "group flex w-full min-w-0 items-start justify-between gap-2 rounded-xl border bg-card p-3 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 sm:p-4";

function Chevron() {
  return <ChevronRight aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />;
}

function Heading({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h2 className="text-base font-semibold">{children}</h2>
      {action}
    </div>
  );
}

function MoreButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex min-h-11 items-center gap-0.5 rounded-md px-1 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-0">
      {children}
      <ChevronRight aria-hidden className="size-4" />
    </button>
  );
}

/** Una linea piccola dell'andamento ai mesi fotografati: solo con almeno due punti. */
function Spark({ values }: { values: ReadonlyArray<number | null> }) {
  const points = values.filter((v): v is number => v !== null);
  if (points.length < 2) return null;
  const max = Math.max(...points);
  const min = Math.min(0, ...points);
  const span = max - min || 1;
  const d = points.map((v, i) => `${i === 0 ? "M" : "L"} ${((i / (points.length - 1)) * 100).toFixed(2)} ${(28 - ((v - min) / span) * 24).toFixed(2)}`).join(" ");
  return (
    <svg aria-hidden viewBox="0 0 100 30" preserveAspectRatio="none" className="mt-2 h-6 w-full">
      <path d={d} className="fill-none stroke-uc-serie-1" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Delta({ text }: { text: string | null }) {
  return text ? <span className="block text-xs text-muted-foreground">{keepTogether(text)}</span> : null;
}

function deltaOf(now: number | null, then: number | null | undefined, kind: "euro" | "int", on: string | undefined): string | null {
  if (now === null || then === null || then === undefined || !on) return null;
  const diff = now - then;
  // Il giorno del SAL (o senza cambiamenti) il delta non dice niente: resta la riga di sempre.
  if (Math.round(diff) === 0) return null;
  return `${kind === "euro" ? signedEuro(diff) : signedInteger(diff)} ${T.sinceSal(on)}`;
}

/** Scarica il PDF del SAL (POST: un'esportazione lascia una traccia e non parte mai da un prefetch). */
function ExportSalButton({ workspaceId }: { workspaceId: string }) {
  const [pending, setPending] = useState(false);
  const run = async () => {
    setPending(true);
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/programma/sal`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!response.ok) throw new Error(String(response.status));
      const blob = await response.blob();
      const name = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(response.headers.get("Content-Disposition") ?? "")?.[1] ?? "sal.pdf";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = decodeURIComponent(name);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Non riesco a preparare il PDF. Riprova tra poco.");
    } finally {
      setPending(false);
    }
  };
  return (
    <Button type="button" variant="outline" onClick={run} disabled={pending} className="min-h-11 sm:min-h-8">
      <Download aria-hidden />
      {T.exportSal}
    </Button>
  );
}

/**
 * La pagina «Programma» (rilascio 7): a colpo d'occhio, con tutti i dati a un clic (titolare, 04/11/2026).
 * Dall'alto: i quattro risultati, valore e costo cumulati, le iniziative, gli use case da rivedere, le
 * persone, gli obiettivi, il SAL. Ogni riquadro, riga e «›» apre il suo pannello.
 */
export function ProgramPage({ view, initialPanel }: { view: ProgramView; initialPanel: string | null }) {
  const [panel, setPanel] = usePanel(initialPanel);
  // Subito dopo i dipendenti, una volta sola, la domanda sul ricavo (facoltativa) nello stesso riquadro.
  const [askRevenue, setAskRevenue] = useState(false);
  const r = view.results;
  const sal = view.lastSal;
  const curve = view.curve.base;
  const trend = view.trend;
  const reviewNames = view.review.map((x) => x.title).join(", ");
  const supportRow = view.costs.support;
  const people = view.people;
  const hasCurve = Math.max(...curve.value, ...curve.cost) > 0;
  const countedPillars = view.index.pillars.filter((p) => p.score !== null && p.weight > 0).length;
  // «Chiudi il SAL» è il pulsante pieno della pagina solo per il primo SAL o da quattro settimane dopo l'ultimo.
  const salDue = !view.sal.lastOn || daysBetween(view.sal.lastOn, view.today) >= 28;
  return (
    <div className="flex-1 space-y-8 p-4 sm:p-6 lg:p-8" data-slot="program-page">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{T.title}</h1>
          <p className="text-sm text-muted-foreground">
            {keepTogether(T.subtitle(view.companyName))} · {longDate(view.today)}
          </p>
        </div>
        <ExportSalButton workspaceId={view.workspaceId} />
      </header>

      <section aria-labelledby="programma-risultati" className="space-y-3">
        <h2 id="programma-risultati" className="sr-only">
          {T.results}
        </h2>
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
          <button type="button" className={OPENER} onClick={() => setPanel("valore")} data-figure="valore-stimato">
            <span className="min-w-0">
              <span className="block text-xl font-semibold tracking-tight whitespace-nowrap tabular-nums sm:text-2xl">{formatEuro(r.estimated)}</span>
              <span className="block text-sm">{T.estimated}</span>
              <Delta text={deltaOf(r.estimated, sal?.estimated, "euro", sal?.on) ?? T.onUseCases(r.estimatedCount)} />
              <Spark values={trend.map((t) => t.estimated)} />
            </span>
            <Chevron />
          </button>
          <button type="button" className={OPENER} onClick={() => setPanel("in-uso")} data-figure="valore-in-uso">
            <span className="min-w-0">
              <span className={cn("block text-xl font-semibold tracking-tight tabular-nums sm:text-2xl", r.inUseCount ? "whitespace-nowrap" : null)}>{r.inUseCount ? formatEuro(r.inUse) : T.noneInUse}</span>
              <span className="block text-sm">{T.inUse}</span>
              <Delta text={r.inUseCount ? (deltaOf(r.inUse, sal?.inUse, "euro", sal?.on) ?? T.onUseCases(r.inUseCount)) : r.firstGoLive ? T.firstGoLive(r.firstGoLive) : null} />
              <Spark values={trend.map((t) => t.inUse)} />
            </span>
            <Chevron />
          </button>
          {view.company.employees && askRevenue && view.company.revenueEur === null ? (
            <div className="min-w-0 space-y-2 rounded-xl border bg-card p-3 sm:p-4" data-figure="valore-per-dipendente">
              <span className="block text-xl font-semibold tracking-tight whitespace-nowrap tabular-nums sm:text-2xl">{r.perEmployee === null || r.inUseCount === 0 ? "—" : formatEuro(r.perEmployee)}</span>
              <span className="block text-sm">{T.perEmployee}</span>
              <FactAsk workspaceId={view.workspaceId} company={view.companyName} canEdit={view.viewer.canEdit} step="ricavo" onDone={() => setAskRevenue(false)} />
            </div>
          ) : view.company.employees ? (
            <button type="button" className={OPENER} onClick={() => setPanel("dipendente")} data-figure="valore-per-dipendente">
              <span className="min-w-0">
                <span className="block text-xl font-semibold tracking-tight whitespace-nowrap tabular-nums sm:text-2xl">{r.perEmployee === null || r.inUseCount === 0 ? "—" : formatEuro(r.perEmployee)}</span>
                <span className="block text-sm">{T.perEmployee}</span>
                <Delta
                  text={
                    r.inUseCount === 0
                      ? T.perEmployeeLater
                      : (deltaOf(r.perEmployee, sal?.perEmployee, "euro", sal?.on) ??
                        (r.perEmployeeOfRevenuePct !== null && r.perEmployeeOfRevenuePct > 0 ? T.ofRevenue(r.perEmployeeOfRevenuePct) : `su ${formatInteger(view.company.employees)} dipendenti`))
                  }
                />
                <Spark values={trend.map((t) => t.perEmployee)} />
              </span>
              <Chevron />
            </button>
          ) : (
            <div className="min-w-0 space-y-2 rounded-xl border bg-card p-3 sm:p-4" data-figure="valore-per-dipendente">
              <span className="block text-sm">{T.perEmployee}</span>
              <FactAsk workspaceId={view.workspaceId} company={view.companyName} canEdit={view.viewer.canEdit} step="dipendenti" onEmployeesSaved={() => setAskRevenue(true)} />
            </div>
          )}
          <button type="button" className={OPENER} onClick={() => setPanel("indice")} data-figure="indice">
            <span className="min-w-0">
              <span className="block text-xl font-semibold tracking-tight tabular-nums sm:text-2xl">
                {view.index.value === null ? (
                  "—"
                ) : (
                  <>
                    {view.index.value}
                    <span className="text-sm font-normal text-muted-foreground">/100</span>
                  </>
                )}
              </span>
              <span className="block text-sm">{T.index}</span>
              <Delta text={deltaOf(view.index.value, sal?.index, "int", sal?.on) ?? (countedPillars > 0 && countedPillars < 4 ? T.onPillars(countedPillars) : null)} />
              <Spark values={trend.map((t) => t.index)} />
            </span>
            <Chevron />
          </button>
        </div>
      </section>

      <section aria-labelledby="programma-curva" className="space-y-3">
        <Heading action={<MoreButton onClick={() => setPanel("curva")}>{T.chartMore}</MoreButton>}>
          <span id="programma-curva">{T.chart}</span>
        </Heading>
        {hasCurve ? (
          <>
            <p className="text-sm text-muted-foreground">{breakevenText(curve, T.programBreakeven)}</p>
            <div className="rounded-xl border bg-card p-3 sm:p-4">
              <ValueCostChart curve={curve} />
            </div>
          </>
        ) : (
          <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">{T.noValueYet}</p>
        )}
      </section>

      <section aria-labelledby="programma-iniziative" className="space-y-3">
        <Heading>
          <span id="programma-iniziative">{T.initiatives}</span>
        </Heading>
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="hidden grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))_1rem] gap-3 border-b px-4 py-2 text-xs text-muted-foreground sm:grid" aria-hidden>
            <span />
            <span className="text-right">{T.colValue}</span>
            <span className="text-right">{T.colOneoff}</span>
            <span className="text-right">{T.colRun}</span>
            <span />
          </div>
          <ul className="divide-y">
            {people.training ? (
              <li>
                <InitiativeRow name={T.training} sub={T.trainingLine(people.training.trained, people.training.hours)} value={null} oneoff={null} run={null} onClick={() => setPanel("formazione")} />
              </li>
            ) : null}
            {view.initiatives.map((row) => (
              <li key={row.stage}>
                <InitiativeRow
                  name={T.stage[row.stage]}
                  sub={row.count === 1 ? "1 use case" : `${formatInteger(row.count)} use case`}
                  value={formatEuro(row.value)}
                  oneoff={formatEuro(row.oneoff)}
                  run={formatEuro(row.run)}
                  onClick={() => setPanel(row.stage)}
                />
              </li>
            ))}
            {supportRow ? (
              <li>
                <InitiativeRow name={T.support} sub={T.supportMonth(supportRow.monthNow)} value={null} oneoff={null} run={formatEuro(supportRow.perYear)} onClick={() => setPanel("supporto")} />
              </li>
            ) : view.ls ? (
              <li>
                <InitiativeRow name={T.support} sub="Nessun canone impostato" value={null} oneoff={null} run={null} onClick={() => setPanel("supporto")} />
              </li>
            ) : null}
          </ul>
        </div>
        {view.review.length ? (
          <button type="button" onClick={() => setPanel("rivedere")} className="group flex w-full items-start gap-2 rounded-xl border bg-uc-giallo-bg p-3 text-left text-sm outline-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50" data-slot="review-alert">
            <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-uc-giallo" />
            <span className="min-w-0 flex-1">
              <b className="font-semibold">{T.review(view.review.length)}</b> · {reviewNames} {view.review.length === 1 ? T.reviewWhy : T.reviewWhyMany}
            </span>
            <Chevron />
          </button>
        ) : null}
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <section aria-labelledby="programma-persone" className="space-y-3">
          <Heading action={<MoreButton onClick={() => setPanel("persone")}>{T.peopleMore}</MoreButton>}>
            <span id="programma-persone">{T.people}</span>
          </Heading>
          <div className="space-y-3 rounded-xl border bg-card p-4">
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              {people.training ? (
                <>
                  <span>
                    <b className="font-semibold tabular-nums">{T.trained(people.training.trained, view.company.employees)}</b>
                  </span>
                  <span className="tabular-nums">{T.hoursTraining(people.training.hours)}</span>
                </>
              ) : (
                <span className="text-muted-foreground">Nessuna formazione registrata.</span>
              )}
              {people.weeklyUsePct !== null ? <span className="tabular-nums">{T.weeklyUse(people.weeklyUsePct)}</span> : null}
            </div>
            {people.levels ? (
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">{T.levelsLabel}</p>
                <div className="flex h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${T.levelsLabel}: ${people.levels.bars.map((b) => `${b.label.toLowerCase()} ${b.count}`).join(", ")}`}>
                  {people.levels.bars.map((b) =>
                    b.share > 0 ? <span key={b.label} className="h-3 border-r-2 border-card last:border-r-0" style={{ width: `${b.share * 100}%`, background: `color-mix(in oklch, var(--uc-serie-1) ${20 + b.levels[0] * 16}%, transparent)` }} /> : null,
                  )}
                </div>
                <div className="flex justify-between text-[11px] text-muted-foreground">
                  <span>{T.levelLow}</span>
                  <span>{T.levelHigh}</span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{T.levelsHidden}</p>
            )}
          </div>
        </section>

        <section aria-labelledby="programma-obiettivi" className="space-y-3">
          <Heading action={<MoreButton onClick={() => setPanel("obiettivi")}>{T.goalsMore}</MoreButton>}>
            <span id="programma-obiettivi">{T.goals}</span>
          </Heading>
          <div className="rounded-xl border bg-card p-4">
            {view.objectives.length || view.kpis.length ? (
              <ul className="space-y-3">
                {view.objectives.slice(0, 3).map((o) => (
                  <li key={o.id} className="space-y-1.5">
                    <p className="text-sm font-medium">{o.title}</p>
                    {o.keyResults.slice(0, 3).map((kr) => (
                      <div key={kr.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-xs">
                        <span className="line-clamp-2 min-w-0">{kr.title}</span>
                        <span className="text-right whitespace-nowrap text-muted-foreground tabular-nums">
                          {kr.progress === null ? "senza base" : `${Math.round(kr.progress)} %`}
                          {kr.target !== null ? ` · obiettivo ${kpiValueText(kr.target, kr.unit)}` : ""}
                        </span>
                        {kr.progress !== null ? (
                          <span aria-hidden className="col-span-2 h-1.5 rounded-full bg-muted">
                            <span className="block h-1.5 rounded-full bg-uc-serie-3" style={{ width: `${Math.round(kr.progress)}%` }} />
                          </span>
                        ) : null}
                      </div>
                    ))}
                  </li>
                ))}
                {!view.objectives.length
                  ? view.kpis.slice(0, 4).map((k) => (
                      <li key={k.id} className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="line-clamp-2 min-w-0">{k.label}</span>
                        <span className="font-medium whitespace-nowrap tabular-nums">{kpiValueText(k.now, k.unit)}</span>
                      </li>
                    ))
                  : null}
              </ul>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">{T.noGoals}</p>
                {view.viewer.canEdit ? (
                  <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-7" onClick={() => setPanel("obiettivi")}>
                    {T.chooseKpis}
                  </Button>
                ) : null}
              </div>
            )}
          </div>
        </section>
      </div>

      <section aria-labelledby="programma-sal" className="space-y-3">
        <Heading>
          <span id="programma-sal">{T.sal}</span>
        </Heading>
        {view.viewer.canEdit ? <CloseSalButton workspaceId={view.workspaceId} filled={salDue} /> : null}
        <div className="grid gap-3 md:grid-cols-3">
          <button type="button" className={cn(OPENER, "flex-col")} onClick={() => setPanel("sal")}>
            <span className="flex w-full items-start justify-between gap-2">
              <span className="text-sm font-semibold">{T.changedSince(view.sal.lastOn)}</span>
              <Chevron />
            </span>
            {view.sal.lastOn ? (
              view.sal.changes.length ? (
                <ul className="space-y-1 text-sm">
                  {view.sal.changes.slice(0, 4).map((c) => (
                    <li key={c.key}>{salChangeText(c)}</li>
                  ))}
                </ul>
              ) : (
                <span className="text-sm text-muted-foreground">{T.nothingChanged}</span>
              )
            ) : (
              <span className="text-sm text-muted-foreground">{T.noSalYet}</span>
            )}
          </button>
          <div className="space-y-2 rounded-xl border bg-card p-3 sm:p-4">
            <h3 className="text-sm font-semibold">{T.nextSteps}</h3>
            {view.nextSteps.length ? (
              <ul className="space-y-1.5 text-sm">
                {view.nextSteps.map((s, i) => (
                  <li key={i} className="flex gap-2">
                    <span aria-hidden className="text-muted-foreground">
                      →
                    </span>
                    <span className="min-w-0">{nextStepText(s, view.companyName)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Niente da fare adesso.</p>
            )}
          </div>
          <div className="space-y-2 rounded-xl border bg-card p-3 sm:p-4">
            <h3 className="text-sm font-semibold">{T.asks}</h3>
            <AsksEditor workspaceId={view.workspaceId} asks={view.asks} canEdit={view.viewer.canEdit} />
          </div>
        </div>
      </section>

      <p className="text-xs text-muted-foreground">{T.sources}</p>

      <ProgramPanelSheet panel={panel} view={view} onClose={() => setPanel(null)} />
    </div>
  );
}

function InitiativeRow({ name, sub, value, oneoff, run, onClick }: { name: string; sub: string; value: string | null; oneoff: string | null; run: string | null; onClick: () => void }) {
  const cell = (label: string, text: string | null) => (
    <span className="flex items-baseline justify-between gap-2 text-sm tabular-nums sm:block sm:text-right">
      <span className="text-xs text-muted-foreground sm:sr-only">{label}</span>
      {text === null ? (
        <span className="text-muted-foreground">
          <span aria-hidden>—</span>
          <span className="sr-only">nessuno</span>
        </span>
      ) : (
        <span>{text}</span>
      )}
    </span>
  );
  return (
    <button type="button" onClick={onClick} className="group grid w-full grid-cols-[minmax(0,1fr)_1rem] gap-x-3 gap-y-1 px-4 py-3 text-left outline-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50 sm:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))_1rem] sm:items-center">
      <span className="min-w-0">
        <span className="block text-sm font-medium">{name}</span>
        <span className="block text-xs text-muted-foreground">{sub}</span>
      </span>
      <span className="col-start-1 space-y-0.5 sm:contents">
        {cell(T.colValue, value)}
        {cell(T.colOneoff, oneoff)}
        {cell(T.colRun, run)}
      </span>
      <span className="col-start-2 row-start-1 self-center sm:col-start-auto sm:row-start-auto">
        <Chevron />
      </span>
    </button>
  );
}
