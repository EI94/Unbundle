import test, { before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { enableTsxImports } from "../../use-cases/detail/referent/tsx-test-loader.ts";
import type { BoardStep } from "../../../lib/uc/views/solution.ts";

// (Rilascio 10, §3.5) «Come funziona» disegnato come la board, in sola lettura, reso in HTML: card della stessa
// larghezza, frecce, «◆ Decide una persona», il colore dell'agente solo sui passi che fa l'agente, il puntino delle
// domande con la parola per i lettori di schermo; da 640 px una riga che scorre dentro la sua cornice, al telefono un
// elenco verticale. Ogni card apre il pannello del passo. Dati inventati.

type Render = (element: unknown) => string;
let render: Render;
let h: (type: unknown, props?: object | null, ...children: unknown[]) => unknown;
let Board: (props: never) => unknown;

before(async () => {
  await enableTsxImports();
  const react = await import("react");
  const { renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: Render };
  const { AppRouterContext } = (await import("next/dist/shared/lib/app-router-context.shared-runtime.js")) as unknown as { AppRouterContext: import("react").Context<object | null> };
  const router = { push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {} };
  h = react.createElement as never;
  render = (element) => renderToStaticMarkup(react.createElement(AppRouterContext.Provider, { value: router }, element as never)).replace(/&#x27;/g, "'");
  Board = ((await import("./process-board.tsx")) as { ProcessBoard: typeof Board }).ProcessBoard;
});

const STEPS: BoardStep[] = [
  { id: "a", n: 1, title: "Arriva la richiesta", who: "Commerciale", decision: false, agent: true, tone: "a_posto" },
  { id: "b", n: 2, title: "Si approva lo sconto", who: "Responsabile", decision: true, agent: false, tone: "da_verificare" },
  { id: "c", n: 3, title: "Si manda il preventivo", who: null, decision: false, agent: true, tone: null },
];

const visible = (html: string) =>
  html
    .replace(/<span class="sr-only">[^<]*<\/span>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

test("cards, arrows, «◆ Decide una persona» and the agent's colour only where the agent works", () => {
  const html = render(h(Board, { steps: STEPS, hrefFor: (id: string) => `/s?apri=passo-${id}`, agentTone: 3, audience: "ls", label: "Come funziona" }));
  assert.match(html, /data-slot="process-board"/);
  assert.match(html, /\[--path-c:var\(--uc-agente-3\)\]/, "the agent's colour of the use case");
  assert.equal([...html.matchAll(/<a\b/g)].length, 3, "one link per card, nothing else");
  assert.equal([...html.matchAll(/border-l-\[var\(--path-c\)\]/g)].length, 2, "two steps done by the agent");
  assert.equal([...html.matchAll(/◆/g)].length, 1);
  assert.equal([...html.matchAll(/↓/g)].length, 2, "an arrow between two cards (down on the phone)");
  assert.equal([...html.matchAll(/→/g)].length, 2, "and to the right from 640 px");
  assert.match(html, /href="\/s\?apri=passo-b"/);
  assert.match(html, /sm:w-max sm:flex-row/, "a row from 640 px, a list on the phone");
  assert.match(html, /overflow-x-auto/, "the row scrolls inside its frame, never the page");
  const text = visible(html);
  assert.ok(text.includes("Chi: Commerciale"));
  assert.ok(text.includes("Decide una persona"));
  assert.ok(html.includes("Passo 2: "), "the step number for screen readers");
  assert.ok(html.includes("Lo fa l'agente"), "the colour is never the only sign");
  assert.ok(html.includes("Nessuna domanda collegata"), "a step without questions says so");
  assert.ok(html.includes("A posto") && html.includes("Da verificare"), "the dot has its word");
});

test("without an agent colour the agent's steps take the colour of the text; no steps, no board", () => {
  const html = render(h(Board, { steps: STEPS, hrefFor: () => "/s", agentTone: null, audience: "cliente", label: "x" }));
  assert.match(html, /\[--path-c:var\(--foreground\)\]/);
  assert.doesNotMatch(html, /uc-agente/);
  assert.equal(render(h(Board, { steps: [], hrefFor: () => "/s", agentTone: 1, audience: "ls", label: "x" })), "");
});

test("the Soluzione is one reading page: no segmented control, the panels in the address, closed folds", () => {
  const source = readFileSync(new URL("../../../app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/soluzione/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /SolutionNav|solution-nav|solutionSegmentsFor/);
  assert.match(source, /<ProcessBoard steps=\{steps\}/);
  assert.match(source, /<SegmentedNav size="sm" ariaLabel=\{T\.viewsLabel\}/, "«Oggi | Con l'AI»");
  assert.match(source, /<Why id="come-funziona-legenda"/, "the legend behind a «?» (F-086)");
  assert.match(source, /<RulesPanel /, "the rules panel, `?apri=regole`");
  assert.match(source, /<StepPanelContent /, "the step panel, `?apri=passo-<id>`");
  assert.match(source, /<Fold id="altro" title=\{T\.more\} defaultOpen=\{editing\}>/, "«Altro» closed unless editing");
  assert.doesNotMatch(source, /<details/);
  for (const page of ["soluzione/mappa/page.tsx", "soluzione/dati/page.tsx"]) {
    const other = readFileSync(new URL(`../../../app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/${page}`, import.meta.url), "utf8");
    assert.doesNotMatch(other, /SolutionNav/, page);
    assert.match(other, /SOLUTION_TEXT\.backToSolution/, `${page}: «‹ Soluzione»`);
  }
});
