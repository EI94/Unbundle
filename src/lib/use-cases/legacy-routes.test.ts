import test from "node:test";
import assert from "node:assert/strict";
import {
  HUB_VIEWS,
  PORTFOLIO_PASS_THROUGH,
  hubRedirectFor,
  legacyRouteRedirect,
  stubLogEntry,
  type HubRedirect,
} from "./legacy-routes.ts";
import { HUB_VIEWS as PAGE_VIEWS } from "./views.ts";

// docs/use-case/DESIGN.md §2.3 e §2.4, PIANO-LAVORI §5.5: una prova per ogni riga della
// tabella, con le query. Valgono con l'area accesa: l'interruttore lo controlla chi chiama.
// Id inventati.

const WS = "00000000-0000-4000-8000-0000000000f1";
const UC = "00000000-0000-4000-8000-000000000e01";
const CASE = "00000000-0000-4000-8000-000000000c01";
const base = `/dashboard/${WS}`;
const hub = `${base}/use-cases`;

test("§2.3 /portfolio → /use-cases?vista=da-decidere, senza query", () => {
  assert.deepEqual(legacyRouteRedirect(`${base}/portfolio`), { from: "/portfolio", to: `${hub}?vista=da-decidere` } satisfies HubRedirect);
  assert.equal(hubRedirectFor(`${base}/portfolio`, {}), `${hub}?vista=da-decidere`);
});

test("§2.3 /portfolio: joined, thanks e created passano, nell'ordine in cui arrivano", () => {
  assert.deepEqual(PORTFOLIO_PASS_THROUGH, ["joined", "thanks", "created"]);
  assert.equal(hubRedirectFor(`${base}/portfolio`, { joined: "1" }), `${hub}?vista=da-decidere&joined=1`);
  assert.equal(hubRedirectFor(`${base}/portfolio`, { thanks: "1", created: UC }), `${hub}?vista=da-decidere&thanks=1&created=${UC}`);
  assert.equal(
    hubRedirectFor(`${base}/portfolio`, new URLSearchParams(`created=${UC}&thanks=1&joined=Ada%20Rossi`)),
    `${hub}?vista=da-decidere&created=${UC}&thanks=1&joined=Ada+Rossi`,
  );
  // Valori ripetuti (string[] di Next) passano tutti; un valore vuoto resta vuoto.
  assert.equal(hubRedirectFor(`${base}/portfolio`, { joined: ["a", "b"], thanks: "" }), `${hub}?vista=da-decidere&joined=a&joined=b&thanks=`);
});

test("§2.3 /portfolio: ogni altro parametro cade, anche waveBudget, waveDurationMonths e vista", () => {
  assert.equal(
    hubRedirectFor(`${base}/portfolio`, { waveBudget: "50000", waveDurationMonths: "6", vista: "roadmap", proponente: "x", joined: "1" }),
    `${hub}?vista=da-decidere&joined=1`,
  );
  assert.equal(hubRedirectFor(`${base}/portfolio`, "?waveBudget=1&waveDurationMonths=2"), `${hub}?vista=da-decidere`);
});

test("§2.3 /portfolio/review/[id] → /use-cases/[id], senza query", () => {
  assert.deepEqual(legacyRouteRedirect(`${base}/portfolio/review/${UC}`, { tab: "x" }), { from: "/portfolio/review", to: `${hub}/${UC}` });
  // Un id con caratteri speciali non diventa una query o un altro percorso.
  assert.equal(hubRedirectFor(`${base}/portfolio/review/a?b#c`), `${hub}/a`, "la query attaccata al percorso non è un id");
  assert.equal(hubRedirectFor(`${base}/portfolio/review/a%3Fb`), `${hub}/a%3Fb`);
  assert.equal(hubRedirectFor(`${base}/portfolio/review/a%2Fb`), null);
  assert.equal(hubRedirectFor(`${base}/portfolio/review/..`), null);
  assert.equal(hubRedirectFor(`${base}/portfolio/review`), null, "non è una pagina di oggi");
  assert.equal(hubRedirectFor(`${base}/portfolio/review/${UC}/altro`), null);
});

test("§2.3 /portfolio/submit → /use-cases/nuovo, senza query", () => {
  assert.deepEqual(legacyRouteRedirect(`${base}/portfolio/submit`, { kind: "best_practice" }), { from: "/portfolio/submit", to: `${hub}/nuovo` });
});

