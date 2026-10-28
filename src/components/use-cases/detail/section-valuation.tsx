import { COST_BANDS, type CostBandInfo } from "@/lib/use-cases/cost-bands";
import { showsZone, zoneText } from "@/lib/use-cases/format";
import type { Dimension, ValuationModel } from "@/lib/use-cases/valuation";
import type { ValueParams } from "@/lib/use-cases/value-model";
import { hubValueParams, type UseCaseDetail } from "@/lib/use-cases/views";
import { unofficialEstimateLines } from "@/lib/use-cases/estimates";
import { cn } from "@/lib/utils";
import { CostFigure } from "../cost-figure";
import { ValueFigure } from "../value-figure";
import { RiskChips } from "./risk-chips";
import { ValuationEditor } from "./valuation-form";

/** I testi del capitolo (§6.3, §14.3). */
export const SECTION_VALUATION_TEXT = Object.freeze({
  title: "Valutazione",
  zone: "Zona",
  zoneHint: "(un suggerimento, non la decisione)",
});

/** Un gruppo di KPI del modello del workspace nel modulo «Modifica valutazione». */
export interface ValuationKpiGroup {
  dimension: Dimension;
  /** «Valore», «Fattibilità», «ESG». */
  title: string;
  kpis: Array<{ id: string; label: string; description: string | null }>;
}

/** I nomi dei gruppi: l'impatto è il Valore (§14.1), la fattibilità resta tale, poi ESG. */
const GROUP_TITLE: Readonly<Record<Dimension, string>> = { impact: "Valore", feasibility: "Fattibilità", esg: "ESG" };

/**
 * L'etichetta di un KPI come la scrive il modello del workspace. Il KPI dello sforzo del modello
 * predefinito si chiama in inglese: nell'area si dice «Sforzo» (§14.5 vieta la parola inglese).
 */
export function kpiDisplayLabel(kpi: { id: string; label?: unknown }): string {
  const label = typeof kpi.label === "string" && kpi.label.trim() ? kpi.label.trim() : kpi.id;
  return /^effort$/i.test(label) ? "Sforzo" : label;
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * I KPI del modello del workspace per il modulo (§6.3): Valore (impatto), Fattibilità ed ESG se
 * attivo, con l'etichetta e la rubrica scritte nel modello. Il modello arriva da
 * `getUseCaseDetail` (`normalizeScoringConfig`, che porta anche etichette e descrizioni).
 */
export function valuationKpiGroups(model: Pick<ValuationModel, "dimensions">, opts: { esgEnabled: boolean }): ValuationKpiGroup[] {
  const dimensions: Dimension[] = opts.esgEnabled ? ["impact", "feasibility", "esg"] : ["impact", "feasibility"];
  return dimensions.flatMap((dimension) => {
    const kpis = (model.dimensions[dimension] ?? []).map((kpi) => {
      const extra = kpi as { label?: unknown; description?: unknown };
      return { id: kpi.id, label: kpiDisplayLabel({ id: kpi.id, label: extra.label }), description: textOrNull(extra.description) };
    });
    return kpis.length ? [{ dimension, title: GROUP_TITLE[dimension], kpis }] : [];
  });
}

/** I punteggi delle persone come partono nel modulo: interi da 1 a 5, solo i KPI del modello. */
export function personKpiValues(
  customScores: UseCaseDetail["customScores"],
  groups: readonly ValuationKpiGroup[],
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const group of groups) {
    const dim = customScores?.[group.dimension];
    if (!dim || typeof dim !== "object") continue;
    for (const kpi of group.kpis) {
      const value = (dim as Record<string, unknown>)[kpi.id];
      if (typeof value === "number" && Number.isFinite(value) && value > 0) (out[group.dimension] ??= {})[kpi.id] = Math.min(5, Math.max(1, Math.round(value)));
    }
  }
  return out;
}

export interface SectionValuationProps {
  workspaceId: string;
  detail: Pick<
    UseCaseDetail,
    "id" | "version" | "value" | "cost" | "zone" | "intake" | "risks" | "aiSuggestion" | "customScores" | "valueEurYear" | "costEurOnce" | "costBand" | "valueModel"
  >;
  model: Pick<ValuationModel, "dimensions">;
  /** Le ipotesi di calcolo del workspace (`getUseCaseDetail`); assenti: le predefinite. */
  valueParams?: ValueParams;
  /** Oggi a Roma, per le ipotesi predefinite. */
  today?: string;
  /** Le fasce del costo del workspace (D15, `resolveCostBands`). */
  costBands?: readonly CostBandInfo[];
  esgEnabled: boolean;
  /** `canEditValuation`: tutti i revisori. */
  canEdit: boolean;
  id?: string;
  className?: string;
}

/**
 * Il capitolo «Valutazione» della scheda, solo per i revisori (docs/use-case/DESIGN.md §6.3,
 * §6.7, §7): Valore e Costo di realizzazione, due cifre grandi con la loro fonte (una colonna sul
 * telefono), la zona come suggerimento, solo per un Valore senza cifra in euro (`showsZone`), un
 * solo riquadro «Stime non ufficiali» (la stima di Claude e quella di chi ha proposto, se ci sono
 * dati, e il «Suggerimento AI», sotto la frase «Conta la valutazione del team.»), i chip di
 * rischio e «Modifica valutazione», che apre il modulo sul posto. Il costo usa le fasce del
 * workspace (D15).
 */
export function SectionValuation({
  workspaceId,
  detail,
  model,
  costBands = COST_BANDS,
  valueParams,
  today,
  esgEnabled,
  canEdit,
  id = "valutazione",
  className,
}: SectionValuationProps) {
  const headingId = `${id}-titolo`;
  const params = valueParams ?? hubValueParams({ today: today ?? new Date().toISOString().slice(0, 10) });
  const groups = valuationKpiGroups(model, { esgEnabled });
  return (
    <section id={id} aria-labelledby={headingId} data-slot="section-valuation" className={cn("scroll-mt-28 space-y-4", className)}>
      <h2 id={headingId} className="text-base font-semibold">
        {SECTION_VALUATION_TEXT.title}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <ValueFigure value={detail.value} form="lunga" withLabel />
        <CostFigure cost={detail.cost} bands={costBands} form="lunga" withLabel />
      </div>
      {/* Con una cifra in euro basta la cifra: la zona resta nella matrice. */}
      {showsZone(detail.value) ? (
        <p className="text-sm">
          <span className="text-muted-foreground">{SECTION_VALUATION_TEXT.zone}: </span>
          <span className={cn(detail.zone ? "font-medium" : "text-muted-foreground")}>{zoneText(detail.zone, detail.value)}</span>
          {detail.zone ? <span className="text-muted-foreground"> {SECTION_VALUATION_TEXT.zoneHint}</span> : null}
        </p>
      ) : null}
      <ValuationEditor
        workspaceId={workspaceId}
        item={{ id: detail.id, version: detail.version }}
        groups={groups}
        personValues={personKpiValues(detail.customScores, groups)}
        valueEurYear={detail.valueEurYear}
        savedCost={{ costEurOnce: detail.costEurOnce, costBand: detail.costBand }}
        costBands={costBands}
        suggestion={detail.aiSuggestion ? { scores: detail.aiSuggestion.scores, rationale: detail.aiSuggestion.rationale, at: detail.aiSuggestion.at } : null}
        valueModel={detail.valueModel}
        valueParams={params}
        estimateLines={unofficialEstimateLines(detail.intake)}
        canEdit={canEdit}
        risks={<RiskChips risks={detail.risks} />}
      />
    </section>
  );
}
