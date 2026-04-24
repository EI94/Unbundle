"use client";

import { useActionState } from "react";
import {
  savePortfolioReviewAction,
  suggestPortfolioScoresWithAiAction,
  type ActionState,
} from "@/lib/actions/portfolio";
import type { ScoringModelConfig, ScoringKpi } from "@/lib/db/queries/scoring-model";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sparkles } from "lucide-react";
import { useState, useTransition } from "react";

const INITIAL: ActionState = { ok: true };

type ReviewFormProps = {
  workspaceId: string;
  useCaseId: string;
  config: ScoringModelConfig;
  esgEnabled: boolean;
  initial: {
    customScores: {
      impact?: Record<string, number>;
      feasibility?: Record<string, number>;
      esg?: Record<string, number>;
    };
    portfolioReviewStatus: string;
    reviewNotes: string;
  };
};

const statusOptions = [
  { value: "needs_inputs", label: "Dati mancanti" },
  { value: "in_review", label: "In review" },
  { value: "scored", label: "Valutato" },
  { value: "archived", label: "Archiviato" },
];

export function ReviewForm({
  workspaceId,
  useCaseId,
  config,
  esgEnabled,
  initial,
}: ReviewFormProps) {
  const boundAction = savePortfolioReviewAction.bind(null, workspaceId, useCaseId);
  const [state, formAction, pending] = useActionState(boundAction, INITIAL);

  const [aiState, setAiState] = useState<ActionState | null>(null);
  const [aiPending, startTransition] = useTransition();

  const handleSuggestAi = () => {
    startTransition(async () => {
      const res = await suggestPortfolioScoresWithAiAction(workspaceId, useCaseId);
      setAiState(res);
    });
  };

  const fe = state.fieldErrors ?? {};

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button
          type="button"
          variant="secondary"
          onClick={handleSuggestAi}
          disabled={aiPending}
        >
          <Sparkles className="mr-1 h-4 w-4" />
          {aiPending ? "L'AI sta valutando…" : "Suggerisci punteggi con AI"}
        </Button>
      </div>

      {aiState && (
        <div
          className={`rounded-md border p-3 text-sm ${
            aiState.ok
              ? "border-green-500/30 bg-green-500/5 text-green-500"
              : "border-red-500/30 bg-red-500/5 text-red-500"
          }`}
          role="status"
        >
          {aiState.message}
        </div>
      )}

      <form action={formAction} className="space-y-6">
        <DimensionScoreGrid
          dim="impact"
          title="Impatto"
          kpis={config.dimensions.impact}
          initialScores={initial.customScores.impact ?? {}}
          fieldErrors={fe}
        />

        <DimensionScoreGrid
          dim="feasibility"
          title="Fattibilità"
          kpis={config.dimensions.feasibility}
          initialScores={initial.customScores.feasibility ?? {}}
          fieldErrors={fe}
        />

        {esgEnabled && (
          <DimensionScoreGrid
            dim="esg"
            title="ESG"
            kpis={config.dimensions.esg}
            initialScores={initial.customScores.esg ?? {}}
            fieldErrors={fe}
          />
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">Stato review</label>
            <Select name="portfolioReviewStatus" defaultValue={initial.portfolioReviewStatus || "in_review"}>
              <SelectTrigger>
                <SelectValue placeholder="Seleziona stato" />
              </SelectTrigger>
              <SelectContent>
                {statusOptions.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fe["portfolioReviewStatus"] && (
              <p className="text-xs text-red-500">
                {fe["portfolioReviewStatus"]}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Note reviewer</label>
            <Textarea
              name="reviewNotes"
              defaultValue={initial.reviewNotes}
              rows={4}
              placeholder="Note, assunzioni, cosa manca, next step…"
            />
          </div>
        </div>

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

        <div className="flex items-center justify-end">
          <Button type="submit" disabled={pending}>
            {pending ? "Salvo…" : "Salva valutazione"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function DimensionScoreGrid({
  dim,
  title,
  kpis,
  initialScores,
  fieldErrors,
}: {
  dim: "impact" | "feasibility" | "esg";
  title: string;
  kpis: ScoringKpi[];
  initialScores: Record<string, number>;
  fieldErrors: Record<string, string>;
}) {
  if (kpis.length === 0) {
    return (
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground">
          Nessun KPI configurato per questa dimensione.
        </p>
      </section>
    );
  }
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{title} (0–5)</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {kpis.map((k) => {
          const key = `score__${dim}__${k.id}`;
          const err = fieldErrors[key];
          const initial = initialScores[k.id];
          return (
            <div key={k.id} className="space-y-1">
              <label className="text-xs">
                <span className="font-medium">{k.label}</span>
                {k.description && (
                  <span className="block text-[11px] text-muted-foreground">
                    {k.description}
                  </span>
                )}
              </label>
              <Input
                name={key}
                type="number"
                min={0}
                max={5}
                step={0.5}
                defaultValue={
                  typeof initial === "number" && Number.isFinite(initial)
                    ? initial
                    : ""
                }
                placeholder="0–5"
                aria-invalid={!!err}
              />
              {err && <p className="text-xs text-red-500">{err}</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
