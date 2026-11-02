import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as census from "../../../scripts/theme/colour-census.mjs";
import * as roles from "../../../scripts/theme/palette-roles.mjs";

// La guardia dei colori fissi nel codice del dashboard (scripts/theme/colour-census.mjs): i colori nuovi
// passano dai token del tema, che valgono nei due temi. Un colore fisso in più, o un file nuovo con un
// colore fisso, fa fallire il test; uno in meno chiede di abbassare la base, così non torna.

const baseline = JSON.parse(readFileSync(new URL("./colour-baseline.json", import.meta.url), "utf8")) as Record<string, Record<string, number>>;
const current = census.census() as Record<string, Record<string, number>>;

// Dove la variante `light:` può stare: i pochi testi sbiaditi che i token non raggiungono.
const LIGHT_ALLOWED = [
  "src/components/dashboard/app-sidebar.tsx",
  "src/components/dashboard/activity-sidebar.tsx",
  "src/components/dashboard/department-dashboard.tsx",
  "src/components/agent/chat-interface.tsx",
  // L'interruttore spento dei risultati di Learning: al 40% del grigio secondario sarebbe 2:1 sulla card chiara.
  "src/components/learning/results-toggle.tsx",
  // La casella nativa del catalogo del dossier: `[color-scheme:dark]` la disegnerebbe scura sul bianco.
  "src/components/uc/catalog/checkbox.ts",
];

test("nessun colore fisso nuovo nel dashboard: si usano i token del tema", () => {
  const { grown, dropped } = census.compare(current, baseline) as { grown: string[]; dropped: string[] };
  assert.deepEqual(
    grown,
    [],
    "colori fissi in più (classi di Tailwind con una tinta, bianco o nero, esadecimali, rgb()/oklch(), testi sbiaditi, dark:, light:): " +
      "usare i token del tema (text-foreground, text-muted-foreground, bg-muted, border-input, i toni uc-*), che valgono nel tema scuro e in «Chiaro».",
  );
  assert.deepEqual(dropped, [], "meno colori fissi di prima: bene, abbassare la base con node scripts/theme/colour-census.mjs --write");
});

test("nessuna classe dark: nuova: nel dashboard non valgono mai", () => {
  for (const [file, counts] of Object.entries(current)) {
    assert.ok((counts.dark ?? 0) <= (baseline[file]?.dark ?? 0), `${file}: dark: in più; il tema chiaro e lo scuro passano dai token`);
  }
});

test("la variante light: solo dove serve", () => {
  const files = Object.entries(current).filter(([, counts]) => (counts.light ?? 0) > 0).map(([file]) => file);
  assert.deepEqual(files.filter((file) => !LIGHT_ALLOWED.includes(file)), [], "light: fuori dai file previsti: usare un token");
  for (const file of LIGHT_ALLOWED) assert.ok(files.includes(file), `${file}: light: atteso`);
});

test("ogni classe di colore di Tailwind usata ha il suo valore nel tema chiaro, o è già per il chiaro", () => {
  const plan = roles.plan() as Map<string, unknown>;
  const missing: string[] = [];
  for (const file of census.files() as string[]) {
    for (const use of roles.paletteClasses(readFileSync(file, "utf8")) as Array<{ token: string; utility: string; hue: string; step: number; dark: boolean }>) {
      if (use.dark) continue;
      const role = (roles.ROLE_OF_UTILITY as Record<string, string>)[use.utility];
      assert.ok(role, `${use.token}: utility senza ruolo`);
      if (roles.baseTarget(role, use.step) === null) continue;
      if (!plan.has(`${role}|${use.hue}|${use.step}`)) missing.push(use.token);
    }
  }
  assert.deepEqual(missing, [], "classi senza il valore del tema chiaro: node scripts/theme/palette-roles.mjs");
});

test("il censimento conta quello che deve", () => {
  const counts = census.count(
    [
      'className="text-emerald-300 bg-red-500/15 dark:text-amber-300 bg-white text-muted-foreground/50 light:text-muted-foreground"',
      'fill="#22c55e" stroke="rgba(1,2,3,0.5)"',
    ].join("\n"),
  );
  assert.deepEqual(counts, { palette: 2, whiteBlack: 1, hex: 1, namedColor: 0, colorFunction: 1, fadedText: 1, dark: 1, light: 1 });
  // Anche i colori scritti come valore arbitrario di Tailwind e i nomi dei colori CSS negli attributi e negli stili.
  assert.deepEqual(
    census.count('className="text-[#22c55e] bg-[#0f172a]/50 fill-[#fff] stroke-[red]" fill="white" stopColor="red" style={{ color: "black" }}'),
    { palette: 0, whiteBlack: 0, hex: 3, namedColor: 4, colorFunction: 0, fadedText: 0, dark: 0, light: 0 },
  );
  // currentColor, transparent e i token non sono colori fissi.
  assert.equal(census.count('fill="currentColor" stroke="transparent" style={{ color: "var(--foreground)" }} className="text-[var(--viz-x)]"').namedColor, 0);
  // I test e i loro aiuti non contano; le pagine del dashboard e i componenti sì.
  const files = (census.files() as string[]).map((file) => file.slice(census.REPO.length + 1));
  assert.ok(files.some((file) => file.startsWith("src/app/(dashboard)/")));
  assert.ok(files.some((file) => file.startsWith("src/components/use-cases/")));
  assert.ok(!files.some((file) => /\.test\.tsx?$/.test(file) || file.includes("/test-support/")));
});
