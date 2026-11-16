/**
 * «Mappatura board»: dai nove valori di `activities.classification` ai tre stream
 * (docs/mappatura/MAPPATURA-BOARD-PIANO.md §4.1).
 *
 * La colonna tiene tre valori di oggi (`automate`, `differentiate`, `innovate`) e sei di prima. La board li piega come
 * faceva la dashboard del reparto: `automatable`, `blocked_by_system`, `blocked_by_governance` → Automate;
 * `augmentable`, `differentiating` → Differentiate; `emerging_opportunity` → Innovate. I sei posti che li piegano oggi
 * non cambiano.
 *
 * Modulo puro: importa solo il vocabolario. `STREAM_OF_CLASSIFICATION` serve anche a `board-sql.ts`, che scrive lo stesso
 * piegamento in SQL (il confronto di `step.stream` e i conteggi di `listUnitBoards`).
 */
import type { Stream } from "./vocab.ts";

/** Ogni valore che la colonna può tenere (l'enum `classification`, drizzle/0000), con il suo stream. */
export const STREAM_OF_CLASSIFICATION: Readonly<Record<string, Stream>> = Object.freeze({
  automate: "automate",
  differentiate: "differentiate",
  innovate: "innovate",
  automatable: "automate",
  augmentable: "differentiate",
  differentiating: "differentiate",
  emerging_opportunity: "innovate",
  blocked_by_system: "automate",
  blocked_by_governance: "automate",
});

/** Lo stream di un valore salvato; null se manca o non è uno dei nove. */
export function streamOf(classification: string | null): Stream | null {
  if (typeof classification !== "string") return null;
  return Object.hasOwn(STREAM_OF_CLASSIFICATION, classification) ? STREAM_OF_CLASSIFICATION[classification] : null;
}
