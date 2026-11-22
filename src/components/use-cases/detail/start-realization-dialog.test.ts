import test, { before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installAppModules } from "../../../lib/ai/claude-test-kit.ts";
import { findHubForbiddenIn } from "../../../lib/use-cases/copy-guard.ts";
import { START_DIALOG_TEXT as T, startTemplateLabel } from "../../../lib/uc/views/start-dialog.ts";
import { enableTsxImports } from "./referent/tsx-test-loader.ts";

// (Rilascio 10, docs/ui-10/PROPOSTA-10.md §3.5, F-019…F-024) «Avvia la realizzazione» è un dialogo sulla scheda dello
// use case: «Parte la realizzazione di XX-0012», «Cambia schema» solo con più di uno schema, «Avvia»; niente «Nome».
// Lo aprono il passo della scheda e la piega «Realizzazione»; senza i dati del dialogo, la pagina di ripiego.

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

type Render = (element: unknown) => string;
let render: Render;
let h: (type: unknown, props?: object | null, ...children: unknown[]) => unknown;
let D: { StartRealizationButton: (props: never) => unknown; StartRealizationHost: (props: never) => unknown };
let C: { StartRealizationButton: (props: never) => unknown; startClickHandler: (open: (() => void) | null) => ((event: never) => void) | undefined };

