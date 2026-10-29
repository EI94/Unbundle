import test, { before } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { enableTsxImports } from "../use-cases/detail/referent/tsx-test-loader.ts";

// I riquadri d'errore del dossier: la pagina (error.tsx del caso), i KPI, le persone e il grafo della
// Mappa. Next passa il valore lanciato così com'è (da 16.3 `ErrorInfo.error` è `unknown`): da un
// Client Component può arrivare `null`, `undefined` o una stringa. Leggere `.digest` su `null` faceva
// cadere il riquadro stesso, l'errore saliva al boundary di sopra e «Riprova» non compariva. Il
// codice si mostra solo se è un `digest` vero.
type ErrorInfo = { error: unknown; reset: () => void; retry: () => void };
type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve?(specifier: string, context: object, nextResolve: (specifier: string, context: object) => ResolveResult): ResolveResult }): void;
};
type Fallback = (value: unknown) => unknown;

let renderToStaticMarkup: (element: unknown) => string;
let fallbacks: Record<string, Fallback>;

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
  const info = (error: unknown): ErrorInfo => ({ error, reset() {}, retry() {} });
  // Il riquadro di `catchError` è una funzione (props, errorInfo): la si chiama dentro un componente,
  // come fa Next, così i suoi hook hanno dove stare.
  const asComponent = (render: () => unknown) => react.createElement(function Probe() {
    return render() as never;
  });
  fallbacks = {
    pagina: (error) => react.createElement(page.default, { error, retry() {} }),
    kpi: (error) => asComponent(() => kpi.WidgetError({ title: "KPI" }, info(error))),
    persone: (error) => asComponent(() => people.WidgetFallback({ title: "Persone" }, info(error))),
    mappa: (error) => asComponent(() => map.GraphFallback({}, info(error))),
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
