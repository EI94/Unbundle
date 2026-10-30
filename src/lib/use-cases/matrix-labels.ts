/**
 * Dove mettere il tag o il codice accanto ai punti della matrice Valore × Costo (docs/use-case/
 * DESIGN.md §4.4; H4p) e alle bolle di «Matrice Facilità × Beneficio», e dove mettere i nomi delle
 * quattro zone della matrice.
 *
 * Un'etichetta si scrive solo accanto a un punto **isolato** e solo dove sta **libera a ogni
 * larghezza**: un punto con un altro a meno di `isolationPx` pixel (bordo a bordo, sul riquadro più
 * piccolo) fa parte di un gruppo fitto e resta senza etichetta (il gruppo si legge nell'elenco
 * sotto il grafico, e ogni punto ha il suo riquadro al passaggio del mouse). Un'etichetta libera
 * non copre altri punti né altre etichette, non esce dal riquadro, non tocca gli ostacoli
 * (`obstacles`: i nomi delle zone, le linee tratteggiate, la striscia delle bolle senza beneficio)
 * e resta a `clearancePx` pixel dagli altri punti, così sta accanto al suo punto e non a quello di
 * un altro agente.
 *
 * Il calcolo è in pixel, sul riquadro più piccolo in cui il grafico si disegna (`boxPx` di
 * larghezza, `aspect` l'altezza sulla larghezza) e, con `maxBoxPx`, anche su quello più grande e
 * su uno in mezzo: le etichette hanno una misura fissa mentre i punti si allontanano. Per ogni
 * punto si provano le posizioni in ordine (a destra, a sinistra, sopra, sotto, poi le diagonali,
 * poi le stesse più lontane) e si prende la prima libera a ogni larghezza; se nessuna lo è,
 * l'etichetta non c'è. Un punto può avere il suo raggio (`radiusPx`, le bolle). Lo spostamento è
 * dal centro del punto all'angolo in alto a sinistra dell'etichetta, in pixel.
 *
 * Con `wideFromPx` c'è un secondo livello: un punto senza un posto libero a ogni larghezza (o non
 * isolato sul riquadro più piccolo) può avere l'etichetta da `wideFromPx` in su, se lì è isolato e
 * libero (`wide`); chi disegna la nasconde sotto quella larghezza. Su TopJet la colonna «€» al
 * telefono è larga 61 px e «LIBRA L1» non ci sta senza passare la linea del costo basso; da 440
 * px sì.
 *
 * Modulo puro: nessun import.
 */

export interface MatrixLabelInput {
  id: string;
  /** Posizione del punto in percentuale del riquadro, da 0 a 100 (sinistra → destra). */
  left: number;
  /** Posizione del punto in percentuale del riquadro, da 0 a 100 (alto → basso). */
  top: number;
  /** Il testo dell'etichetta: il tag o il codice; vuoto, nessuna etichetta (il punto resta un ostacolo). */
  text: string;
  /** Raggio del punto in pixel (le bolle); senza, `dotPx / 2`. */
  radiusPx?: number;
}

export interface MatrixLabelPlacement {
  /** Spostamento orizzontale dell'angolo in alto a sinistra dell'etichetta dal centro del punto, in pixel. */
  dx: number;
  /** Spostamento verticale, in pixel. */
  dy: number;
  /** Solo da `wideFromPx` in su: sotto, l'etichetta non c'è. */
  wide: boolean;
}

/** Un rettangolo in pixel sul riquadro. */
export interface LabelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MatrixLabelOptions {
  /** Larghezza del riquadro più piccolo, in pixel. */
  boxPx?: number;
  /** Larghezza del riquadro più grande, in pixel (predefinita `boxPx`). */
  maxBoxPx?: number;
  /** Da questa larghezza in su un'etichetta può esserci anche se sul riquadro più piccolo non sta (`wide`). */
  wideFromPx?: number;
  /** Altezza del riquadro sulla larghezza (predefinita 1, un quadrato). */
  aspect?: number;
  /** Larghezza di un carattere dell'etichetta (monospazio, 10 px: 6 px misurati), in pixel. */
  charPx?: number;
  /** Altezza dell'etichetta, in pixel. */
  heightPx?: number;
  /** Diametro del punto (con il suo bordo), in pixel. */
  dotPx?: number;
  /** Un punto con un altro più vicino di così (bordo a bordo, sul riquadro più piccolo) non ha etichetta. */
  isolationPx?: number;
  /** Distanza minima tra un'etichetta e i punti degli altri, in pixel. */
  clearancePx?: number;
  /** Quel che le etichette non devono coprire, per ogni misura del riquadro. */
  obstacles?: (box: { w: number; h: number }) => readonly LabelRect[];
}

