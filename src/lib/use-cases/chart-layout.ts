/**
 * Dove stanno i punti dei grafici del menu «⋯» quando cadono uno sull'altro: la «Matrice Valore ×
 * Costo» (molti use case nella colonna «€» con un Valore vicino) e la «Matrice Facilità × Beneficio»
 * (la facilità è un intero da 1 a 5: le bolle con lo stesso beneficio si coprivano).
 *
 * - **Sciame** (`swarm`): il punto si sposta in orizzontale, il meno possibile, dentro la sua colonna
 *   (la fascia del costo, la facilità), finché non tocca più nessun altro; la y resta quella del dato
 *   (il Valore, il beneficio). Con `dy` il punto può anche salire o scendere di qualche pixel, dentro
 *   `yLo`-`yHi` (mai oltre la linea del «Valore alto»), quando la colonna è piena a quell'altezza:
 *   uno spostamento in verticale costa il doppio di uno in orizzontale. Se non c'è posto resta dove
 *   copre meno.
 * - **Striscia** (`packStrip`): le bolle senza un beneficio contato non hanno una y; stanno in una
 *   striscia sotto lo zero, ognuna nella colonna della sua facilità, il più in alto possibile.
 *
 * Il calcolo è in pixel sul riquadro più piccolo in cui il grafico si disegna. Il riquadro cresce
 * tenendo le proporzioni e i punti hanno una misura fissa: due punti che non si toccano sul più
 * piccolo non si toccano su nessuno. Chi disegna passa le posizioni in percentuale.
 *
 * Modulo puro: nessun import.
 */

export interface SwarmInput {
  /** Il centro voluto, in pixel: la x del dato. */
  x: number;
  /** La y del dato, in pixel: non cambia. */
  y: number;
  /** Raggio in pixel, con il bordo. */
  r: number;
  /** Il centro resta tra `lo` e `hi` (la colonna del punto). */
  lo: number;
  hi: number;
  /** Di quanti pixel la y può cambiare (predefinito 0: mai). */
  dy?: number;
  /** La y resta tra `yLo` e `yHi` anche spostata (la zona del punto). */
  yLo?: number;
  yHi?: number;
}

export interface SwarmPlacement {
  x: number;
  y: number;
  /** Nella colonna non c'era posto: il punto copre un altro punto. */
  overlaps: boolean;
}

/** Un punto già messo, che gli altri non devono toccare. */
export interface PlacedCircle {
  x: number;
  y: number;
  r: number;
}

const EPS = 1e-6;

function fits(x: number, y: number, r: number, placed: readonly PlacedCircle[], gap: number): boolean {
  return placed.every((other) => Math.hypot(x - other.x, y - other.y) >= r + other.r + gap - EPS);
}

/** Quanto il cerchio entra negli altri, sommato (per scegliere dove copre meno). */
function overlapDepth(x: number, y: number, r: number, placed: readonly PlacedCircle[], gap: number): number {
  return placed.reduce((sum, other) => sum + Math.max(0, r + other.r + gap - Math.hypot(x - other.x, y - other.y)), 0);
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), Math.max(lo, hi));
}

/**
 * La x libera più vicina a quella voluta, a quella y, dentro la colonna: la voluta stessa, i
 * bordi della colonna, o una delle due x in cui il cerchio tocca un punto già messo. null se nessuna è libera.
 */
function freeX(point: Pick<SwarmInput, "x" | "r" | "lo" | "hi">, y: number, placed: readonly PlacedCircle[], gap: number): number | null {
  const hi = Math.max(point.lo, point.hi);
  const want = clamp(point.x, point.lo, hi);
  const candidates = [want, point.lo, hi];
  for (const other of placed) {
    const need = point.r + other.r + gap;
    const dy = y - other.y;
    if (Math.abs(dy) >= need) continue;
    const dx = Math.sqrt(need * need - dy * dy);
    candidates.push(other.x - dx, other.x + dx);
  }
  let best: number | null = null;
  for (const x of candidates) {
    if (x < point.lo - EPS || x > hi + EPS) continue;
    if (!fits(x, y, point.r, placed, gap)) continue;
    const distance = Math.abs(x - want);
    // A pari distanza la x più piccola: lo stesso risultato a ogni resa.
    if (best === null || distance < Math.abs(best - want) - EPS || (Math.abs(distance - Math.abs(best - want)) <= EPS && x < best)) best = x;
  }
  return best;
}

