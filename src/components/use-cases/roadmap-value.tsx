import type { HubItem } from "@/lib/use-cases/views";
import { buildLeverChart, groupLegend, groupOf, roadmapValueItems, type GroupPalette, type RoadmapValue } from "@/lib/use-cases/value-charts";
import type { ValueParams } from "@/lib/use-cases/value-model";
import { ValueByLever } from "./value-by-lever";
import { ValueJCurve } from "./value-jcurve";
import { ValueParamsSummary } from "./value-params-summary";

export const ROADMAP_VALUE_TEXT = Object.freeze({
  label: "Benefici e costi della roadmap",
});

export interface RoadmapValueChartsProps {
  /** I conti di `buildRoadmapValue`: ci sono solo se almeno una scheda ha «Benefici e costi». */
  value: RoadmapValue;
  /** Le schede dei revisori della vista, già filtrate. */
  items: readonly HubItem[];
  params: ValueParams;
  palette: GroupPalette;
  /** id → il pannello laterale. */
  hrefs: Readonly<Record<string, string>>;
  /** Il primo mese della curva segue il mese corrente (non è salvato). */
  followsCurrentMonth?: boolean;
  /** Impostazioni › Valutazione, solo per chi gestisce il workspace. */
  settingsHref?: string | null;
}

/**
 * I grafici di «Benefici e costi» della Roadmap, sotto le cifre in testa (spec di Pierpaolo,
 * 25/10/2026): la J-curve e «Valore per tipo di ritorno», poi il riquadro chiuso «Ipotesi di
 * calcolo» con le ipotesi del workspace in sola lettura. Solo per i revisori, e solo se almeno una
 * scheda della vista ha un modello (chi chiama passa `value` solo allora).
 */
export function RoadmapValueCharts({ value, items, params, palette, hrefs, followsCurrentMonth = false, settingsHref = null }: RoadmapValueChartsProps) {
  const levers = buildLeverChart(items, params, palette);
  const legend = groupLegend(
    palette,
    roadmapValueItems(items).map((item) => groupOf(item.valueModel)),
  );
  return (
    <section aria-label={ROADMAP_VALUE_TEXT.label} data-slot="roadmap-value" className="space-y-3">
      <div className="rounded-xl border bg-card p-4">
        <ValueJCurve value={value} />
      </div>
      <div className="rounded-xl border bg-card p-4">
        <ValueByLever chart={levers} hrefs={hrefs} legend={legend} />
      </div>
      <ValueParamsSummary params={params} followsCurrentMonth={followsCurrentMonth} settingsHref={settingsHref} />
    </section>
  );
}
