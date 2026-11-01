#!/usr/bin/env node
/**
 * I colori fissi di Tailwind (`text-emerald-300`, `bg-red-500/15`, `border-amber-500/40`…) nel tema
 * «Chiaro» del dashboard: scrive src/app/theme-palette.css.
 *
 * Molti componenti (Formazione, AI Readiness, Portfolio, Impostazioni, Intelligence, le pagine più
 * vecchie, qualche segno dell'area «Use case») usano un passo di Tailwind scelto per il fondo scuro:
 * `text-emerald-300` è 1,5:1 sul bianco. Tailwind 4 legge il colore di `text-*` prima da
 * `--text-color-*` e poi da `--color-*` (e `bg-*`, `from-*`, `via-*`, `to-*` da `--background-color-*`,
 * `border-*` e `divide-*` da `--border-color-*`, `ring-*` da `--ring-color-*`, `accent-*` da
 * `--accent-color-*`). Per ogni colore scelto per lo scuro che il codice usa, il file dà al ruolo una
 * voce in `@theme inline` che vale `var(--palette-…, <il valore di Tailwind>)`: nel tema scuro il
 * valore è lo stesso di sempre. Nel tema chiaro (`:root[data-theme="light"]:has([data-theme-scope])`)
 * `--palette-…` prende un passo più scuro della stessa tinta:
 *   - testo dal 50 al 600 → 800, o 900 (950) dove un'opacità in uso non arriva a 4,5:1 sul bianco, sul
 *     fondo della pagina o sui fondi tinti della stessa tinta (3:1 per le classi solo su icone);
 *   - fondo 400 → 600, 500 → 700, 600 → 800 (un passo in più dove un segno pieno resta sotto 3:1);
 *   - bordo, anello e `accent` dal 200 al 600 → 700.
 * I passi dal 700 in su e i fondi dal 50 al 300 sono già per il chiaro e restano come sono; le
 * classi `dark:` non valgono mai (nessun elemento ha `.dark`) e non contano. Nessun componente cambia.
 *
 * Uso: node scripts/theme/palette-roles.mjs          scrive il file
 *      node scripts/theme/palette-roles.mjs --check  esce con 1 se il file non è allineato ai sorgenti
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const OUTPUT = "src/app/theme-palette.css";
export const LIGHT_SCOPE = ':root[data-theme="light"]:has([data-theme-scope])';

export const HUES = ["red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal", "cyan", "sky", "blue", "indigo", "violet", "purple", "fuchsia", "pink", "rose", "slate", "gray", "zinc", "neutral", "stone"];
export const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

/** Il ruolo di ogni utility di colore: la voce del tema che Tailwind 4 legge prima di `--color-*`. */
export const ROLE_OF_UTILITY = {
  text: "text",
  bg: "background",
  from: "background",
  via: "background",
  to: "background",
  border: "border",
  "border-t": "border",
  "border-r": "border",
  "border-b": "border",
  "border-l": "border",
  "border-x": "border",
  "border-y": "border",
  "border-s": "border",
  "border-e": "border",
  divide: "border",
  ring: "ring",
  accent: "accent",
};
/** Le voci del tema per ruolo (`--text-color-<tinta>-<passo>`…). */
export const THEME_KEY = { text: "--text-color", background: "--background-color", border: "--border-color", ring: "--ring-color", accent: "--accent-color" };

const UTILITY = "(?:bg|text|border(?:-[trblxyse])?|ring|inset-ring|outline|fill|stroke|from|via|to|shadow|divide|placeholder|decoration|accent|caret|ring-offset)";
const CLASS = new RegExp(`(?<![\\w-])((?:[\\w\\-\\[\\]&=*.>()"'@/:]+?:)*)(${UTILITY})-(${HUES.join("|")})-(\\d{2,3})(?:\\/(\\d+))?(?![\\w-])`, "g");

/**
 * Classi di testo che nel codice colorano solo un'icona (un segno grafico: 3:1, non 4,5:1), con il
 * file in cui stanno. Il test controlla che lì siano davvero su un'icona.
 */
export const ICON_ONLY = { "text-green-500/70": "src/components/agent/chat-interface.tsx" };

/** I file dell'app (non i test né i loro aiuti): .ts, .tsx, .mjs sotto src/. */
export function sourceFiles(root = REPO) {
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
  walk(join(root, "src"));
  return out.sort();
}

