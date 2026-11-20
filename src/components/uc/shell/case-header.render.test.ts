import test, { before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installAppModules } from "../../../lib/ai/claude-test-kit.ts";
import { enableTsxImports } from "../../use-cases/detail/referent/tsx-test-loader.ts";

// (Rilascio 10, docs/ui-10/PROPOSTA-10.md §3.5) La testata della realizzazione resa in HTML, con i dati inventati del
// prototipo S4: cinque elementi (percorso, titolo dello use case, stato a puntino, pulsante pieno con icona e «?», «⋯»),
// niente frase sotto il titolo né badge, l'avanzamento piccolo solo fuori dalla Panoramica, al massimo un avviso.
// Le azioni del server sono finte; id inventati.

await installAppModules({
  "@/lib/actions/uc-cases": `export async function transitionCaseAction() { return { ok: true }; }`,
  "../decision-buttons": `export function DecisionButtons() { return null; }
export function MarkInProgressButton() { return null; }`,
  "./referent/dialog-host": `export function useReferentDialog() { return null; }`,
});

const WS = "00000000-0000-4000-8000-0000000000f1";
const CASE = "00000000-0000-4000-8000-000000000c01";
const base = `/dashboard/${WS}/casi-duso/${CASE}`;

type Props = Record<string, unknown>;
let html: (props: Props, at: { pathname: string; segment: string | null; search?: string }) => string;