const DEFAULTS = { boxPx: 320, charPx: 6.2, heightPx: 13, dotPx: 12, isolationPx: 12, clearancePx: 6 } as const;

function overlap(a: LabelRect, b: LabelRect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Quanto l'etichetta esce dal riquadro, come area. */
function outside(rect: LabelRect, boxW: number, boxH: number): number {
  return rect.w * rect.h - overlap(rect, { x: 0, y: 0, w: boxW, h: boxH });
}

/** La larghezza di un'etichetta, in pixel. */
export function labelWidthPx(text: string, charPx: number = DEFAULTS.charPx): number {
  return Math.ceil([...text].length * charPx) + 4;
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
 * Le posizioni delle etichette che si scrivono: solo i punti isolati con una posizione libera a
 * ogni larghezza (o, con `wideFromPx`, a ogni larghezza da lì in su). Chi viene prima sceglie
 * prima: l'ordine è quello della matrice (`buildPriority`) o delle bolle, mai per persona.
 */
export function placeMatrixLabels(points: readonly MatrixLabelInput[], options: MatrixLabelOptions = {}): Map<string, MatrixLabelPlacement> {
  const { boxPx, charPx, heightPx, dotPx, isolationPx, clearancePx } = { ...DEFAULTS, ...options };
  const maxBox = Math.max(boxPx, options.maxBoxPx ?? boxPx);
  const aspect = options.aspect && options.aspect > 0 ? options.aspect : 1;
  const wideFrom = options.wideFromPx;
  const tiered = typeof wideFrom === "number" && wideFrom > boxPx && wideFrom <= maxBox;
  const widths = tiered ? [boxPx, wideFrom, (wideFrom + maxBox) / 2, maxBox] : maxBox > boxPx ? [boxPx, (boxPx + maxBox) / 2, maxBox] : [boxPx];
  // Le larghezze di ogni livello: tutte, oppure da `wideFromPx` in su.
  const firstWide = tiered ? 1 : widths.length;
  const radius = (point: MatrixLabelInput) => (typeof point.radiusPx === "number" && point.radiusPx > 0 ? point.radiusPx : dotPx / 2);
  const scales = widths.map((boxW) => {
    const boxH = boxW * aspect;
    const centers = points.map((point) => ({ x: (point.left / 100) * boxW, y: (point.top / 100) * boxH }));
    return { boxW, boxH, centers, obstacles: options.obstacles?.({ w: boxW, h: boxH }) ?? [] };
  });
  const isolatedAt = (scale: (typeof scales)[number]) =>
    points.map((point, index) =>
      points.every((other, j) => {
        if (j === index) return true;
        const a = scale.centers[index];
        const b = scale.centers[j];
        return Math.hypot(a.x - b.x, a.y - b.y) - radius(point) - radius(other) >= isolationPx;
      }),
    );
  const isolated = isolatedAt(scales[0]);
  const isolatedWide = tiered ? isolatedAt(scales[firstWide]) : isolated;
  // Le etichette già messe, con la prima larghezza a cui si vedono.
  const placed: Array<{ index: number; dx: number; dy: number; w: number; h: number; from: number }> = [];
  const out = new Map<string, MatrixLabelPlacement>();
  points.forEach((point, index) => {
    if (!point.text) return;
    const w = labelWidthPx(point.text, charPx);
    const h = heightPx;
    const freeAt = (at: number, dx: number, dy: number) => {
      const scale = scales[at];
      const center = scale.centers[index];
      const rect = { x: center.x + dx, y: center.y + dy, w, h };
      if (outside(rect, scale.boxW, scale.boxH) > 0) return false;
      for (const [i, other] of points.entries()) {
        if (i === index) continue;
        // Gli altri punti con il loro margine: l'etichetta sta accanto al suo, non a quello di un altro.
        const r = radius(other) + clearancePx;
        const c = scale.centers[i];
        if (overlap(rect, { x: c.x - r, y: c.y - r, w: 2 * r, h: 2 * r }) > 0) return false;
      }
      for (const other of placed) {
        if (at < other.from) continue;
        const c = scale.centers[other.index];
        if (overlap(rect, { x: c.x + other.dx, y: c.y + other.dy, w: other.w, h: other.h }) > 0) return false;
      }
      return scale.obstacles.every((obstacle) => overlap(rect, obstacle) === 0);
    };
    const freeFrom = (from: number) => candidates(w, h, radius(point)).find(([dx, dy]) => scales.every((_, at) => at < from || freeAt(at, dx, dy)));
    let from = 0;
    let chosen = isolated[index] ? freeFrom(0) : undefined;
    if (!chosen && tiered && isolatedWide[index]) {
      from = firstWide;
      chosen = freeFrom(firstWide);
    }
    if (!chosen) return;
    placed.push({ index, dx: chosen[0], dy: chosen[1], w, h, from });
    out.set(point.id, { dx: Math.round(chosen[0]), dy: Math.round(chosen[1]), wide: from > 0 });
  });
  return out;
}

// ─── I nomi delle zone della matrice ─────────────────────────────────

/** Le quattro zone, con il lato della linea del costo basso e la metà del Valore. */
export interface ZoneLabelInput {
  key: string;
  text: string;
  /** A sinistra della linea del costo basso (costo basso) o a destra. */
  side: "low" | "high";
  /** Sopra la linea del «Valore alto» o sotto. */
  half: "top" | "bottom";
}

/**
 * Dove sta il nome di una zona: nell'angolo esterno del riquadro («outer», come sempre) oppure
 * nell'angolo della zona accanto alla linea del «Valore alto» («inner»), se lì copre meno punti.
 */
export type ZoneLabelSpot = "outer" | "inner";

export interface ZoneLabelGeometry {
  /** La linea del costo basso, in percentuale da sinistra. */
  lowLeftPct: number;
  /** La linea del «Valore alto», in percentuale dall'alto. */
  highTopPct: number;
}

/** Misure del nome di una zona (text-xs, `leading-tight`; 6,3 px a carattere misurati, qui 6,6). */
export const ZONE_LABEL_METRICS = Object.freeze({ charPx: 6.6, lineHeightPx: 15, insetXPx: 8, insetYPx: 6, lineGapPx: 6, sideGapPx: 12 });

/** Le righe di un testo che va a capo tra le parole entro `maxPx`, con la larghezza della più lunga. */
function wrapText(text: string, maxPx: number, charPx: number): { lines: number; width: number } {
  const words = text.split(/\s+/).filter(Boolean);
  let lines = 0;
  let width = 0;
  let current = 0;
  for (const word of words) {
    const wordPx = [...word].length * charPx;
    const next = current ? current + charPx / 2 + wordPx : wordPx;
    if (current && next > maxPx) {
      lines += 1;
      width = Math.max(width, current);
      current = wordPx;
    } else current = next;
  }
  if (current) {
    lines += 1;
    width = Math.max(width, current);
  }
  return { lines: Math.max(1, lines), width };
}

/**
 * Il rettangolo del nome di una zona su un riquadro largo `w` e alto `h`, in pixel: a sinistra della
 * linea del costo basso va a capo prima della linea, a destra si allinea a destra; in alto o in
 * basso nel riquadro («outer»), oppure accanto alla linea del «Valore alto» («inner»).
 */
export function zoneLabelRect(zone: ZoneLabelInput, spot: ZoneLabelSpot, geometry: ZoneLabelGeometry, box: { w: number; h: number }): LabelRect {
  const m = ZONE_LABEL_METRICS;
  const lowX = (geometry.lowLeftPct / 100) * box.w;
  const highY = (geometry.highTopPct / 100) * box.h;
  const maxPx = zone.side === "low" ? lowX - m.sideGapPx : box.w - m.insetXPx - (lowX + m.insetXPx);
  const { lines, width } = wrapText(zone.text, Math.max(m.charPx, maxPx), m.charPx);
  const h = lines * m.lineHeightPx;
  const x = zone.side === "low" ? m.insetXPx : box.w - m.insetXPx - width;
  let y: number;
  if (zone.half === "top") y = spot === "outer" ? m.insetYPx : highY - m.lineGapPx - h;
  else y = spot === "outer" ? box.h - m.insetYPx - h : highY + m.lineGapPx;
  return { x, y, w: width, h };
}

/**
 * Dove scrivere il nome di ogni zona: nell'angolo esterno, oppure accanto alla linea del «Valore
 * alto» se l'angolo esterno copre più punti (somma sulle larghezze `widths`). TopJet: quindici use
 * case in basso a sinistra, nella colonna «€» con Valore 1-2, e «Se avanza tempo» sotto la linea.
 */
export function placeZoneLabels(
  zones: readonly ZoneLabelInput[],
  points: readonly { left: number; top: number; radiusPx: number }[],
  geometry: ZoneLabelGeometry,
  widths: readonly number[],
): Record<string, ZoneLabelSpot> {
  const out: Record<string, ZoneLabelSpot> = {};
  for (const zone of zones) {
    const covered = (spot: ZoneLabelSpot) =>
      widths.reduce((sum, w) => {
        const rect = zoneLabelRect(zone, spot, geometry, { w, h: w });
        return (
          sum +
          points.filter((point) => {
            const r = point.radiusPx + 2;
            return overlap(rect, { x: (point.left / 100) * w - r, y: (point.top / 100) * w - r, w: 2 * r, h: 2 * r }) > 0;
          }).length
        );
      }, 0);
    out[zone.key] = covered("inner") < covered("outer") ? "inner" : "outer";
  }
  return out;
}
