import test from "node:test";
import assert from "node:assert/strict";
import {
  atLeast,
  COLOR_VALUE,
  contrast,
  cvdDistance,
  declarations,
  hueDistance,
  over,
  parseColor,
  ratio,
  readRepo,
  sha256,
  topLevelRules,
  type Color,
  type Rgb,
} from "./test-support/color.ts";

// I due temi del dashboard, dai token di globals.css: «Scuro», il predefinito, che deve restare
// com'era, e «Chiaro», che vale solo sulle pagine del dashboard di chi l'ha scelto. Qui i rapporti
// di contrasto WCAG di ogni coppia che conta, nei due temi, e la prova che i blocchi di prima non
// sono cambiati di una virgola.

const css = readRepo("src/app/globals.css");
const rules = topLevelRules(css);
const LIGHT = ':root[data-theme="light"]:has([data-theme-scope])';
const isLight = (selector: string) => selector.startsWith(LIGHT);

const rootRule = rules.find((rule) => rule.selector === ":root");
const lightRule = rules.find((rule) => rule.selector === LIGHT);
assert.ok(rootRule && lightRule, "i blocchi :root e del tema chiaro");
const darkValues = declarations(rootRule.body);
const lightValues = declarations(lightRule.body);
const colorNames = (values: Record<string, string>) => Object.keys(values).filter((name) => COLOR_VALUE.test(values[name]));

/** I colori di un tema: il valore del tema chiaro se c'è, altrimenti quello di :root. */
const palette = (values: Record<string, string>): Record<string, Color> =>
  Object.fromEntries(colorNames(values).map((name) => [name.slice(2), parseColor(values[name])]));
const dark = palette(darkValues);
const light = { ...dark, ...palette(lightValues) };

// I blocchi di globals.css prima del tema chiaro, testo per testo (senza commenti): nessuno cambia,
// nessuno si sposta. Così il tema scuro e le pagine pubbliche (.survey-light) restano come erano.
const FROZEN_BLOCKS: Array<[string, string]> = [
  ['@import "tailwindcss"', "944e6e12c0067a6767836a78ad6c4095b829f966b44f33bc95cfef1401ab3c10"],
  ['@import "tw-animate-css"', "42bf33c3f671299b72a7b2fd942da2f6b99707528120ca8772e2247e075e37b3"],
  ['@import "shadcn/tailwind.css"', "1612ad7a63b414169f0c69c233209d67cc1765da5443ed4776c407eeda9c66bb"],
  ["@custom-variant dark", "193c32249dee60279ddca5d637c924bb13c1b56c9a4b0cb9ca60158f42ed8eaa"],
  ["@theme inline", "c445a893efd73aa36ece0f8f929ebc059fa35571022209a41d69415917a0ec83"],
  [":root", "9b6ea9a96537ba7526f60b230b03c16bfa7f50f27c5544ed4100d85d36b92979"],
  ["@layer base", "de12d63509d7735374d2218bdcd7a4a53dec90fb1ce2dbdc7d7f35586086fa99"],
  [".survey-light", "f3cf6bcd0f1caa91dfe961ae39fc3b8d9447c9029f611b83a3d9539d1c08dd93"],
  [".survey-light :focus-visible", "18e168213e949c0c849d8a9b5aec33eba6a2d224989ce14318a36d2ce17a5440"],
  ["html:has([data-uc-case-head])", "bd912e0618370aadda3e2fd803631fde48e120c0c362264c89aac3248132a48f"],
  ["@media (min-width: 64rem)", "74ae572cf4697ff1a9a420445b896405a05b9eef84393634c4782168f6bd191d"],
  ["[data-uc-case-root]", "7feaceb65acdf6aa4db30aa53c146842148b848ac029c73d7bc709e687d4e417"],
  ["[data-use-case-root]", "25c03e85a1989e14711c4a180e80dc4af50fdfd493a4b1fa3c6d73677f9a0dda"],
  ["segmented-nav", "aef9673ba0a47a3d8f02f76b78f068692612946cd1cfe1b37279bd14779ce2db"],
];
// Le sole aggiunte prima del tema chiaro: i due file importati e la variante `light:`.
const ADDED_BEFORE_LIGHT = ['@import "./theme-palette.css"', '@import "./theme-viz.css"', "@custom-variant light"];

