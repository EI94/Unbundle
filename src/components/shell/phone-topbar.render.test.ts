import test, { before } from "node:test";
import assert from "node:assert/strict";
import { installAppModules } from "../../lib/ai/claude-test-kit.ts";
import { enableTsxImports } from "../use-cases/detail/referent/tsx-test-loader.ts";
import { listNav, workspaceNav, type ShellNav, type ShellViewer } from "./sidebar-model.ts";

// (Rilascio 10, ondata 2a «Cornice», docs/ui-10/PROPOSTA-10.md §2.1, §5.7) La barra in alto del telefono resa in HTML:
// «☰», il titolo della pagina (la voce accesa o la sua vista, altrimenti il nome del workspace) e la campanella, che
// qui c'è solo al telefono (su desktop sta nella barra laterale: una sola alla volta). La larghezza della finestra la
// decide il test.

const screen = { phone: false };
(globalThis as { __phoneTopbarScreen?: typeof screen }).__phoneTopbarScreen = screen;

await installAppModules({
  "@/hooks/use-mobile": `export function useIsMobile() { return globalThis.__phoneTopbarScreen.phone === true; }`,
});

const WS = "00000000-0000-4000-8000-0000000000f1";
const base = `/dashboard/${WS}`;

let html: (props: { nav: ShellNav; workspaceId?: string; fallbackTitle: string; bell?: unknown }, pathname: string, phone: boolean) => string;

before(async () => {
  await enableTsxImports();
  const react = await import("react");
  const { renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string };
  const { AppRouterContext } = (await import("next/dist/shared/lib/app-router-context.shared-runtime.js")) as unknown as { AppRouterContext: import("react").Context<object | null> };
  const { PathnameContext } = (await import("next/dist/shared/lib/hooks-client-context.shared-runtime.js")) as unknown as { PathnameContext: import("react").Context<string | null> };
  const { PhoneTopbar } = (await import("./phone-topbar.tsx")) as { PhoneTopbar: unknown };
  const { SidebarProvider } = (await import("../ui/sidebar.tsx")) as { SidebarProvider: unknown };
  const router = { push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {} };
  html = (props, pathname, phone) => {
    screen.phone = phone;
    return renderToStaticMarkup(
      react.createElement(
        AppRouterContext.Provider,
        { value: router },
        react.createElement(PathnameContext.Provider, { value: pathname }, react.createElement(SidebarProvider as never, null, react.createElement(PhoneTopbar as never, props as never))),
      ),
    ).replace(/&#x27;/g, "'");
  };
});

const viewer = (patch: Partial<ShellViewer> = {}): ShellViewer => ({ workspaceId: WS, role: "transformation_lead", useCaseHub: true, learningAvailable: true, casesAvailable: false, factoryAvailable: true, ...patch });
const topbar = (page: string) => /<header data-slot="phone-topbar"[\s\S]*?<\/header>/.exec(page)?.[0] ?? "";
const titleOf = (page: string) => /<p class="absolute [^"]*">([^<]*)<\/p>/.exec(topbar(page))?.[1] ?? null;

test("il titolo è la pagina: la voce accesa o la sua vista, altrimenti il nome del workspace", () => {
  const nav = workspaceNav(viewer());
  const props = { nav, workspaceId: WS, fallbackTitle: "Cliente Demo" };
  for (const [pathname, title] of [
    [base, "Home"],
    [`${base}/programma`, "Home"],
    [`${base}/strategy`, "Home"],
    [`${base}/use-cases`, "Use case"],
    [`${base}/use-cases/00000000-0000-4000-8000-0000000000c1`, "Use case"],
    [`${base}/agent-factory`, "Agent Factory"],
    [`${base}/contesto`, "Contesto"],
    [`${base}/mapping/00000000-0000-4000-8000-000000000d01`, "Processi"],
    [`${base}/setup/leadership`, "Intervista iniziale"],
    [`${base}/ai-readiness`, "AI Readiness"],
    [`${base}/learning/programma-1`, "Formazione"],
    [`${base}/value-map`, "Value map"],
    [`${base}/settings`, "Impostazioni"],
    [`${base}/pagina-che-non-ha-una-voce`, "Cliente Demo"],
  ] as const) {
    assert.equal(titleOf(html(props, pathname, true)), title, pathname);
  }
  // Chi segue solo un corso: «Formazione»; fuori da un workspace, «I tuoi workspace».
  assert.equal(titleOf(html({ nav: workspaceNav(viewer({ role: "learner" })), workspaceId: WS, fallbackTitle: "Cliente Demo" }, `${base}/learning`, true)), "Formazione");
  assert.equal(titleOf(html({ nav: listNav(), fallbackTitle: "Unbundle" }, "/dashboard", true)), "I tuoi workspace");
});

test("la campanella sta qui solo al telefono; su desktop il suo posto resta vuoto, della stessa misura", () => {
  const props = { nav: workspaceNav(viewer()), workspaceId: WS, fallbackTitle: "Cliente Demo", bell: "CAMPANELLA" };
  const phone = topbar(html(props, base, true));
  assert.ok(phone.includes("CAMPANELLA"), "al telefono la campanella");
  const desktop = topbar(html(props, base, false));
  assert.ok(!desktop.includes("CAMPANELLA"), "su desktop la campanella sta nella barra laterale");
  assert.match(desktop, /<span aria-hidden="true" class="size-11"><\/span><\/header>$/, "il posto della campanella, vuoto");
  // Senza campanella (chi segue solo un corso), anche al telefono il posto resta vuoto.
  const learner = topbar(html({ nav: workspaceNav(viewer({ role: "learner" })), workspaceId: WS, fallbackTitle: "Cliente Demo" }, `${base}/learning`, true));
  assert.match(learner, /<span aria-hidden="true" class="size-11"><\/span><\/header>$/);
});

test("la barra: 56 px, solo sotto i 768 px, «☰» da 44 px che apre la barra laterale", () => {
  const bar = topbar(html({ nav: workspaceNav(viewer()), workspaceId: WS, fallbackTitle: "Cliente Demo", bell: "CAMPANELLA" }, base, true));
  assert.match(bar, /^<header data-slot="phone-topbar" class="[^"]*\bh-14\b[^"]*\bmd:hidden\b[^"]*">/);
  assert.match(bar, /<button[^>]*aria-label="Apri il menu"[^>]*>/);
  assert.match(/<button[^>]*aria-label="Apri il menu"[^>]*>/.exec(bar)?.[0] ?? "", /class="[^"]*\bsize-11\b/);
  // Un titolo lungo non spinge via «☰» né la campanella: si tronca.
  assert.match(bar, /<p class="absolute [^"]*\btruncate\b[^"]*">Home<\/p>/);
});
