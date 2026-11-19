import test, { before } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { readFileSync } from "node:fs";
import { findHubForbiddenIn } from "../../lib/use-cases/copy-guard.ts";
import { enableTsxImports } from "./detail/referent/tsx-test-loader.ts";

// (Rilascio 10, §3.4, D8) «Nuovo use case»: un modulo solo, nella pagina e nel pannello rapido. In vista il tipo (due
// scelte grandi), Titolo e Problema; il resto in «Aggiungi dettagli», chiusa; un solo pulsante pieno. Reso in HTML,
// senza database: le action sono finte (non si chiamano rendendo).
let form: typeof import("./use-case-form.tsx");
let render: (props: Record<string, unknown>) => string;
type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve?(specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: object) => ResolveResult): ResolveResult }): void;
};

before(async () => {
  await enableTsxImports();
  const actions = `data:text/javascript,${encodeURIComponent("export async function createUseCaseFromFormAction() { throw new Error('non nel test'); } export async function createQuickUseCaseAction() { throw new Error('non nel test'); }")}`;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "@/lib/actions/use-case-create" && context.parentURL?.endsWith("/use-case-form.tsx")) return { url: actions, shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });
  form = await import("./use-case-form.tsx");
  const { createElement } = (await import("react")) as unknown as { createElement: (type: unknown, props: unknown, ...children: unknown[]) => unknown };
  const { renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string };
  const { AppRouterContext } = (await import("next/dist/shared/lib/app-router-context.shared-runtime.js")) as unknown as { AppRouterContext: unknown };
  const router = { push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {} };
  render = (props) =>
    renderToStaticMarkup(createElement((AppRouterContext as { Provider: unknown }).Provider, { value: router }, createElement(form.UseCaseForm, { workspaceId: "ws", esgEnabled: true, ...props })));
});

const readable = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
/** Il modulo come si vede con le pieghe chiuse: senza la regione nascosta di «Aggiungi dettagli». */
function inView(html: string): string {
  return html.replace(/<div id="[^"]*-contenuto" data-slot="fold-content" hidden=""[\s\S]*?<\/div><\/section>/, "</section>");
}
const textOf = (html: string) => readable(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const filled = (html: string) =>
  [...html.matchAll(/<button\b[^>]*>/g)].map((m) => m[0]).filter((tag) => tag.includes('data-slot="button"') && (/class="([^"]*)"/.exec(tag)?.[1].split(/\s+/) ?? []).includes("bg-primary"));
const names = (html: string) => [...html.matchAll(/<(?:input|textarea)\b[^>]*name="([^"]+)"/g)].map((m) => m[1]);
/** Il campo radio con quel nome e quel valore, se è scelto. */
const checked = (html: string, name: string, value: string) =>
  [...html.matchAll(/<input\b[^>]*>/g)].map((m) => m[0]).some((tag) => tag.includes(`name="${name}"`) && tag.includes(`value="${value}"`) && /\schecked=""/.test(tag));

test("la pagina: in vista il tipo (parte da «Da costruire»), Titolo e Problema; il resto in «Aggiungi dettagli», chiusa", () => {
  const html = readable(render({ isReviewer: false, defaultOrigin: "adoption" }));
  const visible = inView(html);
  assert.deepEqual([...new Set(names(visible))], ["kind", "title", "description"], "in vista solo tipo, titolo e problema");
  assert.ok(checked(visible, "kind", "da_costruire") && !checked(visible, "kind", "da_diffondere"), "parte da «Da costruire»");
  // Le due scelte grandi, con l'icona e una riga grigia.
  assert.ok(textOf(visible).includes("Che cosa proponi? Da costruire Un'idea da costruire con l'AI Da diffondere Una cosa che fai già con l'AI e che altri possono copiare"), textOf(visible));
  // «Aggiungi dettagli»: un H2 con il pulsante della piega, chiusa; dentro gli stessi campi di prima, nello stesso ordine.
  assert.match(html, /<h2 class="text-base font-semibold"><button type="button" aria-expanded="false"[^>]*>[\s\S]*?Aggiungi dettagli/);
  const details = names(html).filter((name) => !["kind", "title", "description"].includes(name));
  assert.deepEqual(details, ["flowDescription", "businessCase", "humanInTheLoop", "guardrails", "dataRequirements", "sustainabilityImpact", "timeline"]);
  // Obbligatori solo Titolo e Problema (D8): niente «facoltativo» accanto a ogni campo, niente frase sugli obbligatori.
  const required = [...html.matchAll(/<(?:input|textarea)\b[^>]*>/g)].map((m) => m[0]).filter((tag) => tag.includes('aria-required="true"')).map((tag) => /name="([^"]+)"/.exec(tag)?.[1]);
  assert.deepEqual(required, ["title", "description"]);
  assert.ok(!html.includes("facoltativ") && !html.includes("I campi sono obbligatori"));
  // Un solo pulsante pieno: «Invia lo use case»; i contributori non hanno Origine né Valutazione.
  const buttons = filled(html);
  assert.equal(buttons.length, 1);
  assert.ok(html.includes(">Invia lo use case</button>"));
  assert.ok(!html.includes('name="origin"') && !html.includes('name="valueEurYear"') && !html.includes("AI Lab"));
  // Parole e controlli in vista (§3.14: circa 60 parole, 6 controlli): due scelte, due campi, la piega, il pulsante.
  assert.ok(textOf(visible).split(" ").length <= 45, `${textOf(visible).split(" ").length} parole`);
  const controls = [...visible.matchAll(/<(?:input(?![^>]*type="hidden")|textarea|button)\b/g)].length;
  assert.equal(controls, 6);
  assert.deepEqual(findHubForbiddenIn([textOf(html)], "area"), []);
});

