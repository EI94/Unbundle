"use client";

import {
  useActionState,
  useMemo,
  useState,
  useTransition,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  recalibratePortfolioScoresAction,
  updateScoringModelAction,
  type ActionState,
} from "@/lib/actions/portfolio";
import type {
  ScoringKpi,
  ScoringModelConfig,
} from "@/lib/db/queries/scoring-model";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";

const INITIAL: ActionState = { ok: true };

type Dim = "impact" | "feasibility" | "esg";
const dimLabels: Record<Dim, string> = {
  impact: "Impatto",
  feasibility: "Fattibilità",
  esg: "ESG",
};

const dimHelp: Record<Dim, string> = {
  impact:
    "Cosa rende un contributo ad alto impatto per la tua azienda (es. efficiency, profitability…).",
  feasibility:
    "Cosa rende un contributo facile o difficile da implementare (es. effort, dati, tecnologia…).",
  esg:
    "Impatto ambientale e sociale. Attivo solo se hai abilitato ESG in Integrazioni.",
};

function genId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().slice(0, 8);
  }
  return Math.random().toString(36).slice(2, 10);
}

function cloneKpis(kpis: ScoringKpi[]) {
  return kpis.map((k) => ({ ...k }));
}

export function ScoringModelForm({
  workspaceId,
  initialConfig,
  esgEnabled,
}: {
  workspaceId: string;
  initialConfig: ScoringModelConfig;
  esgEnabled: boolean;
}) {
  const boundAction = updateScoringModelAction.bind(null, workspaceId);
  const [state, formAction, pending] = useActionState(boundAction, INITIAL);
  const [recalibrateState, setRecalibrateState] = useState<ActionState<{ updated: number }> | null>(null);
  const [recalibrating, startRecalibration] = useTransition();
  const router = useRouter();

  const [impact, setImpact] = useState<ScoringKpi[]>(() =>
    cloneKpis(initialConfig.dimensions.impact)
  );
  const [feasibility, setFeasibility] = useState<ScoringKpi[]>(() =>
    cloneKpis(initialConfig.dimensions.feasibility)
  );
  const [esg, setEsg] = useState<ScoringKpi[]>(() =>
    cloneKpis(initialConfig.dimensions.esg)
  );
  const [overall, setOverall] = useState(initialConfig.overall);
  const [thresholds, setThresholds] = useState(initialConfig.thresholds);

  const setters: Record<Dim, Dispatch<SetStateAction<ScoringKpi[]>>> = {
    impact: setImpact,
    feasibility: setFeasibility,
    esg: setEsg,
  };
  const payload = useMemo(() => {
    return JSON.stringify({
      dimensions: { impact, feasibility, esg },
      overall,
      thresholds,
    });
  }, [impact, feasibility, esg, overall, thresholds]);

  const addKpi = (dim: Dim) =>
    setters[dim]((prev) => [
      ...prev,
      {
        id: genId(),
        label: "",
        description: "",
        weight: 1,
        direction: "higher_better",
      },
    ]);

  const removeKpi = (dim: Dim, idx: number) =>
    setters[dim]((prev) => prev.filter((_, i) => i !== idx));

  const patchKpi = (dim: Dim, idx: number, patch: Partial<ScoringKpi>) =>
    setters[dim]((prev) => {
      const next = prev.slice();
      next[idx] = { ...next[idx], ...patch };
      return next;
    });

  const fe = state.fieldErrors ?? {};

  const handleRecalibration = () => {
    startRecalibration(async () => {
      const result = await recalibratePortfolioScoresAction(workspaceId);
      setRecalibrateState(result);
      if (result.ok) {
        router.refresh();
      }
    });
  };

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="payload" value={payload} />

      {state.message && (
        <div
          className={`rounded-md border p-3 text-sm ${
            state.ok
              ? "border-green-500/30 bg-green-500/5 text-green-500"
              : "border-red-500/30 bg-red-500/5 text-red-500"
          }`}
          role="status"
        >
          {state.message}
        </div>
      )}

      {recalibrateState?.message && (
        <div
          className={`rounded-md border p-3 text-sm ${
            recalibrateState.ok
              ? "border-green-500/30 bg-green-500/5 text-green-500"
              : "border-red-500/30 bg-red-500/5 text-red-500"
          }`}
          role="status"
        >
          {recalibrateState.message}
        </div>
      )}

      <Dimension
        dim="impact"
        title={dimLabels.impact}
        help={dimHelp.impact}
        kpis={impact}
        onAdd={() => addKpi("impact")}
        onRemove={(i) => removeKpi("impact", i)}
        onPatch={(i, p) => patchKpi("impact", i, p)}
        fieldErrors={fe}
      />

      <Dimension
        dim="feasibility"
        title={dimLabels.feasibility}
        help={dimHelp.feasibility}
        kpis={feasibility}
        onAdd={() => addKpi("feasibility")}
        onRemove={(i) => removeKpi("feasibility", i)}
        onPatch={(i, p) => patchKpi("feasibility", i, p)}
        fieldErrors={fe}
      />

      {esgEnabled ? (
        <Dimension
          dim="esg"
          title={dimLabels.esg}
          help={dimHelp.esg}
          kpis={esg}
          onAdd={() => addKpi("esg")}
          onRemove={(i) => removeKpi("esg", i)}
          onPatch={(i, p) => patchKpi("esg", i, p)}
          fieldErrors={fe}
        />
      ) : (
        <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          ESG è disattivato a livello di workspace. Puoi attivarlo in{" "}
          <strong>Integrazioni</strong>: quando è ON, la dimensione ESG viene
          inclusa automaticamente nel ranking e puoi editare i KPI qui.
        </div>
      )}

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Pesi globali tra dimensioni</h3>
        <p className="text-xs text-muted-foreground">
          Non servono somme esatte a 1: Unbundle li normalizza automaticamente.
          ESG è ignorata se disattivata.
        </p>
        {fe["overall"] && (
          <p className="text-xs text-red-500">{fe["overall"]}</p>
        )}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <LabeledNumber
            label="Peso Impatto"
            value={overall.impact}
            onChange={(v) => setOverall((o) => ({ ...o, impact: v }))}
            error={fe["overall.impact"]}
          />
          <LabeledNumber
            label="Peso Fattibilità"
            value={overall.feasibility}
            onChange={(v) => setOverall((o) => ({ ...o, feasibility: v }))}
            error={fe["overall.feasibility"]}
          />
          <LabeledNumber
            label="Peso ESG"
            value={overall.esg}
            disabled={!esgEnabled}
            onChange={(v) => setOverall((o) => ({ ...o, esg: v }))}
            error={fe["overall.esg"]}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Soglie della matrice (0–5)</h3>
        <p className="text-xs text-muted-foreground">
          Determinano dove ricade un use case: Quick Win, Strategic Bet,
          Capability Builder, Not Yet.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <LabeledNumber
            label="High Impact ≥"
            value={thresholds.highImpact}
            onChange={(v) => setThresholds((t) => ({ ...t, highImpact: v }))}
            error={fe["thresholds.highImpact"]}
            step={0.1}
            min={0}
            max={5}
          />
          <LabeledNumber
            label="High Feasibility ≥"
            value={thresholds.highFeasibility}
            onChange={(v) =>
              setThresholds((t) => ({ ...t, highFeasibility: v }))
            }
            error={fe["thresholds.highFeasibility"]}
            step={0.1}
            min={0}
            max={5}
          />
          <LabeledNumber
            label="Mid Impact ≥"
            value={thresholds.midImpact}
            onChange={(v) => setThresholds((t) => ({ ...t, midImpact: v }))}
            error={fe["thresholds.midImpact"]}
            step={0.1}
            min={0}
            max={5}
          />
        </div>
      </section>

      <div className="flex items-center justify-end">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleRecalibration}
            disabled={recalibrating}
          >
            {recalibrating ? "Ricalibrazione…" : "Ricalibra tutti con Claude"}
          </Button>
          <Button type="submit" disabled={pending}>
          {pending ? "Salvataggio…" : "Salva modello"}
          </Button>
        </div>
      </div>
    </form>
  );
}

