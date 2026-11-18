import test from "node:test";
import assert from "node:assert/strict";
import { CONTEXT_NAV_MATCH, CONTEXT_SECTION_MATCH, HOME_NAV_MATCH, PEOPLE_NAV_MATCH, USE_CASE_NAV_MATCH, isNavItemActive } from "./nav-active.ts";
import { legacyWorkspaceNav, workspaceNav } from "../shell/sidebar-model.ts";

// docs/use-case/DESIGN.md §2.1 (D1): Overview solo sull'indirizzo esatto; «Use case» accesa
// anche sulle pagine che sostituisce. (Rilascio 10, docs/ui-10/PROPOSTA-10.md §2.4) «Home» accesa anche sul
// Programma e sugli Obiettivi, «Contesto» sui Processi e sull'Intervista iniziale, «Persone» su AI Readiness e
// Formazione. Id inventati.

const WS = "00000000-0000-4000-8000-0000000000f1";
const OTHER_WS = "00000000-0000-4000-8000-0000000000f2";
const base = `/dashboard/${WS}`;
const at = (rest: string) => `${base}${rest}`;

const overview = { href: base };
const useCase = { href: `${base}/use-cases`, match: USE_CASE_NAV_MATCH };
const discovery = { href: `${base}/setup/leadership` };
// (Rilascio 9a) La voce «Contesto» com'è nella barra: punta a `/contesto` e resta accesa sul vecchio indirizzo.
const context = { href: `${base}/contesto`, match: CONTEXT_NAV_MATCH };
const cases = { href: `${base}/casi-duso` };
const learning = { href: `${base}/learning` };

test("Overview: attiva solo sull'indirizzo esatto del workspace", () => {
  assert.equal(isNavItemActive(base, base, overview), true);
  assert.equal(isNavItemActive(`${base}/`, base, overview), true, "barra finale");
  for (const rest of ["/use-cases", "/portfolio", "/settings", "/casi-duso/abc", "/programma", "/strategy"]) {
    assert.equal(isNavItemActive(at(rest), base, overview), false, rest);
  }
});

test("«Home»: l'indirizzo del workspace e i suoi alias, il Programma e gli Obiettivi (§2.4)", () => {
  assert.deepEqual(HOME_NAV_MATCH, ["programma", "strategy"]);
  const home = { href: base, match: HOME_NAV_MATCH };
  for (const path of [base, `${base}/`, at("/programma"), at("/programma?apri=sal"), at("/strategy"), at("/strategy/"), at("/programma/qualcosa")]) {
    assert.equal(isNavItemActive(path, base, home), true, path);
  }
  for (const path of [at("/use-cases"), at("/programmi"), at("/strategy-old"), at("/settings"), `/dashboard/${OTHER_WS}`, `/dashboard/${OTHER_WS}/programma`, "/dashboard"]) {
    assert.equal(isNavItemActive(path, base, home), false, path);
  }
  // Un alias vuoto non accende tutto il workspace.
  assert.equal(isNavItemActive(at("/settings"), base, { href: base, match: [""] }), false);
});

test("«Contesto» e «Persone»: accese su tutte le loro pagine, spente altrove (§2.4)", () => {
  assert.deepEqual(CONTEXT_SECTION_MATCH, ["contesto", "mapping", "setup"]);
  assert.deepEqual(PEOPLE_NAV_MATCH, ["ai-readiness", "learning"]);
  const section = { href: `${base}/contesto`, match: CONTEXT_SECTION_MATCH };
  for (const rest of ["/contesto", "/contesto/conferma?fonte=x", "/contesto/verifica", "/mapping", "/mapping/00000000-0000-4000-8000-000000000d01", "/setup/leadership", "/setup/context"]) {
    assert.equal(isNavItemActive(at(rest), base, section), true, rest);
  }
  for (const rest of ["", "/settings", "/mappings", "/setups", "/use-cases"]) assert.equal(isNavItemActive(at(rest), base, section), false, rest);
  const people = { href: `${base}/ai-readiness`, match: PEOPLE_NAV_MATCH };
  for (const rest of ["/ai-readiness", "/ai-readiness/questions/00000000-0000-4000-8000-000000000a02", "/learning", "/learning/programma-1/results"]) {
    assert.equal(isNavItemActive(at(rest), base, people), true, rest);
  }
  for (const rest of ["", "/learning-old", "/ai-readiness-x", "/settings"]) assert.equal(isNavItemActive(at(rest), base, people), false, rest);
});

test("«Use case»: attiva su use-cases, portfolio/review/<id>, plan e casi-duso/<id>/domande", () => {
  assert.deepEqual(USE_CASE_NAV_MATCH, ["use-cases", "portfolio", "plan", "casi-duso"]);
  for (const rest of [
    "/use-cases",
    "/use-cases/00000000-0000-4000-8000-000000000e01",
    "/use-cases/nuovo",
    "/portfolio",
    "/portfolio/review/00000000-0000-4000-8000-000000000e01",
    "/portfolio/submit",
    "/plan",
    "/casi-duso",
    "/casi-duso/00000000-0000-4000-8000-000000000c01/domande",
    "/casi-duso/nuovo",
  ]) {
    assert.equal(isNavItemActive(at(rest), base, useCase), true, rest);
  }
});

