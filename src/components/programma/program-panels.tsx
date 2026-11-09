"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { DetailSheetFrame } from "@/components/uc/ui/detail-sheet";
import { Button } from "@/components/ui/button";
import { formatEuro, formatInteger } from "@/lib/use-cases/format";
import { quarterLabel } from "@/lib/use-cases/quarter";
import { monthLabel, monthLongLabel } from "@/lib/use-cases/value-calc";
import type { Scenario } from "@/lib/programma/curve";
import { REVIEW_RATIO } from "@/lib/programma/figures";
import { GAP_TEXT, PILLAR_HOW, PILLAR_TEXT, PROGRAM_TEXT, formatHours, formatPct, kpiValueText, longDate, readinessPillarText, salChangeText } from "@/lib/programma/text";
import type { ProgramView, ViewCard } from "@/lib/programma/view";
import { cn } from "@/lib/utils";
import { CaseDevControl, CustomKpiForm, FactsEditor, KeyResultEditor, KpiCatalog, KpiEditor, LsCostsForm, WeightsForm } from "./program-forms";
import { ValueCostChart, breakevenText } from "./value-cost-chart";

const T = PROGRAM_TEXT;

/** I pannelli della pagina, per `?apri=`. */
export const PROGRAM_PANELS = ["valore", "in-uso", "dipendente", "indice", "curva", "in_uso", "in_realizzazione", "da_avviare", "supporto", "formazione", "rivedere", "persone", "obiettivi", "sal"] as const;
export type ProgramPanel = (typeof PROGRAM_PANELS)[number];

export function isProgramPanel(value: string | null | undefined): value is ProgramPanel {
  return typeof value === "string" && (PROGRAM_PANELS as readonly string[]).includes(value);
}

const PANEL_TITLE: Record<ProgramPanel, string> = {
  valore: T.estimated,
  "in-uso": T.inUse,
  dipendente: T.perEmployee,
  indice: T.index,
  curva: T.chart,
  in_uso: T.stage.in_uso,
  in_realizzazione: T.stage.in_realizzazione,
  da_avviare: T.stage.da_avviare,
  supporto: T.support,
  formazione: T.training,
  rivedere: "Use case da rivedere",
  persone: T.people,
  obiettivi: T.goalsMore,
  sal: T.sal,
};

function Section({ title, children, className }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("space-y-2", className)}>
      {title ? <h3 className="text-sm font-semibold">{title}</h3> : null}
      {children}
    </section>
  );
}

