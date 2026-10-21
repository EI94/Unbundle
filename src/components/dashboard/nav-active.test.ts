import test from "node:test";
import assert from "node:assert/strict";
import { USE_CASE_NAV_MATCH, isNavItemActive } from "./nav-active.ts";

// docs/use-case/DESIGN.md §2.1 (D1): Overview solo sull'indirizzo esatto; «Use case» accesa
// anche sulle pagine che sostituisce. Id inventati.

const WS = "00000000-0000-4000-8000-0000000000f1";
const OTHER_WS = "00000000-0000-4000-8000-0000000000f2";
const base = `/dashboard/${WS}`;
const at = (rest: string) => `${base}${rest}`;

const overview = { href: base };
const useCase = { href: `${base}/use-cases`, match: USE_CASE_NAV_MATCH };
const discovery = { href: `${base}/setup/leadership` };
const context = { href: `${base}/setup/context` };
const cases = { href: `${base}/casi-duso` };
const learning = { href: `${base}/learning` };

test("Overview: attiva solo sull'indirizzo esatto del workspace", () => {
  assert.equal(isNavItemActive(base, base, overview), true);
  assert.equal(isNavItemActive(`${base}/`, base, overview), true, "barra finale");
  for (const rest of ["/use-cases", "/portfolio", "/settings", "/casi-duso/abc"]) {
    assert.equal(isNavItemActive(at(rest), base, overview), false, rest);
  }
  // Anche con un match scritto a mano resta esatta.
  assert.equal(isNavItemActive(at("/use-cases"), base, { href: base, match: ["use-cases"] }), false);
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

test("le altre voci: il proprio segmento come predefinito, pagine annidate comprese (niente più «nested»)", () => {
  assert.equal(isNavItemActive(at("/setup/leadership"), base, discovery), true);
  assert.equal(isNavItemActive(at("/setup/context"), base, discovery), false);
  assert.equal(isNavItemActive(at("/setup/context"), base, context), true);
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
