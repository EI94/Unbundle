import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { atLeast, over, parseColor, ratio, readRepo, type Rgb } from "./test-support/color.ts";
import * as roles from "../../../scripts/theme/palette-roles.mjs";

// I colori fissi di Tailwind nel tema «Chiaro» (scripts/theme/palette-roles.mjs scrive
// src/app/theme-palette.css): nel tema scuro il valore di sempre, nel chiaro un passo più scuro della
// stessa tinta, che si legge sui fondi del tema chiaro.

interface Entry {
  role: "text" | "background" | "border" | "ring" | "accent";
  hue: string;
  step: number;
  target: number;
  alphas: Set<number>;
  files: Set<string>;
  dark: string;
  light: string;
}

const palette = roles.tailwindPalette() as Record<string, string>;
const plan = roles.plan() as Map<string, Entry>;
const css = readRepo("src/app/theme-palette.css");
const LIGHT_SCOPE = ':root[data-theme="light"]:has([data-theme-scope])';

/** I colori di Tailwind scritti con la luminosità in % (`oklch(84.5% 0.143 164.978)`). */
const tw = (value: string) => parseColor(value);
const WHITE: Rgb = parseColor("oklch(1 0 0)").rgb;
const PAGE: Rgb = parseColor("oklch(0.985 0.002 260)").rgb;

test("theme-palette.css è allineato ai sorgenti (node scripts/theme/palette-roles.mjs lo riscrive)", () => {
  assert.equal(css, roles.render(plan), "rigenerare con node scripts/theme/palette-roles.mjs");
  assert.ok(plan.size > 40, `attese le classi di Formazione, AI Readiness, Portfolio, Impostazioni: ${plan.size}`);
  // Le pagine dei grafici e dei colori dell'area «Use case» ci sono anche loro.
  for (const key of ["text|emerald|300", "background|red|500", "border|amber|500", "ring|red|500", "accent|red|600", "background|teal|500", "border|indigo|500"]) assert.ok(plan.has(key), key);
});