function Pairs({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="divide-y rounded-lg border text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between gap-3 px-3 py-2">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="text-right font-medium tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** L'andamento ai mesi fotografati, dal più recente: solo con almeno due mesi. */
function Trend({ rows }: { rows: Array<[string, string]> }) {
  if (rows.length < 2) return null;
  return (
    <Section title="Andamento">
      <Pairs rows={[...rows].reverse().map(([period, text]) => [monthLongLabel(period), text] as [string, ReactNode])} />
    </Section>
  );
}

function Source({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

/** «1,5»: euro di valore per euro di mantenimento. */
function formatRatio(n: number): string {
  return n.toLocaleString("it-IT", { maximumFractionDigits: 1 });
}

/** La riga di uno use case nei pannelli: codice e titolo che aprono la scheda, poi le cifre su colonne separate. */
function CardRow({ card, view, withDev }: { card: ViewCard; view: ProgramView; withDev: boolean }) {
  const dev = view.ls?.caseDev.find((d) => d.id === card.id);
  return (
    <li className="space-y-1.5 px-3 py-2.5">
      <Link href={card.href} className="block text-sm font-medium break-words hover:underline">
        {card.code ? <span className="mr-1 font-mono text-xs text-muted-foreground">{card.code}</span> : null}
        {card.title}
      </Link>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-muted-foreground tabular-nums sm:grid-cols-4">
        <span>
          {T.colValue}: <span className="text-foreground">{formatEuro(card.value)}</span>
        </span>
        <span>
          {T.colOneoff}: <span className="text-foreground">{formatEuro(card.oneoff)}</span>
          {card.lsDev > 0 ? ` (di cui Lateral Space ${formatEuro(card.lsDev)})` : ""}
        </span>
        <span>
          {T.colRun}: <span className="text-foreground">{formatEuro(card.run)}</span>
        </span>
        {card.stage === "in_uso" ? (
          card.run > 0 ? (
            <span>
              {formatRatio(card.value / card.run)} € per euro di mantenimento
              {card.value / card.run < REVIEW_RATIO ? <span className="ml-1 font-medium text-foreground">· da rivedere</span> : null}
            </span>
          ) : (
            <span />
          )
        ) : (
          <span>In uso da {monthLabel(card.goLiveMonth)}</span>
        )}
        {view.ls && card.supportYear > 0 ? (
          <span>
            {"Supporto all'anno: "}
            <span className="text-foreground">{formatEuro(card.supportYear)}</span>
          </span>
        ) : null}
      </div>
      {withDev && dev ? <CaseDevControl workspaceId={view.workspaceId} item={dev} devPct={view.ls?.devPct ?? null} /> : null}
    </li>
  );
}

function StagePanel({ view, stage }: { view: ProgramView; stage: "in_uso" | "in_realizzazione" | "da_avviare" }) {
  const row = view.initiatives.find((r) => r.stage === stage);
  if (!row) return <p className="text-sm text-muted-foreground">Nessuno use case.</p>;
  const withDev = Boolean(view.ls);
  const groups =
    stage === "da_avviare"
      ? [...new Set(row.cards.map((c) => c.quarter ?? ""))].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b))).map((q) => ({ label: q ? quarterLabel(q) : "Più avanti", cards: row.cards.filter((c) => (c.quarter ?? "") === q) }))
      : [{ label: null, cards: row.cards }];
  return (
    <div className="space-y-4">
      <Pairs
        rows={[
          ["Use case", formatInteger(row.count)],
          [T.colValue, formatEuro(row.value)],
          [T.colOneoff, formatEuro(row.oneoff)],
          [T.colRun, formatEuro(row.run)],
          ...(row.lsDev > 0 ? ([["Di cui sviluppo Lateral Space", formatEuro(row.lsDev)]] as Array<[string, ReactNode]>) : []),
        ]}
      />
      {groups.map((g) => (
        <Section key={g.label ?? "tutti"} title={g.label ? `${g.label} · ${formatInteger(g.cards.length)}` : undefined}>
          <ul className="divide-y rounded-lg border">
            {g.cards.map((c) => (
              <CardRow key={c.id} card={c} view={view} withDev={withDev} />
            ))}
          </ul>
        </Section>
      ))}
      <Source>Valore e costi dalle schede degli use case. Il costo di avvio conta per gli use case da costruire.</Source>
    </div>
  );
}

function CurvePanel({ view }: { view: ProgramView }) {
  const [scenario, setScenario] = useState<Scenario>("base");
  const curve = view.curve[scenario];
  const c = view.costs;
  const rows = curve.monthly.map((m, i) => ({ ...m, valueCum: curve.value[i + 1], costCum: curve.cost[i + 1], future: i >= curve.today }));
  return (
    <div className="space-y-5">
      <div role="radiogroup" aria-label="Scenario" className="inline-flex rounded-lg border p-0.5">
        {(["prudente", "base", "ambizioso"] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={scenario === s}
            onClick={() => setScenario(s)}
            className={cn("min-h-11 rounded-md px-3 text-sm sm:min-h-7", scenario === s ? "bg-muted font-medium" : "text-muted-foreground")}
          >
            {s === "prudente" ? "Prudente" : s === "base" ? "Base" : "Ambizioso"}
          </button>
        ))}
      </div>
      <Source>{scenario === "base" ? "Il valore stimato degli use case." : scenario === "prudente" ? "Il valore degli use case non ancora in uso al 70 %." : "Il valore degli use case non ancora in uso al 130 %."} I costi non cambiano.</Source>
      <ValueCostChart curve={curve} compact />
      <p className="text-sm font-medium">{breakevenText(curve)}</p>
      <Section title="I costi">
        <Pairs
          rows={[
            ["Fino a oggi", formatEuro(c.toDate)],
            ["Mantenimento all'anno di ciò che è in uso", formatEuro(c.runInUse)],
            ["Avvio degli use case non ancora in uso", formatEuro(c.buildPlanned)],
            ...(c.lsDev > 0 ? ([["Di cui sviluppo Lateral Space", formatEuro(c.lsDev)]] as Array<[string, ReactNode]>) : []),
            ...(c.support ? ([[T.support, `${formatEuro(c.support.monthNow)} al mese`]] as Array<[string, ReactNode]>) : []),
          ]}
        />
      </Section>
      <Section title="Mese per mese">
        <div className="max-h-80 overflow-auto rounded-lg border">
          <table className="w-full text-xs tabular-nums">
            <caption className="sr-only">Valore e costo cumulati, mese per mese</caption>
            <thead className="sticky top-0 bg-background">
              <tr className="border-b text-left text-muted-foreground">
                <th scope="col" className="px-2 py-1.5 font-medium">
                  Mese
                </th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">
                  {T.value}
                </th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">
                  {T.cost}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.month} className={cn("border-b last:border-0", r.future && "text-muted-foreground")}>
                  <th scope="row" className="px-2 py-1 text-left font-normal">
                    {monthLabel(r.month)}
                    {r.future ? <span className="text-[11px]"> · previsione</span> : null}
                  </th>
                  <td className="px-2 py-1 text-right">{formatEuro(r.valueCum)}</td>
                  <td className="px-2 py-1 text-right">{formatEuro(r.costCum)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Source>
          {formatInteger(c.coverage.counted)} use case su {formatInteger(c.coverage.total)} hanno un valore o un costo: gli altri entrano nella curva quando li avranno.
        </Source>
      </Section>
    </div>
  );
}