test("§2.3 /portfolio/export: la rotta resta; waveBudget e waveDurationMonths non portano altrove", () => {
  assert.equal(hubRedirectFor(`${base}/portfolio/export`), null);
  assert.equal(hubRedirectFor(`${base}/portfolio/export`, { waveBudget: "50000", waveDurationMonths: "6" }), null);
});

test("§2.3 /plan → /use-cases?vista=panoramica, senza query", () => {
  assert.deepEqual(legacyRouteRedirect(`${base}/plan`, { wave: "2" }), { from: "/plan", to: `${hub}?vista=panoramica` });
});

test("HUB_VIEWS dei redirect sono viste della pagina", () => {
  // `legacy-routes.ts` non importa nulla: i suoi nomi devono restare quelli di `views.ts`.
  for (const view of Object.values(HUB_VIEWS)) assert.ok((PAGE_VIEWS as readonly string[]).includes(view), view);
});

test("§2.3 /use-cases e /use-cases/[id]: stesso indirizzo, con vista, filtri e capitolo", () => {
  assert.equal(hubRedirectFor(hub, { vista: "priorita", origine: "adoption" }), null);
  assert.equal(hubRedirectFor(`${hub}/${UC}`, { capitolo: "realizzazione" }), null);
  assert.equal(hubRedirectFor(`${hub}/nuovo`), null);
});

test("§2.3 /casi-duso → /use-cases?vista=panoramica solo con dossierLinksReady vero", () => {
  assert.deepEqual(legacyRouteRedirect(`${base}/casi-duso`, undefined, { dossierLinksReady: true }), { from: "/casi-duso", to: `${hub}?vista=panoramica` });
  assert.equal(hubRedirectFor(`${base}/casi-duso`, undefined, { dossierLinksReady: false }), null);
  assert.equal(hubRedirectFor(`${base}/casi-duso`), null, "senza la lettura la lista dei casi resta");
  assert.equal(hubRedirectFor(`${base}/casi-duso`, { stato: "aperti" }, { dossierLinksReady: true }), `${hub}?vista=panoramica`);
});

test("§2.3 /casi-duso/nuovo senza useCaseId → /use-cases?vista=panoramica, sempre", () => {
  assert.deepEqual(legacyRouteRedirect(`${base}/casi-duso/nuovo`), { from: "/casi-duso/nuovo", to: `${hub}?vista=panoramica` });
  assert.equal(hubRedirectFor(`${base}/casi-duso/nuovo`, new URLSearchParams("template=x")), `${hub}?vista=panoramica`);
  assert.equal(hubRedirectFor(`${base}/casi-duso/nuovo`, { useCaseId: "" }), `${hub}?vista=panoramica`, "useCaseId vuoto = assente");
  assert.equal(hubRedirectFor(`${base}/casi-duso/nuovo`, { useCaseId: "  " }), `${hub}?vista=panoramica`);
  // Non dipende da dossierLinksReady: un dossier nasce solo da uno use case (§6.5).
  assert.equal(hubRedirectFor(`${base}/casi-duso/nuovo`, undefined, { dossierLinksReady: false }), `${hub}?vista=panoramica`);
});

test("§2.3 /casi-duso/nuovo?useCaseId=: stesso indirizzo (è «Avvia la realizzazione»)", () => {
  assert.equal(hubRedirectFor(`${base}/casi-duso/nuovo`, { useCaseId: UC }), null);
  assert.equal(hubRedirectFor(`${base}/casi-duso/nuovo`, new URLSearchParams(`useCaseId=${UC}`)), null);
  assert.equal(hubRedirectFor(`${base}/casi-duso/nuovo?useCaseId=${UC}`), null, "query attaccata al percorso");
  assert.equal(hubRedirectFor(`${base}/casi-duso/nuovo`, { useCaseId: UC.toUpperCase() }), null, "UUID in maiuscolo, come la pagina");
});

