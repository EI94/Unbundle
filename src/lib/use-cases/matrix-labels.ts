/**
 * Dove mettere il codice accanto a ogni punto della matrice Valore × Costo (docs/use-case/
 * DESIGN.md §4.4; H4p) e accanto a ogni bolla di «Matrice Facilità × Beneficio»: ogni punto ha
 * la sua etichetta, e le etichette non si coprono tra loro né coprono gli altri punti, finché c'è
 * posto.
 *
 * Il calcolo è in pixel, sul riquadro più piccolo in cui il grafico si disegna (`boxPx` di
 * larghezza, `aspect` l'altezza sulla larghezza) e, con `maxBoxPx`, anche su quello più grande e
 * su uno in mezzo: le etichette hanno una misura fissa mentre i punti si allontanano, e due
 * etichette messe una sotto e una sopra (incrociate) libere sul riquadro piccolo possono coprirsi
 * su quello grande. Per ogni punto si provano le posizioni in ordine (a destra, a sinistra, sopra,
 * sotto, poi le diagonali, poi le stesse più lontane) e si prende la prima libera e dentro il
 * riquadro a ogni larghezza. Se nessuna lo è, la prima libera sul riquadro più grande (lo schermo
 * largo, dove il grafico si guarda di più); se nemmeno quella, quella che copre meno lì e poi sugli altri:
 * `crowded` dice che copre qualcosa sul riquadro più grande, `crowdedSmall` sui più piccoli. Un
 * punto può avere il suo raggio (`radiusPx`, le bolle). Lo spostamento è dal centro del punto
 * all'angolo in alto a sinistra dell'etichetta, in pixel.
 *
 * Modulo puro: nessun import.
 */

export interface MatrixLabelInput {
  id: string;
  /** Posizione del punto in percentuale del riquadro, da 0 a 100 (sinistra → destra). */
  left: number;
  /** Posizione del punto in percentuale del riquadro, da 0 a 100 (alto → basso). */
  top: number;
  /** Il testo dell'etichetta: il codice. */
  text: string;
  /** Raggio del punto in pixel (le bolle); senza, `dotPx / 2`. */
  radiusPx?: number;
}

export interface MatrixLabelPlacement {
  /** Spostamento orizzontale dell'angolo in alto a sinistra dell'etichetta dal centro del punto, in pixel. */
  dx: number;
  /** Spostamento verticale, in pixel. */
  dy: number;
  /** L'etichetta copre qualcosa anche nella posizione scelta, sul riquadro più grande. */
  crowded: boolean;
  /** …oppure su un riquadro più piccolo (senza `maxBoxPx`: uguale a `crowded`). */
  crowdedSmall: boolean;
}

