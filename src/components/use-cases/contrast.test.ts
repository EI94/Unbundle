import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

// «Molto molto chiare», sui due temi: l'area «Use case» nel tema scuro del dashboard
// (il blocco `[data-use-case-root]` di globals.css, sopra `:root`) e le pagine pubbliche chiare
// (`.survey-light`: /rispondi, /r, /a, /s). Qui i rapporti di contrasto WCAG calcolati dai token
// oklch del CSS, e nei sorgenti le classi che li abbassavano (testo sbiadito, codici della matrice
// più tenui, avvisi in ambra fissa), perché non tornino.

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
const css = read("src/app/globals.css");

/** Da oklch a sRGB (0–1, con la gamma), tagliato dentro la gamma dello schermo. */
function srgb(L: number, C: number, h: number): number[] {
  const a = C * Math.cos((h * Math.PI) / 180), b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
    .map((v) => Math.min(1, Math.max(0, v)))
    .map((v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
}
const lum = (rgb: number[]) => { const [r, g, b] = rgb.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const over = (fg: number[], bg: number[], alpha: number) => fg.map((v, i) => alpha * v + (1 - alpha) * bg[i]);
const ratio = (x: number[], y: number[]) => { const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p); return (hi + 0.05) / (lo + 0.05); };

interface Token {
  rgb: number[];
  alpha: number;
}
type Tokens = Record<string, Token>;

/** Il blocco che parte dalla prima occorrenza di `marker`: il selettore e quello che sta tra le graffe. */
function block(marker: string): { selector: string; body: string } {
  const start = css.indexOf(marker);
  assert.ok(start >= 0, `blocco non trovato: ${marker}`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return { selector: css.slice(start, open), body: css.slice(open + 1, close) };
}

/** I token oklch di un blocco; l'alfa in percentuale diventa da 0 a 1. */
function tokens(body: string): Tokens {
  const out: Tokens = {};
  for (const match of body.matchAll(/--([\w-]+):\s*oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+)(%)?)?\s*\)/g)) {
    const alpha = match[5] === undefined ? 1 : Number(match[5]) / (match[6] ? 100 : 1);
    out[match[1]] = { rgb: srgb(Number(match[2]), Number(match[3]), Number(match[4])), alpha };
  }
  return out;
}

/** Il colore visto sopra `surface`: con l'alfa si compone su di essa. */
function on(token: Token, surface: number[]): number[] {
  return token.alpha === 1 ? token.rgb : over(token.rgb, surface, token.alpha);
}

const root = tokens(block(":root {").body);
const areaBlock = block("[data-use-case-root],");
const area: Tokens = { ...root, ...tokens(areaBlock.body) };
const dossierBlock = block("[data-uc-case-root],");
const lightTokens = tokens(block(".survey-light {").body);
const light: Tokens = { ...root, ...lightTokens };

const atLeast = (value: number, min: number, what: string) => assert.ok(value >= min, `${what}: ${value.toFixed(2)}:1, serve almeno ${min}:1`);

test("nell'area «Use case» i testi secondari sono molto chiari", () => {
  const t = area;
  const bg = t.background.rgb;
  const text = t["muted-foreground"];
  for (const surface of ["background", "card", "popover"]) atLeast(ratio(on(text, t[surface].rgb), t[surface].rgb), 7, `muted-foreground su ${surface}`);
  const surfaces: Array<[string, number[]]> = [
    ["muted", t.muted.rgb],
    ["accent", t.accent.rgb],
    ["muted/60 sul fondo", over(t.muted.rgb, bg, 0.6)],
    ["muted/50 sul popover", over(t.muted.rgb, t.popover.rgb, 0.5)],
  ];
  for (const [name, surface] of surfaces) atLeast(ratio(on(text, surface), surface), 6.5, `muted-foreground su ${name}`);
});

test("nell'area «Use case» bordi dei campi e fuoco almeno 3:1", () => {
  const t = area;
  const bg = t.background.rgb;
  const surfaces: Array<[string, number[]]> = [
    ["background", bg],
    ["popover", t.popover.rgb],
    ["muted/60 sul fondo", over(t.muted.rgb, bg, 0.6)],
  ];
  for (const [name, surface] of surfaces) {
    atLeast(ratio(on(t.input, surface), surface), 3, `input su ${name}`);
    // L'alone del fuoco è `ring-ring/50` (e `outline-ring/50` nella base).
    const ring = over(on(t.ring, surface), surface, 0.5);
    atLeast(ratio(ring, surface), 3, `ring/50 su ${name}`);
  }
  // Il grigio al 70%: i bordi dei pulsanti radio e le linee delle zone della matrice.
  for (const name of ["background", "card"]) {
    const surface = t[name].rgb;
    atLeast(ratio(over(on(t["muted-foreground"], surface), surface, 0.7), surface), 3, `muted-foreground/70 su ${name}`);
  }
});