test("i blocchi di prima restano identici e nello stesso ordine; il tema chiaro sta in fondo", () => {
  const old = rules.filter((rule) => !isLight(rule.selector) && !ADDED_BEFORE_LIGHT.some((added) => rule.selector.startsWith(added)));
  assert.deepEqual(
    old.map((rule) => sha256(rule.text)),
    FROZEN_BLOCKS.map(([, hash]) => hash),
    `blocchi cambiati: ${old.map((rule, index) => (sha256(rule.text) === FROZEN_BLOCKS[index]?.[1] ? "" : rule.selector.slice(0, 40))).filter(Boolean).join(" | ")}`,
  );
  const firstLight = rules.findIndex((rule) => isLight(rule.selector));
  assert.ok(firstLight > 0, "il tema chiaro c'è");
  assert.ok(rules.slice(firstLight).every((rule) => isLight(rule.selector)), "dopo il primo blocco chiaro solo blocchi chiari");
  // Le aggiunte in alto non scrivono CSS: due import e una variante.
  assert.deepEqual(
    rules.filter((rule) => ADDED_BEFORE_LIGHT.some((added) => rule.selector.startsWith(added))).map((rule) => rule.text),
    ['@import "./theme-palette.css";', '@import "./theme-viz.css";', '@custom-variant light (&:where(:root[data-theme="light"]:has([data-theme-scope]) *));'],
  );
});

// I 57 colori del tema scuro, valore per valore: cambiarne uno è una decisione, non un effetto.
const DARK_FROZEN: Record<string, string> = {
  background: "oklch(0.07 0.005 260)", foreground: "oklch(0.95 0.005 260)", card: "oklch(0.11 0.008 260)", "card-foreground": "oklch(0.95 0.005 260)",
  popover: "oklch(0.11 0.008 260)", "popover-foreground": "oklch(0.95 0.005 260)", primary: "oklch(0.95 0 0)", "primary-foreground": "oklch(0.07 0 0)",
  secondary: "oklch(0.15 0.008 260)", "secondary-foreground": "oklch(0.85 0.01 260)", muted: "oklch(0.15 0.008 260)", "muted-foreground": "oklch(0.55 0.01 260)",
  accent: "oklch(0.18 0.01 260)", "accent-foreground": "oklch(0.9 0.01 260)", destructive: "oklch(0.65 0.2 25)", border: "oklch(1 0 0 / 8%)",
  input: "oklch(1 0 0 / 10%)", ring: "oklch(0.7 0 0)",
  "chart-1": "oklch(0.7 0.15 260)", "chart-2": "oklch(0.65 0.12 180)", "chart-3": "oklch(0.7 0.15 140)", "chart-4": "oklch(0.65 0.15 320)", "chart-5": "oklch(0.75 0.12 60)",
  sidebar: "oklch(0.09 0.006 260)", "sidebar-foreground": "oklch(0.85 0.008 260)", "sidebar-primary": "oklch(0.95 0 0)", "sidebar-primary-foreground": "oklch(0.07 0 0)",
  "sidebar-accent": "oklch(0.14 0.01 260)", "sidebar-accent-foreground": "oklch(0.9 0.008 260)", "sidebar-border": "oklch(1 0 0 / 6%)", "sidebar-ring": "oklch(0.7 0 0)",
  "uc-verde": "oklch(0.74 0.15 150)", "uc-verde-bg": "oklch(0.74 0.15 150 / 0.14)", "uc-blu": "oklch(0.7 0.12 245)", "uc-blu-bg": "oklch(0.7 0.12 245 / 0.15)",
  "uc-giallo": "oklch(0.82 0.14 85)", "uc-giallo-bg": "oklch(0.82 0.14 85 / 0.14)", "uc-rosso": "oklch(0.68 0.19 25)", "uc-rosso-bg": "oklch(0.68 0.19 25 / 0.14)",
  "uc-grigio": "oklch(0.6 0.01 260)", "uc-grigio-bg": "oklch(0.6 0.01 260 / 0.14)", "uc-lucchetto": "oklch(0.7 0.12 300)", "uc-lucchetto-bg": "oklch(0.7 0.12 300 / 0.15)",
  "uc-serie-1": "#3987e5", "uc-serie-2": "#d95926", "uc-serie-3": "#199e70", "uc-serie-altro": "oklch(0.6 0.01 260)",
  "uc-agente-1": "oklch(0.8 0.1 83)", "uc-agente-2": "oklch(0.8 0.1 183)", "uc-agente-3": "oklch(0.8 0.1 283)", "uc-agente-4": "oklch(0.8 0.1 50)",
  "uc-agente-5": "oklch(0.8 0.1 150)", "uc-agente-6": "oklch(0.8 0.1 250)", "uc-agente-7": "oklch(0.8 0.1 350)", "uc-agente-8": "oklch(0.8 0.1 117)",
  "uc-agente-9": "oklch(0.8 0.1 217)", "uc-agente-10": "oklch(0.8 0.1 317)",
};