function SupportPanel({ view }: { view: ProgramView }) {
  const s = view.costs.support;
  return (
    <div className="space-y-4">
      {s ? (
        <Pairs
          rows={[
            ["Al mese", formatEuro(s.monthNow)],
            ["All'anno, al ritmo di oggi", formatEuro(s.perYear)],
            ["Fino a oggi", formatEuro(s.toDate)],
            ["Periodo", s.from ? `da ${monthLongLabel(s.from)}${s.to ? ` a ${monthLongLabel(s.to)}` : ""}` : "dall'inizio"],
          ]}
        />
      ) : (
        <p className="text-sm text-muted-foreground">Nessun canone di supporto.</p>
      )}
      {view.ls ? (
        <Section title="Costi di Lateral Space">
          <Source>{"Solo Lateral Space vede questa parte. Il canone di ogni mese si divide tra gli use case in realizzazione o in uso quel mese, in proporzione al loro valore all'anno: la parte di ognuno è nei pannelli delle iniziative."}</Source>
          <LsCostsForm view={view} />
          <Source>{"Lo sviluppo di un singolo use case si accende nel pannello della sua iniziativa e prende il posto del suo costo di avvio, tranne le ore interne."}</Source>
        </Section>
      ) : null}
    </div>
  );
}

function IndexPanel({ view }: { view: ProgramView }) {
  return (
    <div className="space-y-4">
      <p className="text-3xl font-semibold tabular-nums">
        {view.index.value === null ? (
          "—"
        ) : (
          <>
            {view.index.value}
            <span className="text-base font-normal text-muted-foreground">/100</span>
          </>
        )}
      </p>
      <Trend rows={view.trend.map((t) => [t.period, t.index === null ? "—" : `${Math.round(t.index)}/100`])} />
      <ul className="divide-y rounded-lg border">
        {view.index.pillars.map((p) => (
          <li key={p.pillar} className="space-y-1 px-3 py-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-medium">{PILLAR_TEXT[p.pillar]}</span>
              <span className="text-sm tabular-nums">{p.score === null ? "—" : `${Math.round(p.score)}/100`}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {p.gap ? GAP_TEXT[p.gap] : PILLAR_HOW[p.pillar]}
              {p.source === "ai_readiness" ? " Oggi dall'AI Readiness." : p.source === "kpi" ? " Oggi dal KPI «Uso settimanale dell'AI»." : ""} Peso {p.weight}.
            </p>
          </li>
        ))}
      </ul>
      <Source>{"L'indice è la media pesata dei pilastri che contano."}</Source>
      {view.ls ? (
        <Section title="Pesi">
          <WeightsForm workspaceId={view.workspaceId} weights={view.ls.weights} />
        </Section>
      ) : null}
    </div>
  );
}