test("il blocco dell'area vale anche nei portali, come quello del dossier", () => {
  assert.ok(areaBlock.selector.includes("[data-use-case-root]"));
  assert.ok(areaBlock.selector.includes("html:has([data-use-case-root])"));
  const slots = (selector: string) => new Set([...selector.matchAll(/data-slot="([^"]+)"/g)].map((match) => match[1]));
  const areaSlots = slots(areaBlock.selector);
  assert.ok(areaSlots.size > 0, "nessun portale nel selettore dell'area");
  assert.deepEqual(areaSlots, slots(dossierBlock.selector));
  // Il dossier tiene il suo blocco com'era: solo il grigio dei testi secondari.
  assert.deepEqual([...dossierBlock.body.matchAll(/--[\w-]+:[^;]*;/g)].map((match) => match[0]), ["--muted-foreground: oklch(0.62 0.01 260);"]);
});

test("il layout dell'area porta il segno, senza un riquadro in più", () => {
  const layout = read("src/app/(dashboard)/dashboard/[workspaceId]/use-cases/layout.tsx");
  assert.ok(layout.includes('data-use-case-root=""'));
  assert.ok(layout.includes('className="contents"'));
});

test(".survey-light è molto chiara", () => {
  const t = light;
  const bg = t.background.rgb;
  const card = t.card.rgb;
  for (const [name, surface] of [["background", bg], ["card", card]] as const) atLeast(ratio(on(t["muted-foreground"], surface), surface), 7, `muted-foreground su ${name}`);
  atLeast(ratio(t["primary-foreground"].rgb, t.primary.rgb), 6, "testo dei pulsanti su primary");
  for (const [name, surface] of [["background", bg], ["card", card]] as const) atLeast(ratio(on(t.primary, surface), surface), 6, `primary su ${name}`);
  assert.ok(lightTokens.destructive, "--destructive definito nel tema chiaro");
  atLeast(ratio(on(t.destructive, card), card), 6.5, "destructive su card");
  for (const tone of ["verde", "blu", "giallo", "rosso", "grigio", "lucchetto"]) {
    const surface = on(t[`uc-${tone}-bg`], bg);
    atLeast(ratio(on(t[`uc-${tone}`], surface), surface), 5, `uc-${tone} sul suo fondo`);
  }
  for (const [name, surface] of [["background", bg], ["card", card]] as const) atLeast(ratio(on(t.input, surface), surface), 3, `input su ${name}`);
  atLeast(ratio(on(t.ring, card), card), 3, "ring su card");
});

/** I file .tsx sotto una cartella, anche nelle sottocartelle. */
function tsxFiles(dir: string): string[] {
  return readdirSync(new URL(`../../../${dir}`, import.meta.url), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return tsxFiles(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

test("niente testo sbiadito nell'area «Use case»", () => {
  const files = tsxFiles("src/components/use-cases");
  assert.ok(files.length > 20, "attesi i componenti dell'area");
  const faded = files.filter((file) => /\btext-[a-z-]+\/\d+/.test(read(file)));
  assert.deepEqual(faded, [], `testo con l'opacità (text-…/NN): ${faded.join(", ")}`);
  const matrix = read("src/components/use-cases/value-cost-matrix.tsx");
  assert.ok(!matrix.includes("opacity-60"), "matrice: codici più tenui");
  assert.ok(!matrix.includes("max-md:opacity-60"), "matrice: codici più tenui al telefono");
  assert.ok(matrix.includes("label && !label.crowded"), "matrice: il codice che coprirebbe qualcosa non c'è");
  assert.ok(!read("src/components/use-cases/value-jcurve.tsx").includes("stroke-muted-foreground/60"), "curva: la linea del go-live a 60%");
  assert.ok(!read("src/components/use-cases/detail/referent/requests-list.tsx").includes("text-amber-700"), "avvisi in ambra fissa");
  assert.ok(!read("src/components/ui/command.tsx").includes("border-input/30"), "ricerca: bordo del campo al 30%");
});