test("i revisori: Origine e Valutazione iniziale dentro «Aggiungi dettagli», dopo gli stessi campi; l'origine di partenza scelta", () => {
  const html = readable(render({ isReviewer: true, defaultOrigin: "transformation" }));
  const visible = inView(html);
  assert.ok(!visible.includes('name="origin"') && !visible.includes('name="valueEurYear"'), "chiusi nella piega");
  const order = names(html);
  assert.ok(order.indexOf("timeline") < order.indexOf("origin") && order.indexOf("origin") < order.indexOf("valueEurYear"), order.join(", "));
  assert.ok(checked(html, "origin", "transformation") && !checked(html, "origin", "adoption"));
  assert.ok(html.includes(">Origine</legend>") && html.includes(">Valutazione iniziale</legend>"));
  assert.ok(!html.includes("(facoltativa)"));
  assert.equal(filled(html).length, 1);
});

test("il pannello rapido di Lateral Space: lo stesso modulo, «Salva» pieno e «Salva e aggiungi un altro» bordato; «AI Lab» in testa ai dettagli", () => {
  const html = readable(render({ isReviewer: true, defaultOrigin: "transformation", variant: "pannello", aiLabs: ["AI Lab Finanza · 12 ott", "AI Lab Vendite"], lastAiLab: "AI Lab Finanza · 12 ott", esgEnabled: false }));
  const visible = inView(html);
  assert.deepEqual([...new Set(names(visible))], ["kind", "title", "description"]);
  const buttons = filled(html);
  assert.equal(buttons.length, 1);
  assert.match(buttons[0], /type="submit"/);
  assert.ok(html.includes(">Salva</button>"));
  assert.match(html, /<button type="button"[^>]*>Salva e aggiungi un altro<\/button>/);
  assert.ok(!/class="[^"]*bg-primary[^"]*"[^>]*>Salva e aggiungi un altro/.test(html), "bordato");
  // «AI Lab» parte dall'ultimo usato, con le voci del workspace; la piega lo dice nella sua riga grigia.
  const details = names(html).filter((name) => !["kind", "title", "description"].includes(name));
  assert.equal(details[0], "aiLab");
  assert.match(html, /<input[^>]*name="aiLab"[^>]*value="AI Lab Finanza · 12 ott"/);
  assert.ok(html.includes('<option value="AI Lab Vendite"></option>'));
  assert.match(visible, /Aggiungi dettagli<\/span><span class="min-w-0 text-sm font-normal text-muted-foreground">AI Lab Finanza · 12 ott<\/span>/);
  // Niente più «Problema in una riga» né il link al modulo completo: il modulo è lo stesso.
  for (const gone of ["Problema in una riga", "Usa il modulo completo", "I dettagli si completano dopo", "Invia lo use case"]) assert.ok(!html.includes(gone), gone);
});

test("il sorgente: un modulo solo per la pagina e il pannello, con le stesse letture dell'action", () => {
  const source = readFileSync(new URL("./use-case-form.tsx", import.meta.url), "utf8");
  assert.match(source, /parseQuickUseCaseForm\(read, \{ esgEnabled, isReviewer \}\) : parseUseCaseForm\(read, \{ esgEnabled, isReviewer \}\)/);
  assert.match(source, /<Fold id=\{detailsId\} title=\{FORM_TEXT\.details\}/);
  const sheet = readFileSync(new URL("./quick-create-sheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /<UseCaseForm\s+workspaceId=\{workspaceId\}\s+variant="pannello"/);
  assert.ok(!sheet.includes("readQuickCreate") && !sheet.includes("DropdownMenu"), "niente più campi e chip propri del pannello");
  const page = readFileSync(new URL("../../app/(dashboard)/dashboard/[workspaceId]/use-cases/nuovo/page.tsx", import.meta.url), "utf8");
  assert.match(page, /<UseCaseForm\b/);
  assert.ok(!page.includes('variant="pannello"'), "la pagina invia lo use case come prima (`web_proposed`)");
});