test("il tema scuro tiene i suoi 57 colori", () => {
  const values = Object.fromEntries(colorNames(darkValues).map((name) => [name.slice(2), darkValues[name]]));
  assert.equal(Object.keys(DARK_FROZEN).length, 57);
  assert.deepEqual(values, DARK_FROZEN);
  // Nessun `color-scheme` nel tema scuro, come prima: i controlli nativi seguono il sistema.
  assert.ok(!/color-scheme/.test(rootRule.body), "color-scheme nel tema scuro");
});

const f2 = (value: number) => value.toFixed(2);

test("i limiti noti del tema scuro restano quelli di oggi (si cambiano solo con una decisione)", () => {
  const t = dark;
  const surfaces = { background: t.background.rgb, card: t.card.rgb, muted: t.muted.rgb, accent: t.accent.rgb };
  // Fuori dall'area «Use case» e dal dossier: il grigio dei testi secondari, i bordi dei campi, il fuoco.
  assert.deepEqual(Object.values(surfaces).map((surface) => f2(contrast(t["muted-foreground"], surface))), ["4.30", "4.22", "4.05", "3.88"]);
  assert.equal(f2(contrast(t.input, surfaces.background)), "1.20");
  assert.equal(f2(contrast(t.ring, surfaces.background, 0.5)), "2.57");
  assert.equal(f2(contrast(t["sidebar-foreground"], t.sidebar.rgb, 0.5)), "3.71");
  assert.equal(f2(contrast(t["sidebar-foreground"], t.sidebar.rgb, 0.6)), "4.98");
  // L'area «Use case» e il dossier con i loro valori.
  const area = (name: string) => parseColor(declarations(rules.find((rule) => rule.selector.startsWith("[data-use-case-root],"))!.body)[name]);
  assert.deepEqual([surfaces.background, surfaces.card, surfaces.muted].map((surface) => f2(contrast(area("--muted-foreground"), surface))), ["7.24", "7.10", "6.83"]);
  assert.equal(f2(contrast(area("--input"), surfaces.background)), "3.40");
  assert.equal(f2(contrast(area("--ring"), surfaces.background, 0.5)), "3.71");
  const dossier = parseColor(declarations(rules.find((rule) => rule.selector.startsWith("[data-uc-case-root],"))!.body)["--muted-foreground"]);
  assert.deepEqual([surfaces.background, surfaces.card].map((surface) => f2(contrast(dossier, surface))), ["5.73", "5.62"]);
});

test("il tema chiaro ridefinisce ogni colore del tema scuro, dentro la gamma dello schermo", () => {
  assert.deepEqual(colorNames(lightValues).sort(), colorNames(darkValues).sort());
  for (const name of colorNames(lightValues)) assert.ok(parseColor(lightValues[name]).inGamut, `${name}: ${lightValues[name]} fuori dalla gamma sRGB`);
  assert.match(lightRule.body, /color-scheme: light;/);
  // Nessun altro token cambia (raggio, caratteri): solo colori e color-scheme.
  assert.deepEqual(Object.keys(lightValues).filter((name) => !COLOR_VALUE.test(lightValues[name])), []);
});

