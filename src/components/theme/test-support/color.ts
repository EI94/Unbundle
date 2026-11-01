/**
 * Solo per i test del tema (`src/components/theme/*.test.ts`): i rapporti di contrasto WCAG
 * calcolati dai colori scritti nel CSS (oklch, esadecimali), la gamma dello schermo, la tinta in
 * OKLCH e la vista di chi non distingue rosso e verde. Non lo importa nessun file dell'app.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export type Rgb = [number, number, number];

export interface Color {
  rgb: Rgb;
  alpha: number;
  /** I valori oklch scritti (per l'esadecimale, quelli calcolati). */
  L: number;
  C: number;
  h: number;
  inGamut: boolean;
}

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toGamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

function oklabToLinear(L: number, a: number, b: number): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** Da oklch a sRGB (0–1, con la gamma), tagliato dentro la gamma dello schermo. */
export function srgb(L: number, C: number, h: number): Rgb {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  return oklabToLinear(L, a, b).map((v) => toGamma(Math.min(1, Math.max(0, v)))) as Rgb;
}

/** Dentro la gamma sRGB, con una tolleranza da arrotondamento. */
export function inGamut(L: number, C: number, h: number): boolean {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  return oklabToLinear(L, a, b).every((v) => v >= -1e-4 && v <= 1 + 1e-4);
}

export function hexRgb(hex: string): Rgb {
  const n = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255) as Rgb;
}

export function oklab(rgb: Rgb): Rgb {
  const [r, g, b] = rgb.map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** La tinta OKLCH di un colore sRGB, in gradi da 0 a 360. */
export function hueOf(rgb: Rgb): number {
  const [, a, b] = oklab(rgb);
  return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
}

export const hueDistance = (a: number, b: number) => Math.min(Math.abs(a - b) % 360, 360 - (Math.abs(a - b) % 360));

/** Un colore scritto nel CSS: `oklch(L C h)`, `oklch(L C h / a)` (anche in %), `#rrggbb`. */
export function parseColor(value: string): Color {
  const ok = /^oklch\(\s*([\d.]+)(%)?\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+)(%)?)?\s*\)$/.exec(value.trim());
  if (ok) {
    const L = Number(ok[1]) / (ok[2] ? 100 : 1);
    const C = Number(ok[3]);
    const h = Number(ok[4]);
    const alpha = ok[5] === undefined ? 1 : Number(ok[5]) / (ok[6] ? 100 : 1);
    return { rgb: srgb(L, C, h), alpha, L, C, h, inGamut: inGamut(L, C, h) };
  }
  const hex = /^#([0-9a-fA-F]{6})$/.exec(value.trim());
  if (hex) {
    const rgb = hexRgb(value);
    const [L, a, b] = oklab(rgb);
    return { rgb, alpha: 1, L, C: Math.hypot(a, b), h: hueOf(rgb), inGamut: true };
  }
  throw new Error(`colore non letto: ${value}`);
}

const luminance = (rgb: Rgb) => {
  const [r, g, b] = rgb.map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** `fg` con l'opacità `alpha` sopra `bg`, come lo compone il browser. */
export const over = (fg: Rgb, bg: Rgb, alpha: number): Rgb => fg.map((v, i) => alpha * v + (1 - alpha) * bg[i]) as Rgb;

export function ratio(x: Rgb, y: Rgb): number {
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

/** Il colore visto sopra `surface`: con l'alfa si compone su di essa. */
export const on = (color: Color, surface: Rgb): Rgb => (color.alpha === 1 ? color.rgb : over(color.rgb, surface, color.alpha));

/** Il contrasto di `fg` (con l'opacità in più `alpha`) sopra `surface`. */
export const contrast = (fg: Color, surface: Rgb, alpha = 1): number => ratio(over(on(fg, surface), surface, alpha), surface);

export const atLeast = (value: number, min: number, what: string) => {
  if (!(value >= min)) throw new Error(`${what}: ${value.toFixed(2)}:1, serve almeno ${min}:1`);
};

// Deuteranopia e protanopia (Machado, Oliveira e Fernandes 2009, gravità piena).
const CVD: Record<string, number[][]> = {
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
};
const simulate = (rgb: Rgb, matrix: number[][]): Rgb => {
  const l = rgb.map(toLinear);
  return matrix.map((row) => toGamma(Math.min(1, Math.max(0, row[0] * l[0] + row[1] * l[1] + row[2] * l[2])))) as Rgb;
};
const distance = (x: Rgb, y: Rgb) => {
  const [p, q] = [oklab(x), oklab(y)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};
/** La distanza OKLab più piccola tra due colori, a vista piena e per chi non distingue rosso e verde. */
export const cvdDistance = (x: Rgb, y: Rgb) => Math.min(distance(x, y), ...Object.values(CVD).map((m) => distance(simulate(x, m), simulate(y, m))));

export const readRepo = (path: string) => readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");

export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** Le istruzioni di primo livello di un foglio CSS senza commenti: `@import …;` e i blocchi `selettore { … }`. */
export function topLevelRules(css: string): Array<{ selector: string; body: string; text: string }> {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Array<{ selector: string; body: string; text: string }> = [];
  let depth = 0;
  let start = 0;
  let open = -1;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === "{") {
      if (depth === 0) open = i;
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) {
        out.push({ selector: source.slice(start, open).trim(), body: source.slice(open + 1, i), text: source.slice(start, i + 1).trim() });
        start = i + 1;
      }
    } else if (char === ";" && depth === 0) {
      out.push({ selector: source.slice(start, i).trim(), body: "", text: source.slice(start, i + 1).trim() });
      start = i + 1;
    }
  }
  return out;
}

/** Le dichiarazioni `--nome: valore;` di un blocco, così come sono scritte. */
export function declarations(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[match[1]] = match[2].trim();
  return out;
}

export const COLOR_VALUE = /^(?:oklch\([^)]*\)|#[0-9a-fA-F]{6})$/;
