import test from "node:test";
import assert from "node:assert/strict";
import { isNavItemActive } from "../dashboard/nav-active.ts";
import {
  activeNavItem,
  activeNavTitle,
  legacyWorkspaceNav,
  listNav,
  navBase,
  topLevelItems,
  workspaceNav,
  WORKSPACE_LIST_HREF,
  type ShellNav,
  type ShellViewer,
} from "./sidebar-model.ts";

// (Rilascio 10, ondata 2a «Cornice», docs/ui-10/PROPOSTA-10.md §2.1-§2.4, D11 respinta il 18/11) Le voci della barra,
// ruolo per ruolo: le cinque in alto, gli strumenti di oggi sotto una linea, «Impostazioni» nel piede per chi gestisce;
// la voce accesa su ogni pagina della sua area. Id inventati.

const WS = "00000000-0000-4000-8000-0000000000f1";
const base = `/dashboard/${WS}`;
const at = (rest: string) => `${base}${rest}`;

const viewer = (patch: Partial<ShellViewer>): ShellViewer => ({
  workspaceId: WS,
  role: "analyst",
  useCaseHub: true,
  learningAvailable: true,
  casesAvailable: false,
  factoryAvailable: false,
  ...patch,
});

const titles = (items: readonly { title: string }[]) => items.map((item) => item.title);
const TOOLS = ["Value map", "Report", "Blueprints", "Simulazione", "Intelligence"];

test("revisore di Lateral Space che gestisce e guida l'Agent Factory: cinque voci, gli strumenti sotto, Impostazioni nel piede", () => {
  const nav = workspaceNav(viewer({ role: "transformation_lead", factoryAvailable: true }));
  assert.deepEqual(titles(nav.main), ["Home", "Use case", "Agent Factory", "Contesto", "Persone"]);
  assert.deepEqual(titles(nav.tools), TOOLS);
  assert.equal(nav.settings?.title, "Impostazioni");
  assert.equal(nav.settings?.href, at("/settings"));
  assert.deepEqual(
    nav.main.map((item) => item.href),
    [base, at("/use-cases"), at("/agent-factory"), at("/contesto"), at("/ai-readiness")],
  );
  assert.deepEqual(
    nav.tools.map((item) => item.href),
    [at("/value-map"), at("/reports"), at("/blueprints"), at("/simulation"), at("/intelligence")],
  );
  // Le viste che le pagine non hanno ancora: sotto la voce, solo mentre è accesa.
  assert.deepEqual(titles(nav.main[3].children ?? []), ["Processi", "Intervista iniziale"]);
  assert.deepEqual(titles(nav.main[4].children ?? []), ["AI Readiness", "Formazione"]);
});

test("revisore del cliente che gestisce, senza costruire: quattro voci, gli strumenti e Impostazioni", () => {
  const nav = workspaceNav(viewer({ role: "exec_sponsor" }));
  assert.deepEqual(titles(nav.main), ["Home", "Use case", "Contesto", "Persone"]);
  assert.deepEqual(titles(nav.tools), TOOLS);
  assert.equal(nav.settings?.title, "Impostazioni");
});

test("altro revisore del cliente: quattro voci e gli strumenti, niente Impostazioni", () => {
  for (const role of ["function_lead", "analyst"]) {
    const nav = workspaceNav(viewer({ role }));
    assert.deepEqual(titles(nav.main), ["Home", "Use case", "Contesto", "Persone"], role);
    assert.deepEqual(titles(nav.tools), TOOLS, role);
    assert.equal(nav.settings, null, role);
  }
});

test("chi costruisce (anche da fuori, con un ruolo da revisore): «Agent Factory» al terzo posto, come oggi", () => {
  const nav = workspaceNav(viewer({ role: "analyst", factoryAvailable: true }));
  assert.deepEqual(titles(nav.main), ["Home", "Use case", "Agent Factory", "Contesto", "Persone"]);
  assert.equal(nav.settings, null);
  // Senza il flag la voce non c'è, qualunque sia il ruolo.
  assert.ok(!titles(workspaceNav(viewer({ role: "transformation_lead" })).main).includes("Agent Factory"));
});

