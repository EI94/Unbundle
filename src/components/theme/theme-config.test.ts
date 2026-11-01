import test, { before } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { THEME_PROVIDER_PROPS, THEME_SCOPE_ATTRIBUTE, THEME_STORAGE_KEY, toasterTheme } from "./theme-config.ts";
import { readRepo } from "./test-support/color.ts";
import { enableTsxImports } from "../use-cases/detail/referent/tsx-test-loader.ts";

// Il tema del dashboard: chi lo sceglie, dove vale, come arriva prima che la pagina si disegni.

let renderToStaticMarkup: (element: unknown) => string;
let createElement: (type: unknown, props: unknown, ...children: unknown[]) => unknown;
let ThemeProvider: unknown;
before(async () => {
  await enableTsxImports();
  ({ ThemeProvider } = await import("./theme-provider.tsx"));
  const react = await import("react");
  createElement = (type, props, ...children) => react.createElement(type as never, props as never, ...(children as never[]));
  ({ renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string });
});

test("next-themes: «Scuro» per tutti finché qualcuno non sceglie, in data-theme, sotto una chiave sua", () => {
  assert.deepEqual(THEME_PROVIDER_PROPS, {
    attribute: "data-theme",
    defaultTheme: "dark",
    themes: ["dark", "light"],
    enableSystem: true,
    enableColorScheme: false,
    storageKey: "unbundle-theme",
    disableTransitionOnChange: true,
  });
  // La scelta delle pagine pubbliche /a e /s resta la sua.
  const survey = readRepo("src/components/ai-readiness/survey-theme-toggle.tsx");
  assert.ok(survey.includes('const STORAGE_KEY = "unbundle-survey-theme";'));
  assert.notEqual(THEME_STORAGE_KEY, "unbundle-survey-theme");
});

test("lo script del tema gira nell'HTML del server, prima che la pagina si disegni", () => {
  const html = renderToStaticMarkup(createElement(ThemeProvider, {}, createElement("p", {}, "pagina")));
  const script = /^<script type="text\/javascript">\(([\s\S]*)\)\(([\s\S]*)\)<\/script><p>pagina<\/p>$/.exec(html);
  assert.ok(script, html.slice(0, 200));
  // attributo, chiave, predefinito, tema forzato, temi, valori, sistema, color-scheme.
  assert.equal(script[2], '"data-theme","unbundle-theme","dark",null,["dark","light"],null,true,false');
  const provider = readRepo("src/components/theme/theme-provider.tsx");
  assert.ok(provider.includes('scriptProps={{ type: typeof window === "undefined" ? "text/javascript" : "text/plain" }}'), "nel client lo script è text/plain");
});

test("i toast: chiari solo sulle pagine del dashboard col tema chiaro, altrimenti come prima", () => {
  assert.equal(toasterTheme("light", "/dashboard"), "light");
  assert.equal(toasterTheme("light", "/dashboard/ws-1/use-cases"), "light");
  assert.equal(toasterTheme("dark", "/dashboard/ws-1"), "system");
  assert.equal(toasterTheme(undefined, "/dashboard/ws-1"), "system");
  assert.equal(toasterTheme("light", "/r/token"), "system");
  assert.equal(toasterTheme("light", "/rispondi/token"), "system");
  assert.equal(toasterTheme("light", "/a/token"), "system");
  assert.equal(toasterTheme("light", "/dashboardx"), "system");
  assert.equal(toasterTheme("light", null), "system");
  const sonner = readRepo("src/components/ui/sonner.tsx");
  assert.ok(sonner.includes("theme={toasterTheme(resolvedTheme, pathname)}"));
});

/** I file .tsx sotto una cartella, anche nelle sottocartelle. */
function tsxFiles(dir: string): string[] {
  return readdirSync(new URL(`../../../${dir}`, import.meta.url), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return tsxFiles(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

test("il tema chiaro vale solo nel dashboard: il segno sta in (dashboard)/layout e da nessun'altra parte", () => {
  assert.equal(THEME_SCOPE_ATTRIBUTE, "data-theme-scope");
  const layout = readRepo("src/app/(dashboard)/layout.tsx");
  assert.ok(layout.includes('<div data-theme-scope="" className="contents">'), "il segno, senza un riquadro in più");
  const marked = tsxFiles("src").filter((file) => readRepo(file).includes("data-theme-scope="));
  assert.deepEqual(marked, ["src/app/(dashboard)/layout.tsx"]);
  // Le pagine pubbliche chiare restano chiare dal server, senza il segno.
  for (const file of ["src/app/r/layout.tsx", "src/app/rispondi/layout.tsx"]) {
    const source = readRepo(file);
    assert.ok(source.includes("survey-light"), `${file}: .survey-light`);
    assert.ok(!source.includes("data-theme-scope"), `${file}: niente segno`);
  }
});

test("il layout di base: il tema per primo nel body, attorno a tutto il resto", () => {
  const layout = readRepo("src/app/layout.tsx");
  assert.ok(layout.includes("<html") && layout.includes("suppressHydrationWarning"), "html con suppressHydrationWarning");
  const body = layout.slice(layout.indexOf("<body"), layout.indexOf("</body>"));
  const inner = body.slice(body.indexOf(">") + 1).replace(/\{\/\*[\s\S]*?\*\/\}/g, "").trim();
  assert.ok(inner.startsWith("<ThemeProvider>"), inner.slice(0, 80));
  assert.ok(inner.endsWith("</ThemeProvider>"), inner.slice(-80));
  for (const child of ["<TooltipProvider>{children}</TooltipProvider>", "<Toaster richColors"]) assert.ok(inner.includes(child), child);
});
