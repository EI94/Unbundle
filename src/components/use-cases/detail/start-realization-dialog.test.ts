import test, { before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installAppModules } from "../../../lib/ai/claude-test-kit.ts";
import { findHubForbiddenIn } from "../../../lib/use-cases/copy-guard.ts";
import { START_DIALOG_TEXT as T } from "../../../lib/uc/views/start-dialog.ts";
import { START_TEMPLATE_TEXT } from "../../../lib/uc/views/start-templates.ts";
import { enableTsxImports } from "./referent/tsx-test-loader.ts";

// (Rilascio 10, docs/ui-10/PROPOSTA-10.md §3.5, F-019…F-024) «Avvia la realizzazione» è un dialogo sulla scheda dello
// use case: «Parte la realizzazione di XX-0012», «Cambia schema» solo con più di uno schema, «Avvia»; niente «Nome».
// Lo aprono il passo della scheda e la piega «Realizzazione»; senza i dati del dialogo, la pagina di ripiego.
// Lo schema di partenza segue R2 di docs/dossier/SCHEMA-DI-PARTENZA.md, come la pagina di ripiego. Dati inventati.

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

type Render = (element: unknown) => string;
let render: Render;
let h: (type: unknown, props?: object | null, ...children: unknown[]) => unknown;
let D: { StartRealizationButton: (props: never) => unknown; StartRealizationHost: (props: never) => unknown };
let W: { StartRealizationForm: (props: never) => unknown };
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
  W = (await import("../../uc/shell/create-wizard.tsx")) as never;
});

const FROM_USE_CASE = { id: "00000000-0000-4000-8000-0000000000b1", key: "unbundle.dal_caso", name: "Dal caso d'uso", questions: 6, line: "per ogni use case · 6 domande", restricted: false, fromUseCase: true };
const RESERVED = { id: "00000000-0000-4000-8000-0000000000b2", key: "settore.smistamento", name: "Smistamento richieste", questions: 245, line: "per smistamento richieste · 245 domande", restricted: true, fromUseCase: false };
const OTHER = { id: "00000000-0000-4000-8000-0000000000b3", key: "esempio.minimo", name: "Esempio · Turni", questions: 12, line: "per turni di reparto · 12 domande", restricted: false, fromUseCase: false };

const DATA = {
  useCase: { id: "00000000-0000-4000-8000-0000000000a1", code: "XX-0012", title: "Smistamento delle richieste" },
  defaults: { title: "Smistamento delle richieste", oneLiner: "Le richieste arrivano da tre canali." },
  templates: [FROM_USE_CASE, RESERVED],
  otherTemplates: [OTHER],
  preselectedId: FROM_USE_CASE.id,
  codeMissing: false,
  prefillRows: [],
};

test("the dialog's words: who starts what, with which template; at most 25 words, one click", () => {
  assert.equal(T.title("XX-0012", "Smistamento delle richieste"), "Parte la realizzazione di XX-0012");
  assert.equal(T.title(null, "Smistamento delle richieste"), "Parte la realizzazione di «Smistamento delle richieste»");
  assert.equal(T.template({ name: "Smistamento richieste", questions: 245 }), "Con lo schema «Smistamento richieste», 245 domande.");
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
  assert.match(source, /\) : all\.length > 1 \? \(/, "«Cambia schema» only with more than one");
  assert.match(source, /if \(choosing\) chooserRef\.current\?\.focus\(\);/, "after «Cambia schema» the focus goes to the choice");
  assert.match(source, /focusRef=\{chooserRef\}/);
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

test("(R2) the dialog chooses the schema as the fallback page does: «Dal caso d'uso» preselected, never a reserved one, >50 asked", () => {
  const source = read("./start-realization-dialog.tsx");
  // The same choice and the same rule as the fallback page: what is preselected comes from `preselectedId`, never from the order.
  assert.match(source, /useStartTemplatePicker\(data\.templates, data\.otherTemplates, data\.preselectedId\)/);
  assert.doesNotMatch(source, /templates\[0\]/, "the first schema is never chosen by its place in the list");
  assert.match(source, /<StartTemplatePicker\s[^>]*otherTemplates=\{data\.otherTemplates\}/, "the others behind «Mostra anche gli altri schemi»");
  assert.match(source, /useState\(choice\.initial === null\)/, "nothing preselected: the choice is open from the start");
  // Above 50 questions the first «Avvia» asks inside the dialog, the second (the confirm label) starts.
  assert.match(source, /if \(large && !asking\) \{\s*setAsking\(true\);\s*return;/);
  assert.match(source, /asking && large \? START_TEMPLATE_TEXT\.largeConfirm : T\.start/);
  assert.match(source, /START_TEMPLATE_TEXT\.largeTitle\(template\.questions\)/);
  const wizard = read("../../uc/shell/create-wizard.tsx");
  assert.match(wizard, /const initial = all\.find\(\(t\) => t\.id === preselectedId && !t\.restricted\) \?\? null;/, "a reserved schema is never preselected");
  assert.match(wizard, /const choice = useStartTemplatePicker\(templates, otherTemplates, preselectedId\);/, "the fallback page uses the same choice");
  assert.equal((wizard.match(/<StartTemplatePicker\s/g) ?? []).length, 1);
});

test("(R2) the fallback page: «Dal caso d'uso» first and checked with its line, the others hidden, a reserved schema never checked", () => {
  const props = { workspaceId: "w", useCase: DATA.useCase, defaults: DATA.defaults, templates: DATA.templates, otherTemplates: DATA.otherTemplates };
  const html = render(h(W.StartRealizationForm, { ...props, preselectedId: FROM_USE_CASE.id }));
  const checked = [...html.matchAll(/<input [^>]*type="radio"[^>]*>/g)].map((m) => m[0]).filter((tag) => /\schecked=""/.test(tag));
  assert.equal(checked.length, 1);
  assert.match(checked[0], new RegExp(`value="${FROM_USE_CASE.id}"`));
  assert.ok(html.indexOf(FROM_USE_CASE.name) >= 0 && html.indexOf(FROM_USE_CASE.name) < html.indexOf(RESERVED.name), "«Dal caso d'uso» first");
  assert.match(html, /per ogni use case · 6 domande/);
  assert.match(html, /per smistamento richieste · 245 domande/);
  assert.doesNotMatch(html, new RegExp(OTHER.name), "the others only on request");
  assert.match(html, new RegExp(START_TEMPLATE_TEXT.showOthers(1)));
  assert.doesNotMatch(html, /realizzazione-nome/);
  // Asked to preselect a reserved schema, nobody is chosen: the choice is by hand.
  const reserved = render(h(W.StartRealizationForm, { ...props, preselectedId: RESERVED.id }));
  assert.doesNotMatch(reserved, /<input [^>]*type="radio"[^>]*checked=""/);
  assert.match(reserved, new RegExp(START_TEMPLATE_TEXT.chooseOne.replace(".", "\\.")));
});
