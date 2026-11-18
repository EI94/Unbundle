import test, { before } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { enableTsxImports } from "../use-cases/detail/referent/tsx-test-loader.ts";

// (Ondata 0, docs/ui-10/PROPOSTA-10.md §6.4 voce 0.23) Nessuna pagina mostra più la pagina inglese di Next: un
// `error.tsx` per le pagine del workspace (dentro la cornice), uno per `/dashboard`, un `global-error.tsx` per tutto il
// resto; e un `loading.tsx` per le pagine del workspace che non l'avevano. «Questa pagina non si è caricata.» e
// «Riprova». Resa in HTML; il messaggio e il codice dell'errore non compaiono mai.

const APP = new URL("../../app/", import.meta.url);
const WS = "(dashboard)/dashboard/[workspaceId]/";

type ErrorPage = (props: { error: unknown; retry: () => void }) => unknown;
let pages: Record<string, ErrorPage>;
let loadings: Record<string, () => unknown>;
let render: (element: unknown) => string;
let h: (type: unknown, props: unknown) => unknown;

/** Le pagine del workspace senza un loading.tsx loro prima dell'ondata 0 (Processi esclusi: vedi il test in fondo). */
const LOADING = ["agent-factory", "settings", "ai-readiness", "strategy"];

before(async () => {
  await enableTsxImports();
  const react = await import("react");
  h = (type, props) => react.createElement(type as never, props as never);
  ({ renderToStaticMarkup: render } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string });
  const load = async (path: string) => ((await import(new URL(path, APP).href)) as { default: ErrorPage }).default;
  pages = {
    workspace: await load(`${WS}error.tsx`),
    dashboard: await load("(dashboard)/dashboard/error.tsx"),
    global: await load("global-error.tsx"),
  };
  loadings = Object.fromEntries(await Promise.all(LOADING.map(async (d) => [d, (await load(`${WS}${d}/loading.tsx`)) as unknown as () => unknown])));
});

const VALUES: [string, unknown][] = [
  ["null", null],
  ["una stringa", "stringa segreta"],
  ["un Error", new Error("messaggio segreto")],
  ["un Error con digest", Object.assign(new Error("messaggio segreto"), { digest: "1234567890" })],
];

test("the workspace, /dashboard and the global boundary: the calm sentence and «Riprova», never the message or the code", () => {
  for (const [where, Page] of Object.entries(pages)) {
    for (const [label, error] of VALUES) {
      const html = render(h(Page, { error, retry() {} }));
      assert.match(html, /role="alert"/, `${where}, ${label}`);
      assert.match(html, /Questa pagina non si è caricata\./, `${where}, ${label}`);
      assert.match(html, />Riprova</, `${where}, ${label}`);
      assert.doesNotMatch(html, /segret|1234567890|Codice/, `${where}, ${label}`);
    }
  }
});

test("the global boundary is a whole Italian document, and «Riprova» reloads it", () => {
  const html = render(h(pages.global, { error: null, retry() {} }));
  assert.match(html, /^<html lang="it">/);
  assert.match(html, /<body>/);
  assert.match(html, /<title>Questa pagina non si è caricata — Unbundle<\/title>/);
  assert.match(readFileSync(new URL("global-error.tsx", APP), "utf8"), /onClick=\{\(\) => window\.location\.reload\(\)\}/);
});

test("inside the app «Riprova» re-reads the segment with retry (Next 16), not reset", () => {
  const shared = readFileSync(new URL("./page-load-error.tsx", import.meta.url), "utf8");
  assert.match(shared, /onClick=\{\(\) => retry\(\)\}/);
  for (const file of [`${WS}error.tsx`, "(dashboard)/dashboard/error.tsx"]) {
    const source = readFileSync(new URL(file, APP), "utf8");
    assert.match(source, /\{ error, retry \}: \{ error: unknown; retry: \(\) => void \}/, file);
    assert.doesNotMatch(source, /\breset\b/, file);
  }
});

test("the workspace pages that had none now load with a skeleton inside the frame", () => {
  for (const [where, Loading] of Object.entries(loadings)) {
    const html = render(h(Loading, {}));
    assert.match(html, /role="status"/, where);
    assert.match(html, /Caricamento…/, where);
  }
});

test("Processi keeps the board's own loading: no mapping/loading.tsx above the unit board's layout", () => {
  // Un loading.tsx in mapping/ avvolgerebbe il layout della board di un'unità (mapping/[deptId]/layout.tsx) e mostrerebbe
  // uno scheletro prima della testata che la board disegna mentre carica («il riferimento non ha scheletri»).
  assert.equal(existsSync(new URL(`${WS}mapping/loading.tsx`, APP)), false);
  assert.equal(existsSync(new URL(`${WS}mapping/[deptId]/loading.tsx`, APP)), true);
});
