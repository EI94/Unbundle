/**
 * Il modello della barra laterale, ruolo per ruolo (rilascio 10, ondata 2a «Cornice», docs/ui-10/PROPOSTA-10.md
 * §2.1-§2.4, §3.1, con la decisione del titolare del 18/11 su D11).
 *
 * In alto le cinque voci: Home · Use case · Agent Factory · Contesto · Persone. «Agent Factory» solo per chi costruisce,
 * come oggi (`factoryAvailable`); i contributori e chi segue solo un corso come dice §2.2. Sotto una linea sottile,
 * senza titolo, ogni altro strumento di oggi resta una voce sua (D11 respinta: niente «Altri strumenti», niente ritiri):
 * Value map, Report, Blueprints, Simulazione, Intelligence, nell'ordine di oggi; prima di loro «Realizzazioni» finché
 * non ogni realizzazione ha la sua scheda (P0-16). «Impostazioni» sta nel piede, solo per chi gestisce il workspace.
 *
 * Le viste di una voce che le pagine non hanno ancora (Processi e Intervista iniziale in «Contesto», AI Readiness e
 * Formazione in «Persone») stanno sotto la voce, solo mentre è accesa: così ogni pagina di oggi resta a un tocco dalla
 * sua voce. Le toglieranno le ondate che danno quelle viste alle pagine (6a per Contesto, 7 per Persone).
 *
 * Con l'area «Use case» spenta la barra resta quella di prima, voce per voce (`legacyWorkspaceNav`): va via con i rami
 * «area spenta» (ondata 8).
 *
 * Modulo puro: niente React, niente icone (solo i loro nomi), import relativi `.ts` per `node --test`.
 */
import {
  CONTEXT_NAV_MATCH,
  CONTEXT_SECTION_MATCH,
  HOME_NAV_MATCH,
  PEOPLE_NAV_MATCH,
  USE_CASE_NAV_MATCH,
  isNavItemActive,
} from "../dashboard/nav-active.ts";
import { PORTFOLIO_REVIEWER_ROLES, canManageWorkspaceSettings } from "../../lib/workspace-permissions.ts";
import { SHELL_TEXT } from "../../lib/shell/text.ts";

/** Le icone della barra, per nome: la barra le traduce nelle icone di lucide. */
export type ShellIcon =
  | "home"
  | "use-case"
  | "factory"
  | "context"
  | "people"
  | "processes"
  | "interview"
  | "readiness"
  | "learning"
  | "realizations"
  | "value-map"
  | "reports"
  | "blueprints"
  | "simulation"
  | "intelligence"
  | "settings"
  | "workspaces"
  | "overview"
  | "portfolio"
  | "strategy"
  | "plan";

export interface ShellNavItem {
  /** Chiave stabile della voce (per React e per i test). */
  key: string;
  title: string;
  href: string;
  icon: ShellIcon;
  /** I segmenti sotto il workspace per cui resta accesa (`isNavItemActive`); senza, il suo segmento. */
  match?: readonly string[];
  /** Le altre viste della voce, sotto di lei mentre è accesa. */
  children?: readonly ShellNavItem[];
}

export interface ShellNav {
  /** Le voci principali: per chi lavora nel workspace al massimo cinque. */
  main: readonly ShellNavItem[];
  /** Gli altri strumenti, sotto una linea sottile, senza titolo. */
  tools: readonly ShellNavItem[];
  /** «Impostazioni» nel piede: solo per chi gestisce il workspace. */
  settings: ShellNavItem | null;
}

export interface ShellViewer {
  workspaceId: string;
  /** Il ruolo di chi guarda nel workspace (`learner` per chi segue solo un corso). */
  role: string | null | undefined;
  /** Area «Use case» accesa per il workspace (`isUseCaseHubWorkspace`). */
  useCaseHub: boolean;
  /** Il workspace ha dei corsi (`hasLearningForWorkspace`). */
  learningAvailable: boolean;
  /** «Realizzazioni»: chi vede le realizzazioni, finché non ognuna ha la sua scheda (P0-16, `ucCasesNavVisible`). */
  casesAvailable: boolean;
  /** «Agent Factory»: chi costruisce in un caso del workspace, o lo guida da manager di Lateral Space (`factoryNavVisible`). */
  factoryAvailable: boolean;
}

const N = SHELL_TEXT.nav;
const L = SHELL_TEXT.legacy;

/** «Use case» lascia `/casi-duso` a «Realizzazioni» mentre quella voce c'è. */
const USE_CASE_WITHOUT_REALIZATIONS: readonly string[] = Object.freeze(USE_CASE_NAV_MATCH.filter((segment) => segment !== "casi-duso"));

