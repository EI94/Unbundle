import test, { before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { enableTsxImports } from "../../components/use-cases/detail/referent/tsx-test-loader.ts";
import { PORTFOLIO_SHARE_TTL_DAYS } from "../portfolio/share-link.ts";
import { findHubForbiddenIn } from "./copy-guard.ts";
import { SHARE_PAGE_TEXT, shareExpiryDay } from "./share-page.ts";

// (Rilascio 10, §3.4, §3.11) La pagina pubblica del link di condivisione (`/share/portfolio/<ws>/<id>`): tema chiaro, il
// marchio piccolo in alto, l'H1 è il titolo del caso d'uso, sotto la fase e «Quando», «Il link vale 30 giorni». Il link
// che non vale ha una scheda sola. Resa in HTML senza database; la pagina vera la provano d4-legacy.integration.test.ts
// e il harness delle schermate. Dati inventati.
let view: typeof import("../../app/share/portfolio/[workspaceId]/[useCaseId]/share-view.tsx");
let renderToStaticMarkup: (element: unknown) => string;
let h: (type: unknown, props: unknown) => unknown;
before(async () => {
  await enableTsxImports();
  view = await import("../../app/share/portfolio/[workspaceId]/[useCaseId]/share-view.tsx");
  const react = await import("react");
  h = (type, props) => react.createElement(type as never, props as never);
  ({ renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string });
});

const PAGE = readFileSync(new URL("../../app/share/portfolio/[workspaceId]/[useCaseId]/page.tsx", import.meta.url), "utf8");
const VIEW = readFileSync(new URL("../../app/share/portfolio/[workspaceId]/[useCaseId]/share-view.tsx", import.meta.url), "utf8");
const readable = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const textOf = (html: string) => readable(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const LOGIN = "/login?callbackUrl=%2Fdashboard%2Fws%2Fuse-cases%2Fuc";

test("il caso d'uso del link: tema chiaro, il marchio in alto, l'H1 è il titolo, sotto la fase e «Quando», il pulsante a tutta larghezza", () => {
  const html = readable(
    renderToStaticMarkup(
      h(view.ShareCase, { title: "Preventivi ai clienti", phaseText: "Approvato", phase: "approvato", quando: "T1 2027", loginHref: LOGIN, validity: SHARE_PAGE_TEXT.validity(30, "19 dicembre") }),
    ),
  );
  assert.match(html, /^<div data-slot="share-page" class="survey-light /, "le pagine pubbliche sono chiare");
  assert.ok(html.indexOf(">Unbundle</p>") < html.indexOf("<h1"), "il marchio in alto, piccolo");
  assert.match(html, /<h1 class="text-2xl font-semibold tracking-tight break-words">Preventivi ai clienti<\/h1>/);
  assert.equal((html.match(/<h1/g) ?? []).length, 1);
  assert.ok(textOf(html).includes("Fase Approvato Quando T1 2027"), textOf(html));
  assert.match(html, /data-slot="phase-pill" data-tone="blu"/);
  const button = /<a\b[^>]*>Accedi per aprire la scheda<\/a>/.exec(html)?.[0] ?? "";
  assert.ok(button.includes(`href="${LOGIN}"`) && /\bh-12\b/.test(button) && /\bw-full\b/.test(button), button);
  assert.ok(textOf(html).endsWith("Il link vale 30 giorni: fino al 19 dicembre."));
  // Niente card in più, niente «Use case» come titolo, nessun codice.
  for (const gone of ["Use case", "data-slot=\"card\"", "XX-00"]) assert.ok(!html.includes(gone), gone);
});

test("una scheda nascosta alla ricerca: solo la fase, con «Caso d'uso» come titolo", () => {
  const html = readable(renderToStaticMarkup(h(view.ShareCase, { title: null, phaseText: "Da valutare", phase: "da_valutare", quando: null, loginHref: LOGIN, validity: "x" })));
  assert.match(html, /<h1[^>]*>Caso d'uso<\/h1>/);
  assert.ok(textOf(html).includes("Fase Da valutare") && !html.includes("Quando"));
});

test("il link che non vale: una scheda sola, una frase; scaduto dice perché", () => {
  const invalid = readable(renderToStaticMarkup(h(view.ShareInvalid, { expiredNote: null, loginHref: LOGIN })));
  assert.equal(textOf(invalid), "Unbundle Questo link non vale più. Accedi per aprire la scheda, o chiedi un link nuovo al team. Accedi a Unbundle");
  assert.match(invalid, /^<div data-slot="share-page" class="survey-light /);
  const expired = readable(renderToStaticMarkup(h(view.ShareInvalid, { expiredNote: SHARE_PAGE_TEXT.expired(PORTFOLIO_SHARE_TTL_DAYS), loginHref: LOGIN })));
  assert.ok(textOf(expired).includes("Questo link non vale più. Il link vale 30 giorni. Accedi per aprire la scheda"), textOf(expired));
  assert.ok(expired.includes(`href="${LOGIN}"`));
});

test("i testi: «caso d'uso» fuori dalla dashboard, mai «use case» né il nome del team; 30 giorni come il link", () => {
  const texts = [
    ...Object.values(SHARE_PAGE_TEXT).filter((value): value is string => typeof value === "string"),
    SHARE_PAGE_TEXT.validity(PORTFOLIO_SHARE_TTL_DAYS, "19 dicembre"),
    SHARE_PAGE_TEXT.expired(PORTFOLIO_SHARE_TTL_DAYS),
  ];
  assert.deepEqual(findHubForbiddenIn(texts, "esterno"), []);
  assert.equal(SHARE_PAGE_TEXT.title, "Caso d'uso");
  assert.equal(PORTFOLIO_SHARE_TTL_DAYS, 30);
  assert.equal(SHARE_PAGE_TEXT.validity(PORTFOLIO_SHARE_TTL_DAYS, "19 dicembre"), "Il link vale 30 giorni: fino al 19 dicembre.");
  assert.equal(shareExpiryDay(new Date("2026-12-19T10:00:00Z")), "19 dicembre");
  // I testi stanno nel modulo, non nella pagina; la pagina non nomina il team (D14).
  for (const source of [PAGE, VIEW]) {
    assert.ok(!/teamName|aiTransformationTeamName/.test(source));
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const text of ["Accedi per aprire la scheda", "Accedi a Unbundle", "Link valido", "Link scaduto", "Link non più valido", "portfolio valgono", ">Fase<", ">Quando<", ">Use case<"]) {
      assert.ok(!code.includes(text), `«${text}» scritto nel sorgente: va in SHARE_PAGE_TEXT`);
    }
  }
});

test("la pagina: i membri vanno alla scheda, il token si verifica prima di leggere i dati, il link che non vale ha la sua scheda", () => {
  assert.match(PAGE, /if \(access && access\.role !== "learner"\) \{\s*redirect\(memberCardPath\(workspaceId, useCaseId\)\);/);
  assert.ok(PAGE.indexOf("verifyPortfolioShareToken(") < PAGE.indexOf("getUseCaseById("), "prima il token, poi i dati");
  assert.match(PAGE, /return <InvalidShareLink reason=\{check\.ok \? "invalid" : check\.reason\} loginUrl=\{loginHref\(workspaceId, useCaseId\)\} \/>;/);
  assert.match(PAGE, /export const viewport: Viewport = \{\s*themeColor: "#f9fafb",\s*colorScheme: "light",\s*\};/);
  assert.match(PAGE, /robots: \{ index: false, follow: false \}/);
});