/** Le classi di colore di Tailwind in un sorgente, con le varianti e l'opacità. */
export function paletteClasses(source) {
  return [...source.matchAll(CLASS)].map((match) => ({
    token: match[0],
    variants: match[1],
    utility: match[2],
    hue: match[3],
    step: Number(match[4]),
    alpha: match[5] === undefined ? 100 : Number(match[5]),
    dark: /(^|:)dark:/.test(match[1]),
  }));
}

/** Le classi usate nei sorgenti, per ruolo, tinta e passo, con le opacità e i file. */
export function scan(root = REPO) {
  const uses = new Map();
  for (const file of sourceFiles(root)) {
    const rel = relative(root, file);
    for (const use of paletteClasses(readFileSync(file, "utf8"))) {
      if (use.dark) continue;
      const role = ROLE_OF_UTILITY[use.utility];
      if (!role) throw new Error(`${rel}: ${use.token}: utility senza ruolo nel tema chiaro (aggiungerla a ROLE_OF_UTILITY)`);
      const key = `${role}|${use.hue}|${use.step}`;
      if (!uses.has(key)) uses.set(key, { role, hue: use.hue, step: use.step, alphas: new Set(), files: new Set() });
      uses.get(key).alphas.add(use.alpha);
      uses.get(key).files.add(rel);
    }
  }
  return uses;
}

/** I valori della tavolozza di Tailwind installata (`--color-emerald-300: oklch(…)`). */
export function tailwindPalette(root = REPO) {
  const theme = readFileSync(join(root, "node_modules/tailwindcss/theme.css"), "utf8");
  const out = {};
  for (const match of theme.matchAll(/--color-([a-z]+)-(\d+):\s*(oklch\([^)]*\));/g)) out[`${match[1]}-${match[2]}`] = match[3];
  return out;
}