test("contributore: Home, Use case, Contesto con i soli Processi; Persone solo se segue un corso; niente strumenti né Impostazioni", () => {
  const without = workspaceNav(viewer({ role: "contributor", learningAvailable: false }));
  assert.deepEqual(titles(without.main), ["Home", "Use case", "Contesto"]);
  assert.deepEqual(titles(without.main[2].children ?? []), ["Processi"]);
  assert.deepEqual(without.tools, []);
  assert.equal(without.settings, null);
  const withCourse = workspaceNav(viewer({ role: "contributor", learningAvailable: true }));
  assert.deepEqual(titles(withCourse.main), ["Home", "Use case", "Contesto", "Persone"]);
  assert.equal(withCourse.main[3].href, at("/learning"), "«Persone» è la sua Formazione");
  assert.deepEqual(withCourse.main[3].children ?? [], []);
  // Un contributore che costruisce in un caso vede l'Agent Factory, come oggi.
  assert.deepEqual(titles(workspaceNav(viewer({ role: "contributor", learningAvailable: false, factoryAvailable: true })).main), ["Home", "Use case", "Agent Factory", "Contesto"]);
});

test("chi segue solo un corso: «Formazione», voce unica, con l'area accesa o spenta", () => {
  for (const useCaseHub of [true, false]) {
    const nav = workspaceNav(viewer({ role: "learner", useCaseHub, factoryAvailable: true, casesAvailable: true }));
    assert.deepEqual(titles(nav.main), ["Formazione"]);
    assert.equal(nav.main[0].href, at("/learning"));
    assert.deepEqual(nav.tools, []);
    assert.equal(nav.settings, null);
    assert.equal(isNavItemActive(at("/learning/programma-1/attempts/x"), base, nav.main[0]), true);
  }
});

test("«Realizzazioni» finché non ogni realizzazione ha la sua scheda (P0-16): prima degli strumenti, e tiene /casi-duso", () => {
  const nav = workspaceNav(viewer({ role: "analyst", casesAvailable: true }));
  assert.deepEqual(titles(nav.tools), ["Realizzazioni", ...TOOLS]);
  assert.equal(nav.tools[0].href, at("/casi-duso"));
  const useCase = nav.main[1];
  assert.equal(isNavItemActive(at("/casi-duso/00000000-0000-4000-8000-000000000c01/domande"), base, useCase), false);
  assert.equal(activeNavItem(nav, at("/casi-duso/00000000-0000-4000-8000-000000000c01/domande"), base)?.item.title, "Realizzazioni");
  // Il contributore che vede una realizzazione: la sola voce sotto la linea.
  assert.deepEqual(titles(workspaceNav(viewer({ role: "contributor", casesAvailable: true })).tools), ["Realizzazioni"]);
  // Senza la voce, /casi-duso è di «Use case».
  assert.equal(activeNavItem(workspaceNav(viewer({ role: "analyst" })), at("/casi-duso/00000000-0000-4000-8000-000000000c01"), base)?.item.title, "Use case");
});