export interface MatrixLabelOptions {
  /** Larghezza del riquadro più piccolo, in pixel. */
  boxPx?: number;
  /** Larghezza del riquadro più grande, in pixel (predefinita `boxPx`). */
  maxBoxPx?: number;
  /** Altezza del riquadro sulla larghezza (predefinita 1, un quadrato). */
  aspect?: number;
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

/** Quanto l'etichetta esce dal riquadro, come area. */
function outside(rect: Rect, boxW: number, boxH: number): number {
  const inside = overlap(rect, { x: 0, y: 0, w: boxW, h: boxH });
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
 * prima: l'ordine è quello della matrice, `buildPriority`, mai per persona).
 */
export function placeMatrixLabels(points: readonly MatrixLabelInput[], options: MatrixLabelOptions = {}): Map<string, MatrixLabelPlacement> {
  const { boxPx, charPx, heightPx, dotPx } = { ...DEFAULTS, ...options };
  const maxBox = Math.max(boxPx, options.maxBoxPx ?? boxPx);
  const aspect = options.aspect && options.aspect > 0 ? options.aspect : 1;
  const widths = maxBox > boxPx ? [boxPx, (boxPx + maxBox) / 2, maxBox] : [boxPx];
  const radius = (point: MatrixLabelInput) => (typeof point.radiusPx === "number" && point.radiusPx > 0 ? point.radiusPx : dotPx / 2);
  const scales = widths.map((boxW) => {
    const boxH = boxW * aspect;
    const centers = points.map((point) => ({ x: (point.left / 100) * boxW, y: (point.top / 100) * boxH }));
    const dots: Rect[] = centers.map((c, i) => {
      const r = radius(points[i]);
      return { x: c.x - r, y: c.y - r, w: 2 * r, h: 2 * r };
    });
    return { boxW, boxH, centers, dots };
  });
  const placed: Array<{ index: number; dx: number; dy: number; w: number; h: number }> = [];
  const out = new Map<string, MatrixLabelPlacement>();
  points.forEach((point, index) => {
    // Senza testo il punto non ha un'etichetta sua (il suo codice sta in quella del gruppo), ma resta un ostacolo.
    if (!point.text) return;
    const w = Math.ceil([...point.text].length * charPx) + 4;
    const h = heightPx;
    const costAt = (scale: (typeof scales)[number], dx: number, dy: number) => {
      const center = scale.centers[index];
      const rect = { x: center.x + dx, y: center.y + dy, w, h };
      let cost = outside(rect, scale.boxW, scale.boxH) * 4;
      for (const [i, dot] of scale.dots.entries()) if (i !== index) cost += overlap(rect, dot) * 2;
      for (const other of placed) {
        const at = scale.centers[other.index];
        cost += overlap(rect, { x: at.x + other.dx, y: at.y + other.dy, w: other.w, h: other.h });
      }
      return cost;
    };
    // La prima posizione libera a ogni larghezza; se non c'è, la prima libera sul riquadro più
    // grande (nell'ordine di preferenza: a destra prima di tutto); se nemmeno quella, la meno coperta.
    type Choice = { dx: number; dy: number; large: number; small: number };
    let perfect: Choice | null = null;
    let largeFree: Choice | null = null;
    let least: Choice | null = null;
    for (const [dx, dy] of candidates(w, h, radius(point))) {
      const large = costAt(scales[scales.length - 1], dx, dy);
      const small = scales.slice(0, -1).reduce((sum, scale) => sum + costAt(scale, dx, dy), 0);
      const choice = { dx, dy, large, small };
      if (large === 0 && small === 0) {
        perfect = choice;
        break;
      }
      if (large === 0 && !largeFree) largeFree = choice;
      if (!least || large < least.large || (large === least.large && small < least.small)) least = choice;
    }
    const chosen = (perfect ?? largeFree ?? least)!;
    placed.push({ index, dx: chosen.dx, dy: chosen.dy, w, h });
    out.set(point.id, { dx: Math.round(chosen.dx), dy: Math.round(chosen.dy), crowded: chosen.large > 0, crowdedSmall: chosen.small > 0 || chosen.large > 0 });
  });
  return out;
}

/**
 * I punti che cadono quasi nello stesso posto: entro `nearPct` punti percentuali dal primo del
 * gruppo, nelle due direzioni (3 % è un punto di 10 px sulla matrice più piccola, 320 px). Gruppi di
 * indici nell'ordine dei punti; il primo di ogni gruppo è l'ancora. Chi disegna scrive un'etichetta
 * sola con tutti i codici del gruppo (`groupLabelTexts`): un codice coperto non sparisce dal grafico.
 */
export function groupNearPoints(points: readonly { left: number; top: number }[], nearPct = 3): number[][] {
  const groups: number[][] = [];
  points.forEach((point, index) => {
    const group = groups.find((members) => {
      const anchor = points[members[0]];
      return Math.abs(anchor.left - point.left) <= nearPct && Math.abs(anchor.top - point.top) <= nearPct;
    });
    if (group) group.push(index);
    else groups.push([index]);
  });
  return groups;
}

/**
 * Il testo dell'etichetta di ogni punto, per gruppi: il primo punto con un codice porta tutti i
 * codici del gruppo, «XX-0001, XX-0004»; gli altri "" (nessuna etichetta loro). Un punto senza
 * codice non ne ha.
 */
export function groupLabelTexts(codes: readonly (string | null)[], groups: readonly number[][]): string[] {
  const out = codes.map(() => "");
  for (const members of groups) {
    const withCode = members.filter((index) => codes[index]);
    if (withCode.length) out[withCode[0]] = withCode.map((index) => codes[index]).join(", ");
  }
  return out;
}