// Contrasto WCAG da oklch (Tailwind scrive la luminosità in %), tagliato dentro la gamma sRGB.
function srgb(value) {
  const match = /oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)\)/.exec(value);
  if (!match) throw new Error(`colore non letto: ${value}`);
  const L = Number(match[1]) / 100;
  const C = Number(match[2]);
  const h = (Number(match[3]) * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
    .map((v) => Math.min(1, Math.max(0, v)))
    .map((v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
}
const luminance = (rgb) => {
  const [r, g, b] = rgb.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const over = (fg, bg, alpha) => fg.map((v, i) => alpha * v + (1 - alpha) * bg[i]);
const ratio = (x, y) => {
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
};
// Il fondo della pagina e la card del tema chiaro (globals.css): oklch(0.985 0.002 260) e il bianco.
export const LIGHT_SURFACES = { card: srgb("oklch(100% 0 0)"), background: srgb("oklch(98.5% 0.002 260)") };

/** Il passo del tema chiaro per un colore scelto per lo scuro; null se è già per il chiaro. */
export function baseTarget(role, step) {
  if (role === "text") return step <= 600 ? 800 : null;
  if (role === "background") return step >= 400 && step <= 600 ? step + 200 : null;
  return step >= 200 && step <= 600 ? 700 : null;
}

/** I fondi tinti di una tinta nel tema chiaro (`bg-amber-500/10` → amber-700 al 10%), sul bianco e sul fondo. */
function washes(uses, palette, plan, hue) {
  const out = [];
  for (const use of uses.values()) {
    if (use.role !== "background" || use.hue !== hue) continue;
    const step = plan.get(`background|${hue}|${use.step}`)?.target ?? use.step;
    for (const alpha of use.alphas) {
      if (alpha >= 50) continue;
      for (const [name, surface] of Object.entries(LIGHT_SURFACES)) out.push({ what: `bg-${hue}-${use.step}/${alpha} su ${name}`, rgb: over(srgb(palette[`${hue}-${step}`]), surface, alpha / 100) });
    }
  }
  return out;
}

/** Le superfici su cui un colore del tema chiaro deve leggersi, con la soglia. */
export function checks(use, value, uses, palette, plan) {
  const out = [];
  const color = srgb(value);
  for (const alpha of use.alphas) {
    const a = alpha / 100;
    if (use.role === "text") {
      const surfaces = [...Object.entries(LIGHT_SURFACES).map(([what, rgb]) => ({ what, rgb })), ...washes(uses, palette, plan, use.hue)];
      const min = ICON_ONLY[`text-${use.hue}-${use.step}/${alpha}`] ? 3 : 4.5;
      for (const surface of surfaces) out.push({ what: `${use.hue}-${use.step}/${alpha} su ${surface.what}`, value: ratio(over(color, surface.rgb, a), surface.rgb), min });
    } else if (alpha >= 50 && use.role !== "border") {
      // Un segno pieno (un punto, una barra, un pulsante): almeno 3:1 sulla card e sul fondo.
      for (const [what, rgb] of Object.entries(LIGHT_SURFACES)) out.push({ what: `${use.role} ${use.hue}-${use.step}/${alpha} su ${what}`, value: ratio(over(color, rgb, a), rgb), min: 3 });
    } else if (use.role === "border" && alpha === 100) {
      for (const [what, rgb] of Object.entries(LIGHT_SURFACES)) out.push({ what: `bordo ${use.hue}-${use.step} su ${what}`, value: ratio(color, rgb), min: 3 });
    }
  }
  return out;
}

/** Per ogni colore scelto per lo scuro, il passo del tema chiaro che supera le soglie. */
export function plan(uses = scan(), palette = tailwindPalette()) {
  const out = new Map();
  // Prima i fondi: i testi si misurano anche sui fondi tinti del tema chiaro.
  const ordered = [...uses.values()].sort((x, y) => (x.role === "background" ? 0 : 1) - (y.role === "background" ? 0 : 1));
  for (const use of ordered) {
    const base = baseTarget(use.role, use.step);
    if (base === null) continue;
    const key = `${use.role}|${use.hue}|${use.step}`;
    let target = base;
    while (checks(use, palette[`${use.hue}-${target}`], uses, palette, out).some((check) => check.value < check.min)) {
      const next = STEPS[STEPS.indexOf(target) + 1];
      if (!next) {
        const failing = checks(use, palette[`${use.hue}-${target}`], uses, palette, out).filter((check) => check.value < check.min);
        throw new Error(`${key}: nessun passo supera le soglie (${failing.map((check) => `${check.what} ${check.value.toFixed(2)}`).join(", ")})`);
      }
      target = next;
    }
    out.set(key, { ...use, target, dark: palette[`${use.hue}-${use.step}`], light: palette[`${use.hue}-${target}`] });
  }
  return out;
}

const ROLE_ORDER = ["text", "background", "border", "ring", "accent"];
const sortEntries = (entries) =>
  [...entries].sort((x, y) => ROLE_ORDER.indexOf(x.role) - ROLE_ORDER.indexOf(y.role) || HUES.indexOf(x.hue) - HUES.indexOf(y.hue) || x.step - y.step);

/** Il testo di src/app/theme-palette.css. */
export function render(entries = plan()) {
  const sorted = sortEntries(entries.values());
  const themeLines = sorted.map((entry) => `  ${THEME_KEY[entry.role]}-${entry.hue}-${entry.step}: var(--palette-${entry.role}-${entry.hue}-${entry.step}, ${entry.dark});`);
  const lightLines = sorted.map((entry) => `  --palette-${entry.role}-${entry.hue}-${entry.step}: ${entry.light}; /* ${entry.hue}-${entry.target} */`);
  return `/* Generato da scripts/theme/palette-roles.mjs: non modificare a mano (node scripts/theme/palette-roles.mjs
   lo riscrive, --check dice se è allineato ai sorgenti). I colori fissi di Tailwind scelti per il
   fondo scuro: nel tema scuro il valore di sempre, nel tema «Chiaro» del dashboard un passo più
   scuro della stessa tinta. ${sorted.length} voci. */
@theme inline {
${themeLines.join("\n")}
}

${LIGHT_SCOPE} {
${lightLines.join("\n")}
}
`;
}

function main() {
  const text = render();
  const path = join(REPO, OUTPUT);
  if (process.argv.includes("--check")) {
    const current = readFileSync(path, "utf8");
    if (current !== text) {
      console.error(`${OUTPUT} non è allineato ai sorgenti: node scripts/theme/palette-roles.mjs`);
      process.exit(1);
    }
    console.log(`${OUTPUT}: allineato`);
    return;
  }
  writeFileSync(path, text);
  console.log(`${OUTPUT}: scritto`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