const lightSurfaces = (t: Record<string, Color>): Array<[string, Rgb]> => [
  ["background", t.background.rgb],
  ["card", t.card.rgb],
  ["popover", t.popover.rgb],
  ["muted", t.muted.rgb],
  ["accent", t.accent.rgb],
  ["muted/60 sul fondo", over(t.muted.rgb, t.background.rgb, 0.6)],
  ["muted/50 sul popover", over(t.muted.rgb, t.popover.rgb, 0.5)],
];

test("tema chiaro: testi molto chiari su ogni superficie", () => {
  const t = light;
  for (const [name, surface] of lightSurfaces(t)) {
    atLeast(contrast(t.foreground, surface), 7, `foreground su ${name}`);
    atLeast(contrast(t["card-foreground"], surface), 7, `card-foreground su ${name}`);
    // Le soglie dell'area «Use case» nel tema scuro: almeno 7:1 sulle superfici piene, 6,5:1 sulle altre.
    const min = ["background", "card", "popover"].includes(name) ? 7 : 6.5;
    atLeast(contrast(t["muted-foreground"], surface), min, `muted-foreground su ${name}`);
  }
  atLeast(contrast(t["popover-foreground"], t.popover.rgb), 7, "popover-foreground su popover");
  atLeast(contrast(t["primary-foreground"], t.primary.rgb), 7, "testo dei pulsanti su primary");
  for (const surface of ["background", "card"]) atLeast(contrast(t.primary, t[surface].rgb), 7, `primary su ${surface}`);
  atLeast(contrast(t["secondary-foreground"], t.secondary.rgb), 7, "secondary-foreground su secondary");
  atLeast(contrast(t["accent-foreground"], t.accent.rgb), 7, "accent-foreground su accent");
  for (const surface of ["background", "card", "popover"]) atLeast(contrast(t.destructive, t[surface].rgb), 4.5, `destructive su ${surface}`);
  const wash = over(t.destructive.rgb, t.card.rgb, 0.1);
  atLeast(ratio(t.destructive.rgb, wash), 4.5, "destructive sul suo fondo al 10%");
});

test("tema chiaro: bordi dei campi, fuoco e linee almeno 3:1", () => {
  const t = light;
  for (const [name, surface] of lightSurfaces(t)) {
    atLeast(contrast(t.input, surface), 3, `input su ${name}`);
    // L'alone del fuoco è `ring-ring/50` (e `outline-ring/50` nella base).
    atLeast(contrast(t.ring, surface, 0.5), 3, `ring/50 su ${name}`);
  }
  // Il grigio al 70%: i bordi dei pulsanti radio e le linee delle zone della matrice.
  for (const name of ["background", "card"]) atLeast(contrast(t["muted-foreground"], t[name].rgb, 0.7), 3, `muted-foreground/70 su ${name}`);
  // Il segmento scelto delle viste dell'area: l'anello (`var(--input)`) sul segmento e sulla cornice.
  atLeast(contrast(t.input, t.background.rgb), 3, "anello del segmento scelto");
  atLeast(contrast(t.input, over(t.muted.rgb, t.background.rgb, 0.6)), 3, "anello del segmento sulla cornice");
});

test("tema chiaro: la barra laterale, grigio chiaro sulla pagina", () => {
  const t = light;
  const sidebar = t.sidebar.rgb;
  assert.ok(t.sidebar.L > 0.9, "la barra laterale è chiara");
  atLeast(contrast(t["sidebar-foreground"], sidebar), 7, "sidebar-foreground");
  // Le righe sbiadite di oggi: il nome del workspace (/50 diventa /70 col tema chiaro), l'e-mail e la freccia (/60).
  for (const alpha of [0.7, 0.6]) atLeast(contrast(t["sidebar-foreground"], sidebar, alpha), 4.5, `sidebar-foreground/${alpha * 100}`);
  assert.ok(contrast(t["sidebar-foreground"], sidebar, 0.5) < 4.5, "al 50% non basta: per questo la riga del workspace prende /70");
  atLeast(contrast(t["sidebar-foreground"], t["sidebar-accent"].rgb), 7, "sidebar-foreground sulla voce accesa");
  atLeast(contrast(t["sidebar-accent-foreground"], t["sidebar-accent"].rgb), 7, "sidebar-accent-foreground");
  atLeast(contrast(t["sidebar-primary-foreground"], t["sidebar-primary"].rgb), 7, "sidebar-primary-foreground");
  atLeast(contrast(t["sidebar-ring"], sidebar, 0.5), 3, "sidebar-ring/50");
  atLeast(contrast(t["muted-foreground"], sidebar), 4.5, "muted-foreground sulla barra");
});