function Dimension({
  dim,
  title,
  help,
  kpis,
  onAdd,
  onRemove,
  onPatch,
  fieldErrors,
}: {
  dim: Dim;
  title: string;
  help: string;
  kpis: ScoringKpi[];
  onAdd: () => void;
  onRemove: (i: number) => void;
  onPatch: (i: number, patch: Partial<ScoringKpi>) => void;
  fieldErrors: Record<string, string>;
}) {
  const dimError = fieldErrors[`dimensions.${dim}`];
  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="text-xs text-muted-foreground">{help}</p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={onAdd}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Nuovo KPI
        </Button>
      </div>
      {dimError && <p className="text-xs text-red-500">{dimError}</p>}
      {kpis.length === 0 && (
        <p className="text-xs text-muted-foreground italic">
          Nessun KPI definito. Aggiungine almeno uno.
        </p>
      )}
      <ul className="space-y-3">
        {kpis.map((k, i) => {
          const labelErr = fieldErrors[`dimensions.${dim}.${i}.label`];
          const weightErr = fieldErrors[`dimensions.${dim}.${i}.weight`];
          return (
            <li key={k.id} className="rounded-md border p-3 space-y-2">
              <div className="grid grid-cols-1 md:grid-cols-[1fr_120px_180px_auto] gap-2 items-start">
                <div className="space-y-1">
                  <Input
                    placeholder="Nome KPI (es. Tempo liberato, Rischio regolatorio…)"
                    value={k.label}
                    onChange={(e) => onPatch(i, { label: e.target.value })}
                    aria-invalid={!!labelErr}
                  />
                  {labelErr && (
                    <p className="text-xs text-red-500">{labelErr}</p>
                  )}
                </div>
                <div className="space-y-1">
                  <Input
                    type="number"
                    min={0}
                    step={0.1}
                    placeholder="Peso"
                    value={Number.isFinite(k.weight) ? k.weight : 0}
                    onChange={(e) =>
                      onPatch(i, {
                        weight: Number(e.target.value.replace(",", ".")),
                      })
                    }
                    aria-invalid={!!weightErr}
                  />
                  {weightErr && (
                    <p className="text-xs text-red-500">{weightErr}</p>
                  )}
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground">
                    Direzione ranking
                  </label>
                  <select
                    value={k.direction ?? "higher_better"}
                    onChange={(e) =>
                      onPatch(i, {
                        direction:
                          e.target.value === "lower_better"
                            ? "lower_better"
                            : "higher_better",
                      })
                    }
                    className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none"
                  >
                    <option value="higher_better">Piu alto = meglio</option>
                    <option value="lower_better">Piu basso = meglio</option>
                  </select>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => onRemove(i)}
                  aria-label="Rimuovi KPI"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <Textarea
                placeholder="Descrizione (opzionale): come si valuta questo KPI? cosa distingue 1 da 5?"
                value={k.description ?? ""}
                onChange={(e) => onPatch(i, { description: e.target.value })}
                rows={2}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function LabeledNumber({
  label,
  value,
  onChange,
  disabled,
  error,
  step = 0.05,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
  error?: string;
  step?: number;
  min?: number;
  max?: number;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      <Input
        type="number"
        step={step}
        min={min}
        max={max}
        value={Number.isFinite(value) ? value : 0}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value.replace(",", ".")))}
        aria-invalid={!!error}
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
