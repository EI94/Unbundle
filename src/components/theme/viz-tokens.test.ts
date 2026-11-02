import test from "node:test";
import assert from "node:assert/strict";
import { atLeast, declarations, over, parseColor, ratio, readRepo, topLevelRules, type Rgb } from "./test-support/color.ts";

// I grafici disegnati con valori fissi (la matrice di Portfolio, la matrice dei use case della vecchia
// panoramica, la Wardley map, il radar di AI Readiness) prendono i colori da src/app/theme-viz.css:
// nel tema scuro gli stessi valori di prima, nel tema «Chiaro» le stesse tinte che si leggono sul fondo
// chiaro.

const LIGHT = ':root[data-theme="light"]:has([data-theme-scope])';
const rules = topLevelRules(readRepo("src/app/theme-viz.css"));
const darkRule = rules.find((rule) => rule.selector === ":root");
const lightRule = rules.find((rule) => rule.selector === LIGHT);
assert.ok(darkRule && lightRule);
const dark = declarations(darkRule.body);
const light = declarations(lightRule.body);

const CHARTS = [
  "src/components/portfolio/ranking-matrix.tsx",
  "src/components/dashboard/use-case-matrix.tsx",
  "src/components/maps/wardley-map.tsx",
  "src/components/ai-readiness/pillar-radar.tsx",
];

// I valori scritti nei grafici prima dei token, così come erano: il tema scuro non cambia.
const BEFORE: Record<string, string> = {
  "--viz-portfolio-neutral-fill": "#64748b",
  "--viz-portfolio-neutral-soft": "rgba(100, 116, 139, 0.14)",
  "--viz-portfolio-neutral-stroke": "#475569",
  "--viz-portfolio-red-fill": "#ef4444",
  "--viz-portfolio-red-soft": "rgba(239, 68, 68, 0.16)",
  "--viz-portfolio-red-stroke": "#b91c1c",
  "--viz-portfolio-yellow-fill": "#f59e0b",
  "--viz-portfolio-yellow-soft": "rgba(245, 158, 11, 0.18)",
  "--viz-portfolio-yellow-stroke": "#b45309",
  "--viz-portfolio-green-fill": "#22c55e",
  "--viz-portfolio-green-soft": "rgba(34, 197, 94, 0.18)",
  "--viz-portfolio-green-stroke": "#15803d",
  "--viz-portfolio-active-stroke": "#0f172a",
  "--viz-portfolio-bg-start": "rgba(16,185,129,0.10)",
  "--viz-portfolio-bg-middle": "rgba(15,23,42,0.02)",
  "--viz-portfolio-bg-end": "rgba(245,158,11,0.10)",
  "--viz-portfolio-zone-quick-win": "rgba(34,197,94,0.10)",
  "--viz-portfolio-zone-strategic-bet": "rgba(59,130,246,0.08)",
  "--viz-portfolio-zone-capability-builder": "rgba(245,158,11,0.10)",
  "--viz-portfolio-grid": "rgba(148,163,184,0.18)",
  "--viz-portfolio-axis": "rgba(100,116,139,0.7)",
  "--viz-portfolio-threshold": "rgba(71,85,105,0.8)",
  "--viz-matrix-quick-win": "#22c55e",
  "--viz-matrix-strategic-bet": "#8b5cf6",
  "--viz-matrix-capability-builder": "#3b82f6",
  "--viz-matrix-not-yet": "#94a3b8",
  "--viz-matrix-reference": "#666",
  // Le etichette «Fattibilita'» e «Impatto» degli assi: il grigio che recharts scrive da sé.
  "--viz-matrix-label": "#808080",
  "--viz-wardley-automate": "#22c55e",
  "--viz-wardley-differentiate": "#8b5cf6",
  "--viz-wardley-innovate": "#f59e0b",
  "--viz-wardley-other": "#64748b",
  "--viz-readiness": "oklch(0.72 0.17 160)",
};

test("nel tema scuro i grafici tengono i colori di prima", () => {
  assert.deepEqual(dark, BEFORE);
  assert.deepEqual(Object.keys(light).sort(), Object.keys(dark).sort(), "il tema chiaro ridefinisce ogni token");
  assert.deepEqual(rules.map((rule) => rule.selector), [":root", LIGHT]);
});

test("i grafici non scrivono più colori fissi, e ogni token che usano esiste", () => {
  const used = new Set<string>();
  for (const file of CHARTS) {
    const source = readRepo(file);
    assert.deepEqual(source.match(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch)\(/g) ?? [], [], `${file}: colori fissi`);
    for (const match of source.matchAll(/var\((--viz-[\w-]+)\)/g)) used.add(match[1]);
  }
  assert.deepEqual([...used].filter((name) => !(name in dark)), [], "token usati ma non definiti");
  assert.deepEqual(Object.keys(dark).filter((name) => !used.has(name)), [], "token definiti ma non usati");
});

