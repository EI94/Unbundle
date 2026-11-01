import test, { before } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { THEME_MENU_LABEL, THEME_OPTIONS, THEME_PROVIDER_PROPS, THEME_SCOPE_ATTRIBUTE, THEME_STORAGE_KEY, toasterTheme } from "./theme-config.ts";
import { readRepo } from "./test-support/color.ts";
import { enableTsxImports } from "../use-cases/detail/referent/tsx-test-loader.ts";

// Il tema del dashboard: chi lo sceglie, dove vale, come arriva prima che la pagina si disegni.

let renderToStaticMarkup: (element: unknown) => string;
let createElement: (type: unknown, props: unknown, ...children: unknown[]) => unknown;
let ThemeProvider: unknown;
let ThemeMenuGroup: unknown;
let MenuRoot: unknown;
before(async () => {
  await enableTsxImports();
  ({ ThemeProvider } = await import("./theme-provider.tsx"));
  ({ ThemeMenuGroup } = await import("./theme-menu.tsx"));
  MenuRoot = (await import("@base-ui/react/menu")).Menu.Root;
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

test("il menu «Tema»: «Scuro», «Chiaro», «Come il sistema», in quest'ordine, come voci a scelta singola", () => {
  assert.equal(THEME_MENU_LABEL, "Tema");
  assert.deepEqual(THEME_OPTIONS, [
    { value: "dark", label: "Scuro" },
    { value: "light", label: "Chiaro" },
    { value: "system", label: "Come il sistema" },
  ]);
  // Il gruppo come lo disegna Base UI (aperto, senza il portale): l'etichetta e tre `menuitemradio`.
  const html = renderToStaticMarkup(createElement(ThemeProvider, {}, createElement(MenuRoot, { open: true }, createElement(ThemeMenuGroup, {}))));
  const group = html.slice(html.indexOf("</script>") + "</script>".length);
  assert.match(group, /^<div role="group" data-slot="dropdown-menu-group"><div [^>]*data-slot="dropdown-menu-label"[^>]*>Tema<\/div>/);
  // L'etichetta nel grigio del testo secondario: quello delle etichette dei menu è 4,2:1 sul popover scuro.
  assert.match(group, /data-slot="dropdown-menu-label" class="[^"]*\btext-secondary-foreground\b[^"]*"/);
  const items = [...group.matchAll(/<div [^>]*role="menuitemradio"[^>]*aria-checked="(true|false)"[^>]*>([\s\S]*?)<\/div>/g)];
  assert.deepEqual(items.map((item) => item[2].replace(/<[^>]+>/g, "")), ["Scuro", "Chiaro", "Come il sistema"]);
  // Nell'HTML del server il tema non è ancora letto: vale il predefinito, «Scuro».
  assert.deepEqual(items.map((item) => item[1]), ["true", "false", "false"]);
  // Le icone non si leggono: dicono la stessa cosa del testo.
  for (const icon of ["lucide-moon", "lucide-sun", "lucide-monitor"]) assert.match(group, new RegExp(`class="lucide ${icon}[^"]*" aria-hidden="true"`), icon);
  const menu = readRepo("src/components/theme/theme-menu.tsx");
  assert.ok(menu.includes('const value: ThemeChoice = isChoice(theme) ? theme : "dark";'), "un valore salvato sconosciuto vale «Scuro»");
  assert.ok(!menu.includes("closeOnClick"), "il menu resta aperto dopo la scelta");
});

test("il menu «Tema» sta sotto il nome, in fondo alla barra laterale, tra «I miei workspace» e «Esci»", () => {
  const sidebar = readRepo("src/components/dashboard/app-sidebar.tsx");
  assert.ok(sidebar.includes('import { ThemeMenuGroup } from "@/components/theme/theme-menu";'));
  const footer = sidebar.slice(sidebar.indexOf("<SidebarFooter>"), sidebar.indexOf("</SidebarFooter>"));
  const content = footer.slice(footer.indexOf("<DropdownMenuContent"), footer.indexOf("</DropdownMenuContent>"));
  assert.ok(content.length > 0, "il menu sotto il nome");
  const order = ["I miei workspace", "<DropdownMenuSeparator />", "<ThemeMenuGroup />", "<DropdownMenuSeparator />", "Esci"].map((needle) => content.indexOf(needle));
  assert.ok(order.every((index) => index >= 0), String(order));
  assert.ok(order[1] < order[2] && order[2] < content.lastIndexOf("<DropdownMenuSeparator />") && order[0] < order[1] && content.lastIndexOf("<DropdownMenuSeparator />") < order[4], "l'ordine delle voci");
  assert.equal(sidebar.match(/<ThemeMenuGroup \/>/g)?.length, 1);
  // Il nome del workspace sotto «Unbundle»: al 50% sul grigio chiaro sarebbe 3,4:1, col tema chiaro va al 70%.
  assert.ok(sidebar.includes("text-sidebar-foreground/50 light:text-sidebar-foreground/70"), "il nome del workspace nel tema chiaro");
  // L'e-mail e la freccia sotto il nome: al 60% sul grigio della voce aperta sarebbero 4,4:1 nel chiaro.
  assert.equal(sidebar.match(/text-sidebar-foreground\/60 light:text-sidebar-foreground\/70/g)?.length, 2, "e-mail e freccia nel tema chiaro");
  // La stessa barra (e lo stesso menu) per /dashboard e per ogni workspace.
  for (const file of ["src/components/dashboard/dashboard-list-shell.tsx", "src/app/(dashboard)/dashboard/[workspaceId]/layout.tsx"]) assert.ok(readRepo(file).includes("<AppSidebar"), file);
});