const TONES = ["verde", "blu", "giallo", "rosso", "grigio", "lucchetto"];

test("tema chiaro: il semaforo con gli stessi toni del tema scuro", () => {
  const t = light;
  for (const tone of TONES) {
    const color = t[`uc-${tone}`];
    assert.equal(color.h, dark[`uc-${tone}`].h, `uc-${tone}: stesso tono del tema scuro`);
    assert.equal(color.alpha, 1);
    for (const surface of ["card", "background", "muted"]) atLeast(contrast(color, t[surface].rgb), 5, `uc-${tone} su ${surface}`);
    for (const surface of ["card", "background"]) {
      const tint = over(t[`uc-${tone}-bg`].rgb, t[surface].rgb, t[`uc-${tone}-bg`].alpha);
      atLeast(ratio(color.rgb, tint), 5, `uc-${tone} sul suo fondo, su ${surface}`);
    }
    // Il fondo è il tono al 10%, tranne il giallo, che ha un fondo giallo chiaro.
    if (tone === "giallo") assert.equal(lightValues["--uc-giallo-bg"], "oklch(0.82 0.14 85 / 0.2)");
    else assert.equal(lightValues[`--uc-${tone}-bg`], lightValues[`--uc-${tone}`].replace(")", " / 0.1)"));
  }
});

test("tema chiaro: i gruppi dei grafici con gli stessi toni, e distinti per chi non vede rosso e verde", () => {
  const series = ["uc-serie-1", "uc-serie-2", "uc-serie-3", "uc-serie-altro"];
  for (const name of series.slice(0, 3)) assert.ok(hueDistance(light[name].h, dark[name].h) <= 3, `${name}: ${light[name].h.toFixed(1)}° contro ${dark[name].h.toFixed(1)}°`);
  for (const name of series) {
    for (const [surfaceName, surface] of [["card", light.card.rgb], ["background", light.background.rgb], ["muted/50 sulla card", over(light.muted.rgb, light.card.rgb, 0.5)]] as const) {
      atLeast(contrast(light[name], surface), 3, `${name} su ${surfaceName}`);
    }
  }
  // Ogni coppia (nelle bolle due gruppi qualsiasi stanno vicini) resta distante quanto nel tema scuro,
  // entro 0,01 in OKLab, e la coppia più vicina non si avvicina.
  const lightPairs: number[] = [];
  const darkPairs: number[] = [];
  for (let i = 0; i < series.length; i++) {
    for (let j = i + 1; j < series.length; j++) {
      const lightDistance = cvdDistance(light[series[i]].rgb, light[series[j]].rgb);
      const darkDistance = cvdDistance(dark[series[i]].rgb, dark[series[j]].rgb);
      assert.ok(lightDistance >= darkDistance - 0.01, `${series[i]}–${series[j]}: ${lightDistance.toFixed(3)} contro ${darkDistance.toFixed(3)} nel tema scuro`);
      lightPairs.push(lightDistance);
      darkPairs.push(darkDistance);
    }
  }
  assert.ok(Math.min(...lightPairs) >= Math.min(...darkPairs), `coppia più vicina: ${Math.min(...lightPairs).toFixed(3)} contro ${Math.min(...darkPairs).toFixed(3)}`);
});