const WHITE: Rgb = parseColor("oklch(1 0 0)").rgb;
const PAGE: Rgb = parseColor("oklch(0.985 0.002 260)").rgb;
const color = (name: string) => parseColor(light[name]);
/** Un colore del tema chiaro sopra `surface`, con la sua opacità. */
const seen = (name: string, surface: Rgb) => over(color(name).rgb, surface, color(name).alpha);

test("nel tema chiaro i punti, le barre e le linee che dicono qualcosa almeno 3:1, i testi colorati 4,5:1", () => {
  const marks = [
    ...["neutral", "red", "yellow", "green"].flatMap((band) => [`--viz-portfolio-${band}-fill`, `--viz-portfolio-${band}-stroke`]),
    "--viz-portfolio-active-stroke",
    "--viz-portfolio-axis",
    "--viz-portfolio-threshold",
    "--viz-matrix-quick-win",
    "--viz-matrix-strategic-bet",
    "--viz-matrix-capability-builder",
    "--viz-matrix-not-yet",
    "--viz-matrix-reference",
    "--viz-readiness",
  ];
  // La matrice di Portfolio: sul fondo della pagina e dentro ogni zona colorata.
  const zones = ["quick-win", "strategic-bet", "capability-builder"].map((zone) => [zone, seen(`--viz-portfolio-zone-${zone}`, PAGE)] as const);
  for (const name of marks) {
    for (const [surfaceName, surface] of [["card", WHITE], ["fondo", PAGE], ...zones] as Array<readonly [string, Rgb]>) {
      atLeast(ratio(seen(name, surface), surface), 3, `${name} su ${surfaceName}`);
    }
  }
  // I flussi della Wardley map sono anche il testo dell'etichetta nel suggerimento (su --card).
  for (const name of ["--viz-wardley-automate", "--viz-wardley-differentiate", "--viz-wardley-innovate", "--viz-wardley-other"]) atLeast(ratio(seen(name, WHITE), WHITE), 4.5, name);
  // Le etichette degli assi della matrice dei use case sono testo (14 px) sulla card e sulla pagina:
  // il grigio di recharts sarebbe 3,9:1 sul bianco.
  for (const [surfaceName, surface] of [["card", WHITE], ["fondo", PAGE]] as const) atLeast(ratio(seen("--viz-matrix-label", surface), surface), 4.5, `--viz-matrix-label su ${surfaceName}`);
  assert.ok(ratio(parseColor(dark["--viz-matrix-label"]).rgb, WHITE) < 4.5, "il grigio di recharts non basta sul bianco");
  const matrix = readRepo("src/components/dashboard/use-case-matrix.tsx");
  assert.equal(matrix.match(/<Label[^>]*fill="var\(--viz-matrix-label\)"/g)?.length, 2, "le due etichette degli assi");
  // Il radar: la stessa tinta del tema scuro, dentro la gamma dello schermo.
  assert.equal(color("--viz-readiness").h, parseColor(dark["--viz-readiness"]).h);
  assert.ok(color("--viz-readiness").inGamut);
});

test("nel tema chiaro gli stessi colori per le stesse cose (stessa tinta, entro 12°)", () => {
  const hueDistance = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
  for (const name of Object.keys(dark)) {
    const before = parseColor(dark[name]);
    const after = color(name);
    if (before.C < 0.03 || after.C < 0.03) continue; // i grigi
    assert.ok(hueDistance(before.h, after.h) <= 12, `${name}: ${before.h.toFixed(0)}° → ${after.h.toFixed(0)}°`);
  }
});

test("i testi sbiaditi dei pannelli vecchi tornano pieni nel tema chiaro", () => {
  const sites: Array<[string, string]> = [
    ["src/components/dashboard/activity-sidebar.tsx", "text-muted-foreground/70 light:text-muted-foreground"],
    ["src/components/dashboard/activity-sidebar.tsx", "text-muted-foreground/50 light:text-muted-foreground"],
    ["src/components/dashboard/department-dashboard.tsx", "font-mono text-muted-foreground/50 light:text-muted-foreground"],
    ["src/components/dashboard/department-dashboard.tsx", "shrink-0 text-muted-foreground/50 light:text-muted-foreground"],
    ["src/components/agent/chat-interface.tsx", "text-muted-foreground/50 light:text-muted-foreground"],
    ["src/components/agent/chat-interface.tsx", "text-muted-foreground/60 light:text-muted-foreground"],
  ];
  for (const [file, classes] of sites) assert.ok(readRepo(file).includes(classes), `${file}: ${classes}`);
  for (const file of new Set(sites.map(([file]) => file))) {
    assert.deepEqual(readRepo(file).match(/text-muted-foreground\/\d+(?!\d| light:text-muted-foreground)/g) ?? [], [], `${file}: testo sbiadito senza il tema chiaro`);
  }
});