/** Solo l'indirizzo della voce: come accendeva la barra prima dell'area «Use case». */
const EXACT: readonly string[] = Object.freeze([]);

const isReviewer = (role: string | null | undefined) => typeof role === "string" && (PORTFOLIO_REVIEWER_ROLES as readonly string[]).includes(role);

function freeze(nav: ShellNav): ShellNav {
  return Object.freeze({ main: Object.freeze([...nav.main]), tools: Object.freeze([...nav.tools]), settings: nav.settings });
}

/** La barra di chi segue solo un corso: «Formazione», voce unica (§2.2). */
function learnerNav(base: string): ShellNav {
  return freeze({ main: [{ key: "learning", title: N.learning, href: `${base}/learning`, icon: "learning", match: ["learning"] }], tools: [], settings: null });
}

/** La barra di prima, con l'area «Use case» spenta: le stesse voci, nello stesso ordine, accese come prima. */
export function legacyWorkspaceNav(viewer: Pick<ShellViewer, "workspaceId" | "learningAvailable" | "casesAvailable">): ShellNav {
  const base = `/dashboard/${viewer.workspaceId}`;
  const main: ShellNavItem[] = [
    { key: "overview", title: L.overview, href: base, icon: "overview" },
    { key: "readiness", title: L.readiness, href: `${base}/ai-readiness`, icon: "readiness", match: EXACT },
    ...(viewer.learningAvailable ? [{ key: "learning", title: L.learning, href: `${base}/learning`, icon: "learning", match: EXACT } satisfies ShellNavItem] : []),
    { key: "portfolio", title: L.portfolio, href: `${base}/portfolio`, icon: "portfolio", match: EXACT },
    { key: "discovery", title: L.discovery, href: `${base}/setup/leadership`, icon: "interview", match: EXACT },
    { key: "context", title: L.context, href: `${base}/contesto`, icon: "context", match: CONTEXT_NAV_MATCH },
    { key: "strategy", title: L.strategy, href: `${base}/strategy`, icon: "strategy", match: EXACT },
    { key: "mapping", title: L.mapping, href: `${base}/mapping`, icon: "processes", match: EXACT },
    { key: "value-map", title: L.valueMap, href: `${base}/value-map`, icon: "value-map", match: EXACT },
    { key: "use-cases", title: L.useCases, href: `${base}/use-cases`, icon: "use-case", match: EXACT },
    ...(viewer.casesAvailable ? [{ key: "cases", title: L.cases, href: `${base}/casi-duso`, icon: "realizations" } satisfies ShellNavItem] : []),
    { key: "plan", title: L.plan, href: `${base}/plan`, icon: "plan", match: EXACT },
    { key: "reports", title: L.reports, href: `${base}/reports`, icon: "reports", match: EXACT },
    { key: "blueprints", title: L.blueprints, href: `${base}/blueprints`, icon: "blueprints", match: EXACT },
    { key: "simulation", title: L.simulation, href: `${base}/simulation`, icon: "simulation", match: EXACT },
    { key: "intelligence", title: L.intelligence, href: `${base}/intelligence`, icon: "intelligence", match: EXACT },
    { key: "settings", title: L.settings, href: `${base}/settings`, icon: "settings", match: EXACT },
  ];
  return freeze({ main, tools: [], settings: null });
}