function PeoplePanel({ view }: { view: ProgramView }) {
  const p = view.people;
  return (
    <div className="space-y-5">
      {p.training ? (
        <Pairs
          rows={[
            ["Persone formate", p.trainedPct !== null ? `${formatInteger(p.training.trained)} · ${formatPct(p.trainedPct)}` : formatInteger(p.training.trained)],
            ["Ore d'aula", formatHours(p.training.hours)],
            ["Sessioni tenute", formatInteger(p.training.sessions)],
            ["Esercitazioni completate", formatInteger(p.training.exercises)],
          ]}
        />
      ) : (
        <p className="text-sm text-muted-foreground">Nessuna formazione registrata.</p>
      )}
      <Section title={T.levelsLabel}>
        {p.levels ? (
          <ul className="space-y-1">
            {p.levels.bars.map((b) => (
              <li key={b.label} className="grid grid-cols-[5.5rem_minmax(0,1fr)_4.5rem] items-center gap-2 text-xs">
                <span>{b.label}</span>
                <span className="h-2 rounded-full bg-muted">
                  <span className="block h-2 rounded-full bg-uc-serie-1" style={{ width: `${Math.round(b.share * 100)}%` }} />
                </span>
                <span className="text-right tabular-nums">{formatInteger(b.count)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{T.levelsHidden}</p>
        )}
        {p.levels ? (
          <Source>
            Solo gruppi: mai il livello di una persona. Da {formatInteger(p.levels.total)} {"risposte all'AI Readiness."}
            {p.levels.grouped ? " Livelli uniti a coppie: da solo, un livello avrebbe meno di 5 risposte." : ""}
          </Source>
        ) : null}
      </Section>
      {p.readiness ? (
        <Section title="AI Readiness">
          <Pairs rows={[["Media", `${p.readiness.overall.toLocaleString("it-IT", { maximumFractionDigits: 1 })} su 5`], ...Object.entries(p.readiness.pillars).map(([k, v]) => [readinessPillarText(k), v === null ? "—" : v.toLocaleString("it-IT", { maximumFractionDigits: 1 })] as [string, ReactNode])]} />
        </Section>
      ) : null}
      {p.areas.length ? (
        <Section title="Prontezza per area">
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-xs tabular-nums">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    Area
                  </th>
                  {Object.keys(p.areas[0].pillars).map((k) => (
                    <th key={k} scope="col" className="px-2 py-1.5 text-right font-medium">
                      {readinessPillarText(k)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {p.areas.map((a) => (
                  <tr key={a.unit} className="border-b last:border-0">
                    <th scope="row" className="px-2 py-1 text-left font-normal">
                      {a.unit}
                    </th>
                    {Object.values(a.pillars).map((v, i) => (
                      <td key={i} className="px-2 py-1 text-right">
                        {v === null ? "—" : v.toLocaleString("it-IT", { maximumFractionDigits: 1 })}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Source>{"Un'area con meno di 5 risposte non si mostra."}</Source>
        </Section>
      ) : null}
    </div>
  );
}

function GoalsPanel({ view }: { view: ProgramView }) {
  const cards = view.initiatives.flatMap((r) => r.cards).map((c) => ({ id: c.id, code: c.code, title: c.title }));
  const keyResults = view.objectives.flatMap((o) => o.keyResults.map((kr) => ({ id: kr.id, title: kr.title })));
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-6">
      <Section title="Risultati chiave">
        {view.objectives.length ? (
          view.objectives.map((o) => (
            <div key={o.id} className="space-y-2">
              <p className="text-sm font-medium">
                {o.title}
                {o.timeframe ? <span className="font-normal text-muted-foreground"> · {o.timeframe}</span> : null}
              </p>
              <ul className="divide-y rounded-lg border">
                {o.keyResults.map((kr) => (
                  <li key={kr.id} className="space-y-2 px-3 py-2.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <span className="min-w-0 text-sm break-words">{kr.title}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        base {kpiValueText(kr.base, kr.unit)} · adesso <span className="text-foreground">{kpiValueText(kr.now, kr.unit)}</span> · obiettivo {kpiValueText(kr.target, kr.unit)}
                        {kr.progress !== null ? ` · ${Math.round(kr.progress)} %` : ""}
                      </span>
                    </div>
                    {kr.progress !== null ? (
                      <span className="block h-1.5 rounded-full bg-muted" aria-hidden>
                        <span className="block h-1.5 rounded-full bg-uc-serie-3" style={{ width: `${Math.round(kr.progress)}%` }} />
                      </span>
                    ) : null}
                    {view.viewer.canEdit ? (
                      open === kr.id ? (
                        <KeyResultEditor workspaceId={view.workspaceId} kr={kr} today={view.today} cards={cards} />
                      ) : (
                        <Button type="button" variant="ghost" size="sm" className="-ml-2 min-h-11 sm:min-h-7" onClick={() => setOpen(kr.id)}>
                          Aggiorna
                        </Button>
                      )
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">{T.noGoals}</p>
            <Button render={<Link href={`/dashboard/${view.workspaceId}/strategy`} />} nativeButton={false} variant="outline" size="sm">
              {T.addInStrategy}
            </Button>
          </div>
        )}
      </Section>
      <Section title="KPI">
        {view.kpis.length ? (
          <ul className="divide-y rounded-lg border">
            {view.kpis.map((k) => (
              <li key={k.id} className="space-y-2 px-3 py-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="min-w-0 text-sm break-words">
                    {k.label}
                    <span className="ml-1 text-xs text-muted-foreground">{k.kind === "risultato" ? "Risultato" : "Iniziativa"}</span>
                  </span>
                  <span className="text-sm font-medium tabular-nums">{kpiValueText(k.now, k.unit)}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {k.source === "automatico" ? "Calcolato da Unbundle." : k.source === "formula" ? (view.viewer.canEdit ? `Formula: ${k.formula}.` : "Calcolato con una formula.") : k.lastPeriod ? `A mano, ultimo valore di ${monthLongLabel(k.lastPeriod)}${k.lastSource === "brain" ? " (dal Brain)" : ""}.` : "A mano: nessun valore ancora."}
                  {k.target !== null ? ` Obiettivo ${kpiValueText(k.target, k.unit)}.` : ""}
                  {k.broken ? " La formula usa un KPI che non c'è più." : ""}
                </p>
                {k.progress !== null ? (
                  <span className="block h-1.5 rounded-full bg-muted" aria-hidden>
                    <span className="block h-1.5 rounded-full bg-uc-serie-3" style={{ width: `${Math.round(k.progress)}%` }} />
                  </span>
                ) : null}
                {view.viewer.canEdit ? (
                  open === k.id ? (
                    <KpiEditor workspaceId={view.workspaceId} kpi={k} keyResults={keyResults} month={view.today.slice(0, 7)} />
                  ) : (
                    <Button type="button" variant="ghost" size="sm" className="-ml-2 min-h-11 sm:min-h-7" onClick={() => setOpen(k.id)}>
                      {k.source === "manuale" ? "Scrivi il valore" : T.edit}
                    </Button>
                  )
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Nessun KPI attivo.</p>
        )}
        {view.viewer.canEdit ? (
          <div className="space-y-2 pt-2">
            <p className="text-xs font-medium">Catalogo</p>
            <KpiCatalog workspaceId={view.workspaceId} active={view.kpis} />
            <CustomKpiForm workspaceId={view.workspaceId} />
          </div>
        ) : null}
      </Section>
    </div>
  );
}

function SalPanel({ view }: { view: ProgramView }) {
  return (
    <div className="space-y-4">
      {view.sal.lastOn ? (
        <Section title={T.changedSince(view.sal.lastOn)}>
          {view.sal.changes.length ? (
            <ul className="space-y-1 text-sm">
              {view.sal.changes.map((c) => (
                <li key={c.key}>{salChangeText(c)}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{T.nothingChanged}</p>
          )}
        </Section>
      ) : (
        <p className="text-sm text-muted-foreground">{T.noSalYet}</p>
      )}
      <Source>Ogni mese il sistema fotografa i numeri da solo; un SAL chiuso li fotografa quel giorno.</Source>
    </div>
  );
}

/** Il contenuto di un pannello. */
function PanelBody({ panel, view }: { panel: ProgramPanel; view: ProgramView }) {
  const r = view.results;
  switch (panel) {
    case "valore":
      return (
        <div className="space-y-4">
          <p className="text-3xl font-semibold tabular-nums">{formatEuro(r.estimated)}</p>
          <Pairs
            rows={[
              ...view.initiatives.map((row) => [T.stage[row.stage], formatEuro(row.value)] as [string, ReactNode]),
              ...(view.metrics.valore_misurato_pct !== null ? ([["Di cui misurato nel dossier", formatPct(view.metrics.valore_misurato_pct)]] as Array<[string, ReactNode]>) : []),
            ]}
          />
          <Trend rows={view.trend.map((t) => [t.period, t.estimated === null ? "—" : formatEuro(t.estimated)])} />
          <Source>Le cifre delle schede degli use case approvati, in realizzazione e realizzati, {T.onUseCases(r.estimatedCount)}.</Source>
        </div>
      );
    case "in-uso":
      return (
        <div className="space-y-4">
          <Trend rows={view.trend.map((t) => [t.period, t.inUse === null ? "—" : formatEuro(t.inUse)])} />
          <StagePanel view={view} stage="in_uso" />
        </div>
      );
    case "dipendente":
      return (
        <div className="space-y-4">
          <p className="text-3xl font-semibold tabular-nums">{r.perEmployee === null || r.inUseCount === 0 ? "—" : formatEuro(r.perEmployee)}</p>
          <Trend rows={view.trend.map((t) => [t.period, t.perEmployee === null ? "—" : formatEuro(t.perEmployee)])} />
          <Source>{"Il valore già in uso all'anno diviso per i dipendenti."}{r.perEmployeeOfRevenuePct !== null && r.perEmployeeOfRevenuePct > 0 ? ` È ${T.ofRevenue(r.perEmployeeOfRevenuePct)}.` : ""}</Source>
          <Pairs
            rows={[
              ["Dipendenti", view.company.employees === null ? "—" : `${formatInteger(view.company.employees)} · ${view.company.employeesSource === "discovery" ? "dalla Discovery" : "scritto a mano"}`],
              ["Ricavo dell'ultimo anno", view.company.revenueEur === null ? "—" : `${formatEuro(view.company.revenueEur)} · ${view.company.revenueSource === "discovery" ? "dalla Discovery" : "scritto a mano"}`],
            ]}
          />
          {view.viewer.canEdit ? <FactsEditor view={view} /> : null}
        </div>
      );
    case "indice":
      return <IndexPanel view={view} />;
    case "curva":
      return <CurvePanel view={view} />;
    case "in_uso":
    case "in_realizzazione":
    case "da_avviare":
      return <StagePanel view={view} stage={panel} />;
    case "supporto":
      return <SupportPanel view={view} />;
    case "formazione":
    case "persone":
      return <PeoplePanel view={view} />;
    case "rivedere":
      return (
        <div className="space-y-3">
          <ul className="divide-y rounded-lg border">
            {view.review.map((x) => (
              <li key={x.id} className="space-y-1 px-3 py-2.5">
                <Link href={x.href} className="text-sm font-medium hover:underline">
                  {x.code ? <span className="mr-1 font-mono text-xs text-muted-foreground">{x.code}</span> : null}
                  {x.title}
                </Link>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {formatEuro(x.value)} {"all'anno per"} {formatEuro(x.run)} di mantenimento: {x.ratio.toLocaleString("it-IT", { maximumFractionDigits: 1 })} € per ogni euro.
                </p>
              </li>
            ))}
          </ul>
          <Source>Uno use case in uso è da rivedere se rende meno di {REVIEW_RATIO} € per ogni euro che costa tenerlo acceso.</Source>
        </div>
      );
    case "obiettivi":
      return <GoalsPanel view={view} />;
    case "sal":
      return <SalPanel view={view} />;
  }
}

/** Il pannello aperto: da destra sul computer, dal basso sul telefono; si chiude con Esc o toccando fuori. */
export function ProgramPanelSheet({ panel, view, onClose }: { panel: ProgramPanel | null; view: ProgramView; onClose: () => void }) {
  return (
    <DetailSheetFrame open={panel !== null} onOpenChange={(next) => (next ? undefined : onClose())} title={panel ? PANEL_TITLE[panel] : ""} size="xl">
      {panel ? <PanelBody panel={panel} view={view} /> : null}
      {panel ? <p className="pt-2 text-xs text-muted-foreground">Aggiornato al {longDate(view.today)}.</p> : null}
    </DetailSheetFrame>
  );
}
