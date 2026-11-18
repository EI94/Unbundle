/**
 * Voce attiva della barra laterale (docs/use-case/DESIGN.md §2.1, D1; rilascio 10, docs/ui-10/PROPOSTA-10.md §2.4).
 *
 * Ogni voce ha `match`, i segmenti sotto `/dashboard/<ws>` per cui resta accesa; il
 * predefinito è il segmento della voce stessa (`setup/leadership` per Discovery). Una voce
 * è attiva se l'indirizzo è `base/m` oppure inizia con `base/m/`, per un `m` di `match`:
 * così «Use case» resta accesa su `/portfolio`, `/plan` e `/casi-duso`, e «Contesto» su `/mapping` e `/setup`.
 * La voce che punta alla base del workspace («Home», prima «Overview») è accesa sull'indirizzo esatto e, se ha un
 * `match`, anche sui suoi alias (`/programma`, `/strategy`).
 *
 * Modulo puro, senza import: lo usano la barra laterale e il suo modello (src/components/shell/sidebar-model.ts) e lo
 * prova `nav-active.test.ts` con `node --test`.
 */

export interface NavItemMatch {
  href: string;
  /** Segmenti sotto la base del workspace, senza barre (`"use-cases"`, `"casi-duso"`). */
  match?: readonly string[];
}

/** I segmenti della voce «Use case» con l'area accesa: le pagine che la sostituiscono restano sotto di lei. */
export const USE_CASE_NAV_MATCH: readonly string[] = Object.freeze(["use-cases", "portfolio", "plan", "casi-duso"]);

/**
 * I segmenti della voce «Contesto» della barra di prima (rilascio 9a), che vale ancora con l'area «Use case» spenta: la
 * pagina `/contesto` con «Da confermare» sotto, e il vecchio indirizzo `/setup/context`, che reindirizza.
 */
export const CONTEXT_NAV_MATCH: readonly string[] = Object.freeze(["contesto", "setup/context"]);

/** (Rilascio 10, §2.4) «Home»: oltre all'indirizzo del workspace, il Programma e gli Obiettivi (oggi `/strategy`). */
export const HOME_NAV_MATCH: readonly string[] = Object.freeze(["programma", "strategy"]);

/** (Rilascio 10, §2.4) «Contesto»: la Memoria, i Processi (`/mapping`) e l'Intervista iniziale (`/setup`). */
export const CONTEXT_SECTION_MATCH: readonly string[] = Object.freeze(["contesto", "mapping", "setup"]);

/** (Rilascio 10, §2.4) «Persone»: AI Readiness e Formazione. */
export const PEOPLE_NAV_MATCH: readonly string[] = Object.freeze(["ai-readiness", "learning"]);

/** Senza barra finale (tranne la radice) e senza query o frammento. */
function normalizePath(path: string): string {
  const cut = path.search(/[?#]/);
  const bare = cut === -1 ? path : path.slice(0, cut);
  const trimmed = bare.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

function trimSlashes(segment: string): string {
  return segment.replace(/^\/+|\/+$/g, "");
}

/** Il segmento della voce sotto la base, oppure null se la voce non sta sotto la base. */
function ownSegment(href: string, base: string): string | null {
  if (href === base) return "";
  const prefix = base === "/" ? "/" : `${base}/`;
  return href.startsWith(prefix) ? href.slice(prefix.length) : null;
}

/** Vero se la voce è quella dell'indirizzo corrente. */
export function isNavItemActive(pathname: string, basePath: string, item: NavItemMatch): boolean {
  const path = normalizePath(pathname);
  const base = normalizePath(basePath);
  const href = normalizePath(item.href);
  const own = ownSegment(href, base);
  // Una voce fuori dal workspace: solo l'indirizzo esatto.
  if (own === null) return path === href;
  const prefix = base === "/" ? "" : base;
  const under = (m: string) => path === `${prefix}/${m}` || path.startsWith(`${prefix}/${m}/`);
  // La base stessa («Home»): l'indirizzo esatto, più gli alias del suo `match`.
  if (own === "") return path === href || (item.match ?? []).map(trimSlashes).filter((m) => m !== "").some(under);
  const segments = (item.match ?? [own]).map(trimSlashes).filter((m) => m !== "");
  if (segments.length === 0) return path === href;
  return segments.some(under);
}