test("«Use case»: spenta altrove, sui prefissi che non sono un segmento e negli altri workspace", () => {
  for (const path of [
    base,
    at("/settings"),
    at("/use-cases-archivio"),
    at("/planning"),
    at("/portfolios"),
    at("/strategy"),
    `/dashboard/${OTHER_WS}/use-cases`,
    "/dashboard",
    "/use-cases",
  ]) {
    assert.equal(isNavItemActive(path, base, useCase), false, path);
  }
});

test("«Contesto»: accesa su /contesto, su /contesto/conferma e sul vecchio /setup/context; spenta altrove", () => {
  assert.deepEqual(CONTEXT_NAV_MATCH, ["contesto", "setup/context"]);
  for (const rest of ["/contesto", "/contesto/", "/contesto?vista=appunti", "/contesto/conferma", "/contesto/conferma?fonte=00000000-0000-4000-8000-000000000a01", "/setup/context"]) {
    assert.equal(isNavItemActive(at(rest), base, context), true, rest);
  }
  for (const path of [base, at("/setup/leadership"), at("/setup"), at("/contesto-vecchio"), at("/setup/context-old"), at("/settings"), `/dashboard/${OTHER_WS}/contesto`, "/contesto"]) {
    assert.equal(isNavItemActive(path, base, context), false, path);
  }
  // «Discovery» non si accende sulla pagina di «Contesto», né sul vecchio indirizzo.
  for (const rest of ["/contesto", "/contesto/conferma", "/setup/context"]) assert.equal(isNavItemActive(at(rest), base, discovery), false, rest);
});

test("la barra usa quelle voci: «Contesto» punta a /contesto, con l'area «Use case» accesa e spenta", () => {
  const accesa = workspaceNav({ workspaceId: WS, role: "analyst", useCaseHub: true, learningAvailable: true, casesAvailable: false, factoryAvailable: false });
  const spenta = legacyWorkspaceNav({ workspaceId: WS, learningAvailable: true, casesAvailable: false });
  const contextOf = (items: readonly { key: string; href: string; match?: readonly string[] }[]) => items.find((item) => item.key === "context");
  assert.deepEqual([contextOf(accesa.main)?.href, contextOf(accesa.main)?.match], [`${base}/contesto`, CONTEXT_SECTION_MATCH]);
  // Spenta: la voce di prima, tra «Discovery» e «Strategia», accesa su /contesto e sul vecchio indirizzo.
  assert.deepEqual([contextOf(spenta.main)?.href, contextOf(spenta.main)?.match], [`${base}/contesto`, CONTEXT_NAV_MATCH]);
  const keys = spenta.main.map((item) => item.key);
  assert.deepEqual(keys.slice(keys.indexOf("context") - 1, keys.indexOf("context") + 2), ["discovery", "context", "strategy"]);
  // Nessun link al vecchio indirizzo, in nessuna delle due barre.
  for (const nav of [accesa, spenta]) {
    const hrefs = [...nav.main, ...nav.tools].flatMap((item) => [item.href, ...(item.children ?? []).map((child) => child.href)]);
    assert.equal(hrefs.some((href) => href.includes("setup/context")), false);
  }
});

test("le altre voci: il proprio segmento come predefinito, pagine annidate comprese (niente più «nested»)", () => {
  assert.equal(isNavItemActive(at("/setup/leadership"), base, discovery), true);
  assert.equal(isNavItemActive(at("/setup"), base, discovery), false);
  assert.equal(isNavItemActive(at("/casi-duso/00000000-0000-4000-8000-000000000c01/domande"), base, cases), true);
  assert.equal(isNavItemActive(at("/learning/programma-1/live"), base, learning), true);
  assert.equal(isNavItemActive(at("/learning"), base, learning), true);
  assert.equal(isNavItemActive(at("/learning-old"), base, learning), false);
});

test("indirizzi con barra finale, query o frammento; match con barre", () => {
  assert.equal(isNavItemActive(at("/plan/"), base, useCase), true);
  assert.equal(isNavItemActive(at("/plan?x=1"), base, useCase), true);
  assert.equal(isNavItemActive(at("/settings#webhook"), base, { href: at("/settings") }), true);
  assert.equal(isNavItemActive(at("/plan"), `${base}/`, useCase), true, "base con barra finale");
  assert.equal(isNavItemActive(at("/plan"), base, { href: at("/use-cases"), match: ["/plan/"] }), true);
  // Un match vuoto non accende tutto il workspace: resta il solo indirizzo della voce.
  assert.equal(isNavItemActive(at("/settings"), base, { href: at("/use-cases"), match: [""] }), false);
  assert.equal(isNavItemActive(at("/use-cases"), base, { href: at("/use-cases"), match: [] }), true);
});

test("voci fuori dal workspace: solo l'indirizzo esatto", () => {
  assert.equal(isNavItemActive("/dashboard", "/dashboard", { href: "/dashboard" }), true);
  assert.equal(isNavItemActive(`/dashboard/${WS}`, "/dashboard", { href: "/dashboard" }), false);
  assert.equal(isNavItemActive("/altro/pagina", base, { href: "/altro" }), false);
});