test("nel tema scuro ogni voce vale il colore di Tailwind di sempre", () => {
  const theme = readFileSync(new URL("../../../node_modules/tailwindcss/theme.css", import.meta.url), "utf8");
  for (const entry of plan.values()) {
    const name = `${entry.hue}-${entry.step}`;
    const literal = new RegExp(`--color-${name}: (oklch\\([^)]*\\));`).exec(theme)?.[1];
    assert.ok(literal, name);
    assert.equal(entry.dark, literal, name);
    const key = (roles.THEME_KEY as Record<string, string>)[entry.role];
    assert.ok(css.includes(`  ${key}-${name}: var(--palette-${entry.role}-${name}, ${literal});`), `${key}-${name}`);
  }
  // Solo `@theme inline` e il blocco del tema chiaro: nient'altro.
  const blocks = css.replace(/\/\*[\s\S]*?\*\//g, "").match(/^[^\s{}][^{}]*\{/gm)?.map((head) => head.slice(0, -1).trim());
  assert.deepEqual(blocks, ["@theme inline", LIGHT_SCOPE]);
});

test("nel tema chiaro ogni voce prende il passo previsto della stessa tinta", () => {
  for (const entry of plan.values()) {
    const name = `${entry.role}-${entry.hue}-${entry.step}`;
    assert.ok(css.includes(`  --palette-${name}: ${palette[`${entry.hue}-${entry.target}`]}; /* ${entry.hue}-${entry.target} */`), name);
    assert.equal(entry.light, palette[`${entry.hue}-${entry.target}`]);
    const base = roles.baseTarget(entry.role, entry.step);
    assert.ok(base !== null, `${name}: un colore già per il chiaro non ha voce`);
    assert.ok(entry.target >= base, `${name}: ${entry.target} sotto il passo di base ${base}`);
    if (entry.role === "text") assert.ok(entry.step <= 600 && entry.target >= 800, name);
    if (entry.role === "background") assert.ok(entry.step >= 400 && entry.step <= 600, name);
    if (["border", "ring", "accent"].includes(entry.role)) assert.ok(entry.step >= 200 && entry.step <= 600 && entry.target >= 700, name);
  }
});

/** I fondi tinti di una tinta nel tema chiaro (`bg-amber-500/10` diventa amber-700 al 10%). */
const uses = roles.scan() as Map<string, Entry>;
function washes(hue: string): Array<[string, Rgb]> {
  const out: Array<[string, Rgb]> = [];
  for (const use of uses.values()) {
    if (use.role !== "background" || use.hue !== hue) continue;
    const step = plan.get(`background|${hue}|${use.step}`)?.target ?? use.step;
    for (const alpha of use.alphas) {
      if (alpha >= 50) continue;
      out.push([`bg-${hue}-${use.step}/${alpha} sul bianco`, over(tw(palette[`${hue}-${step}`]).rgb, WHITE, alpha / 100)]);
      out.push([`bg-${hue}-${use.step}/${alpha} sul fondo`, over(tw(palette[`${hue}-${step}`]).rgb, PAGE, alpha / 100)]);
    }
  }
  return out;
}

test("nel tema chiaro i testi almeno 4,5:1 sul bianco, sul fondo e sui fondi tinti della loro tinta, a ogni opacità in uso", () => {
  const icons = roles.ICON_ONLY as Record<string, string>;
  for (const entry of plan.values()) {
    if (entry.role !== "text") continue;
    const color = tw(entry.light).rgb;
    for (const alpha of entry.alphas) {
      const cls = `text-${entry.hue}-${entry.step}/${alpha}`;
      const min = icons[cls] ? 3 : 4.5;
      for (const [name, surface] of [["bianco", WHITE], ["fondo", PAGE], ...washes(entry.hue)] as Array<[string, Rgb]>) {
        atLeast(ratio(over(color, surface, alpha / 100), surface), min, `${cls} (${entry.hue}-${entry.target}) su ${name}`);
      }
    }
  }
  // Le classi solo su icone: lì davvero su un'icona di lucide.
  for (const [cls, file] of Object.entries(icons)) {
    const source = readRepo(file);
    const uses = [...source.matchAll(new RegExp(`<(\\w+)\\s+className="[^"]*(?<![\\w-])${cls.replace("/", "\\/")}(?![\\w-])`, "g"))];
    assert.ok(uses.length > 0, `${cls} in ${file}`);
    for (const use of uses) assert.match(use[1], /^[A-Z]/, `${cls}: su <${use[1]}>, non su un'icona`);
    assert.equal(source.split(cls).length - 1, uses.length, `${cls}: anche fuori da un'icona in ${file}`);
  }
});

test("nel tema chiaro i segni pieni almeno 3:1, e il testo bianco su un fondo pieno almeno 4,5:1", () => {
  for (const entry of plan.values()) {
    if (entry.role === "text") continue;
    const color = tw(entry.light).rgb;
    for (const alpha of entry.alphas) {
      if (alpha < 50 || (entry.role === "border" && alpha < 100)) continue;
      for (const [name, surface] of [["bianco", WHITE], ["fondo", PAGE]] as const) {
        atLeast(ratio(over(color, surface, alpha / 100), surface), 3, `${entry.role} ${entry.hue}-${entry.step}/${alpha} (${entry.hue}-${entry.target}) su ${name}`);
      }
    }
  }
  // I pulsanti e i bollini pieni con il testo bianco (oggi 2,5–3,7:1 su emerald-500 e -600 anche nello scuro).
  for (const [file, string] of classStrings()) {
    if (!/(?<![\w:-])text-white(?![\w/-])/.test(string)) continue;
    for (const match of string.matchAll(/(?<![\w:-])bg-([a-z]+)-(\d+)(?![\w/-])/g)) {
      const entry = plan.get(`background|${match[1]}|${match[2]}`);
      if (!entry) continue;
      atLeast(ratio(WHITE, tw(entry.light).rgb), 4.5, `${file}: text-white su bg-${match[1]}-${match[2]} (${match[1]}-${entry.target})`);
    }
  }
});

/** Le stringhe (tra virgolette o apici inversi) dei sorgenti dell'app che contengono classi di Tailwind. */
function classStrings(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const file of roles.sourceFiles() as string[]) {
    const rel = file.slice(fileURLToPath(new URL("../../../", import.meta.url)).length);
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/"([^"\n]*)"|`([^`]*)`|'([^'\n]*)'/g)) {
      const string = match[1] ?? match[2] ?? match[3];
      if (/(?:text|bg)-[a-z]+-\d/.test(string)) out.push([rel, string]);
    }
  }
  return out;
}

