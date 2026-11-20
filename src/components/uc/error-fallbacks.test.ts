import test, { before } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { enableTsxImports } from "../use-cases/detail/referent/tsx-test-loader.ts";

// I riquadri d'errore del dossier: la pagina (error.tsx del caso), i KPI, le persone e il grafo della
// Mappa. Next passa il valore lanciato così com'è (da 16.3 `ErrorInfo.error` è `unknown`): da un
// Client Component può arrivare `null`, `undefined` o una stringa. Leggere `.digest` su `null` faceva
// cadere il riquadro stesso, l'errore saliva al boundary di sopra e «Riprova» non compariva. Il
// codice si mostra solo se è un `digest` vero e (Ondata 0) solo a Lateral Space: la pagina lo sa dal
// guscio del caso (`viewer-context`), il pannello delle persone da `showCode`; il grafo della Mappa
// esiste solo nella vista di analisi, che è di Lateral Space.
type ErrorInfo = { error: unknown; reset: () => void; retry: () => void };
type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve?(specifier: string, context: object, nextResolve: (specifier: string, context: object) => ResolveResult): ResolveResult }): void;
};
type Fallback = (value: unknown) => unknown;

let renderToStaticMarkup: (element: unknown) => string;
let fallbacks: Record<string, Fallback>;
/** Gli stessi riquadri visti da chi non è di Lateral Space. */
let clientFallbacks: Record<string, Fallback>;

before(async () => {
  await enableTsxImports();
  // `next/error` dà `catchError` con un getter (per caricarlo solo se serve), che l'import ESM di Node
  // non vede: qui lo stesso `catchError` di Next, preso dal suo file.
  const catchErrorFile = nodeModule.createRequire(import.meta.url).resolve("next/dist/client/components/catch-error.js");
  const nextError = `data:text/javascript,${encodeURIComponent(`import { createRequire } from "node:module";\nexport const { catchError } = createRequire(${JSON.stringify(catchErrorFile)})(${JSON.stringify(catchErrorFile)});`)}`;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      return specifier === "next/error" ? { url: nextError, shortCircuit: true } : nextResolve(specifier, context);
    },
  });
  const react = await import("react");
  ({ renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string });
  const kpi = await import("./kpi/widget-boundary.tsx");
  const people = await import("./people/widget-boundary.tsx");
  const map = await import("./map/graph-boundary.tsx");
  const page = await import("../../app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/error.tsx");
  const viewer = await import("./shell/viewer-context.tsx");
  const info = (error: unknown): ErrorInfo => ({ error, reset() {}, retry() {} });
  // Il riquadro di `catchError` è una funzione (props, errorInfo): la si chiama dentro un componente,
  // come fa Next, così i suoi hook hanno dove stare.
  const asComponent = (render: () => unknown) => react.createElement(function Probe() {
    return render() as never;
  });
  const inShell = (lateralSpace: boolean, element: unknown) => react.createElement(viewer.LateralSpaceViewerProvider, { value: lateralSpace, children: element as never });
  fallbacks = {
    pagina: (error) => inShell(true, react.createElement(page.default, { error, retry() {} })),
    kpi: (error) => asComponent(() => kpi.WidgetError({ title: "KPI" }, info(error))),
    persone: (error) => asComponent(() => people.WidgetFallback({ title: "Persone", showCode: true }, info(error))),
    mappa: (error) => asComponent(() => map.GraphFallback({}, info(error))),
  };
  clientFallbacks = {
    pagina: (error) => inShell(false, react.createElement(page.default, { error, retry() {} })),
    "pagina fuori dal guscio": (error) => react.createElement(page.default, { error, retry() {} }),
    persone: (error) => asComponent(() => people.WidgetFallback({ title: "Persone" }, info(error))),
  };
});

const withDigest = Object.assign(new Error("boom"), { digest: "1234567890" });
const VALUES: [string, unknown][] = [
  ["null", null],
  ["undefined", undefined],
  ["una stringa", "stringa"],
  ["un Error", new Error("boom")],
  ["un Error con digest", withDigest],
];

test("riquadri d'errore del dossier: con qualsiasi valore lanciato resta «Riprova»", () => {
  for (const [where, fallback] of Object.entries(fallbacks)) {
    for (const [label, value] of VALUES) {
      const html = renderToStaticMarkup(fallback(value));
      assert.match(html, /role="alert"/, `${where}, ${label}`);
      assert.match(html, /Riprova/, `${where}, ${label}`);
      assert.doesNotMatch(html, /boom|stringa/, `${where}, ${label}: mai il messaggio`);
    }
  }
});