test("area «Use case» spenta: la barra di prima, voce per voce, accesa come prima, con le parole di §4", () => {
  const nav = workspaceNav(viewer({ role: "transformation_lead", useCaseHub: false, casesAvailable: true, factoryAvailable: true }));
  assert.deepEqual(titles(nav.main), [
    "Overview",
    "AI Readiness",
    "Formazione",
    "Raccolta & ranking",
    "Intervista iniziale",
    "Contesto",
    "Strategia",
    "Processi",
    "Value map",
    "Use case",
    "Realizzazioni",
    "Piano",
    "Report",
    "Blueprints",
    "Simulazione",
    "Intelligence",
    "Impostazioni",
  ]);
  assert.deepEqual(nav.tools, []);
  assert.equal(nav.settings, null, "Impostazioni resta una voce, per tutti, come prima");
  assert.deepEqual(nav, legacyWorkspaceNav({ workspaceId: WS, learningAvailable: true, casesAvailable: true }));
  const activeAt = (rest: string) => topLevelItems(nav).filter((item) => isNavItemActive(at(rest), base, item)).map((item) => item.title);
  assert.deepEqual(activeAt("/portfolio"), ["Raccolta & ranking"]);
  assert.deepEqual(activeAt("/portfolio/review/x"), []);
  assert.deepEqual(activeAt("/casi-duso/x/domande"), ["Realizzazioni"]);
  // Le voci che hanno la stessa cosa della barra nuova la chiamano allo stesso modo.
  assert.doesNotMatch(titles(nav.main).join(" | "), /casi d'uso|Discovery|Activity mapping|Use cases/i);
  for (const [key, title] of [["discovery", "Intervista iniziale"], ["mapping", "Processi"], ["use-cases", "Use case"], ["cases", "Realizzazioni"]] as const) {
    assert.equal(nav.main.find((item) => item.key === key)?.title, title, key);
  }
  assert.deepEqual(activeAt("/setup/context"), ["Contesto"]);
  assert.deepEqual(activeAt("/learning/programma"), []);
});

test("mai più di cinque voci in alto, chiavi uniche, ogni indirizzo dentro il workspace", () => {
  const roles = ["exec_sponsor", "transformation_lead", "function_lead", "analyst", "contributor", "learner", null, "sconosciuto"];
  for (const role of roles) {
    for (const flags of [0, 1, 2, 3, 4, 5, 6, 7]) {
      const nav = workspaceNav(viewer({ role, learningAvailable: Boolean(flags & 1), casesAvailable: Boolean(flags & 2), factoryAvailable: Boolean(flags & 4) }));
      assert.ok(nav.main.length <= 5, `${role}: ${nav.main.length} voci`);
      const all = [...topLevelItems(nav), ...topLevelItems(nav).flatMap((item) => item.children ?? [])];
      assert.equal(new Set(topLevelItems(nav).map((item) => item.key)).size, topLevelItems(nav).length, `${role}: chiavi doppie`);
      for (const item of all) assert.ok(item.href === base || item.href.startsWith(`${base}/`), `${role}: ${item.href}`);
      for (const item of nav.main) assert.ok((item.children ?? []).length !== 1 || item.children?.[0].href !== item.href, "una vista sola uguale alla voce non serve");
    }
  }
  // Un ruolo sconosciuto vede quanto un contributore, mai di più.
  assert.deepEqual(workspaceNav(viewer({ role: "sconosciuto" })), workspaceNav(viewer({ role: "contributor" })));
  assert.deepEqual(workspaceNav(viewer({ role: null })), workspaceNav(viewer({ role: "contributor" })));
});

/** Ogni rotta di oggi (§2.4) accende una voce sola, quella della sua casa nuova. */
const ROUTES: Array<[string, string, string]> = [
  ["", "Home", "Home"],
  ["/programma", "Home", "Home"],
  ["/programma?apri=sal", "Home", "Home"],
  ["/strategy", "Home", "Home"],
  ["/use-cases", "Use case", "Use case"],
  ["/use-cases?vista=da-decidere&apri=x", "Use case", "Use case"],
  ["/use-cases/00000000-0000-4000-8000-000000000e01", "Use case", "Use case"],
  ["/use-cases/nuovo", "Use case", "Use case"],
  ["/use-cases/00000000-0000-4000-8000-000000000e01/progetto", "Use case", "Use case"],
  ["/portfolio", "Use case", "Use case"],
  ["/portfolio/review/00000000-0000-4000-8000-000000000e01", "Use case", "Use case"],
  ["/portfolio/submit", "Use case", "Use case"],
  ["/portfolio/export", "Use case", "Use case"],
  ["/plan", "Use case", "Use case"],
  ["/casi-duso", "Use case", "Use case"],
  ["/casi-duso/nuovo", "Use case", "Use case"],
  ["/casi-duso/00000000-0000-4000-8000-000000000c01/domande/verifica", "Use case", "Use case"],
  ["/agent-factory", "Agent Factory", "Agent Factory"],
  ["/agent-factory?apri=XX-0012", "Agent Factory", "Agent Factory"],
  ["/contesto", "Contesto", "Contesto"],
  ["/contesto?vista=appunti", "Contesto", "Contesto"],
  ["/contesto/conferma", "Contesto", "Contesto"],
  ["/mapping", "Contesto", "Processi"],
  ["/mapping/00000000-0000-4000-8000-000000000d01", "Contesto", "Processi"],
  ["/setup/leadership", "Contesto", "Intervista iniziale"],
  ["/setup/context", "Contesto", "Contesto"],
  ["/ai-readiness", "Persone", "AI Readiness"],
  ["/ai-readiness/questions/00000000-0000-4000-8000-000000000a02", "Persone", "AI Readiness"],
  ["/learning", "Persone", "Formazione"],
  ["/learning/programma-1/results", "Persone", "Formazione"],
  ["/settings", "Impostazioni", "Impostazioni"],
  ["/value-map", "Value map", "Value map"],
  ["/reports", "Report", "Report"],
  ["/blueprints", "Blueprints", "Blueprints"],
  ["/simulation", "Simulazione", "Simulazione"],
  ["/intelligence", "Intelligence", "Intelligence"],
];

test("la voce accesa su ogni rotta di oggi e sui suoi alias (§2.4), e il titolo della barra in alto del telefono", () => {
  const nav = workspaceNav(viewer({ role: "transformation_lead", factoryAvailable: true }));
  for (const [rest, item, title] of ROUTES) {
    const path = at(rest);
    const lit = topLevelItems(nav).filter((candidate) => isNavItemActive(path, base, candidate)).map((candidate) => candidate.title);
    assert.deepEqual(lit, [item], rest);
    assert.equal(activeNavTitle(nav, path, base), title, rest);
  }
  // Fuori dalle voci (un altro workspace, la lista): nessuna voce accesa, nessun titolo.
  assert.equal(activeNavItem(nav, "/dashboard/00000000-0000-4000-8000-0000000000f2/use-cases", base), null);
  assert.equal(activeNavTitle(nav, "/dashboard", base), null);
});

test("le viste sotto «Contesto» e «Persone» si accendono da sole, una alla volta", () => {
  const nav = workspaceNav(viewer({ role: "analyst" }));
  const childrenLit = (rest: string) =>
    topLevelItems(nav)
      .flatMap((item) => item.children ?? [])
      .filter((child) => isNavItemActive(at(rest), base, child))
      .map((child) => child.title);
  assert.deepEqual(childrenLit("/contesto"), []);
  assert.deepEqual(childrenLit("/mapping/x"), ["Processi"]);
  assert.deepEqual(childrenLit("/setup/leadership"), ["Intervista iniziale"]);
  assert.deepEqual(childrenLit("/ai-readiness?assessment=x"), ["AI Readiness"]);
  assert.deepEqual(childrenLit("/learning/p/ideas"), ["Formazione"]);
  // Senza corsi nel workspace «Persone» non ha viste: porta all'AI Readiness e basta.
  const noCourse = workspaceNav(viewer({ role: "analyst", learningAvailable: false }));
  assert.deepEqual(noCourse.main.find((item) => item.key === "people")?.children, []);
});

test("fuori da un workspace: «I tuoi workspace», accesa su /dashboard anche con la query", () => {
  const nav: ShellNav = listNav();
  assert.deepEqual(titles(nav.main), ["I tuoi workspace"]);
  assert.equal(nav.main[0].href, WORKSPACE_LIST_HREF);
  assert.equal(WORKSPACE_LIST_HREF, "/dashboard?tutti=1");
  assert.equal(navBase(null), "/dashboard");
  assert.equal(navBase(WS), base);
  assert.equal(isNavItemActive("/dashboard", "/dashboard", nav.main[0]), true);
  assert.equal(isNavItemActive(base, "/dashboard", nav.main[0]), false);
});

test("le parole delle voci: nessun «caso d'uso» né «Altri strumenti» con l'area accesa", () => {
  for (const role of ["transformation_lead", "analyst", "contributor", "learner"]) {
    const nav = workspaceNav(viewer({ role, casesAvailable: true, factoryAvailable: true }));
    const words = [...topLevelItems(nav), ...topLevelItems(nav).flatMap((item) => item.children ?? [])].map((item) => item.title).join(" | ");
    assert.doesNotMatch(words, /caso d'uso|casi d'uso|Altri strumenti|Overview|Discovery|Activity mapping|Strategia|Il mio corso/i, role);
  }
});
