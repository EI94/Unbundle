import { formatEuro, hoursFreedText } from "@/lib/use-cases/format";
import type { RoadmapValue } from "@/lib/use-cases/value-charts";
import { shareLabel, totalsNote, type RoadmapTile, type RoadmapTotals } from "@/lib/use-cases/views";
import type { Origin } from "@/lib/use-cases/types";
import { cn } from "@/lib/utils";
import { ORIGIN_DOT_CLASS } from "./origin-chip";

/** Testi delle cifre in testa (docs/use-case/DESIGN.md §4.5, §14.3; spec di Pierpaolo, 25/10/2026). */
export const TILES_TEXT = Object.freeze({
  label: "Cifre della roadmap",
  expectedValue: "Valore atteso all'anno",
  committedCost: "Costo impegnato",
  hoursFreed: "Ore liberate all'anno",
  breakeven: "Pareggio",
  measuredValue: "Valore misurato",
});

export interface RoadmapTilesProps {
  totals: RoadmapTotals;
  /**
   * I conti di «Benefici e costi» (`buildRoadmapValue`): con almeno una scheda con un modello
   * aggiungono «Ore liberate all'anno» e «Pareggio». null o assente: le cifre di oggi.
   */
  value?: RoadmapValue | null;
}

interface TileView {
  key: string;
  label: string;
  figure: string;
  note: string;
  share: Record<Origin, number> | null;
}

/**
 * Le cifre in testa alla Roadmap, solo per i revisori (docs/use-case/DESIGN.md §4.5): «Valore
 * atteso all'anno» (Prossimi e In realizzazione), «Costo impegnato» (Prossimi «Da costruire» e In
 * realizzazione, con le fasce del workspace: una fascia vale il suo riferimento) e, con «Benefici e
 * costi», «Ore liberate all'anno» (le ore contate) e «Pareggio» (il mese in cui la J-curve torna a
 * zero). Ognuna dice su quanti use case è calcolata; le prime due anche la quota delle due origini,
 * con una barra sottile e il testo. Una cifra senza use case non si mostra.
 */
export function RoadmapTiles({ totals, value = null }: RoadmapTilesProps) {
  const tiles: TileView[] = [];
  const money = (key: string, label: string, tile: RoadmapTile): TileView => ({ key, label, figure: formatEuro(tile.amountEur), note: tile.note, share: tile.share });
  if (totals.expectedValue) tiles.push(money("valore", TILES_TEXT.expectedValue, totals.expectedValue));
  if (totals.committedCost) tiles.push(money("costo", TILES_TEXT.committedCost, totals.committedCost));
  if (value) {
    const withHours = value.cards.filter((card) => card.hours > 0).length;
    if (withHours > 0) tiles.push({ key: "ore", label: TILES_TEXT.hoursFreed, figure: hoursFreedText(value.hours), note: totalsNote(withHours), share: null });
    if (value.breakevenText) tiles.push({ key: "pareggio", label: TILES_TEXT.breakeven, figure: value.breakevenText, note: totalsNote(value.cards.length), share: null });
  }
  if (!tiles.length) return null;
  return (
    // Al telefono le cifre stanno affiancate e piccole, così le colonne si vedono già nel primo
    // schermo: la quota delle origini resta come testo per i lettori di schermo (H7).
    <section aria-label={TILES_TEXT.label} data-slot="roadmap-tiles" className={cn("grid grid-cols-2 gap-2 sm:gap-3", tiles.length > 3 ? "lg:grid-cols-4" : "lg:grid-cols-3")}>
      {tiles.map((tile) => (
        <div key={tile.key} data-figure={`totale-${tile.key}`} className="min-w-0 space-y-1 rounded-xl border bg-card p-3 sm:space-y-2 sm:p-4">
          <p className="text-xs text-muted-foreground sm:text-sm">{tile.label}</p>
          <p className="text-lg font-semibold tracking-tight sm:text-2xl">{tile.figure}</p>
          <p className="text-xs text-muted-foreground">{tile.note}</p>
          {tile.share ? (
            <>
              <div aria-hidden className="hidden h-1.5 overflow-hidden rounded-full bg-muted sm:flex">
                <span className={ORIGIN_DOT_CLASS.adoption} style={{ width: `${tile.share.adoption}%` }} />
                <span className={ORIGIN_DOT_CLASS.transformation} style={{ width: `${tile.share.transformation}%` }} />
              </div>
              <p className="sr-only text-xs text-muted-foreground sm:not-sr-only">{shareLabel(tile.share)}</p>
            </>
          ) : null}
        </div>
      ))}
    </section>
  );
}
