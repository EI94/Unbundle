"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { UseCase } from "@/lib/db/schema";
import type { ScoringModelConfig } from "@/lib/db/queries/scoring-model";
import { buildPortfolioWavePlan } from "@/lib/portfolio/planning";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Download, Waves } from "lucide-react";

const currency = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

const kindLabels: Record<string, string> = {
  best_practice: "Best Practice",
  use_case_ai: "Use Case AI",
};

const sustainabilityBadgeClasses: Record<string, string> = {
  green: "bg-green-500/10 text-green-700 border-green-500/30",
  yellow: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  red: "bg-red-500/10 text-red-700 border-red-500/30",
  neutral: "bg-slate-500/10 text-slate-700 border-slate-500/30",
};

export function WavePlanner({
  workspaceId,
  items,
  config,
  esgEnabled,
}: {
  workspaceId: string;
  items: UseCase[];
  config: ScoringModelConfig;
  esgEnabled: boolean;
}) {
  const [waveBudget, setWaveBudget] = useState(150_000);
  const [waveDurationMonths, setWaveDurationMonths] = useState(3);
  const [selectedWaveId, setSelectedWaveId] = useState<string | null>(null);

  const plan = useMemo(
    () =>
      buildPortfolioWavePlan({
        items,
        config,
        esgEnabled,
        waveBudget,
        waveDurationMonths,
      }),
    [config, esgEnabled, items, waveBudget, waveDurationMonths]
  );

  const selectedWave =
    plan.waves.find((wave) => wave.id === selectedWaveId) ?? null;

  const exportHref = `/dashboard/${workspaceId}/portfolio/export?waveBudget=${waveBudget}&waveDurationMonths=${waveDurationMonths}`;

  return (
    <>
      <section className="space-y-5 rounded-[28px] border bg-linear-to-br from-sky-500/6 via-background to-emerald-500/8 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Waves className="h-4 w-4 text-sky-600" />
              <h3 className="text-base font-semibold">AI Transformation Waves</h3>
            </div>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Il piano viene autogenerato combinando ranking corrente, effort
              stimato e valore potenziale. Le stime economiche sono euristiche
              basate sui punteggi `efficiency`, `profitability` ed `effort`.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              window.location.href = exportHref;
            }}
          >
            <Download className="mr-1 h-4 w-4" />
            Export Excel
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <ControlCard
            label="Budget per wave"
            hint="Usato per packare i contributi per blocchi di delivery."
          >
            <Input
              type="number"
              min={10000}
              step={10000}
              value={waveBudget}
              onChange={(event) =>
                setWaveBudget(Math.max(10000, Number(event.target.value) || 150000))
              }
            />
          </ControlCard>
          <ControlCard
            label="Durata wave (mesi)"
            hint="Default 3 mesi, modificabile."
          >
            <Input
              type="number"
              min={1}
              max={12}
              step={1}
              value={waveDurationMonths}
              onChange={(event) =>
                setWaveDurationMonths(
                  Math.max(1, Math.min(12, Number(event.target.value) || 3))
                )
              }
            />
          </ControlCard>
          <MetricCard
            label="Contributi pianificati"
            value={String(plan.totals.items)}
            note={`${plan.waves.length} wave generate`}
          />
          <MetricCard
            label="Valore netto stimato"
            value={currency.format(plan.totals.estimatedNetValue)}
            note={`Budget allocato ${currency.format(plan.totals.budgetUsed)}`}
          />
        </div>

        {plan.waves.length === 0 ? (
          <div className="rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">
            Non ci sono ancora contributi rankizzati a sufficienza per generare
            una roadmap in waves.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="overflow-x-auto">
              <div className="flex min-w-max items-stretch gap-4 pb-2">
                {plan.waves.map((wave, index) => (
                  <div key={wave.id} className="flex items-center gap-4">
                    <button
                      type="button"
                      onClick={() => setSelectedWaveId(wave.id)}
                      className="w-[310px] rounded-[24px] border bg-background/90 p-4 text-left shadow-sm transition-transform hover:-translate-y-0.5 hover:border-sky-500/30"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                            {wave.label}
                          </div>
                          <div className="mt-1 text-lg font-semibold">
                            {wave.startLabel} → {wave.endLabel}
                          </div>
                        </div>
                        <Badge
                          variant="outline"
                          className={
                            wave.isOverBudget
                              ? "border-red-500/30 text-red-600"
                              : "border-emerald-500/30 text-emerald-700"
                          }
                        >
                          {currency.format(wave.budgetUsed)} / {currency.format(wave.budget)}
                        </Badge>
                      </div>

                      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                        <MiniMetric
                          label="Valore lordo"
                          value={currency.format(wave.totalEstimatedValue)}
                        />
                        <MiniMetric
                          label="Valore netto"
                          value={currency.format(wave.totalEstimatedNetValue)}
                        />
                        <MiniMetric
                          label="Contributi"
                          value={String(wave.items.length)}
                        />
                        <MiniMetric
                          label="Sustainability"
                          value={
                            typeof wave.avgSustainabilityScore === "number"
                              ? wave.avgSustainabilityScore.toFixed(1)
                              : "—"
                          }
                        />
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        {wave.items.slice(0, 4).map((item) => (
                          <span
                            key={item.useCase.id}
                            className="inline-flex max-w-full items-center gap-2 rounded-full bg-muted px-2.5 py-1 text-xs"
                          >
                            <ContributionShape kind={item.useCase.portfolioKind} />
                            <span className="truncate">{item.useCase.title}</span>
                          </span>
                        ))}
                        {wave.items.length > 4 && (
                          <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                            +{wave.items.length - 4} altri
                          </span>
                        )}
                      </div>
                    </button>

                    {index < plan.waves.length - 1 && (
                      <div className="h-px w-10 shrink-0 bg-border" />
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <MetricCard
                label="Budget complessivo"
                value={currency.format(plan.totals.budget)}
                note="Capacita teorica della roadmap"
              />
              <MetricCard
                label="Valore lordo stimato"
                value={currency.format(plan.totals.estimatedValue)}
                note="Somma del valore potenziale per tutte le wave"
              />
              <MetricCard
                label="Budget utilizzato"
                value={currency.format(plan.totals.budgetUsed)}
                note="Stimato a partire dal punteggio effort"
              />
            </div>
          </div>
        )}
      </section>

      <Dialog open={!!selectedWave} onOpenChange={(open) => !open && setSelectedWaveId(null)}>
        {selectedWave && (
          <DialogContent className="sm:max-w-4xl max-h-[86vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {selectedWave.label} · {selectedWave.startLabel} → {selectedWave.endLabel}
              </DialogTitle>
              <DialogDescription>
                Dettaglio della wave con costo stimato, impatto atteso e contributi
                inclusi nel piano.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 md:grid-cols-4">
              <MetricCard
                label="Budget wave"
                value={currency.format(selectedWave.budget)}
                note={`Usato ${currency.format(selectedWave.budgetUsed)}`}
              />
              <MetricCard
                label="Valore lordo"
                value={currency.format(selectedWave.totalEstimatedValue)}
                note="Stima combinata efficiency + profitability"
              />
              <MetricCard
                label="Valore netto"
                value={currency.format(selectedWave.totalEstimatedNetValue)}
                note="Valore potenziale meno costo implementativo"
              />
              <MetricCard
                label="Sustainability"
                value={
                  typeof selectedWave.avgSustainabilityScore === "number"
                    ? selectedWave.avgSustainabilityScore.toFixed(1)
                    : "—"
                }
                note="Media dei contributi in wave"
              />
            </div>

            <div className="space-y-3">
              {selectedWave.items.map((item) => (
                <div key={item.useCase.id} className="rounded-2xl border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-semibold">{item.useCase.title}</div>
                        <Badge variant="secondary" className="text-[10px]">
                          {kindLabels[item.useCase.portfolioKind ?? ""] ??
                            item.useCase.portfolioKind}
                        </Badge>
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${sustainabilityBadgeClasses[item.sustainabilityBand]}`}
                        >
                          Sustainability {item.sustainabilityScore?.toFixed(1) ?? "—"}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {item.useCase.description ?? "Nessuna descrizione disponibile."}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <MiniMetric
                        label="Costo"
                        value={currency.format(item.estimatedCost)}
                      />
                      <MiniMetric
                        label="Valore netto"
                        value={currency.format(item.estimatedNetValue)}
                      />
                      <MiniMetric
                        label="Efficiency"
                        value={item.efficiencyScore.toFixed(1)}
                      />
                      <MiniMetric
                        label="Effort"
                        value={item.effortScore.toFixed(1)}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}

function ControlCard({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl border bg-background/90 p-4">
      <div className="text-sm font-medium">{label}</div>
      <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="rounded-2xl border bg-background/90 p-4">
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 text-xl font-semibold">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{note}</div>
    </div>
  );
}

function MiniMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl bg-muted/50 px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-medium">{value}</div>
    </div>
  );
}

function ContributionShape({ kind }: { kind: string | null }) {
  if (kind === "best_practice") {
    return <span className="h-2.5 w-2.5 rounded-[3px] bg-slate-600" />;
  }
  return <span className="h-2.5 w-2.5 rounded-full bg-slate-600" />;
}