before(async () => {
  // L'azione del server è finta: qui si prova il dialogo, non la creazione.
  await installAppModules({ "@/lib/actions/uc-realization": "export async function startRealizationAction() { return { ok: true, data: { caseId: 'c' } }; }" });
  await enableTsxImports();
  const react = await import("react");
  const { renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: Render };
  const { AppRouterContext } = (await import("next/dist/shared/lib/app-router-context.shared-runtime.js")) as unknown as { AppRouterContext: import("react").Context<object | null> };
  const router = { push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {} };
  h = react.createElement as never;
  render = (element) => renderToStaticMarkup(react.createElement(AppRouterContext.Provider, { value: router }, element as never)).replace(/&#x27;/g, "'");
  C = (await import("./start-realization-context.tsx")) as never;
  D = { ...((await import("./start-realization-dialog.tsx")) as object), StartRealizationButton: C.StartRealizationButton } as never;
});

const DATA = {
  useCase: { id: "00000000-0000-4000-8000-0000000000a1", code: "XX-0012", title: "Smistamento delle richieste" },
  defaults: { title: "Smistamento delle richieste", oneLiner: "Le richieste arrivano da tre canali." },
  templates: [{ id: "00000000-0000-4000-8000-0000000000b1", name: "Smistamento richieste", questions: 245, restricted: true }],
  codeMissing: false,
  prefillRows: [],
};

test("the dialog's words: who starts what, with which template; at most 25 words, one click", () => {
  assert.equal(T.title("XX-0012", "Smistamento delle richieste"), "Parte la realizzazione di XX-0012");
  assert.equal(T.title(null, "Smistamento delle richieste"), "Parte la realizzazione di «Smistamento delle richieste»");
  assert.equal(T.template({ name: "Smistamento richieste", questions: 245 }), "Con lo schema «Smistamento richieste», 245 domande.");
  assert.equal(startTemplateLabel({ name: "Base", questions: 1 }), "Base · 1 domanda");
  const words = [T.title("XX-0012", ""), T.template({ name: "Smistamento richieste", questions: 245 }), T.change, T.cancel, T.start].join(" ").split(/\s+/).filter(Boolean);
  assert.ok(words.length <= 25, `${words.length} words`);
  assert.deepEqual(findHubForbiddenIn([T.title("XX-0012", "x"), T.template({ name: "x", questions: 2 }), T.change, T.chooseLabel, T.cancel, T.start, T.settings], "area"), []);
});

test("the buttons are links to the fallback page; with the dialog's data a click opens the dialog instead", () => {
  const fallback = render(h(D.StartRealizationButton, { href: "/dashboard/w/casi-duso/nuovo?useCaseId=u", label: "Avvia la realizzazione" }));
  assert.match(fallback, /<a [^>]*href="\/dashboard\/w\/casi-duso\/nuovo\?useCaseId=u"/);
  assert.doesNotMatch(fallback, /data-action="start-dialog"/);
  const inHost = render(h(D.StartRealizationHost, { workspaceId: "w", data: DATA }, h(D.StartRealizationButton, { href: "/x", label: "Avvia la realizzazione" })));
  assert.match(inHost, /<a [^>]*href="\/x"[^>]*data-action="start-dialog"|<a [^>]*data-action="start-dialog"[^>]*href="\/x"/, "without JavaScript the link still works");
  assert.match(inHost, /border/, "outlined: the filled one belongs to the step box");
  // The click: the dialog opens instead of the page; a click with a key (a new tab) or without the dialog stays a link.
  let opened = 0;
  const click = C.startClickHandler(() => void opened++)!;
  const event = (over: object = {}) => ({ defaultPrevented: false, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, prevented: false, preventDefault() { this.prevented = true; }, ...over });
  const plain = event();
  click(plain as never);
  assert.equal(opened, 1);
  assert.equal(plain.prevented, true);
  const newTab = event({ metaKey: true });
  click(newTab as never);
  assert.equal(opened, 1, "cmd/ctrl-click opens the page in a new tab");
  assert.equal(newTab.prevented, false);
  assert.equal(C.startClickHandler(null), undefined);
});

test("the dialog: no «Nome», «Cambia schema» only with more than one template, its own filled «Avvia», the same action", () => {
  const source = read("./start-realization-dialog.tsx");
  assert.doesNotMatch(source, /realizzazione-nome|>\s*Nome\s*</, "the name is the use case's title (F-020)");
  assert.match(source, /data\.templates\.length > 1 \?/, "«Cambia schema» only with more than one");
  assert.match(source, /if \(choosing\) chooserRef\.current\?\.focus\(\);/, "after «Cambia schema» the focus goes to the choice");
  assert.match(source, /<SelectTrigger ref=\{chooserRef\}/);
  assert.match(source, /startRealizationAction\(workspaceId, \{ useCaseId: data\.useCase\.id, templateId: template\.id, title: data\.defaults\.title, oneLiner:/);
  assert.match(source, /router\.push\(`\/dashboard\/\$\{workspaceId\}\/casi-duso\/\$\{created\.caseId\}`\)/, "then the Panoramica of the realization");
  assert.match(source, /<summary [^>]*>\{PREFILL_TEXT\.title\}<\/summary>/, "«Dati raccolti da Claude» in a closed fold (F-022)");
  assert.match(source, /REALIZATION_TEXT\.noPrefix/, "the missing code prefix says where to set it (F-023)");
  assert.doesNotMatch(source, /window\.(confirm|prompt|alert)/);
  const box = read("./next-step-box.tsx");
  assert.match(box, /case "avvia":[\s\S]*?onClick=\{startClickHandler\(openStart\)\}/, "the step opens the dialog, and stays a link without it");
  // The step box and the fold import only the context, never the dialog with the server action.
  assert.match(box, /from "\.\/start-realization-context"/);
  assert.doesNotMatch(box, /start-realization-dialog/);
  assert.doesNotMatch(read("./start-realization-context.tsx"), /lib\/actions/);
  const fold = read("./section-realization.tsx");
  assert.match(fold, /<StartRealizationButton href=\{`\/dashboard\/\$\{workspaceId\}\/casi-duso\/nuovo\?useCaseId=\$\{item\.id\}`\}/, "the fold too, with the fallback page");
  const page = read("../../../app/(dashboard)/dashboard/[workspaceId]/use-cases/[useCaseId]/page.tsx");
  assert.match(page, /realization\?\.state === "da_avviare" && realization\.canStart \? loadStartDialog\(/, "the data only when who looks can start now");
  const fallback = read("../../../app/(dashboard)/dashboard/[workspaceId]/casi-duso/nuovo/page.tsx");
  assert.match(fallback, /const form = await startFormData\(executor, workspaceId, context\);/, "the fallback page reads the same data");
  assert.doesNotMatch(read("../../uc/shell/create-wizard.tsx"), /realizzazione-nome/);
});