before(async () => {
  await enableTsxImports();
  const react = await import("react");
  const { renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string };
  const { AppRouterContext, LayoutRouterContext } = (await import("next/dist/shared/lib/app-router-context.shared-runtime.js")) as unknown as {
    AppRouterContext: import("react").Context<object | null>;
    LayoutRouterContext: import("react").Context<object | null>;
  };
  const { PathnameContext, SearchParamsContext } = (await import("next/dist/shared/lib/hooks-client-context.shared-runtime.js")) as unknown as {
    PathnameContext: import("react").Context<string | null>;
    SearchParamsContext: import("react").Context<URLSearchParams | null>;
  };
  const { CaseHeader } = (await import("./case-header.tsx")) as { CaseHeader: unknown };
  const router = { push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {} };
  const h = react.createElement;
  html = (props, at) => {
    // L'albero del layout del caso: la scheda attiva è il segmento sotto `[caseId]` (null = la Panoramica).
    const page = ["__PAGE__", {}];
    const parentTree = ["[caseId]", { children: at.segment ? [at.segment, { children: page }] : page }];
    return renderToStaticMarkup(
      h(
        AppRouterContext.Provider,
        { value: router },
        h(
          LayoutRouterContext.Provider,
          { value: { parentTree, parentRenderTree: { data: { bfcacheId: 0 } }, parentCacheNode: null, parentSegmentPath: null, url: at.pathname } },
          h(PathnameContext.Provider, { value: at.pathname }, h(SearchParamsContext.Provider, { value: new URLSearchParams(at.search ?? "") }, h(CaseHeader as never, props as never))),
        ),
      ),
    ).replace(/&#x27;/g, "'");
  };
});

const PROPS: Props = {
  trail: {
    kind: "use_case",
    root: { label: "Use case", href: `/dashboard/${WS}/use-cases?vista=panoramica` },
    parent: { label: "XX-0012", href: `/dashboard/${WS}/use-cases/u1?capitolo=realizzazione`, isCode: true },
    current: { label: "Realizzazione", href: base },
  },
  title: "Smistamento delle richieste",
  status: { tone: "blu", label: "In preparazione" },
  alert: null,
  progress: { ok: 186, required: 245, inReview: 9, audience: "ls" },
  step: { label: "Verifica 9 risposte", href: `${base}/domande/verifica`, caseBase: base, icon: "verifica", why: "9 risposte dei referenti aspettano un controllo. La più vecchia è di 3 giorni fa." },
  menu: [
    { key: "privacy", label: "Privacy", href: `${base}/privacy` },
    { key: "attivita", label: "Attività", href: `${base}/attivita` },
    { key: "esporta", label: "Esporta…", href: null },
    { key: "impostazioni", label: "Impostazioni", href: `${base}/impostazioni` },
  ],
};

const PANORAMICA = { pathname: base, segment: null };
const DOMANDE = { pathname: `${base}/domande`, segment: "domande" };

/** Il testo che si legge: senza tag, senza le copie per i lettori di schermo. */
function visibleWords(page: string): string[] {
  const text = page
    .replace(/<span[^>]*class="sr-only"[^>]*>[^<]*<\/span>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/g, " ");
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
}

/** I controlli: link, pulsanti, menu. */
function controls(page: string): string[] {
  return [...page.matchAll(/<(a|button)\b[^>]*>/g)].map((m) => m[0]);
}

test("five elements: the trail, the use case title, the status, the filled step with icon and «?», the «⋯»", () => {
  const page = html(PROPS, PANORAMICA);
  // Percorso: «Use case › XX-0012 › Realizzazione»; «Realizzazione» è dove si è, mai un link.
  const trail = /<nav aria-label="Percorso"[\s\S]*?<\/nav>/.exec(page)?.[0] ?? "";
  assert.match(trail, /href="[^"]*use-cases\?vista=panoramica"[^>]*>Use case</, "a link on the phone");
  assert.match(trail, />XX-0012</);
  assert.match(trail, /<span aria-current="page"[^>]*>Realizzazione<\/span>/);
  assert.doesNotMatch(trail, new RegExp(`href="${base}"`), "never a link to itself");
  assert.match(page, /<h1 id="uc-case-title" class="[^"]*text-2xl font-semibold tracking-tight[^"]*">Smistamento delle richieste<\/h1>/);
  assert.match(page, /data-slot="status-dot"[\s\S]*?In preparazione/);
  // Il prossimo passo: l'etichetta, un solo pulsante pieno con l'icona, il «?» con il perché.
  assert.match(page, /data-slot="next-step"[\s\S]*?Prossimo passo/);
  const filled = [...page.matchAll(/<a\b[^>]*class="[^"]*\bbg-primary\b[^"]*"[^>]*>[\s\S]*?<\/a>/g)].map((m) => m[0]);
  assert.equal(filled.length, 1, "exactly one filled button");
  assert.match(filled[0], /data-icon="inline-start"/);
  assert.ok(filled[0].replace(/<[^>]+>/g, "").includes("Verifica 9 risposte"));
  assert.match(page, /data-slot="next-step-why"/);
  assert.match(page, /aria-label="Altre azioni sulla realizzazione"/);
  assert.equal((page.match(/aria-label="Altre azioni sulla realizzazione"/g) ?? []).length, 1, "one «⋯» only, also on the phone");
  assert.doesNotMatch(page, /Sola lettura|Configurazione da completare/);
});

test("≤20 words with the five tabs; ≤9 controls with the five tabs from md, where the sidebar has «Use case»", () => {
  const tabs = ["Panoramica", "Domande", "Soluzione", "Valore", "Persone"];
  // A breakpoint hides one of the two «Use case» of the trail: the link below md, the plain word from md.
  const at = (width: "phone" | "desktop", page: string) => controls(page).filter((c) => !(width === "desktop" ? /\bmd:hidden\b/ : /\bhidden md:/).test(c));
  for (const where of [PANORAMICA, DOMANDE]) {
    const page = html(PROPS, where);
    const words = visibleWords(page.replace(/<span class="hidden md:inline">[^<]*<\/span>/g, ""));
    assert.ok(words.length + tabs.length <= 20, `${where.pathname}: ${words.length} + ${tabs.length} words: ${words.join(" ")}`);
    // Desktop: XX-0012, the filled button, its «?», the «⋯» and 5 tabs = 9. Phone: «Use case» is a link too, the one tap back.
    assert.equal(at("desktop", page).length + tabs.length, 9, `${where.pathname}: ${at("desktop", page).join("\n")}`);
    assert.equal(at("phone", page).length + tabs.length, 10);
  }
  assert.match(html(PROPS, PANORAMICA), /<a class="[^"]*md:hidden[^"]*" href="[^"]*use-cases\?vista=panoramica">Use case<\/a><span class="hidden md:inline">Use case<\/span>/);
});

test("the small progress line: not on the Panoramica, which has the big number; elsewhere «186/245» with its bar", () => {
  const overview = html(PROPS, PANORAMICA);
  assert.doesNotMatch(overview, /role="progressbar"|186\/245/);
  const questions = html(PROPS, DOMANDE);
  assert.match(questions, /role="progressbar"[^>]*aria-valuenow="186"/);
  assert.match(questions, /aria-valuetext="186 di 245 domande indispensabili a posto, 9 da verificare"/);
  assert.match(questions, />186\/245</);
  assert.doesNotMatch(questions, /href="[^"]*\/via"/, "not a link: the Panoramica is the first tab");
  assert.doesNotMatch(html({ ...PROPS, progress: null }, DOMANDE), /role="progressbar"/, "who does not open the Panoramica has none");
  assert.doesNotMatch(html({ ...PROPS, progress: { ok: 0, required: 0, inReview: 0, audience: "ls" } }, DOMANDE), /role="progressbar"/, "the zero is not shown");
  assert.match(html({ ...PROPS, progress: { ok: 3, required: 10, inReview: 2, audience: "cliente" } }, DOMANDE), /2 in verifica/, "the client's words");
});

test("no step: no label, no filled button; the step hides on the page it leads to", () => {
  const none = html({ ...PROPS, step: null }, PANORAMICA);
  assert.doesNotMatch(none, /Prossimo passo|bg-primary/);
  const onItsPage = html(PROPS, { pathname: `${base}/domande/verifica`, segment: "domande" });
  assert.doesNotMatch(onItsPage, /Prossimo passo|bg-primary/, "on «Verifica una alla volta» the page has the command");
  // «Proponi il via allo sviluppo»: the section of the Panoramica has the command; elsewhere the button leads there.
  const propose = { ...PROPS, step: { label: "Proponi il via allo sviluppo", href: `${base}#via`, caseBase: base, icon: "avvia", why: null, pageCommand: true } };
  assert.doesNotMatch(html(propose, PANORAMICA), /bg-primary/);
  const elsewhere = /<a\b[^>]*\bbg-primary\b[^>]*>/.exec(html(propose, DOMANDE))?.[0] ?? "";
  assert.ok(elsewhere.includes(`href="${base}#via"`), elsewhere);
});

test("(contract with «domande») «Controlla 2 file»: on Domande it stays and opens the File panel there, with the filters; elsewhere it leads there", () => {
  const files = { ...PROPS, step: { label: "Controlla 2 file", href: `${base}/domande?apri=file`, caseBase: base, icon: "dossier", why: "2 PDF da aprire e controllare prima di usarli.", panel: { name: "apri", value: "file" } } };
  const filledLink = (page: string) => /<a\b[^>]*\bbg-primary\b[^>]*>/.exec(page)?.[0] ?? "";
  const onQuestions = filledLink(html(files, { ...DOMANDE, search: "vista=da-fare&pagina=2" }));
  assert.ok(onQuestions.includes(`href="${base}/domande?vista=da-fare&amp;pagina=2&amp;apri=file"`), onQuestions);
  const onOverview = filledLink(html(files, PANORAMICA));
  assert.ok(onOverview.includes(`href="${base}/domande?apri=file"`), onOverview);
  const onPeople = filledLink(html(files, { pathname: `${base}/persone`, segment: "persone", search: "invia=1" }));
  assert.ok(onPeople.includes(`href="${base}/domande?apri=file"`), "the people's query does not travel to Domande");
});

test("(rilascio 10, F-006) «Firma il via allo sviluppo»: the signatures panel of the shell opens where one is, filters kept", () => {
  const sign = { ...PROPS, step: { label: "Firma il via allo sviluppo", href: `${base}?firma=1`, caseBase: base, icon: "decidi", why: "Lateral Space ha già firmato.", panel: { name: "firma", value: "1" } } };
  const filledLink = (page: string) => /<a\b[^>]*\bbg-primary\b[^>]*>/.exec(page)?.[0] ?? "";
  assert.ok(filledLink(html(sign, { ...DOMANDE, search: "vista=da-fare" })).includes(`href="${base}/domande?vista=da-fare&amp;firma=1"`));
  assert.ok(filledLink(html(sign, PANORAMICA)).includes(`href="${base}?firma=1"`));
});

test("one alert at most, with its link already complete", () => {
  const alert = { kind: "riconferma", text: "Il via allo sviluppo va riconfermato: alcune domande indispensabili non sono più a posto.", tone: "rosso", action: { label: "Vedi cosa manca", href: `${base}#via` } };
  const page = html({ ...PROPS, alert }, DOMANDE);
  assert.equal((page.match(/role="status"/g) ?? []).length, 1);
  assert.match(page, new RegExp(`<a[^>]*href="${base}#via"[^>]*>Vedi cosa manca`));
});

test("the layout: the use case title, the alert silenced by the same filled button, the configuration in the log", () => {
  const source = readFileSync(new URL("../../../app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/layout.tsx", import.meta.url), "utf8");
  assert.match(source, /const title = realizationTitle\(\{ caseTitle: c\.title, parent: header\.parent \}\);/);
  assert.match(source, /<CaseHeader[\s\S]*title=\{title\}/);
  assert.match(source, /<CaseStickyBar[^>]*title=\{title\}/, "the fixed bar has the same title");
  assert.match(source, /caseHeadAlert\(\{[\s\S]*?primary: primary\?\.id \?\? null,/);
  assert.match(source, /ucLog\(\{ level: "warn", area: "uc", op: "configurazione_da_completare"/);
  assert.match(source, /workspaceAdmin: canManageWorkspaceSettings\(access\.role\)/, "the alert, for the admins only, until wave 6b");
  assert.match(source, /caseNextSteps\(\{ \.\.\.header\.nextStep, filesToCheck \}/, "«Controlla N file» in the header");
  assert.doesNotMatch(source, /oneLiner|readOnlyBadge|showsReadOnlyBadge/);
});
