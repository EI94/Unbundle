"use client";

import { ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requestAiSuggestionAction } from "@/lib/actions/use-case-edit";
import type { DecisionItem } from "@/lib/use-cases/decision-ui";
import { formatDate } from "@/lib/use-cases/format";
import type { KpiScoreMap } from "@/lib/use-cases/valuation";
import type { HubAiSuggestion } from "@/lib/use-cases/views";
import { cn } from "@/lib/utils";
import { useDecisionRunner } from "../decision-buttons";
import type { ValuationKpiGroup } from "./section-valuation";

/** I testi del riquadro (§6.3, §14.3). */
export const AI_SUGGESTION_TEXT = Object.freeze({
  title: "Suggerimento AI",
  use: "Usa questi valori",
  askAgain: "Chiedi un nuovo suggerimento",
  ask: "Chiedi un suggerimento",
  none: "Nessun suggerimento, per ora.",
  suggestedOn: "Suggerito il",
});

/** Un punteggio dell'AI che c'è: un numero da 1 a 5. */
function aiScore(scores: KpiScoreMap | null | undefined, dimension: ValuationKpiGroup["dimension"], kpiId: string): number | null {
  const dim = scores?.[dimension];
  const value = dim && typeof dim === "object" ? (dim as Record<string, unknown>)[kpiId] : undefined;
  return typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= 5 ? value : null;
}

/**
 * I punteggi dell'AI per i KPI del modello del workspace, per gruppo: «Efficienza 4». Solo i KPI
 * del modello: un punteggio di un KPI tolto dal modello non si mostra e non si copia.
 */
export function aiScoreRows(scores: KpiScoreMap | null | undefined, groups: readonly ValuationKpiGroup[]): Array<{ title: string; items: Array<{ id: string; label: string; value: number }> }> {
  const out: Array<{ title: string; items: Array<{ id: string; label: string; value: number }> }> = [];
  for (const group of groups) {
    const items = group.kpis.flatMap((kpi) => {
      const value = aiScore(scores, group.dimension, kpi.id);
      return value === null ? [] : [{ id: kpi.id, label: kpi.label, value }];
    });
    if (items.length) out.push({ title: group.title, items });
  }
  return out;
}

/** I punteggi da copiare nel modulo con «Usa questi valori»: interi da 1 a 5, solo i KPI del modello. */
export function aiValuesForForm(scores: KpiScoreMap | null | undefined, groups: readonly ValuationKpiGroup[]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const group of groups) {
    for (const kpi of group.kpis) {
      const value = aiScore(scores, group.dimension, kpi.id);
      if (value === null) continue;
      (out[group.dimension] ??= {})[kpi.id] = Math.min(5, Math.max(1, Math.round(value)));
    }
  }
  return out;
}

/** C'è un suggerimento da mostrare: punteggi di KPI del modello o una motivazione. */
export function hasAiSuggestion(suggestion: Pick<HubAiSuggestion, "scores" | "rationale"> | null | undefined, groups: readonly ValuationKpiGroup[]): boolean {
  return aiScoreRows(suggestion?.scores, groups).length > 0 || Boolean(suggestion?.rationale?.trim());
}

export interface AiSuggestionBoxProps {
  workspaceId: string;
  item: Pick<DecisionItem, "id" | "version">;
  /** `ai_suggestion` della scheda (punteggi e motivazione); null se l'AI non l'ha ancora scritto. */
  suggestion: Pick<HubAiSuggestion, "scores" | "rationale" | "at"> | null;
  groups: readonly ValuationKpiGroup[];
  /** `canEditValuation`: «Usa questi valori» e «Chiedi un nuovo suggerimento». */
  canEdit: boolean;
  /** «Usa questi valori»: copia nel modulo, non salva. */
  onUse: (values: Record<string, Record<string, number>>) => void;
  className?: string;
}

/**
 * «Suggerimento AI» del capitolo «Valutazione» (docs/use-case/DESIGN.md §6.3, §7.6), chiuso: i
 * punteggi dell'AI per KPI e la motivazione, da `ai_suggestion`. «Usa questi valori» li copia nel
 * modulo senza salvare; «Chiedi un nuovo suggerimento» scrive solo `ai_suggestion`, che non cambia
 * `version`: si può poi salvare la valutazione con la versione di prima.
 */
export function AiSuggestionBox({ workspaceId, item, suggestion, groups, canEdit, onUse, className }: AiSuggestionBoxProps) {
  const { run, pending } = useDecisionRunner();
  const rows = aiScoreRows(suggestion?.scores, groups);
  const rationale = suggestion?.rationale?.trim() ? suggestion.rationale : null;
  const on = formatDate(suggestion?.at ?? null);
  const hasSuggestion = hasAiSuggestion(suggestion, groups);

  function ask() {
    if (pending) return;
    void run(item, (version) => requestAiSuggestionAction(workspaceId, item.id, version));
  }

  return (
    <details data-slot="ai-suggestion-box" className={cn("group rounded-lg border border-border", className)}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 px-3 text-sm font-medium select-none [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        {AI_SUGGESTION_TEXT.title}
      </summary>
      <div className="space-y-3 border-t border-border px-3 py-3 text-sm">
        {hasSuggestion ? (
          <>
            {rows.map((group) => (
              <div key={group.title} className="space-y-0.5">
                <p className="text-muted-foreground">{group.title}</p>
                <p>{group.items.map((kpi) => `${kpi.label} ${kpi.value}`).join(" · ")}</p>
              </div>
            ))}
            {rationale ? <p className="whitespace-pre-line text-muted-foreground">{rationale}</p> : null}
            {on ? (
              <p className="text-xs text-muted-foreground">
                {AI_SUGGESTION_TEXT.suggestedOn} {on}
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-muted-foreground">{AI_SUGGESTION_TEXT.none}</p>
        )}
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            {rows.length ? (
              <Button type="button" variant="outline" className="min-h-11 sm:min-h-8" onClick={() => onUse(aiValuesForForm(suggestion?.scores, groups))}>
                {AI_SUGGESTION_TEXT.use}
              </Button>
            ) : null}
            <Button type="button" variant="outline" aria-busy={pending || undefined} className="min-h-11 sm:min-h-8" onClick={ask}>
              {pending ? <Loader2 aria-hidden className="animate-spin" /> : null}
              {hasSuggestion ? AI_SUGGESTION_TEXT.askAgain : AI_SUGGESTION_TEXT.ask}
            </Button>
          </div>
        ) : null}
      </div>
    </details>
  );
}
