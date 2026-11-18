import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { installAppModules } from "../../lib/ai/claude-test-kit.ts";
import { enableTsxImports } from "../use-cases/detail/referent/tsx-test-loader.ts";

// (Rilascio 10, ondata 2b, rifiniture) `/dashboard/<ws>` è la pagina d'arrivo dopo il login: la Home si legge dentro un
// `Suspense` con il suo scheletro, così la cornice e lo scheletro arrivano subito e la pagina non resta vuota mentre il
// Programma si legge. La pagina vera, con l'accesso e la lettura della Home finti; i moduli dei campi del Programma sono
// componenti vuoti (portano con sé le azioni del server). Dati inventati.

type Prova = { asked: string[]; loads: string[]; refuse: Error | null };
const prova: Prova = { asked: [], loads: [], refuse: null };
(globalThis as { __homePage?: Prova }).__homePage = prova;

const WS = "11111111-1111-4111-8111-111111111111";
const FORMS = ["AsksEditor", "CaseDevControl", "CloseSalButton", "CustomKpiForm", "FactAsk", "FactsEditor", "KeyResultEditor", "KpiCatalog", "KpiEditor", "LsCostsForm", "WeightsForm"];

await installAppModules({
  "@/lib/auth/require-workspace": `export async function requireWorkspacePage(workspaceId) {
    const p = globalThis.__homePage; p.asked.push(workspaceId);
    if (p.refuse) throw p.refuse;
    return { session: { user: { id: "utente-prova", email: "persona@esempio.test", emailVerified: true, name: "Persona Prova", image: null } },
      access: { role: "contributor", source: "workspace", workspace: { id: workspaceId, name: "Cliente Demo", description: null } } };
  }`,
  "@/lib/db/queries/use-case-home": `export async function loadHome(i) {
    globalThis.__homePage.loads.push(i.role);
    return { kind: "contributore", workspaceId: i.workspace.id, description: null, useCases: [], participation: null, courses: [], proposeHref: "/dashboard/" + i.workspace.id + "/use-cases/nuovo" };
  }`,
  "./program-forms": FORMS.map((name) => `export function ${name}() { return null; }`).join("\n"),
});
await enableTsxImports();

const react = await import("react");
const { renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string };
const { default: HomePage } = (await import("../../app/(dashboard)/dashboard/[workspaceId]/page.tsx")) as unknown as {
  default: (props: { params: Promise<{ workspaceId: string }>; searchParams: Promise<Record<string, string>> }) => Promise<unknown>;
};
const { HomeSkeleton } = await import("./home-skeleton.tsx");

type Element = { type: unknown; props: { fallback?: Element; children?: Element } & Record<string, unknown> };
const open = (searchParams: Record<string, string> = {}) => HomePage({ params: Promise.resolve({ workspaceId: WS }), searchParams: Promise.resolve(searchParams) }) as Promise<Element>;

test("la pagina d'arrivo: prima la cornice con lo scheletro della Home, poi la Home", async () => {
  Object.assign(prova, { asked: [], loads: [], refuse: null });
  const page = await open();
  assert.equal(page.type, react.Suspense, "la Home dentro un Suspense");
  assert.equal(page.props.fallback?.type, HomeSkeleton, "con lo scheletro della Home");
  // Quello che il browser riceve subito: lo scheletro, che dice «Caricamento…» ai lettori di schermo; la Home no.
  const first = renderToStaticMarkup(page);
  assert.match(first, /<p role="status" class="sr-only">Caricamento…<\/p>/);
  assert.doesNotMatch(first, /<h1\b/);
  // Poi la Home vera, letta per chi guarda.
  const home = page.props.children!;
  assert.equal((home.type as { name?: string }).name, "HomeRoute");
  const tree = await (home.type as (props: unknown) => Promise<unknown>)(home.props);
  assert.match(renderToStaticMarkup(tree), /<h1 class="text-2xl font-semibold tracking-tight">Home<\/h1>/);
  assert.deepEqual(prova.asked, [WS], "l'accesso, una volta, prima dello scheletro");
  assert.ok(prova.loads.length > 0 && prova.loads.every((role) => role === "contributor"), "la Home, per chi guarda");
});

test("chi non può entrare non vede lo scheletro: l'accesso si controlla prima", async () => {
  const refused = Object.assign(new Error("NEXT_HTTP_ERROR_FALLBACK;404"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  Object.assign(prova, { asked: [], loads: [], refuse: refused });
  await assert.rejects(open(), (error) => error === refused);
  assert.deepEqual(prova.loads, []);
  prova.refuse = null;
});

test("lo scheletro sta nella pagina, non in un loading.tsx del workspace che avvolgerebbe ogni sua pagina", () => {
  const workspace = new URL("../../app/(dashboard)/dashboard/[workspaceId]/", import.meta.url);
  assert.equal(existsSync(new URL("loading.tsx", workspace)), false);
  // `/programma`, l'alias, ha il suo scheletro: lo stesso.
  assert.equal(existsSync(new URL("programma/loading.tsx", workspace)), true);
});