test("nessun testo scelto per lo scuro sopra un fondo pieno scuro o chiaro della stessa stringa", () => {
  const found: string[] = [];
  for (const [file, string] of classStrings()) {
    const texts = [...string.matchAll(/(?<![\w:-])text-([a-z]+)-(\d+)(?:\/(\d+))?(?![\w-])/g)].filter((match) => plan.has(`text|${match[1]}|${match[2]}`));
    if (texts.length === 0) continue;
    for (const bg of string.matchAll(/(?<![\w:-])bg-([a-z]+)-(\d+)(?![\w/-])/g)) {
      const step = Number(bg[2]);
      // Un fondo pieno dal 600 in su con un testo che nel chiaro diventa scuro: illeggibile.
      if (step >= 600) found.push(`${file}: ${texts[0][0]} su ${bg[0]}`);
      // Un fondo pieno chiaro (50–300, già per il chiaro): il testo del tema chiaro deve leggersi.
      if (step <= 300) {
        for (const text of texts) {
          const entry = plan.get(`text|${text[1]}|${text[2]}`)!;
          const surface = tw(palette[`${bg[1]}-${bg[2]}`]).rgb;
          const alpha = text[3] ? Number(text[3]) / 100 : 1;
          atLeast(ratio(over(tw(entry.light).rgb, surface, alpha), surface), 4.5, `${file}: ${text[0]} su ${bg[0]}`);
        }
      }
    }
  }
  assert.deepEqual(found, []);
});

test("Tailwind legge ancora i colori per ruolo (una versione nuova potrebbe smettere: qui si vede)", async () => {
  const require = createRequire(new URL("../../../package.json", import.meta.url));
  const { compile } = require("@tailwindcss/node") as { compile: (css: string, options: { base: string; onDependency: () => void }) => Promise<{ build: (candidates: string[]) => string }> };
  const base = fileURLToPath(new URL("../../app/", import.meta.url));
  const compiler = await compile(readRepo("src/app/globals.css"), { base, onDependency() {} });
  const out = compiler.build(["text-red-300", "bg-red-500/15", "border-amber-500/40", "divide-amber-500", "ring-red-500", "accent-red-600", "from-emerald-500/10", "light:text-sidebar-foreground/70"]);
  const rule = (selector: string) => {
    const start = out.indexOf(`${selector} {`);
    assert.ok(start >= 0, `${selector} non generata`);
    return out.slice(start, out.indexOf("\n  }\n", start));
  };
  assert.match(rule(".text-red-300"), /color: var\(--palette-text-red-300, oklch\(80\.8% 0\.114 19\.571\)\);/);
  assert.match(rule(".bg-red-500\\/15"), /color-mix\(in oklab, var\(--palette-background-red-500, oklch\(63\.7% 0\.237 25\.331\)\) 15%, transparent\)/);
  assert.match(rule(".border-amber-500\\/40"), /var\(--palette-border-amber-500, /);
  assert.match(rule(".divide-amber-500"), /var\(--palette-border-amber-500, /);
  assert.match(rule(".ring-red-500"), /--tw-ring-color: var\(--palette-ring-red-500, /);
  assert.match(rule(".accent-red-600"), /accent-color: var\(--palette-accent-red-600, /);
  assert.match(rule(".from-emerald-500\\/10"), /var\(--palette-background-emerald-500, /);
  // La variante `light:` vale solo nel tema chiaro del dashboard.
  assert.ok(out.includes(`:where(${LIGHT_SCOPE} *)`), "variante light:");
});