test("§2.3 /casi-duso/nuovo: conta solo il primo useCaseId, e solo se è un UUID (come la pagina)", () => {
  // La pagina legge `sp.useCaseId[0]` e lo accetta solo come UUID: altrimenti la procedura
  // partirebbe senza scheda, e un dossier nasce solo da uno use case (§6.5).
  for (const useCaseId of ["foo", "123", `${UC}x`, ` ${UC}`]) {
    assert.equal(hubRedirectFor(`${base}/casi-duso/nuovo`, { useCaseId }), `${hub}?vista=panoramica`, useCaseId);
    assert.equal(hubRedirectFor(`${base}/casi-duso/nuovo`, new URLSearchParams({ useCaseId })), `${hub}?vista=panoramica`, useCaseId);
  }
  assert.equal(hubRedirectFor(`${base}/casi-duso/nuovo`, new URLSearchParams(`useCaseId=&useCaseId=${UC}`)), `${hub}?vista=panoramica`);
  assert.equal(hubRedirectFor(`${base}/casi-duso/nuovo`, { useCaseId: ["", UC] }), `${hub}?vista=panoramica`);
  assert.equal(hubRedirectFor(`${base}/casi-duso/nuovo`, new URLSearchParams("useCaseId=&useCaseId=abc")), `${hub}?vista=panoramica`);
  assert.equal(hubRedirectFor(`${base}/casi-duso/nuovo`, { useCaseId: ["", "abc"] }), `${hub}?vista=panoramica`);
  assert.equal(hubRedirectFor(`${base}/casi-duso/nuovo?useCaseId=foo`), `${hub}?vista=panoramica`, "query attaccata al percorso");
  // Il primo è un UUID: resta, qualunque cosa venga dopo.
  assert.equal(hubRedirectFor(`${base}/casi-duso/nuovo`, new URLSearchParams(`useCaseId=${UC}&useCaseId=`)), null);
  assert.equal(hubRedirectFor(`${base}/casi-duso/nuovo`, { useCaseId: [UC, "foo"] }), null);
});

test("§2.3 /casi-duso/[caseId]/*: invariati", () => {
  for (const rest of ["", "/domande", "/roi", "/voci/abc", "/export"]) {
    assert.equal(hubRedirectFor(`${base}/casi-duso/${CASE}${rest}`, undefined, { dossierLinksReady: true }), null, rest);
  }
});

test("§2.3 /r/[token], /api/r/**, /share/portfolio/**: invariati", () => {
  for (const path of ["/r/tok-123", "/api/r/tok-123/answer", `/share/portfolio/${WS}/${UC}`, `/share/portfolio/${WS}`]) {
    assert.equal(hubRedirectFor(path, { joined: "1" }, { dossierLinksReady: true }), null, path);
  }
});

test("le altre pagine del workspace e gli indirizzi fuori forma restano com'erano", () => {
  for (const path of [
    base,
    `${base}/settings`,
    `${base}/portfolios`,
    `${base}/planning`,
    `${base}/Portfolio`,
    `/dashboard//portfolio`,
    `/dashboard/${WS}//portfolio`,
    "/dashboard",
    "/portfolio",
    "",
  ]) {
    assert.equal(hubRedirectFor(path, undefined, { dossierLinksReady: true }), null, path);
  }
});

test("barra finale e query attaccata al percorso", () => {
  assert.equal(hubRedirectFor(`${base}/plan/`), `${hub}?vista=panoramica`);
  assert.equal(hubRedirectFor(`${base}/portfolio?joined=1&waveBudget=2`), `${hub}?vista=da-decidere&joined=1`);
  // Se searchParams c'è, vale quello.
  assert.equal(hubRedirectFor(`${base}/portfolio?joined=1`, { thanks: "1" }), `${hub}?vista=da-decidere&thanks=1`);
});

test("la destinazione resta nell'app: sempre /dashboard/<ws>/use-cases, il workspace ricodificato", () => {
  for (const to of [hubRedirectFor(`${base}/plan`), hubRedirectFor(`/dashboard/a%3Fb/plan`)]) {
    assert.ok(to?.startsWith("/dashboard/") && !to.startsWith("//"), String(to));
  }
  assert.equal(hubRedirectFor(`/dashboard/a%3Fb/plan`), "/dashboard/a%3Fb/use-cases?vista=panoramica");
  assert.equal(hubRedirectFor(`/dashboard/%E0%A4%A/plan`), null, "segmento non decodificabile");
});

test("riga di log dello stub: area, operazione e vecchio indirizzo, senza id né query", () => {
  const redirect = legacyRouteRedirect(`${base}/portfolio/review/${UC}`, { x: "1" })!;
  const entry = stubLogEntry(redirect.from);
  assert.deepEqual(entry, { area: "use-case-hub", op: "stub", from: "/portfolio/review" });
  assert.ok(!JSON.stringify(entry).includes(UC) && !JSON.stringify(entry).includes(WS));
  for (const [path, from] of [
    [`${base}/portfolio`, "/portfolio"],
    [`${base}/portfolio/submit`, "/portfolio/submit"],
    [`${base}/plan`, "/plan"],
    [`${base}/casi-duso/nuovo`, "/casi-duso/nuovo"],
  ] as const) {
    assert.equal(legacyRouteRedirect(path, { joined: "1" })?.from, from, path);
  }
});