test("tema chiaro: i dieci agenti con gli stessi toni, nello stesso ordine, leggibili", () => {
  const tones = Array.from({ length: 10 }, (_, index) => `uc-agente-${index + 1}`);
  assert.equal(new Set(tones.map((name) => `${light[name].L} ${light[name].C}`)).size, 1, "stessa luminosità e saturazione");
  for (const name of tones) assert.equal(light[name].h, dark[name].h, `${name}: stesso tono del tema scuro`);
  const t = light;
  const surfaces: Array<[string, Rgb]> = [
    ["card", t.card.rgb],
    ["background", t.background.rgb],
    ["muted/50 sulla card", over(t.muted.rgb, t.card.rgb, 0.5)],
  ];
  const edge = /\[data-slot="agent-tag"\]:not\(\[data-tone="neutro"\]\)\s*\{\s*border-color: color-mix\(in oklab, currentColor (\d+)%, transparent\);\s*\}/.exec(css);
  assert.ok(edge, "il bordo del tag degli agenti nel tema chiaro");
  assert.ok(rules.some((rule) => rule.selector === `${LIGHT} [data-slot="agent-tag"]:not([data-tone="neutro"])`), "solo nel tema chiaro");
  const edgeAlpha = Number(edge[1]) / 100;
  for (const name of tones) {
    const color = t[name];
    assert.ok(color.inGamut, `${name} dentro la gamma`);
    for (const [surfaceName, surface] of surfaces) {
      atLeast(ratio(color.rgb, surface), 4.5, `testo di ${name} su ${surfaceName}`);
      atLeast(ratio(color.rgb, over(color.rgb, surface, 0.16)), 4.5, `testo di ${name} sul suo fondo al 16%, su ${surfaceName}`);
      atLeast(ratio(over(color.rgb, surface, edgeAlpha), surface), 3, `bordo del tag ${name} su ${surfaceName}`);
      // Al 55% di agent-tag.tsx non basterebbe: per questo il bordo segue il testo.
      assert.ok(ratio(over(color.rgb, surface, 0.55), surface) < 3, `${name}: il bordo al 55% basterebbe`);
    }
    atLeast(ratio(color.rgb, t.muted.rgb), 3, `barra ${name} sulla traccia`);
  }
});

test("tema chiaro: l'area «Use case» e il dossier tornano ai token della pagina, anche nei pannelli sopra", () => {
  const reset = rules.find((rule) => rule.selector.startsWith(`${LIGHT}\n  :is(`) || rule.selector.startsWith(`${LIGHT} :is(`));
  assert.ok(reset, "il blocco che azzera l'area e il dossier");
  assert.deepEqual(declarations(reset.body), { "--muted-foreground": "inherit", "--input": "inherit", "--ring": "inherit" });
  const slots = (selector: string) => [...selector.matchAll(/data-slot="([^"]+)"/g)].map((match) => match[1]);
  const area = rules.find((rule) => rule.selector.startsWith("[data-use-case-root],"))!;
  const dossier = rules.find((rule) => rule.selector.startsWith("[data-uc-case-root],"))!;
  for (const slot of [...slots(area.selector), ...slots(dossier.selector)]) assert.ok(slots(reset.selector).includes(slot), `portale ${slot}`);
  for (const root of ["[data-use-case-root]", "[data-uc-case-root]"]) assert.ok(reset.selector.includes(root), root);
  // Ogni token che i blocchi scuri cambiano è azzerato.
  for (const name of [...Object.keys(declarations(area.body)), ...Object.keys(declarations(dossier.body))]) assert.ok(name in declarations(reset.body), name);
});

test("tema chiaro: i toast colorati con i toni del semaforo", () => {
  const sonner = rules.find((rule) => rule.selector === `${LIGHT} [data-sonner-toaster][data-sonner-theme="light"]`);
  assert.ok(sonner, "i colori dei toast nel tema chiaro");
  const values = declarations(sonner.body);
  const resolve = (value: string) => parseColor(value.startsWith("var(") ? lightValues[value.slice(4, -1)] : value);
  for (const [kind, tone] of [["success", "verde"], ["info", "blu"], ["warning", "giallo"], ["error", "rosso"]]) {
    assert.equal(values[`--${kind}-text`], `var(--uc-${tone})`);
    const bg = resolve(values[`--${kind}-bg`]);
    assert.equal(bg.alpha, 1, `${kind}: fondo pieno`);
    assert.ok(bg.inGamut && resolve(values[`--${kind}-border`]).inGamut, `${kind} dentro la gamma`);
    atLeast(ratio(resolve(values[`--${kind}-text`]).rgb, bg.rgb), 5.5, `testo del toast ${kind}`);
  }
});
