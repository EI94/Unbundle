import { formatEuro } from "@/lib/use-cases/format";
import { shareLabel, type RoadmapTile, type RoadmapTotals } from "@/lib/use-cases/views";
import { ORIGIN_DOT_CLASS } from "./origin-chip";

/** Testi delle cifre in testa (docs/use-case/DESIGN.md §4.5, §14.3). */
export const TILES_TEXT = Object.freeze({
  label: "Cifre della roadmap",
  expectedValue: "Valore atteso all'anno",
  committedCost: "Costo impegnato",
  measuredValue: "Valore misurato",
});

export interface RoadmapTilesProps {
  totals: RoadmapTotals;
}

/**
 * Le cifre in testa alla Roadmap, solo per i revisori (docs/use-case/DESIGN.md §4.5): al massimo
 * tre. «Valore atteso all'anno» (Prossimi e In realizzazione), «Costo impegnato» (Prossimi «Da
 * costruire» e In realizzazione, con le fasce del workspace: una fascia vale il suo riferimento),
 * «Valore misurato» solo quando un dossier ha un ROI misurato (arriva con H6a; oggi non c'è).
 * Ognuna dice su quanti use case è calcolata e la quota delle due origini, con una barra
 * sottile e il testo. Una cifra senza use case non si mostra.
 */
export function RoadmapTiles({ totals }: RoadmapTilesProps) {
  const tiles: Array<{ key: string; label: string; tile: RoadmapTile }> = [];
  if (totals.expectedValue) tiles.push({ key: "valore", label: TILES_TEXT.expectedValue, tile: totals.expectedValue });
  if (totals.committedCost) tiles.push({ key: "costo", label: TILES_TEXT.committedCost, tile: totals.committedCost });
  if (!tiles.length) return null;
  return (
    // Al telefono le cifre stanno affiancate e piccole, così le colonne si vedono già nel primo
    // schermo: la quota delle origini resta come testo per i lettori di schermo (H7).
    <section aria-label={TILES_TEXT.label} data-slot="roadmap-tiles" className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3">
      {tiles.map(({ key, label, tile }) => (
        <div key={key} data-figure={`totale-${key}`} className="min-w-0 space-y-1 rounded-xl border bg-card p-3 sm:space-y-2 sm:p-4">
          <p className="text-xs text-muted-foreground sm:text-sm">{label}</p>
          <p className="text-lg font-semibold tracking-tight tabular-nums sm:text-2xl">{formatEuro(tile.amountEur)}</p>
          <p className="text-xs text-muted-foreground">{tile.note}</p>
          <div aria-hidden className="hidden h-1.5 overflow-hidden rounded-full bg-muted sm:flex">
            <span className={ORIGIN_DOT_CLASS.adoption} style={{ width: `${tile.share.adoption}%` }} />
            <span className={ORIGIN_DOT_CLASS.transformation} style={{ width: `${tile.share.transformation}%` }} />
          </div>
          <p className="sr-only text-xs text-muted-foreground sm:not-sr-only">{shareLabel(tile.share)}</p>
        </div>
      ))}
    </section>
  );
}
