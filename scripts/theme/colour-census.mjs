#!/usr/bin/env node
/**
 * Il censimento dei colori fissi nel codice del dashboard (src/components/** e src/app/(dashboard)/**,
 * senza i test): per file, le classi di colore di Tailwind (`text-emerald-300`), il bianco e il nero
 * (`bg-white`), gli esadecimali, i colori scritti come `rgb(…)`/`hsl(…)`/`oklch(…)`, i testi dei token
 * sbiaditi (`text-muted-foreground/50`), le classi `dark:` (non valgono mai: nessun elemento ha
 * `.dark`) e le classi `light:` (solo nel tema «Chiaro»).
 *
 * src/components/theme/colour-guard.test.ts confronta il censimento con
 * src/components/theme/colour-baseline.json: un conto che cresce, un file nuovo con un colore fisso o un
 * conto che scende senza abbassare la base fanno fallire il test. Così i colori nuovi passano dai token
 * del tema e valgono nei due temi.
 *
 * Uso: node scripts/theme/colour-census.mjs          stampa le differenze dalla base
 *      node scripts/theme/colour-census.mjs --write  riscrive la base con i conti di adesso
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { paletteClasses } from "./palette-roles.mjs";

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const BASELINE = "src/components/theme/colour-baseline.json";
export const SCOPES = ["src/components", "src/app/(dashboard)"];
export const KINDS = ["palette", "whiteBlack", "hex", "colorFunction", "fadedText", "dark", "light"];

const WHITE_BLACK = /(?<![\w-])(?:[\w-]+:)*(?:bg|text|border|ring|outline|fill|stroke|from|via|to|shadow|divide|placeholder|decoration|accent|caret)-(?:white|black)(?:\/\d+|\/\[[^\]]+\])?(?![\w-])/g;
const HEX = /["'`(\s:,]#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;
const COLOR_FUNCTION = /\b(?:oklch|rgba?|hsla?)\(/g;
const FADED_TEXT = /(?<![\w-])(?:[\w-]+:)*text-(?:foreground|muted-foreground|sidebar-foreground|card-foreground|popover-foreground|primary|primary-foreground|secondary-foreground|accent-foreground)\/\d+/g;
const DARK = /(?<![\w-])dark:[\w\-/[\]#.:&*>=()'"]+/g;
const LIGHT = /(?<![\w-])light:[\w\-/[\]#.:&*>=()'"]+/g;

/** I file del dashboard, senza i test e i loro aiuti. */
export function files(root = REPO) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "test-support") continue;
        walk(path);
      } else if (/\.(tsx?|mjs)$/.test(entry.name) && !/\.test\.(tsx?|mjs)$/.test(entry.name)) out.push(path);
    }
  };
  for (const scope of SCOPES) walk(join(root, scope));
  return out.sort();
}

/** I conti di un sorgente. */
export function count(source) {
  const palette = paletteClasses(source).filter((use) => !use.dark).length;
  return {
    palette,
    whiteBlack: (source.match(WHITE_BLACK) ?? []).filter((match) => !/(^|:)dark:/.test(match)).length,
    hex: (source.match(HEX) ?? []).length,
    colorFunction: (source.match(COLOR_FUNCTION) ?? []).length,
    fadedText: (source.match(FADED_TEXT) ?? []).filter((match) => !/(^|:)(dark|light):/.test(match)).length,
    dark: (source.match(DARK) ?? []).length,
    light: (source.match(LIGHT) ?? []).length,
  };
}

/** Il censimento: per file (percorso dalla radice), solo i conti diversi da zero. */
export function census(root = REPO) {
  const out = {};
  for (const file of files(root)) {
    const counts = count(readFileSync(file, "utf8"));
    const nonZero = Object.fromEntries(Object.entries(counts).filter(([, value]) => value > 0));
    if (Object.keys(nonZero).length > 0) out[relative(root, file)] = nonZero;
  }
  return out;
}

/** Le differenze dalla base: cresciuti, nuovi, scesi (da abbassare nella base). */
export function compare(current, baseline) {
  const grown = [];
  const dropped = [];
  for (const file of new Set([...Object.keys(current), ...Object.keys(baseline)])) {
    for (const kind of KINDS) {
      const now = current[file]?.[kind] ?? 0;
      const before = baseline[file]?.[kind] ?? 0;
      if (now > before) grown.push(`${file}: ${kind} ${before} → ${now}${before === 0 && !baseline[file] ? " (file nuovo)" : ""}`);
      if (now < before) dropped.push(`${file}: ${kind} ${before} → ${now}`);
    }
  }
  return { grown, dropped };
}

function main() {
  const current = census();
  if (process.argv.includes("--write")) {
    writeFileSync(join(REPO, BASELINE), `${JSON.stringify(current, null, 2)}\n`);
    console.log(`${BASELINE}: scritto (${Object.keys(current).length} file)`);
    return;
  }
  const { grown, dropped } = compare(current, JSON.parse(readFileSync(join(REPO, BASELINE), "utf8")));
  for (const line of grown) console.log(`cresciuto: ${line}`);
  for (const line of dropped) console.log(`sceso: ${line}`);
  if (grown.length === 0 && dropped.length === 0) console.log("nessuna differenza dalla base");
  process.exitCode = grown.length > 0 || dropped.length > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