/** La x della colonna dove il cerchio copre meno, a passi di un pixel. */
function leastCoveredX(point: Pick<SwarmInput, "x" | "r" | "lo" | "hi">, y: number, placed: readonly PlacedCircle[], gap: number): number {
  const hi = Math.max(point.lo, point.hi);
  const want = clamp(point.x, point.lo, hi);
  let best = want;
  let bestDepth = overlapDepth(want, y, point.r, placed, gap);
  for (let x = point.lo; x <= hi + EPS; x += 1) {
    const depth = overlapDepth(x, y, point.r, placed, gap);
    if (depth < bestDepth - EPS) {
      best = x;
      bestDepth = depth;
    }
  }
  return best;
}

/** Uno spostamento in verticale pesa il doppio: il dato è la y, la colonna è larga. */
const Y_WEIGHT = 2;

/**
 * Lo sciame: ogni punto, nell'ordine dato (chi viene prima resta più vicino al suo dato), va alla
 * x libera più vicina alla sua dentro la colonna, a `gap` pixel dagli altri; con `dy`, se costa
 * meno, a una y vicina. `placed`: punti già messi da non toccare.
 */
export function swarm(points: readonly SwarmInput[], { gap = 2, placed = [] }: { gap?: number; placed?: readonly PlacedCircle[] } = {}): SwarmPlacement[] {
  const taken: PlacedCircle[] = [...placed];
  return points.map((point) => {
    const yLo = Math.min(point.y, point.yLo ?? point.y);
    const yHi = Math.max(point.y, point.yHi ?? point.y);
    const want = clamp(point.x, point.lo, Math.max(point.lo, point.hi));
    let best: { x: number; y: number; cost: number } | null = null;
    // 0, +1, −1, +2, −2…: a pari costo la y del dato, poi la più vicina.
    for (let step = 0; step <= 2 * Math.floor(point.dy ?? 0); step++) {
      const shift = step === 0 ? 0 : step % 2 ? (step + 1) / 2 : -step / 2;
      if (best && Math.abs(shift) * Y_WEIGHT >= best.cost) break;
      const y = point.y + shift;
      if (y < yLo - EPS || y > yHi + EPS) continue;
      const x = freeX(point, y, taken, gap);
      if (x === null) continue;
      const cost = Math.abs(x - want) + Math.abs(shift) * Y_WEIGHT;
      if (!best || cost < best.cost - EPS) best = { x, y, cost };
    }
    const spot = best ? { x: best.x, y: best.y, overlaps: false } : { x: leastCoveredX(point, point.y, taken, gap), y: point.y, overlaps: true };
    taken.push({ x: spot.x, y: spot.y, r: point.r });
    return spot;
  });
}

export interface StripInput {
  /** Il centro voluto della colonna, in pixel. */
  x: number;
  r: number;
  lo: number;
  hi: number;
}

export interface StripLayout {
  placements: SwarmPlacement[];
  /** Il bordo più basso dei punti della striscia, in pixel (`top` senza punti). */
  bottom: number;
}

/**
 * La striscia sotto lo zero: ogni punto, nell'ordine dato, va alla prima altezza da `top` in giù
 * (un pixel alla volta) in cui la sua colonna ha una x libera, la più vicina al centro. Mai sopra
 * `top`; non tocca i punti di `placed` (le bolle con un beneficio piccolo, appena sopra lo zero).
 * Oltre `maxDepth` pixel resta dove copre meno.
 */
export function packStrip(
  points: readonly StripInput[],
  { top, gap = 2, placed = [], maxDepth = 600 }: { top: number; gap?: number; placed?: readonly PlacedCircle[]; maxDepth?: number },
): StripLayout {
  const taken: PlacedCircle[] = [...placed];
  let bottom = top;
  const placements = points.map((point) => {
    let spot: SwarmPlacement | null = null;
    for (let y = top + point.r; y <= top + point.r + maxDepth; y += 1) {
      const x = freeX(point, y, taken, gap);
      if (x !== null) {
        spot = { x, y, overlaps: false };
        break;
      }
    }
    if (!spot) {
      const y = top + point.r;
      spot = { x: leastCoveredX(point, y, taken, gap), y, overlaps: true };
    }
    taken.push({ x: spot.x, y: spot.y, r: point.r });
    bottom = Math.max(bottom, spot.y + point.r);
    return spot;
  });
  return { placements, bottom };
}
