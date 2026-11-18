import test, { before } from "node:test";
import assert from "node:assert/strict";
import { installAppModules } from "../../../lib/ai/claude-test-kit.ts";
import { enableTsxImports } from "../../use-cases/detail/referent/tsx-test-loader.ts";

// (Rilascio 10, ondate 1 e 2 insieme) Il pulsante del passo della realizzazione reso in HTML: l'icona e il «?» vengono
// dal passo dello use case (`NextStepIconView`, `NextStepWhy` di next-step-box.tsx), che l'ondata «Home» ha toccato
// accanto. Nella testata icona, verbo e «?» con il perché; nella barra fissa (`size="sm"`) solo icona e verbo; sulla
// pagina dove porta il passo non c'è. Le azioni del server sono finte; id inventati.

await installAppModules({
  "@/lib/actions/uc-cases": `export async function transitionCaseAction() { return { ok: true }; }`,
  "../decision-buttons": `export function DecisionButtons() { return null; }
export function MarkInProgressButton() { return null; }`,
  "./referent/dialog-host": `export function useReferentDialog() { return null; }`,
});

const WS = "00000000-0000-4000-8000-0000000000f1";
const CASE = "00000000-0000-4000-8000-000000000c01";
const base = `/dashboard/${WS}/casi-duso/${CASE}`;

let html: (props: Record<string, unknown>, pathname: string) => string;

before(async () => {
  await enableTsxImports();
  const react = await import("react");
  const { renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string };
  const { AppRouterContext } = (await import("next/dist/shared/lib/app-router-context.shared-runtime.js")) as unknown as { AppRouterContext: import("react").Context<object | null> };
  const { PathnameContext, SearchParamsContext } = (await import("next/dist/shared/lib/hooks-client-context.shared-runtime.js")) as unknown as {
    PathnameContext: import("react").Context<string | null>;
    SearchParamsContext: import("react").Context<URLSearchParams | null>;
  };
  const { CaseStepButton } = (await import("./case-menu.tsx")) as { CaseStepButton: unknown };
  const router = { push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {} };
  html = (props, pathname) =>
    renderToStaticMarkup(
      react.createElement(
        AppRouterContext.Provider,
        { value: router },
        react.createElement(
          PathnameContext.Provider,
          { value: pathname },
          react.createElement(SearchParamsContext.Provider, { value: new URLSearchParams() }, react.createElement(CaseStepButton as never, props as never)),
        ),
      ),
    ).replace(/&#x27;/g, "'");
});

const STEP = { label: "Rispondi alle domande", href: `${base}/domande`, caseBase: base, icon: "rispondi", why: "Il referente aspetta le tue risposte da 3 giorni." };

test("nella testata: icona, verbo e «?» con il perché, letto anche dal pulsante", () => {
  const page = html({ step: STEP }, base);
  const button = /<a\b[^>]*data-slot="case-step"[^>]*>[\s\S]*?<\/a>/.exec(page)?.[0] ?? "";
  assert.ok(button, page);
  assert.match(button, new RegExp(`href="${STEP.href}"`));
  assert.match(button, /<svg[^>]*aria-hidden="true"[^>]*data-icon="inline-start"/, "l'icona accanto al verbo");
  assert.ok(button.replace(/<[^>]+>/g, "").includes(STEP.label));
  // Il «?»: il pulsante legge il perché (`aria-describedby`), il popover lo mostra.
  const describedBy = /aria-describedby="([^"]+)"/.exec(button)?.[1];
  assert.ok(describedBy, "il pulsante dice il perché ai lettori di schermo");
  assert.ok(page.includes(`<span id="${describedBy}" class="sr-only">${STEP.why}</span>`), page);
  assert.match(page, /data-slot="next-step-why"[^>]*aria-label="[^"]+"|aria-label="[^"]+"[^>]*data-slot="next-step-why"/);
});

test("nella barra fissa solo icona e verbo; senza perché niente «?»; sulla pagina del passo niente pulsante", () => {
  const bar = html({ step: STEP, size: "sm" }, base);
  assert.match(bar, /data-slot="case-step"/);
  assert.match(bar, /data-icon="inline-start"/);
  assert.doesNotMatch(bar, /next-step-why|aria-describedby/);
  const plain = html({ step: { ...STEP, icon: undefined, why: null } }, base);
  assert.match(plain, /data-slot="case-step"/);
  assert.doesNotMatch(plain, /next-step-why|data-icon=/);
  assert.equal(html({ step: STEP }, STEP.href), "", "il passo si nasconde sulla pagina dove porta");
});
