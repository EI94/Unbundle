/**
 * Dove mettere il codice accanto a ogni punto della matrice Valore × Costo (docs/use-case/
 * DESIGN.md §4.4; H4p): ogni punto ha la sua etichetta, e le etichette non si coprono tra loro
 * né coprono gli altri punti, finché c'è posto.
 *
 * Il calcolo è in pixel su un quadrato di `boxPx` (il più piccolo in cui la matrice si disegna,
 * al telefono): su un quadrato più grande i punti si allontanano e le etichette, che restano
 * della stessa misura, si coprono ancora meno. Per ogni punto si provano le posizioni in ordine
 * (a destra, a sinistra, sopra, sotto, poi le diagonali, poi le stesse più lontane) e si prende la
 * prima libera e dentro il quadrato; se nessuna è libera, quella che copre meno. Lo spostamento
 * è dal centro del punto all'angolo in alto a sinistra dell'etichetta, in pixel.
 *
 * Modulo puro: nessun import.
 */

export interface MatrixLabelInput {
  id: string;
  /** Posizione del punto in percentuale del quadrato, da 0 a 100 (sinistra → destra). */
  left: number;
  /** Posizione del punto in percentuale del quadrato, da 0 a 100 (alto → basso). */
  top: number;
  /** Il testo dell'etichetta: il codice. */
  text: string;
}

export interface MatrixLabelPlacement {
  /** Spostamento orizzontale dell'angolo in alto a sinistra dell'etichetta dal centro del punto, in pixel. */
  dx: number;
  /** Spostamento verticale, in pixel. */
  dy: number;
  /** L'etichetta copre qualcosa anche nella posizione scelta: si disegna lo stesso, più tenue. */
  crowded: boolean;
}

export interface MatrixLabelOptions {
  /** Lato del quadrato più piccolo, in pixel. */
  boxPx?: number;
  /** Larghezza di un carattere dell'etichetta (monospazio, 10 px), in pixel. */
  charPx?: number;
  /** Altezza dell'etichetta, in pixel. */
  heightPx?: number;
  /** Diametro del punto (con il suo bordo), in pixel. */
  dotPx?: number;
}

const DEFAULTS = { boxPx: 320, charPx: 6.2, heightPx: 13, dotPx: 12 } as const;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Quanto l'etichetta esce dal quadrato, come area. */
function outside(rect: Rect, box: number): number {
  const inside = overlap(rect, { x: 0, y: 0, w: box, h: box });
  return rect.w * rect.h - inside;
}

/** Le posizioni candidate, in ordine di preferenza, come spostamento dell'angolo dell'etichetta dal centro del punto. */
function candidates(w: number, h: number, r: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const gap of [r + 2, r + 2 + h]) {
    out.push(
      [gap, -h / 2], // destra
      [-gap - w, -h / 2], // sinistra
      [-w / 2, -gap - h], // sopra
      [-w / 2, gap], // sotto
      [gap - 2, -gap - h + 2], // in alto a destra
      [gap - 2, gap - 2], // in basso a destra
      [-gap - w + 2, -gap - h + 2], // in alto a sinistra
      [-gap - w + 2, gap - 2], // in basso a sinistra
    );
  }
  return out;
}

/**
 * Le posizioni delle etichette, una per punto, nell'ordine dei punti (chi viene prima sceglie
 * prima: l'ordine è quello della lista di «Priorità», mai per persona).
 */
export function placeMatrixLabels(points: readonly MatrixLabelInput[], options: MatrixLabelOptions = {}): Map<string, MatrixLabelPlacement> {
  const { boxPx, charPx, heightPx, dotPx } = { ...DEFAULTS, ...options };
  const centers = points.map((point) => ({ id: point.id, x: (point.left / 100) * boxPx, y: (point.top / 100) * boxPx }));
  const dots: Rect[] = centers.map((c) => ({ x: c.x - dotPx / 2, y: c.y - dotPx / 2, w: dotPx, h: dotPx }));
  const placed: Rect[] = [];
  const out = new Map<string, MatrixLabelPlacement>();
  points.forEach((point, index) => {
    const center = centers[index];
    const w = Math.ceil([...point.text].length * charPx) + 4;
    const h = heightPx;
    let best: { dx: number; dy: number; cost: number } | null = null;
    for (const [dx, dy] of candidates(w, h, dotPx / 2)) {
      const rect = { x: center.x + dx, y: center.y + dy, w, h };
      let cost = outside(rect, boxPx) * 4;
      for (const [i, dot] of dots.entries()) if (i !== index) cost += overlap(rect, dot) * 2;
      for (const other of placed) cost += overlap(rect, other);
      if (!best || cost < best.cost) best = { dx, dy, cost };
      if (cost === 0) break;
    }
    const chosen = best!;
    placed.push({ x: center.x + chosen.dx, y: center.y + chosen.dy, w, h });
    out.set(point.id, { dx: Math.round(chosen.dx), dy: Math.round(chosen.dy), crowded: chosen.cost > 0 });
  });
  return out;
}
