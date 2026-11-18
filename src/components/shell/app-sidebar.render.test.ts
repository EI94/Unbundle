import test, { before } from "node:test";
import assert from "node:assert/strict";
import { installAppModules } from "../../lib/ai/claude-test-kit.ts";
import { enableTsxImports } from "../use-cases/detail/referent/tsx-test-loader.ts";
import { listNav, workspaceNav, type ShellViewer } from "./sidebar-model.ts";

// (Rilascio 10, ondata 2a «Cornice», docs/ui-10/PROPOSTA-10.md §2.1, §9.0) La barra laterale resa in HTML, ruolo per
// ruolo: il selettore del workspace in cima, le voci con le viste della voce accesa, una linea sottile e gli strumenti
// senza titolo, «Impostazioni» nel piede per chi gestisce, il menu sotto il nome. Firebase e la sessione finti.

await installAppModules({
  "@/lib/firebase/client": `export const firebaseAuth = {};`,
  "firebase/auth": `export async function signOut() {}`,
  "@/lib/auth/end-session": `export async function endAppSession() {}`,
});

const WS = "00000000-0000-4000-8000-0000000000f1";
const base = `/dashboard/${WS}`;

let html: (props: Record<string, unknown>, pathname: string) => string;

before(async () => {
  await enableTsxImports();
  const react = await import("react");
  const { renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string };
  const { AppRouterContext } = (await import("next/dist/shared/lib/app-router-context.shared-runtime.js")) as unknown as { AppRouterContext: import("react").Context<object | null> };
  const { PathnameContext } = (await import("next/dist/shared/lib/hooks-client-context.shared-runtime.js")) as unknown as { PathnameContext: import("react").Context<string | null> };
  const { AppSidebar } = (await import("../dashboard/app-sidebar.tsx")) as { AppSidebar: unknown };
  const { SidebarProvider } = (await import("../ui/sidebar.tsx")) as { SidebarProvider: unknown };
  const router = { push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {} };
  html = (props, pathname) =>
    renderToStaticMarkup(
      react.createElement(
        AppRouterContext.Provider,
        { value: router },
        react.createElement(PathnameContext.Provider, { value: pathname }, react.createElement(SidebarProvider as never, null, react.createElement(AppSidebar as never, props as never))),
      ),
    ).replace(/&#x27;/g, "'");
});

const viewer = (patch: Partial<ShellViewer>): ShellViewer => ({ workspaceId: WS, role: "analyst", useCaseHub: true, learningAvailable: true, casesAvailable: false, factoryAvailable: false, ...patch });
const USER = { name: "Persona Prova", email: "persona@esempio.test", image: null };

/** Le voci rese, con i link e lo stato acceso (`data-active` di `SidebarMenuButton` e `SidebarMenuSubButton`). */
function entries(page: string, kind: "menu-button" | "menu-sub-button" = "menu-button") {
  return [...page.matchAll(new RegExp(`<a\\b([^>]*data-sidebar="${kind}"[^>]*)>([\\s\\S]*?)<\\/a>`, "g"))].map(([, attributes, inner]) => ({
    title: inner.replace(/<[^>]+>/g, "").trim(),
    href: /\shref="([^"]*)"/.exec(attributes)?.[1] ?? "",
    active: /\sdata-active(?:="[^"]*")?(?=[\s>])/.test(attributes) && !/\sdata-active="false"/.test(attributes),
    current: /\saria-current="page"/.test(attributes),
  }));
}

test("revisore di Lateral Space che gestisce, su una board: Contesto accesa con Processi, gli strumenti sotto la linea, Impostazioni nel piede", () => {
  const page = html({ nav: workspaceNav(viewer({ role: "transformation_lead", factoryAvailable: true })), workspaceId: WS, workspaceName: "Cliente Demo", user: USER }, `${base}/mapping/00000000-0000-4000-8000-000000000d01`);
  const main = entries(page);
  assert.deepEqual(main.map((entry) => entry.title), ["Home", "Use case", "Agent Factory", "Contesto", "Persone", "Value map", "Report", "Blueprints", "Simulazione", "Intelligence", "Impostazioni"]);
  assert.deepEqual(main.filter((entry) => entry.active).map((entry) => entry.title), ["Contesto"]);
  // La vista accesa è quella della pagina; la voce resta accesa ma la pagina è della vista.
  const views = entries(page, "menu-sub-button");
  assert.deepEqual(views.map((entry) => [entry.title, entry.active, entry.current]), [["Processi", true, true], ["Intervista iniziale", false, false]]);
  assert.equal(main.find((entry) => entry.title === "Contesto")?.current, false);
  // Gli strumenti in un gruppo senza titolo a schermo, separato da una linea.
  assert.match(page, /role="group" aria-label="Strumenti"/);
  assert.doesNotMatch(page, /Altri strumenti|>Strumenti</);
  // In cima il selettore del workspace; nel piede il menu sotto il nome.
  assert.match(page, /aria-label="Cliente Demo: cambia workspace"[^>]*>[\s\S]*?Cliente Demo/);
  assert.match(page, /aria-label="Il tuo menu"/);
  assert.ok(page.includes("Persona Prova") && page.includes("persona@esempio.test"));
});

test("le viste stanno sotto la voce solo mentre è accesa", () => {
  const nav = workspaceNav(viewer({ role: "analyst" }));
  assert.deepEqual(entries(html({ nav, workspaceId: WS, workspaceName: "Cliente Demo", user: USER }, `${base}/use-cases`), "menu-sub-button"), []);
  const people = entries(html({ nav, workspaceId: WS, workspaceName: "Cliente Demo", user: USER }, `${base}/learning/programma-1`), "menu-sub-button");
  assert.deepEqual(people.map((entry) => [entry.title, entry.active]), [["AI Readiness", false], ["Formazione", true]]);
});

test("contributore: tre voci, niente linea, niente strumenti, niente Impostazioni", () => {
  const page = html({ nav: workspaceNav(viewer({ role: "contributor", learningAvailable: false })), workspaceId: WS, workspaceName: "Cliente Demo", user: USER }, base);
  assert.deepEqual(entries(page).map((entry) => [entry.title, entry.active]), [["Home", true], ["Use case", false], ["Contesto", false]]);
  assert.doesNotMatch(page, /aria-label="Strumenti"|Impostazioni/);
});

test("chi segue solo un corso: «Formazione», voce unica", () => {
  const page = html({ nav: workspaceNav(viewer({ role: "learner" })), workspaceId: WS, workspaceName: "Cliente Demo", user: USER }, `${base}/learning`);
  assert.deepEqual(entries(page).map((entry) => [entry.title, entry.href, entry.active]), [["Formazione", `${base}/learning`, true]]);
});

test("fuori da un workspace: il marchio, «I tuoi workspace» accesa, nessun selettore", () => {
  const page = html({ nav: listNav(), user: USER }, "/dashboard");
  assert.deepEqual(entries(page).map((entry) => [entry.title, entry.href, entry.active]), [["I tuoi workspace", "/dashboard?tutti=1", true]]);
  assert.match(page, />Unbundle</);
  assert.doesNotMatch(page, /cambia workspace/);
});

test("la campanella sta nella testata della barra su desktop", () => {
  const page = html({ nav: workspaceNav(viewer({})), workspaceId: WS, workspaceName: "Cliente Demo", user: USER, bell: "CAMPANELLA" }, base);
  const header = /data-sidebar="header"[\s\S]*?<\/div>\s*<div[^>]*data-sidebar="content"/.exec(page)?.[0] ?? "";
  assert.ok(header.includes("CAMPANELLA"), "nella testata");
});