test("riquadri d'errore del dossier: il codice compare solo con un digest vero", () => {
  for (const where of ["pagina", "persone", "mappa"]) {
    assert.match(renderToStaticMarkup(fallbacks[where](withDigest)), /Codice: 1234567890/, where);
    for (const [label, value] of VALUES.slice(0, 4)) assert.doesNotMatch(renderToStaticMarkup(fallbacks[where](value)), /Codice/, `${where}, ${label}`);
    assert.doesNotMatch(renderToStaticMarkup(fallbacks[where]({ digest: "<b>x</b>" })), /Codice/, `${where}: un digest che non è un codice`);
  }
});

test("(Ondata 0) riquadri d'errore del dossier: chi non è di Lateral Space non vede il codice, solo «Riprova»", () => {
  for (const [where, fallback] of Object.entries(clientFallbacks)) {
    const html = renderToStaticMarkup(fallback(withDigest));
    assert.match(html, /Riprova/, where);
    assert.doesNotMatch(html, /Codice|1234567890/, where);
  }
});

test("ogni error.tsx tipizza il valore lanciato come `unknown`, come la guida di Next", () => {
  const app = new URL("../../app/", import.meta.url);
  const pages = (readdirSync(app, { recursive: true }) as string[]).filter((file) => /(^|\/)error\.tsx$/.test(file));
  assert.ok(pages.length >= 9, "le pagine d'errore ci sono");
  for (const file of pages) {
    const source = readFileSync(new URL(file, app), "utf8");
    assert.doesNotMatch(source, /error:\s*Error\b/, `${file}: \`error\` non è sempre un Error`);
    assert.doesNotMatch(source, /error\.digest|as Error\b/, `${file}: il digest si legge con digestOf`);
  }
});

test("(rilascio 10, §3.5) una pagina della realizzazione che non si carica: un testo solo e «Riprova», mai codici né «caso»", async () => {
  const react = await import("react");
  const { AppRouterContext } = (await import("next/dist/shared/lib/app-router-context.shared-runtime.js")) as unknown as { AppRouterContext: import("react").Context<object | null> };
  const router = { push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {} };
  const inApp = (element: unknown) => renderToStaticMarkup(react.createElement(AppRouterContext.Provider, { value: router }, element as never));
  const { PAGE_ERROR_TEXT } = await import("../dashboard/page-load-error.tsx");
  const { SectionUnavailable } = await import("./shell/section-unavailable.tsx");
  for (const [where, html] of [
    ["la pagina", renderToStaticMarkup(fallbacks.pagina(withDigest) as never)],
    ["sezione non disponibile", inApp(react.createElement(SectionUnavailable))],
  ] as [string, string][]) {
    assert.match(html, /role="alert"/, where);
    assert.ok(html.includes(PAGE_ERROR_TEXT.title), `${where}: ${html}`);
    assert.match(html, />Riprova</, where);
    assert.doesNotMatch(html, /non disponibile|del caso|Dossier|Casi d&#x27;uso/i, where);
  }
  assert.equal(PAGE_ERROR_TEXT.title, "Questa pagina non si è caricata.");
});

test("(rilascio 10, §3.5) una pagina che non c'è: un titolo calmo e la via d'uscita, mai «Riprova» (un 404 non riesce)", async () => {
  const react = await import("react");
  const { PathParamsContext } = (await import("next/dist/shared/lib/hooks-client-context.shared-runtime.js")) as unknown as { PathParamsContext: import("react").Context<object | null> };
  const { CASE_NOT_FOUND_TEXT } = await import("../../lib/uc/views/case-shell.ts");
  const params = { workspaceId: "00000000-0000-4000-8000-0000000000f1", caseId: "00000000-0000-4000-8000-000000000c01" };
  const withParams = (element: unknown) => renderToStaticMarkup(react.createElement(PathParamsContext.Provider, { value: params }, element as never)).replace(/&#x27;/g, "'");
  const inside = await import("../../app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/not-found.tsx");
  const outside = await import("../../app/(dashboard)/dashboard/[workspaceId]/casi-duso/not-found.tsx");
  const inner = withParams(react.createElement(inside.default));
  const outer = withParams(react.createElement(outside.default));
  for (const html of [inner, outer]) {
    assert.ok(html.includes(CASE_NOT_FOUND_TEXT.title), html);
    assert.doesNotMatch(html, /Riprova|non trovat|Codice|caso/i, html);
  }
  assert.match(inner, new RegExp(`href="/dashboard/${params.workspaceId}/casi-duso/${params.caseId}"[^>]*>${CASE_NOT_FOUND_TEXT.toOverview}<`));
  assert.doesNotMatch(inner, /bg-primary/, "inside the realization the filled button is the header's");
  assert.match(outer, new RegExp(`href="/dashboard/${params.workspaceId}/use-cases"[^>]*>${CASE_NOT_FOUND_TEXT.toUseCases}<`));
  assert.match(outer, /<h1 class="text-2xl font-semibold tracking-tight">/);
});