/** La barra di un workspace, per chi guarda (§2.2). */
export function workspaceNav(viewer: ShellViewer): ShellNav {
  const base = `/dashboard/${viewer.workspaceId}`;
  if (viewer.role === "learner") return learnerNav(base);
  if (!viewer.useCaseHub) return legacyWorkspaceNav(viewer);

  const reviewer = isReviewer(viewer.role);
  const processes: ShellNavItem = { key: "processes", title: N.processes, href: `${base}/mapping`, icon: "processes", match: ["mapping"] };
  const interview: ShellNavItem = { key: "interview", title: N.interview, href: `${base}/setup/leadership`, icon: "interview", match: ["setup/leadership"] };

  const main: ShellNavItem[] = [
    { key: "home", title: N.home, href: base, icon: "home", match: HOME_NAV_MATCH },
    {
      key: "use-case",
      title: N.useCase,
      href: `${base}/use-cases`,
      icon: "use-case",
      match: viewer.casesAvailable ? USE_CASE_WITHOUT_REALIZATIONS : USE_CASE_NAV_MATCH,
    },
    ...(viewer.factoryAvailable ? [{ key: "factory", title: N.factory, href: `${base}/agent-factory`, icon: "factory" } satisfies ShellNavItem] : []),
    // I contributori leggono il Contesto e modificano i Processi, come oggi; l'Intervista iniziale è dei revisori.
    { key: "context", title: N.context, href: `${base}/contesto`, icon: "context", match: CONTEXT_SECTION_MATCH, children: reviewer ? [processes, interview] : [processes] },
  ];

  if (reviewer) {
    // AI Readiness · Formazione; senza corsi nel workspace, la sola AI Readiness.
    const readiness: ShellNavItem = { key: "readiness", title: N.readiness, href: `${base}/ai-readiness`, icon: "readiness", match: ["ai-readiness"] };
    const learning: ShellNavItem = { key: "learning", title: N.learning, href: `${base}/learning`, icon: "learning", match: ["learning"] };
    main.push({
      key: "people",
      title: N.people,
      href: readiness.href,
      icon: "people",
      match: PEOPLE_NAV_MATCH,
      children: viewer.learningAvailable ? [readiness, learning] : [],
    });
  } else if (viewer.learningAvailable) {
    // Il contributore che segue un corso: «Persone» è la sua Formazione.
    main.push({ key: "people", title: N.people, href: `${base}/learning`, icon: "people", match: PEOPLE_NAV_MATCH });
  }

  const tools: ShellNavItem[] = [
    ...(viewer.casesAvailable ? [{ key: "realizations", title: N.realizations, href: `${base}/casi-duso`, icon: "realizations", match: ["casi-duso"] } satisfies ShellNavItem] : []),
    // Gli strumenti della prima versione: ai revisori, come in §2.2 (il contributore non li può usare, §4.10 dell'audit).
    ...(reviewer
      ? ([
          { key: "value-map", title: N.valueMap, href: `${base}/value-map`, icon: "value-map" },
          { key: "reports", title: N.reports, href: `${base}/reports`, icon: "reports" },
          { key: "blueprints", title: N.blueprints, href: `${base}/blueprints`, icon: "blueprints" },
          { key: "simulation", title: N.simulation, href: `${base}/simulation`, icon: "simulation" },
          { key: "intelligence", title: N.intelligence, href: `${base}/intelligence`, icon: "intelligence" },
        ] satisfies ShellNavItem[])
      : []),
  ];

  const settings: ShellNavItem | null = canManageWorkspaceSettings(viewer.role)
    ? { key: "settings", title: N.settings, href: `${base}/settings`, icon: "settings" }
    : null;

  return freeze({ main, tools, settings });
}

/** Il bersaglio di «Salta al contenuto»: il riquadro della pagina, accanto alla barra laterale. */
export const SHELL_CONTENT_ID = "contenuto";

/** La barra fuori da un workspace (`/dashboard`): «I tuoi workspace». */
export const WORKSPACE_LIST_HREF = "/dashboard?tutti=1";
export const NEW_WORKSPACE_HREF = "/dashboard?nuovo=1";

export function listNav(): ShellNav {
  return freeze({ main: [{ key: "workspaces", title: N.workspaces, href: WORKSPACE_LIST_HREF, icon: "workspaces" }], tools: [], settings: null });
}

/** La base delle voci: il workspace, oppure `/dashboard` fuori da un workspace. */
export function navBase(workspaceId: string | null | undefined): string {
  return workspaceId ? `/dashboard/${workspaceId}` : "/dashboard";
}

/** Tutte le voci di primo livello, nell'ordine della barra: principali, strumenti, Impostazioni. */
export function topLevelItems(nav: ShellNav): readonly ShellNavItem[] {
  return [...nav.main, ...nav.tools, ...(nav.settings ? [nav.settings] : [])];
}

/** La voce accesa (e la sua vista accesa, se ne ha) per l'indirizzo, oppure null. */
export function activeNavItem(nav: ShellNav, pathname: string, basePath: string): { item: ShellNavItem; child: ShellNavItem | null } | null {
  for (const item of topLevelItems(nav)) {
    if (!isNavItemActive(pathname, basePath, item)) continue;
    const child = item.children?.find((candidate) => isNavItemActive(pathname, basePath, candidate)) ?? null;
    return { item, child };
  }
  return null;
}

/** Il titolo della barra in alto del telefono: la vista accesa, o la voce accesa (§2.1). */
export function activeNavTitle(nav: ShellNav, pathname: string, basePath: string): string | null {
  const active = activeNavItem(nav, pathname, basePath);
  return active ? (active.child ?? active.item).title : null;
}
